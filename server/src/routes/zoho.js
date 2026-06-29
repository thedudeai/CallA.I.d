// Zoho integration routes (Zoho spec §8). Most are company-admin only; the OAuth
// callback is public (Zoho redirects the browser to it with a code + state).
import { Router } from 'express';
import { db } from '../db.js';
import { authRequired, isAdmin, audit } from '../auth.js';
import * as zoho from '../integrations/zoho/index.js';

export const router = Router();

function adminOnly(req, res, next) {
  if (!isAdmin(req.user) || !req.companyId) return res.status(403).json({ error: 'forbidden' });
  next();
}

// ---- Public OAuth callback ----
router.get('/zoho/callback', async (req, res) => {
  const { code, state, location } = req.query;
  const accountsServer = req.query['accounts-server'] || req.query.accounts_server;
  const companyId = zoho.resolveState(String(state || ''));
  if (!code || !companyId) return res.status(400).send('Invalid Zoho callback (missing code/state).');
  try {
    await zoho.handleCallback({ companyId, code: String(code), location: location ? String(location) : null, accountsServer: accountsServer ? String(accountsServer) : null });
    audit(null, companyId, 'zoho_connected', companyId, { dc: location || null });
    res.redirect('/settings?zoho=connected');
  } catch (e) {
    res.status(502).send(`Zoho connection failed: ${String(e?.message || e)}`);
  }
});

// ---- Authenticated, admin-only ----
router.get('/zoho/status', authRequired, adminOnly, (req, res) => res.json(zoho.status(req.companyId)));

router.post('/zoho/connect', authRequired, adminOnly, (req, res) => {
  res.json(zoho.startConnect(req.companyId)); // { auth_url } or { sandbox: true }
});

router.post('/zoho/connect/sandbox', authRequired, adminOnly, async (req, res) => {
  const s = await zoho.sandboxConnect(req.companyId);
  audit(req.user.id, req.companyId, 'zoho_connected', req.companyId, { sandbox: true });
  res.json(s);
});

router.post('/zoho/disconnect', authRequired, adminOnly, async (req, res) => {
  await zoho.disconnect(req.companyId);
  audit(req.user.id, req.companyId, 'zoho_disconnected', req.companyId);
  res.json({ ok: true });
});

router.get('/zoho/mappings', authRequired, adminOnly, (req, res) => res.json(zoho.mappings(req.companyId)));

router.patch('/zoho/mappings/:userId', authRequired, adminOnly, (req, res) => {
  const ok = zoho.setMapping(req.companyId, req.params.userId, { crm: req.body?.crm, desk: req.body?.desk });
  if (!ok) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

router.put('/zoho/defaults', authRequired, adminOnly, (req, res) => {
  const ok = zoho.setDefaults(req.companyId, { crm: req.body?.crm, desk: req.body?.desk });
  if (!ok) return res.status(400).json({ error: 'not_connected' });
  res.json({ ok: true });
});

router.get('/zoho/records', authRequired, adminOnly, (req, res) => res.json(zoho.records(req.companyId)));

// Manual (re)sync of one call — admin, or the rep who owns the call. Doubles as
// the on-demand backfill for historical calls (decision §10.5).
router.post('/zoho/sync/:callId', authRequired, async (req, res) => {
  if (!req.companyId) return res.status(400).json({ error: 'company_context_required' });
  const call = db.prepare('SELECT id,user_id FROM calls WHERE id = ? AND company_id = ?').get(req.params.callId, req.companyId);
  if (!call) return res.status(404).json({ error: 'not_found' });
  if (!isAdmin(req.user) && call.user_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  if (!zoho.isConnected(req.companyId)) return res.status(409).json({ error: 'not_connected' });
  try {
    const r = await zoho.syncCall(req.companyId, req.params.callId);
    res.json(r);
  } catch (e) {
    res.status(502).json({ error: 'sync_failed', detail: String(e?.message || e).slice(0, 200) });
  }
});
