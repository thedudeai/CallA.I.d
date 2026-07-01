// AI engine façade. Selects the Claude adapter when the tenant has a valid LLM
// key, otherwise the deterministic fallback. Every method degrades gracefully
// (spec §13): if a live Claude call fails or is slow, we fall back rather than
// block the rep mid-call. The contract is identical across both engines.
import { db } from '../db.js';
import { decrypt, json } from '../util.js';
import { retrieveContext } from './rag.js';
import * as fallback from './fallback.js';
import * as claude from './claude.js';
import { DISCOVERY_SLOTS } from './prompts.js';

function tenantKey(companyId) {
  const row = db.prepare(`SELECT encrypted_key FROM api_keys WHERE company_id = ? AND provider = 'anthropic' AND status = 'active' ORDER BY created_at DESC LIMIT 1`).get(companyId);
  return row ? decrypt(row.encrypted_key) : null;
}

function companyName(companyId) {
  const row = db.prepare('SELECT name FROM companies WHERE id = ?').get(companyId);
  return row?.name || 'the company';
}

// Hydrate a playbook row's JSON columns + attach discovery slots for tracking.
export function hydratePlaybook(row) {
  if (!row) return null;
  const mode = row.mode;
  return {
    ...row,
    stages: json(row.stages, []),
    discovery_bank: json(row.discovery_bank, []),
    rubric_weights: json(row.rubric_weights, {}),
    tactics: json(row.tactics, []),
    discovery_slots: DISCOVERY_SLOTS[mode],
  };
}

// Returns { engine: 'claude'|'fallback', ...guidance }.
export async function liveSuggest(companyId, ctx) {
  const key = tenantKey(companyId);
  const query = (ctx.transcript || []).slice(-4).map(t => t.text).join(' ') || ctx.mode;
  const kbContext = retrieveContext(companyId, query, 3);
  const full = { ...ctx, kbContext, companyName: companyName(companyId) };
  if (key) {
    try {
      const r = await claude.suggest(key, full);
      return { engine: 'claude', ...r };
    } catch (e) {
      // fall through to deterministic engine — never block the live HUD.
      // Log so a persistently-failing Claude path (bad key, API change) is
      // visible instead of silently degrading every tenant to the fallback.
      console.error('[ai] liveSuggest claude failed, using fallback:', e?.message);
      return { engine: 'fallback', degraded: true, ...fallback.suggest(full) };
    }
  }
  return { engine: 'fallback', ...fallback.suggest(full) };
}

export async function analyzeCall(companyId, ctx) {
  const key = tenantKey(companyId);
  const full = { ...ctx, companyName: companyName(companyId) };
  if (key) {
    try {
      const r = await claude.analyze(key, full);
      return { engine: 'claude', ...r };
    } catch (e) {
      console.error('[ai] analyzeCall claude failed, using fallback:', e?.message);
      return { engine: 'fallback', degraded: true, ...fallback.analyze(full) };
    }
  }
  return { engine: 'fallback', ...fallback.analyze(full) };
}

export async function proposePlaybook(companyId, { filename, text }) {
  const key = tenantKey(companyId);
  if (key) {
    try { return await claude.propose(key, { companyName: companyName(companyId), filename, text }); }
    catch (e) {
      console.error('[ai] proposePlaybook claude failed, using fallback:', e?.message);
      return fallback.propose({ filename, text });
    }
  }
  return fallback.propose({ filename, text });
}

export function hasKey(companyId) {
  return !!tenantKey(companyId);
}
