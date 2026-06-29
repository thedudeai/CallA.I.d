// Sandbox Zoho: simulates a connected org (CRM users + Desk agents derived from
// the tenant's own reps, so email auto-matching works), and records every
// "pushed" record to zoho_mirror. This makes the integration end-to-end testable
// and demoable without a live Zoho org or real OAuth credentials. The real
// adapters (client.js + adapters.js) share the same high-level interface.
import { randomBytes } from 'node:crypto';
import { db } from '../../db.js';
import { id, now } from '../../util.js';

// Zoho-looking 18-digit numeric id.
export function zid() {
  let s = '';
  for (const b of randomBytes(9)) s += (b % 10).toString();
  return '40' + s.slice(0, 16);
}

export function mockOrg(companyName) {
  return {
    sandbox: true,
    dc_location: 'us',
    accounts_server: 'https://accounts.zoho.com',
    crm_api_domain: 'https://www.zohoapis.com',
    desk_api_base: 'https://desk.zoho.com',
    desk_org_id: zid(),
    desk_department_id: zid(),
    org_name: `${companyName} (Zoho sandbox)`,
    products_enabled: ['crm', 'desk'],
    default_crm_owner_id: null,
    default_desk_agent_id: null,
  };
}

// Fake CRM users / Desk agents = the company's reps + admins, so auto-match by
// email succeeds at connect time.
export function mockCrmUsers(companyId) {
  return db.prepare(`SELECT id,name,email,role FROM users WHERE company_id = ? AND status='active'`).all(companyId)
    .map(u => ({ id: zid(), name: u.name, email: u.email }));
}
export function mockDeskAgents(companyId) {
  return db.prepare(`SELECT id,name,email,role FROM users WHERE company_id = ? AND status='active'`).all(companyId)
    .map(u => ({ id: zid(), name: u.name, email: u.email }));
}

// Record a mirrored write for the in-app "pushed to Zoho" audit. For sandbox the
// zoho_id is generated here; for real writes pass the id Zoho returned.
export function logMirror(companyId, { call_id = null, product, kind, owner = null, payload, sandbox = 1, zoho_id }) {
  const rid = zoho_id || zid();
  db.prepare(`INSERT INTO zoho_mirror (id, company_id, call_id, product, kind, zoho_id, owner, payload, sandbox, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run(id('zm'), companyId, call_id, product, kind, rid, owner, JSON.stringify(payload), sandbox ? 1 : 0, now());
  return rid;
}

// Sandbox shortcut: generate a fake id and mirror it.
export function mirror(companyId, fields) {
  return logMirror(companyId, { ...fields, sandbox: 1 });
}
