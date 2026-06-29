// Persistence for a tenant's Zoho connection. The integrations row (type='zoho')
// holds the connection config as ENCRYPTED JSON at rest — it contains the refresh
// token (Zoho spec §2). The short-lived access token is cached in memory only.
import { db } from '../../db.js';
import { id, now, encrypt, decrypt, json } from '../../util.js';

export function getRow(companyId) {
  return db.prepare(`SELECT * FROM integrations WHERE company_id = ? AND type = 'zoho' ORDER BY created_at DESC LIMIT 1`).get(companyId);
}

// Decrypted config object (or null if not connected).
export function getConfig(companyId) {
  const row = getRow(companyId);
  if (!row) return null;
  const cfg = json(decrypt(row.config), null) || {};
  return { ...cfg, _status: row.status, _id: row.id };
}

export function saveConfig(companyId, cfg, status = 'connected') {
  const row = getRow(companyId);
  const enc = encrypt(JSON.stringify(cfg));
  if (row) {
    db.prepare(`UPDATE integrations SET config = ?, status = ? WHERE id = ?`).run(enc, status, row.id);
    return row.id;
  }
  const iid = id('int');
  db.prepare(`INSERT INTO integrations (id, company_id, type, config, status, created_at) VALUES (?,?,?,?,?,?)`)
    .run(iid, companyId, 'zoho', enc, status, now());
  return iid;
}

export function setStatus(companyId, status) {
  const row = getRow(companyId);
  if (row) db.prepare('UPDATE integrations SET status = ? WHERE id = ?').run(status, row.id);
}

export function remove(companyId) {
  const row = getRow(companyId);
  if (row) db.prepare('DELETE FROM integrations WHERE id = ?').run(row.id);
}

export function isConnected(companyId) {
  const row = getRow(companyId);
  return !!row && row.status === 'connected';
}

// ---- In-memory access-token cache (per tenant). Never persisted. ----
const tokenCache = new Map(); // companyId -> { access_token, expiresAt }

export function getCachedToken(companyId) {
  const t = tokenCache.get(companyId);
  // Proactive refresh window: treat as stale ~5 min before expiry (spec §4).
  if (t && t.expiresAt - Date.now() > 5 * 60 * 1000) return t.access_token;
  return null;
}
export function setCachedToken(companyId, access_token, expiresInSec) {
  tokenCache.set(companyId, { access_token, expiresAt: Date.now() + expiresInSec * 1000 });
}
export function clearCachedToken(companyId) { tokenCache.delete(companyId); }
