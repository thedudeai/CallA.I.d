// Zoho OAuth: code exchange, token refresh, revoke (Zoho spec §3.4 / §4).
// Multi-DC aware — every call uses the tenant's stored accounts-server, not a
// hardcoded .com. Refreshes are serialized per tenant so concurrent jobs don't
// mint multiple tokens and burn the refresh budget.
import { CLIENT_ID, CLIENT_SECRET, REDIRECT_URI } from './config.js';
import { getConfig, saveConfig, setStatus, getCachedToken, setCachedToken, clearCachedToken } from './store.js';

async function postForm(url, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString(),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// Exchange the authorization code at the DC-specific accounts-server. Returns the
// token payload incl. refresh_token + api_domain (the CRM domain).
export async function exchangeCode({ code, accountsServer }) {
  const { ok, data } = await postForm(`${accountsServer}/oauth/v2/token`, {
    grant_type: 'authorization_code',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    redirect_uri: REDIRECT_URI,
    code,
  });
  if (!ok || !data.refresh_token) throw new Error(`token_exchange_failed: ${data.error || 'no_refresh_token'}`);
  return data; // { access_token, refresh_token, expires_in, api_domain }
}

// Per-tenant in-flight refresh lock.
const inflight = new Map();

export async function getAccessToken(companyId) {
  const cached = getCachedToken(companyId);
  if (cached) return cached;
  if (inflight.has(companyId)) return inflight.get(companyId);
  const p = doRefresh(companyId).finally(() => inflight.delete(companyId));
  inflight.set(companyId, p);
  return p;
}

async function doRefresh(companyId) {
  const cfg = getConfig(companyId);
  if (!cfg?.refresh_token || !cfg?.accounts_server) throw new Error('not_connected');
  const { ok, status, data } = await postForm(`${cfg.accounts_server}/oauth/v2/token`, {
    grant_type: 'refresh_token',
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    refresh_token: cfg.refresh_token,
  });
  if (!ok || !data.access_token) {
    // Repeated auth failures → mark for re-consent and surface a banner (spec §4).
    if (status === 401 || data.error === 'invalid_code' || data.error === 'invalid_grant') {
      setStatus(companyId, 'needs_reauth');
    }
    throw new Error(`refresh_failed: ${data.error || status}`);
  }
  setCachedToken(companyId, data.access_token, data.expires_in || 3600);
  return data.access_token;
}

export async function revoke(companyId) {
  const cfg = getConfig(companyId);
  clearCachedToken(companyId);
  if (cfg?.refresh_token && cfg?.accounts_server) {
    try { await postForm(`${cfg.accounts_server}/oauth/v2/token/revoke`, { token: cfg.refresh_token }); }
    catch { /* best-effort */ }
  }
}
