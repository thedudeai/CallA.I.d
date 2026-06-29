// Playbooks + proposals (spec §6.3 / §10). Reps can read; admins CRUD.
import { Router } from 'express';
import { db } from '../db.js';
import { authRequired, isAdmin, audit } from '../auth.js';
import { hydratePlaybook } from '../ai/index.js';
import { id, now, json } from '../util.js';

export const router = Router();
router.use(authRequired);

function adminOnly(req, res, next) {
  if (!isAdmin(req.user) || !req.companyId) return res.status(403).json({ error: 'forbidden' });
  next();
}

router.get('/playbooks', (req, res) => {
  if (!req.companyId) return res.status(400).json({ error: 'company_context_required' });
  const rows = db.prepare(`SELECT * FROM playbooks WHERE company_id = ? AND status='active' ORDER BY mode, created_at`).all(req.companyId);
  res.json(rows.map(hydratePlaybook));
});

router.post('/playbooks', adminOnly, (req, res) => {
  const b = req.body || {};
  if (!b.name || !b.mode) return res.status(400).json({ error: 'name_mode_required' });
  const pid = id('pb');
  db.prepare(`INSERT INTO playbooks (id,company_id,mode,name,emoji,description,stages,discovery_bank,rubric_weights,tactics,source,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    pid, req.companyId, b.mode, b.name, b.emoji || '📘', b.description || '',
    JSON.stringify(b.stages || []), JSON.stringify(b.discovery_bank || []),
    JSON.stringify(b.rubric_weights || {}), JSON.stringify(b.tactics || []), b.source || 'custom', 'active', now());
  audit(req.user.id, req.companyId, 'create_playbook', pid, { name: b.name });
  res.status(201).json(hydratePlaybook(db.prepare('SELECT * FROM playbooks WHERE id = ?').get(pid)));
});

router.patch('/playbooks/:pid', adminOnly, (req, res) => {
  const pb = db.prepare('SELECT * FROM playbooks WHERE id = ? AND company_id = ?').get(req.params.pid, req.companyId);
  if (!pb) return res.status(404).json({ error: 'not_found' });
  const b = req.body || {};
  const map = { name: 'name', emoji: 'emoji', description: 'description', mode: 'mode' };
  const jsonMap = { stages: 'stages', discovery_bank: 'discovery_bank', rubric_weights: 'rubric_weights', tactics: 'tactics' };
  const sets = [], vals = [];
  for (const k of Object.keys(map)) if (k in b) { sets.push(`${k} = ?`); vals.push(b[k]); }
  for (const k of Object.keys(jsonMap)) if (k in b) { sets.push(`${k} = ?`); vals.push(JSON.stringify(b[k])); }
  if (!sets.length) return res.status(400).json({ error: 'no_fields' });
  db.prepare(`UPDATE playbooks SET ${sets.join(', ')} WHERE id = ?`).run(...vals, req.params.pid);
  audit(req.user.id, req.companyId, 'update_playbook', req.params.pid, b);
  res.json(hydratePlaybook(db.prepare('SELECT * FROM playbooks WHERE id = ?').get(req.params.pid)));
});

router.delete('/playbooks/:pid', adminOnly, (req, res) => {
  const pb = db.prepare('SELECT * FROM playbooks WHERE id = ? AND company_id = ?').get(req.params.pid, req.companyId);
  if (!pb) return res.status(404).json({ error: 'not_found' });
  db.prepare(`UPDATE playbooks SET status='archived' WHERE id = ?`).run(req.params.pid);
  audit(req.user.id, req.companyId, 'delete_playbook', req.params.pid);
  res.json({ ok: true });
});

// ---- Proposals ----
router.get('/playbook-proposals', (req, res) => {
  if (!req.companyId) return res.status(400).json({ error: 'company_context_required' });
  const rows = db.prepare(`SELECT * FROM playbook_proposals WHERE company_id = ? AND status='pending' ORDER BY created_at`).all(req.companyId);
  res.json(rows.map(r => ({ id: r.id, source_filename: r.source_filename, status: r.status, draft: json(r.draft, {}) })));
});

router.post('/playbook-proposals/:pid/accept', adminOnly, (req, res) => {
  const p = db.prepare('SELECT * FROM playbook_proposals WHERE id = ? AND company_id = ?').get(req.params.pid, req.companyId);
  if (!p || p.status !== 'pending') return res.status(404).json({ error: 'not_found' });
  const d = json(p.draft, {});
  const pid = id('pb');
  db.prepare(`INSERT INTO playbooks (id,company_id,mode,name,emoji,description,stages,discovery_bank,rubric_weights,tactics,source,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    pid, req.companyId, d.mode || 'sales', d.name, d.emoji || '✨', d.description || '',
    JSON.stringify(d.stages || []), JSON.stringify(d.discovery_bank || []),
    JSON.stringify(d.rubric_weights || {}), JSON.stringify(d.tactics || []), 'ai-proposed', 'active', now());
  db.prepare(`UPDATE playbook_proposals SET status='accepted' WHERE id = ?`).run(req.params.pid);
  audit(req.user.id, req.companyId, 'accept_proposal', pid, { name: d.name });
  res.status(201).json(hydratePlaybook(db.prepare('SELECT * FROM playbooks WHERE id = ?').get(pid)));
});

router.post('/playbook-proposals/:pid/dismiss', adminOnly, (req, res) => {
  const p = db.prepare('SELECT * FROM playbook_proposals WHERE id = ? AND company_id = ?').get(req.params.pid, req.companyId);
  if (!p) return res.status(404).json({ error: 'not_found' });
  db.prepare(`UPDATE playbook_proposals SET status='dismissed' WHERE id = ?`).run(req.params.pid);
  audit(req.user.id, req.companyId, 'dismiss_proposal', req.params.pid);
  res.json({ ok: true });
});
