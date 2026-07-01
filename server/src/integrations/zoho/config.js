// Zoho integration configuration (companion Zoho spec §1–§3).
//
// The platform-owner registers ONE server-based, multi-DC OAuth client and puts
// its credentials in the environment (never per-tenant, never logged). When those
// env vars are absent, the integration runs in SANDBOX mode: the OAuth code path
// and all CRM/Desk adapters are present, but "connect" simulates a Zoho org and
// writes go to the local zoho_mirror table — so the whole feature is demoable and
// testable without a live Zoho org or real credentials.

export const CLIENT_ID = process.env.CALLAID_ZOHO_CLIENT_ID || '';
export const CLIENT_SECRET = process.env.CALLAID_ZOHO_CLIENT_SECRET || '';
export const REDIRECT_URI = process.env.CALLAID_ZOHO_REDIRECT_URI || 'http://localhost:4000/api/zoho/callback';

// SANDBOX when no real client is configured. A tenant can also be sandbox-only
// (config.sandbox === true) even if global creds exist — used for demos.
export const GLOBAL_SANDBOX = !(CLIENT_ID && CLIENT_SECRET);

// CRM API version base path (currently v8 per the spec; bump here when Zoho does).
export const CRM_VERSION = process.env.CALLAID_ZOHO_CRM_VERSION || 'v8';
export const DESK_VERSION = 'v1';

// Single consent, both products (Zoho spec §3.2). Exact strings are the spec's
// suggested set — confirm against live docs before a production launch.
export const SCOPES = [
  'ZohoCRM.modules.contacts.ALL',
  'ZohoCRM.modules.calls.ALL',
  'ZohoCRM.modules.tasks.ALL',
  'ZohoCRM.modules.events.ALL',
  'ZohoCRM.users.READ',
  'ZohoCRM.settings.READ',
  'Desk.tickets.ALL',
  'Desk.contacts.ALL',
  'Desk.tasks.ALL',
  'Desk.basic.READ',
  'Desk.settings.READ',
];

// Always initiate authorization against the .com accounts server for multi-DC;
// Zoho routes the user to their own DC and returns `location` + `accounts-server`.
export const MULTI_DC_AUTH_SERVER = 'https://accounts.zoho.com';

// Per-DC servers. `crm_api_domain` is authoritative from the token response's
// `api_domain`; this table is the fallback + the Desk base (which the token
// response does not provide). Desk bases marked (confirm) per the spec.
export const DC = {
  us: { accounts: 'https://accounts.zoho.com', crm: 'https://www.zohoapis.com', desk: 'https://desk.zoho.com' },
  eu: { accounts: 'https://accounts.zoho.eu', crm: 'https://www.zohoapis.eu', desk: 'https://desk.zoho.eu' },
  in: { accounts: 'https://accounts.zoho.in', crm: 'https://www.zohoapis.in', desk: 'https://desk.zoho.in' },
  au: { accounts: 'https://accounts.zoho.com.au', crm: 'https://www.zohoapis.com.au', desk: 'https://desk.zoho.com.au' },
  jp: { accounts: 'https://accounts.zoho.jp', crm: 'https://www.zohoapis.jp', desk: 'https://desk.zoho.jp' },
  ca: { accounts: 'https://accounts.zohocloud.ca', crm: 'https://www.zohoapis.ca', desk: 'https://desk.zohocloud.ca' }, // (confirm)
  sa: { accounts: 'https://accounts.zoho.sa', crm: 'https://www.zohoapis.sa', desk: 'https://desk.zoho.sa' },           // (confirm)
  cn: { accounts: 'https://accounts.zoho.com.cn', crm: 'https://www.zohoapis.com.cn', desk: 'https://desk.zoho.com.cn' }, // (confirm)
};

// Map an accounts-server hostname (from the callback) back to a DC key.
export function dcFromAccountsServer(server = '') {
  const found = Object.entries(DC).find(([, v]) => server.startsWith(v.accounts));
  return found ? found[0] : 'us';
}

// SSRF guard. `api_domain` in the OAuth token response is attacker-influenceable
// (a spoofed accounts-server can return an arbitrary value), and we later attach a
// live bearer token to every request built from it — so it must be validated
// against known Zoho API hosts before we persist or use it. Accept only https
// URLs whose host is a Zoho APIs domain (exact DC host, or a subdomain of one).
const ZOHO_API_HOST_SUFFIXES = [
  'zohoapis.com', 'zohoapis.eu', 'zohoapis.in', 'zohoapis.com.au',
  'zohoapis.jp', 'zohoapis.ca', 'zohoapis.sa', 'zohoapis.com.cn',
];
export function isAllowedCrmDomain(value) {
  if (!value) return false;
  let u;
  try { u = new URL(value); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  return ZOHO_API_HOST_SUFFIXES.some(s => host === s || host === `www.${s}` || host.endsWith(`.${s}`));
}

export function authUrl(state) {
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: SCOPES.join(' '),
    redirect_uri: REDIRECT_URI,
    access_type: 'offline', // required to receive a refresh token
    prompt: 'consent',
    state,
  });
  return `${MULTI_DC_AUTH_SERVER}/oauth/v2/auth?${p.toString()}`;
}
