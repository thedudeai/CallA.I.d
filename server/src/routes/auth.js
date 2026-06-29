// Auth routes: login, logout, current user.
import { Router } from 'express';
import { db } from '../db.js';
import { verifyPassword, signToken, authRequired, audit } from '../auth.js';
import { json } from '../util.js';

export const router = Router();

router.post('/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email_password_required' });
  const user = db.prepare('SELECT * FROM users WHERE email = ? AND status = ?').get(String(email).toLowerCase().trim(), 'active');
  if (!user || !verifyPassword(password, user.password_hash)) return res.status(401).json({ error: 'invalid_credentials' });
  const token = signToken(user);
  audit(user.id, user.company_id, 'login', user.id);
  res.json({ token, user: publicUser(user) });
});

router.post('/auth/logout', authRequired, (req, res) => {
  audit(req.user.id, req.companyId, 'logout', req.user.id);
  res.json({ ok: true }); // JWT is stateless; client drops the token
});

router.get('/me', authRequired, (req, res) => {
  const company = req.user.company_id ? db.prepare('SELECT id,name,plan,status,theme,seats FROM companies WHERE id = ?').get(req.user.company_id) : null;
  res.json({ user: publicUser(req.user), company });
});

export function publicUser(u) {
  return {
    id: u.id, company_id: u.company_id, name: u.name, email: u.email, role: u.role,
    default_mode: u.default_mode, default_playbook_id: u.default_playbook_id,
    access_level: u.access_level, status: u.status,
  };
}
