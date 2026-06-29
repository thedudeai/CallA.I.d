// Knowledge ingestion + retrieval (spec §7.1). On upload we chunk text and store
// a lightweight lexical embedding (term-frequency map) per chunk. At inference we
// retrieve the most relevant chunks for the live moment. This is a self-contained
// stand-in for pgvector: the interface (chunk -> embed -> retrieve) is identical,
// so swapping in a real embedding model is a one-function change.
import { db } from '../db.js';
import { id, json } from '../util.js';

const STOP = new Set('the a an and or of to in for on with is are be it this that your you we our as at by from'.split(' '));

function tokenize(text) {
  return (text.toLowerCase().match(/[a-z0-9']+/g) || []).filter(w => w.length > 2 && !STOP.has(w));
}

function termFreq(text) {
  const tf = {};
  for (const w of tokenize(text)) tf[w] = (tf[w] || 0) + 1;
  return tf;
}

export function chunkText(text, size = 600) {
  const clean = text.replace(/\s+/g, ' ').trim();
  const out = [];
  for (let i = 0; i < clean.length; i += size) out.push(clean.slice(i, i + size));
  return out.length ? out : [clean || ''];
}

// Store chunks + lexical vectors for a document.
export function indexDocument(companyId, documentId, text) {
  const insert = db.prepare(
    `INSERT INTO kb_chunks (id, document_id, company_id, seq, text, embedding) VALUES (?,?,?,?,?,?)`
  );
  const chunks = chunkText(text);
  const tx = db.transaction(() => {
    chunks.forEach((c, i) => insert.run(id('chk'), documentId, companyId, i, c, JSON.stringify(termFreq(c))));
  });
  tx();
  return chunks.length;
}

// Retrieve top-k chunks for a query string, scoped to the tenant.
export function retrieve(companyId, query, k = 4) {
  const qtf = termFreq(query);
  const qterms = Object.keys(qtf);
  if (!qterms.length) return [];
  const rows = db.prepare('SELECT id, text, embedding FROM kb_chunks WHERE company_id = ?').all(companyId);
  const scored = rows.map(r => {
    const tf = json(r.embedding, {});
    let score = 0;
    for (const t of qterms) if (tf[t]) score += tf[t] * qtf[t];
    return { id: r.id, text: r.text, score };
  }).filter(r => r.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

export function retrieveContext(companyId, query, k = 4) {
  return retrieve(companyId, query, k).map(r => r.text).join('\n---\n');
}
