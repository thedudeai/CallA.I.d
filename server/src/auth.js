// Auth + RBAC. JWT carries { uid, company_id, role }. RBAC is enforced on the
// SERVER (spec §4) — the UI hint is never the boundary. Tenant scoping is
// applied per-request from the token's company_id; super_admin can cross tenants
// but every cross-tenant action is audit-logged.
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { db } from './db.js';
import { id, now } from './util.js';

const JWT_SECRET = process.env.CALLAID_JWT_SECRET || 'callaid-dev-jwt-secret';
const TOKEN_TTL = '12h';

export function hashPassword(pw) {
  return bcrypt.hashSync(pw, 10);
}
export function verifyPassword(pw, hash) {
  return bcrypt.compareSync(pw, hash);
}

export function signToken(user) {
  return jwt.sign(
    { uid: user.id, company_id: user.company_id, role: user.role },
    JWT_SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

export function audit(actorId, companyId, action, target, detail) {
  db.prepare(
    `INSERT INTO audit_log (id, actor_user_id, company_id, action, target, detail, at)
     VALUES (?,?,?,?,?,?,?)`
  ).run(id('aud'), actorId || null, companyId || null, action, target || null,
        detail ? JSON.stringify(detail) : null, now());
}

// Populates req.user from the Bearer token. 401 if missing/invalid.
export function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'auth_required' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND status = ?').get(payload.uid, 'active');
    if (!user) return res.status(401).json({ error: 'invalid_user' });
    req.user = user;
    // The tenant the request operates on. Super admins may override via header to
    // manage a specific tenant; that override is audit-logged at the route layer.
    req.companyId = user.role === 'super_admin'
      ? (req.headers['x-company-id'] || null)
      : user.company_id;
    next();
  } catch {
    return res.status(401).json({ error: 'invalid_token' });
  }
}

// Role gate. Pass the roles allowed to hit the route.
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'auth_required' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}

// Admin-or-self: company_admin sees all reps; a rep only their own rows.
export function isAdmin(user) {
  return user.role === 'company_admin' || user.role === 'super_admin';
}
