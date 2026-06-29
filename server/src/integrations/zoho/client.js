// Low-level authed HTTP to Zoho CRM (v8) and Desk (v1). Proactive token from the
// OAuth layer; one reactive refresh on 401; exponential backoff on 429 (Zoho spec
// §4 / §9). Used only for REAL connections — sandbox tenants never reach here.
import { getConfig, clearCachedToken } from './store.js';
import { getAccessToken } from './oauth.js';
import { CRM_VERSION, DESK_VERSION } from './config.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function authed(companyId, url, { method = 'GET', body, deskOrgId } = {}, attempt = 0) {
  const token = await getAccessToken(companyId);
  const headers = { Authorization: `Zoho-oauthtoken ${token}` };
  if (body) headers['content-type'] = 'application/json';
  if (deskOrgId) headers.orgId = deskOrgId;
  const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });

  if (res.status === 401 && attempt === 0) {
    clearCachedToken(companyId);                 // force a fresh token, retry once
    return authed(companyId, url, { method, body, deskOrgId }, attempt + 1);
  }
  if (res.status === 429 && attempt < 3) {
    await sleep(500 * Math.pow(2, attempt));     // back off on rate limit
    return authed(companyId, url, { method, body, deskOrgId }, attempt + 1);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`zoho_${res.status}: ${JSON.stringify(data).slice(0, 200)}`);
  return data;
}

export function crmRequest(companyId, path, opts = {}) {
  const cfg = getConfig(companyId);
  if (!cfg?.crm_api_domain) throw new Error('no_crm_domain');
  return authed(companyId, `${cfg.crm_api_domain}/crm/${CRM_VERSION}${path}`, opts);
}

export function deskRequest(companyId, path, opts = {}) {
  const cfg = getConfig(companyId);
  if (!cfg?.desk_api_base) throw new Error('no_desk_base');
  return authed(companyId, `${cfg.desk_api_base}/api/${DESK_VERSION}${path}`, { ...opts, deskOrgId: cfg.desk_org_id });
}
