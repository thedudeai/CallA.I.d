// Company settings: BYO LLM key, integrations, knowledge base upload + auto
// playbook proposal (spec §6.10 / §7.1 / §7.5). Company-admin only.
import { Router } from 'express';
import multer from 'multer';
import { db } from '../db.js';
import { authRequired, isAdmin, audit } from '../auth.js';
import { id, now, encrypt, last4, json } from '../util.js';
import { indexDocument } from '../ai/rag.js';
import { proposePlaybook } from '../ai/index.js';

export const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
router.use(authRequired);

function adminOnly(req, res, next) {
  if (!isAdmin(req.user) || !req.companyId) return res.status(403).json({ error: 'forbidden' });
  next();
}

// ---- AI key (encrypted; only last4 ever returned) ----
router.get('/settings/api-key', adminOnly, (req, res) => {
  const row = db.prepare(`SELECT id,provider,last4,status,created_at FROM api_keys WHERE company_id = ? AND status='active' ORDER BY created_at DESC LIMIT 1`).get(req.companyId);
  res.json(row || null);
});

router.put('/settings/api-key', adminOnly, (req, res) => {
  const { key, provider = 'anthropic' } = req.body || {};
  if (!key) return res.status(400).json({ error: 'key_required' });
  db.prepare(`UPDATE api_keys SET status='revoked' WHERE company_id = ? AND status='active'`).run(req.companyId);
  const kid = id('key');
  db.prepare('INSERT INTO api_keys (id,company_id,provider,encrypted_key,last4,status,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(kid, req.companyId, provider, encrypt(key), last4(key), 'active', now());
  audit(req.user.id, req.companyId, 'rotate_api_key', kid); // never log the key itself
  res.json({ id: kid, provider, last4: last4(key), status: 'active' });
});

router.delete('/settings/api-key', adminOnly, (req, res) => {
  db.prepare(`UPDATE api_keys SET status='revoked' WHERE company_id = ? AND status='active'`).run(req.companyId);
  audit(req.user.id, req.companyId, 'revoke_api_key', req.companyId);
  res.json({ ok: true });
});

// ---- Integrations ----
router.get('/settings/integrations', adminOnly, (req, res) => {
  res.json(db.prepare('SELECT id,type,status FROM integrations WHERE company_id = ? ORDER BY type').all(req.companyId));
});

router.post('/settings/integrations', adminOnly, (req, res) => {
  const { type, status = 'connected', config = {} } = req.body || {};
  if (!type) return res.status(400).json({ error: 'type_required' });
  const existing = db.prepare('SELECT id FROM integrations WHERE company_id = ? AND type = ?').get(req.companyId, type);
  if (existing) {
    db.prepare('UPDATE integrations SET status = ?, config = ? WHERE id = ?').run(status, JSON.stringify(config), existing.id);
    return res.json({ id: existing.id, type, status });
  }
  const iid = id('int');
  db.prepare('INSERT INTO integrations (id,company_id,type,config,status,created_at) VALUES (?,?,?,?,?,?)')
    .run(iid, req.companyId, type, JSON.stringify(config), status, now());
  res.status(201).json({ id: iid, type, status });
});

// ---- Appearance / plan / seats live on the company row ----
router.patch('/settings/company', adminOnly, (req, res) => {
  const fields = ['theme', 'seats', 'name'].filter(f => f in (req.body || {}));
  if (!fields.length) return res.status(400).json({ error: 'no_fields' });
  db.prepare(`UPDATE companies SET ${fields.map(f => `${f} = ?`).join(', ')} WHERE id = ?`).run(...fields.map(f => req.body[f]), req.companyId);
  audit(req.user.id, req.companyId, 'update_company_settings', req.companyId, req.body);
  res.json(db.prepare('SELECT id,name,plan,status,theme,seats FROM companies WHERE id = ?').get(req.companyId));
});

// ---- Knowledge base ----
router.get('/kb/documents', adminOnly, (req, res) => {
  res.json(db.prepare('SELECT id,filename,type,status,size_bytes,created_at FROM kb_documents WHERE company_id = ? ORDER BY created_at').all(req.companyId));
});

// Upload a doc: store, chunk+index (RAG), then run the auto-proposal pass.
router.post('/kb/documents', adminOnly, upload.single('file'), async (req, res) => {
  const file = req.file;
  const filename = file?.originalname || req.body?.filename;
  if (!filename) return res.status(400).json({ error: 'file_required' });
  const text = file ? file.buffer.toString('utf8') : (req.body?.text || '');
  const did = id('doc');
  db.prepare('INSERT INTO kb_documents (id,company_id,filename,type,status,size_bytes,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(did, req.companyId, filename, guessType(filename), 'indexing', text.length, now());
  indexDocument(req.companyId, did, text);
  // Auto-propose a playbook if the material warrants one (spec §6.3 / §7.5).
  let proposal = null;
  const draft = await proposePlaybook(req.companyId, { filename, text });
  let status = 'indexed';
  if (draft) {
    status = 'analyzed';
    const pid = id('prop');
    db.prepare('INSERT INTO playbook_proposals (id,company_id,source_document_id,source_filename,draft,status,created_at) VALUES (?,?,?,?,?,?,?)')
      .run(pid, req.companyId, did, filename, JSON.stringify(draft), 'pending', now());
    proposal = { id: pid, source_filename: filename, draft };
  }
  db.prepare('UPDATE kb_documents SET status = ? WHERE id = ?').run(status, did);
  audit(req.user.id, req.companyId, 'upload_kb_document', did, { filename });
  res.status(201).json({ document: db.prepare('SELECT id,filename,type,status,size_bytes FROM kb_documents WHERE id = ?').get(did), proposal });
});

router.delete('/kb/documents/:did', adminOnly, (req, res) => {
  const doc = db.prepare('SELECT * FROM kb_documents WHERE id = ? AND company_id = ?').get(req.params.did, req.companyId);
  if (!doc) return res.status(404).json({ error: 'not_found' });
  db.prepare('DELETE FROM kb_documents WHERE id = ?').run(req.params.did); // cascades chunks
  audit(req.user.id, req.companyId, 'delete_kb_document', req.params.did);
  res.json({ ok: true });
});

function guessType(fn) {
  const ext = (fn.split('.').pop() || '').toLowerCase();
  return ['pdf', 'docx', 'doc', 'txt', 'md'].includes(ext) ? (ext === 'doc' ? 'docx' : ext) : 'doc';
}
