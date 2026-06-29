// Facade the routes call. Owns connect/callback/sandbox-connect, identity
// auto-matching, rep mapping, default owners, manual sync, and the records view.
import { randomBytes } from 'node:crypto';
import { db } from '../../db.js';
import { json } from '../../util.js';
import { GLOBAL_SANDBOX, authUrl, dcFromAccountsServer, DC } from './config.js';
import { getConfig, saveConfig, isConnected, remove, clearCachedToken } from './store.js';
import { exchangeCode, revoke } from './oauth.js';
import { fetchIdentities, fetchDeskOrg } from './adapters.js';
import { mockOrg } from './mock.js';
import { EPHEMERAL_DB } from '../../db.js';
import { enqueueSync, syncCall } from './sync.js';

export { enqueueSync, syncCall };

// Post-call hook. On a long-lived host, enqueue and return immediately (never
// block the HUD/analysis). On serverless (EPHEMERAL_DB) there's no background
// worker and the function freezes after responding, so run the sync inline.
export async function syncOnComplete(companyId, callId) {
  if (!isConnected(companyId)) return;
  if (EPHEMERAL_DB) { try { await syncCall(companyId, callId); } catch { /* surfaced via call status + manual re-sync */ } }
  else enqueueSync(companyId, callId);
}

// Short-lived OAuth state → companyId (single-instance; fine for admin-initiated
// connect). state also guards against CSRF on the callback.
const pendingState = new Map();
function newState(companyId) {
  const s = randomBytes(16).toString('hex');
  pendingState.set(s, { companyId, ts: Date.now() });
  // expire stale states
  for (const [k, v] of pendingState) if (Date.now() - v.ts > 10 * 60 * 1000) pendingState.delete(k);
  return s;
}

export function status(companyId) {
  const cfg = getConfig(companyId);
  if (!cfg) return { connected: false, sandbox_available: GLOBAL_SANDBOX };
  const mapped = db.prepare(`SELECT COUNT(*) c FROM users WHERE company_id = ? AND (zoho_crm_user_id IS NOT NULL OR zoho_desk_agent_id IS NOT NULL)`).get(companyId).c;
  const total = db.prepare(`SELECT COUNT(*) c FROM users WHERE company_id = ? AND role IN ('sales_rep','customer_service_rep','company_admin')`).get(companyId).c;
  return {
    connected: cfg._status === 'connected',
    status: cfg._status,
    sandbox: !!cfg.sandbox,
    dc_location: cfg.dc_location,
    org_name: cfg.org_name,
    products_enabled: cfg.products_enabled || [],
    desk_org_id: cfg.desk_org_id || null,
    default_crm_owner_id: cfg.default_crm_owner_id || null,
    default_desk_agent_id: cfg.default_desk_agent_id || null,
    mapped_users: mapped, total_users: total,
  };
}

// Begin a real OAuth connect (returns the Zoho consent URL). When no platform
// client is configured, the caller uses sandboxConnect instead.
export function startConnect(companyId) {
  if (GLOBAL_SANDBOX) return { sandbox: true };
  const state = newState(companyId);
  return { auth_url: authUrl(state) };
}

export function resolveState(state) {
  const e = pendingState.get(state);
  if (e) pendingState.delete(state);
  return e?.companyId || null;
}

// Real OAuth callback: exchange code at the DC server, persist DC + tokens, fetch
// Desk org, auto-match identities (Zoho spec §3.4).
export async function handleCallback({ companyId, code, location, accountsServer }) {
  const dc = location || dcFromAccountsServer(accountsServer || '');
  const accounts = accountsServer || DC[dc]?.accounts || DC.us.accounts;
  const tok = await exchangeCode({ code, accountsServer: accounts });
  const cfg = {
    sandbox: false,
    refresh_token: tok.refresh_token,
    dc_location: dc,
    accounts_server: accounts,
    crm_api_domain: tok.api_domain || DC[dc]?.crm,
    desk_api_base: DC[dc]?.desk,
    products_enabled: ['crm', 'desk'],
  };
  saveConfig(companyId, cfg, 'connected');
  // Desk org id (required header on every Desk call) + identities.
  try { const org = await fetchDeskOrg(companyId); cfg.desk_org_id = org.id; cfg.org_name = org.name; } catch { /* desk may be absent */ }
  await connectFinalize(companyId, cfg);
  return { companyId };
}

// Instant sandbox/demo connection: no real Zoho org needed (Zoho spec demo path).
export async function sandboxConnect(companyId) {
  const company = db.prepare('SELECT name FROM companies WHERE id = ?').get(companyId);
  const cfg = mockOrg(company?.name || 'Company');
  saveConfig(companyId, cfg, 'connected');
  await connectFinalize(companyId, cfg);
  return status(companyId);
}

// Shared: fetch identities, snapshot them on the config (for the mapping UI),
// auto-match by email, set fallback default owners, persist.
async function connectFinalize(companyId, cfg) {
  const ids = await fetchIdentities(companyId);
  cfg.crm_users = ids.crmUsers;
  cfg.desk_agents = ids.deskAgents;
  autoMatch(companyId, ids);
  // Default owners = the company admin's mapped identities, when available.
  const admin = db.prepare(`SELECT id,email FROM users WHERE company_id = ? AND role = 'company_admin' LIMIT 1`).get(companyId);
  if (admin) {
    cfg.default_crm_owner_id = ids.crmUsers.find(u => sameEmail(u.email, admin.email))?.id || ids.crmUsers[0]?.id || null;
    cfg.default_desk_agent_id = ids.deskAgents.find(a => sameEmail(a.email, admin.email))?.id || ids.deskAgents[0]?.id || null;
  }
  if (!cfg.desk_org_id && cfg.sandbox) { /* mockOrg already set one */ }
  saveConfig(companyId, cfg, 'connected');
}

function sameEmail(a, b) { return a && b && a.toLowerCase() === b.toLowerCase(); }

function autoMatch(companyId, ids) {
  const users = db.prepare('SELECT id,email FROM users WHERE company_id = ?').all(companyId);
  for (const u of users) {
    const crm = ids.crmUsers.find(x => sameEmail(x.email, u.email));
    const desk = ids.deskAgents.find(x => sameEmail(x.email, u.email));
    if (crm || desk) db.prepare('UPDATE users SET zoho_crm_user_id = COALESCE(?, zoho_crm_user_id), zoho_desk_agent_id = COALESCE(?, zoho_desk_agent_id) WHERE id = ?')
      .run(crm?.id || null, desk?.id || null, u.id);
  }
}

export function mappings(companyId) {
  const cfg = getConfig(companyId) || {};
  const users = db.prepare(`SELECT id,name,email,role,zoho_crm_user_id,zoho_desk_agent_id FROM users WHERE company_id = ? ORDER BY role, name`).all(companyId);
  return {
    users,
    crm_users: cfg.crm_users || [],
    desk_agents: cfg.desk_agents || [],
    default_crm_owner_id: cfg.default_crm_owner_id || null,
    default_desk_agent_id: cfg.default_desk_agent_id || null,
  };
}

export function setMapping(companyId, userId, { crm, desk }) {
  const u = db.prepare('SELECT id FROM users WHERE id = ? AND company_id = ?').get(userId, companyId);
  if (!u) return false;
  if (crm !== undefined) db.prepare('UPDATE users SET zoho_crm_user_id = ? WHERE id = ?').run(crm || null, userId);
  if (desk !== undefined) db.prepare('UPDATE users SET zoho_desk_agent_id = ? WHERE id = ?').run(desk || null, userId);
  return true;
}

export function setDefaults(companyId, { crm, desk }) {
  const cfg = getConfig(companyId);
  if (!cfg) return false;
  if (crm !== undefined) cfg.default_crm_owner_id = crm || null;
  if (desk !== undefined) cfg.default_desk_agent_id = desk || null;
  delete cfg._status; delete cfg._id;
  saveConfig(companyId, cfg, 'connected');
  return true;
}

export async function disconnect(companyId) {
  if (!isConnected(companyId)) { remove(companyId); return; }
  await revoke(companyId);
  clearCachedToken(companyId);
  remove(companyId);
}

// Records view: what was (or would be) pushed to Zoho + per-call status.
export function records(companyId, limit = 50) {
  const mirror = db.prepare(`SELECT call_id, product, kind, zoho_id, owner, payload, sandbox, created_at FROM zoho_mirror WHERE company_id = ? ORDER BY created_at DESC LIMIT ?`).all(companyId, limit)
    .map(r => ({ ...r, payload: json(r.payload, {}), sandbox: !!r.sandbox }));
  const calls = db.prepare(`SELECT id, contact_name, mode, zoho_sync_status, zoho_record_id, zoho_product FROM calls WHERE company_id = ? AND zoho_sync_status IS NOT NULL AND zoho_sync_status != 'pending' ORDER BY started_at DESC LIMIT ?`).all(companyId, limit);
  const counts = db.prepare(`SELECT product, kind, COUNT(*) n FROM zoho_mirror WHERE company_id = ? GROUP BY product, kind`).all(companyId);
  return { mirror, calls, counts };
}

export { isConnected };
