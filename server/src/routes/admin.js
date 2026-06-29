// Company (super-admin) + user management routes (spec §10).
import { Router } from 'express';
import { db } from '../db.js';
import { authRequired, requireRole, isAdmin, audit, hashPassword } from '../auth.js';
import { publicUser } from './auth.js';
import { id, now } from '../util.js';

export const router = Router();
router.use(authRequired);

// ---- Companies: super-admin only (the only place tenants are created) ----
router.get('/companies', requireRole('super_admin'), (req, res) => {
  const rows = db.prepare('SELECT * FROM companies ORDER BY created_at').all();
  res.json(rows.map(c => ({ ...c, ...companyUsage(c.id) })));
});

router.post('/companies', requireRole('super_admin'), (req, res) => {
  const { name, plan = 'Starter', seats = 5, theme = 'aurora', admin } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name_required' });
  const cid = id('co');
  db.prepare('INSERT INTO companies (id,name,plan,status,theme,seats,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(cid, name, plan, 'trial', theme, seats, now());
  let createdAdmin = null;
  if (admin?.email && admin?.name) {
    const uid = id('usr');
    db.prepare(`INSERT INTO users (id,company_id,name,email,password_hash,role,default_mode,access_level,status,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(uid, cid, admin.name, String(admin.email).toLowerCase(), hashPassword(admin.password || 'demo1234'), 'company_admin', 'care', 'full', 'active', now());
    createdAdmin = uid;
  }
  audit(req.user.id, null, 'create_company', cid, { name });
  res.status(201).json({ ...db.prepare('SELECT * FROM companies WHERE id = ?').get(cid), ...companyUsage(cid), admin_user_id: createdAdmin });
});

router.patch('/companies/:cid', requireRole('super_admin'), (req, res) => {
  const fields = ['name', 'plan', 'status', 'theme', 'seats'].filter(f => f in (req.body || {}));
  if (!fields.length) return res.status(400).json({ error: 'no_fields' });
  db.prepare(`UPDATE companies SET ${fields.map(f => `${f} = ?`).join(', ')} WHERE id = ?`).run(...fields.map(f => req.body[f]), req.params.cid);
  audit(req.user.id, null, 'update_company', req.params.cid, req.body);
  res.json(db.prepare('SELECT * FROM companies WHERE id = ?').get(req.params.cid));
});

function companyUsage(cid) {
  const seatsUsed = db.prepare('SELECT COUNT(*) c FROM users WHERE company_id = ?').get(cid).c;
  const calls = db.prepare('SELECT COUNT(*) c FROM calls WHERE company_id = ?').get(cid).c;
  return { seats_used: seatsUsed, calls_count: calls };
}

// ---- Users: company-admin (own company) or super-admin (any) ----
router.get('/users', (req, res) => {
  if (!req.companyId) return res.status(400).json({ error: 'company_context_required' });
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'forbidden' });
  const rows = db.prepare('SELECT * FROM users WHERE company_id = ? ORDER BY created_at').all(req.companyId);
  res.json(rows.map(publicUser));
});

router.post('/users', (req, res) => {
  if (!isAdmin(req.user) || !req.companyId) return res.status(403).json({ error: 'forbidden' });
  const { name, email, role = 'customer_service_rep', default_mode = 'care', access_level = 'self', password = 'demo1234', default_playbook_id = null } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'name_email_required' });
  const seats = db.prepare('SELECT seats FROM companies WHERE id = ?').get(req.companyId).seats;
  const used = db.prepare('SELECT COUNT(*) c FROM users WHERE company_id = ?').get(req.companyId).c;
  if (used >= seats) return res.status(409).json({ error: 'seat_limit_reached' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(String(email).toLowerCase())) return res.status(409).json({ error: 'email_taken' });
  const uid = id('usr');
  db.prepare(`INSERT INTO users (id,company_id,name,email,password_hash,role,default_mode,default_playbook_id,access_level,status,created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(uid, req.companyId, name, String(email).toLowerCase(), hashPassword(password), role, default_mode, default_playbook_id, access_level, 'active', now());
  audit(req.user.id, req.companyId, 'create_user', uid, { role });
  res.status(201).json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(uid)));
});

router.patch('/users/:uid', (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'forbidden' });
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.uid);
  if (!target || (req.user.role !== 'super_admin' && target.company_id !== req.companyId)) return res.status(404).json({ error: 'not_found' });
  const fields = ['name', 'role', 'default_mode', 'default_playbook_id', 'access_level', 'status'].filter(f => f in (req.body || {}));
  if (!fields.length) return res.status(400).json({ error: 'no_fields' });
  db.prepare(`UPDATE users SET ${fields.map(f => `${f} = ?`).join(', ')} WHERE id = ?`).run(...fields.map(f => req.body[f]), req.params.uid);
  audit(req.user.id, req.companyId, 'update_user', req.params.uid, req.body);
  res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.uid)));
});

router.delete('/users/:uid', (req, res) => {
  if (!isAdmin(req.user)) return res.status(403).json({ error: 'forbidden' });
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.uid);
  if (!target || (req.user.role !== 'super_admin' && target.company_id !== req.companyId)) return res.status(404).json({ error: 'not_found' });
  db.prepare('DELETE FROM users WHERE id = ?').run(req.params.uid);
  audit(req.user.id, req.companyId, 'delete_user', req.params.uid);
  res.json({ ok: true });
});
