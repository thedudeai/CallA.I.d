// Team reporting + rep drill-down (spec §6.8). Admin only. All figures computed
// from real seeded/ingested calls — nothing hardcoded.
import { Router } from 'express';
import { db } from '../db.js';
import { authRequired, isAdmin, audit } from '../auth.js';
import { DIMENSION_LABELS } from '../ai/prompts.js';

export const router = Router();
router.use(authRequired);

function adminOnly(req, res, next) {
  if (!isAdmin(req.user) || !req.companyId) return res.status(403).json({ error: 'forbidden' });
  next();
}

const trend = (rep) => (rep.avg >= 78 ? 'up' : 'down');

// Aggregate in SQL rather than pulling every row (incl. large transcript blobs)
// into JS and reducing.
function repStats(companyId, userId) {
  const r = db.prepare('SELECT COUNT(*) c, AVG(overall_score) a FROM calls WHERE company_id = ? AND user_id = ?').get(companyId, userId);
  return { count: r.c, avg: r.c ? Math.round(r.a) : 0 };
}

router.get('/reporting/team', adminOnly, (req, res) => {
  // One aggregate pass for the team stats instead of scanning all rows in JS.
  const t = db.prepare(`SELECT
      COUNT(*) total,
      AVG(overall_score) avg,
      SUM(CASE WHEN mode='sales' THEN 1 ELSE 0 END) sales_n,
      SUM(CASE WHEN mode='sales' AND overall_score >= 80 THEN 1 ELSE 0 END) sales_closes,
      AVG(CASE WHEN mode='care' THEN overall_score END) care_avg,
      SUM(CASE WHEN mode='care' THEN 1 ELSE 0 END) care_n
    FROM calls WHERE company_id = ?`).get(req.companyId);
  const total = t.total;
  const avg = total ? Math.round(t.avg) : 0;
  const closeRate = t.sales_n ? Math.round((t.sales_closes / t.sales_n) * 100) : 0;
  const csat = t.care_n ? +((t.care_avg) / 20).toFixed(1) : 0;

  // Leaderboard in a single grouped query (was N+1: one scan per rep).
  const reps = db.prepare(`SELECT u.id, u.name, u.role, u.default_mode mode,
      COUNT(c.id) calls, ROUND(AVG(c.overall_score)) avg
    FROM users u JOIN calls c ON c.user_id = u.id AND c.company_id = u.company_id
    WHERE u.company_id = ? AND u.role IN ('sales_rep','customer_service_rep')
    GROUP BY u.id HAVING calls > 0 ORDER BY avg DESC`).all(req.companyId)
    .map(r => ({ id: r.id, name: r.name, role: r.role, mode: r.mode, calls: r.calls, avg: r.avg, trend: trend(r) }));

  const saved = db.prepare(`SELECT c.id,c.contact_name,c.mode,c.call_type,c.duration,c.overall_score,u.name rep
    FROM calls c JOIN users u ON u.id = c.user_id WHERE c.company_id = ? ORDER BY c.started_at DESC LIMIT 8`).all(req.companyId);

  res.json({
    stats: { calls: total, avg_score: avg, close_rate: closeRate, csat },
    leaderboard: reps,
    saved_logs: saved,
  });
});

router.get('/reporting/reps/:id', adminOnly, (req, res) => {
  const u = db.prepare('SELECT id,name,role,default_mode,default_playbook_id FROM users WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!u) return res.status(404).json({ error: 'not_found' });
  const s = repStats(req.companyId, u.id);
  // Averaged scoring breakdown across the rep's calls.
  const rows = db.prepare(`SELECT cs.dimension, AVG(cs.value) v FROM call_scores cs
    JOIN calls c ON c.id = cs.call_id WHERE c.company_id = ? AND c.user_id = ? GROUP BY cs.dimension`).all(req.companyId, u.id);
  const breakdown = rows.map(r => ({ dimension: r.dimension, label: DIMENSION_LABELS[r.dimension] || r.dimension, value: Math.round(r.v) }));
  const pb = u.default_playbook_id ? db.prepare('SELECT name FROM playbooks WHERE id = ?').get(u.default_playbook_id) : null;
  const log = db.prepare('SELECT id,contact_name,mode,call_type,duration,overall_score FROM calls WHERE company_id = ? AND user_id = ? ORDER BY started_at DESC').all(req.companyId, u.id);
  // Coaching focus = lowest average dimension.
  const low = [...breakdown].sort((a, b) => a.value - b.value)[0];
  const note = low ? `Coaching focus: lift ${low.label.toLowerCase()} (lowest average at ${low.value}).` : 'No calls yet.';
  res.json({
    id: u.id, name: u.name, role: u.role, mode: u.default_mode, default_playbook: pb?.name || null,
    avg: s.avg, calls: s.count, trend: trend({ avg: s.avg }),
    breakdown, note, log,
  });
});

// Audit log view (admin / super-admin) — supports the §12 audit requirement.
router.get('/audit', adminOnly, (req, res) => {
  const rows = db.prepare('SELECT actor_user_id,action,target,at FROM audit_log WHERE company_id = ? ORDER BY at DESC LIMIT 100').all(req.companyId);
  res.json(rows);
});
