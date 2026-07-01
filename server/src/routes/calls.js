// Calls, post-call analysis ingest, tasks & calendar (spec §6.5–§6.7 / §10).
// Reps see only their own calls; admins see all (enforced server-side).
import { Router } from 'express';
import { db } from '../db.js';
import { authRequired, isAdmin, audit } from '../auth.js';
import { hydratePlaybook, analyzeCall, liveSuggest } from '../ai/index.js';
import { syncOnComplete } from '../integrations/zoho/index.js';
import { id, now, json } from '../util.js';
import { rateLimit } from '../middleware/rateLimit.js';

export const router = Router();
router.use(authRequired);

// Both endpoints below invoke the tenant's Claude key, so an authenticated rep
// (or a compromised account) could otherwise run up the tenant's AI bill. Cap
// per-IP throughput; live/suggest is more frequent (per turn) so gets a bit more.
const analyzeLimiter = rateLimit({ windowMs: 60_000, max: 20, bucket: 'ai-analyze' });
const liveLimiter = rateLimit({ windowMs: 60_000, max: 120, bucket: 'ai-live' });

// Single source of truth for persisting a scored call + its children. Wrapped in
// a synchronous transaction so a failure rolls the whole graph back. Used by both
// the HTTP /calls/analyze path and the WebSocket gateway's finalize().
export const persistAnalyzedCall = db.transaction((p) => {
  const { cid, companyId, userId, contactName, contactNumber, mode, playbookId,
    callType, touchNumber, direction, startedAt, duration, transcript, result } = p;
  db.prepare(`INSERT INTO calls (id,company_id,user_id,contact_name,contact_number,mode,playbook_id,call_type,touch_number,direction,status,started_at,duration,transcript,overall_score,gap,verdict,summary)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    cid, companyId, userId, contactName, contactNumber, mode, playbookId,
    callType, touchNumber, direction, 'completed', startedAt, duration,
    JSON.stringify(transcript), result.overall, result.gap ?? 0, result.verdict, result.summary);
  for (const s of result.scores)
    db.prepare('INSERT INTO call_scores (id,call_id,company_id,dimension,value) VALUES (?,?,?,?,?)').run(id('sc'), cid, companyId, s.dimension, s.value);
  for (const m of result.moments)
    db.prepare('INSERT INTO call_moments (id,call_id,company_id,ts,severity,label,detail) VALUES (?,?,?,?,?,?,?)').run(id('mo'), cid, companyId, m.ts, m.severity, m.label, m.detail);
  if (result.coaching) db.prepare('INSERT INTO coaching (call_id,company_id,tip) VALUES (?,?,?)').run(cid, companyId, result.coaching);
  for (const t of result.tasks)
    db.prepare('INSERT INTO tasks (id,company_id,call_id,owner_user_id,text,kind,source,done,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id('tsk'), companyId, cid, userId, t.text, t.kind, 'ai', 0, now());
  if (result.follow)
    db.prepare('INSERT INTO calendar_events (id,company_id,call_id,owner_user_id,title,starts_at,status,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(id('cal'), companyId, cid, userId, result.follow.title, result.follow.starts_at, 'scheduled', now());
  return cid;
});

// Assemble the full detail view for one call.
export function callDetail(callId, companyId) {
  const c = db.prepare('SELECT * FROM calls WHERE id = ? AND company_id = ?').get(callId, companyId);
  if (!c) return null;
  const rep = db.prepare('SELECT id,name FROM users WHERE id = ?').get(c.user_id);
  const scores = db.prepare('SELECT dimension,value FROM call_scores WHERE call_id = ?').all(callId);
  const moments = db.prepare('SELECT ts,severity,label,detail FROM call_moments WHERE call_id = ? ORDER BY ts').all(callId);
  const coaching = db.prepare('SELECT tip FROM coaching WHERE call_id = ?').get(callId);
  const tasks = db.prepare('SELECT id,text,kind,source,done FROM tasks WHERE call_id = ? ORDER BY created_at').all(callId)
    .map(t => ({ ...t, done: !!t.done }));
  const follow = db.prepare('SELECT id,title,starts_at,status FROM calendar_events WHERE call_id = ? LIMIT 1').get(callId);
  const playbook = c.playbook_id ? db.prepare('SELECT name,emoji FROM playbooks WHERE id = ?').get(c.playbook_id) : null;
  return {
    id: c.id, contact_name: c.contact_name, contact_number: c.contact_number, mode: c.mode,
    call_type: c.call_type, touch_number: c.touch_number, direction: c.direction,
    rep: rep ? { id: rep.id, name: rep.name } : null, playbook,
    started_at: c.started_at, duration: c.duration, overall_score: c.overall_score, gap: c.gap,
    verdict: c.verdict, summary: c.summary, transcript: json(c.transcript, []),
    scores, moments, coaching: coaching?.tip || null, tasks, follow: follow || null,
    zoho: { status: c.zoho_sync_status || null, record_id: c.zoho_record_id || null, product: c.zoho_product || null },
  };
}

// A list entry (lightweight).
function callRow(c) {
  return {
    id: c.id, contact_name: c.contact_name, mode: c.mode, call_type: c.call_type,
    rep_id: c.user_id, started_at: c.started_at, duration: c.duration,
    overall_score: c.overall_score, gap: c.gap, summary: c.summary,
  };
}

// GET /calls — scoped. Admin may pass ?user_id= to view a specific rep.
router.get('/calls', (req, res) => {
  if (!req.companyId) return res.status(400).json({ error: 'company_context_required' });
  let rows;
  if (isAdmin(req.user)) {
    if (req.query.user_id)
      rows = db.prepare('SELECT * FROM calls WHERE company_id = ? AND user_id = ? ORDER BY started_at DESC').all(req.companyId, req.query.user_id);
    else
      rows = db.prepare('SELECT * FROM calls WHERE company_id = ? ORDER BY started_at DESC').all(req.companyId);
  } else {
    rows = db.prepare('SELECT * FROM calls WHERE company_id = ? AND user_id = ? ORDER BY started_at DESC').all(req.companyId, req.user.id);
  }
  res.json(rows.map(callRow));
});

// GET /calls/:id — detail, with own-vs-admin scoping.
router.get('/calls/:id', (req, res) => {
  const detail = callDetail(req.params.id, req.companyId);
  if (!detail) return res.status(404).json({ error: 'not_found' });
  if (!isAdmin(req.user) && detail.rep?.id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  res.json(detail);
});

// My latest call's feedback (default for the "My feedback" screen).
router.get('/feedback/latest', (req, res) => {
  const c = db.prepare('SELECT id FROM calls WHERE company_id = ? AND user_id = ? ORDER BY started_at DESC LIMIT 1').get(req.companyId, req.user.id);
  if (!c) return res.json(null);
  res.json(callDetail(c.id, req.companyId));
});

// POST /calls/analyze — ingest a transcript and produce a scored, summarized call
// with extracted tasks + follow-up (Phase 1: proves the AI loop on recordings).
router.post('/calls/analyze', analyzeLimiter, async (req, res) => {
  if (!req.companyId) return res.status(400).json({ error: 'company_context_required' });
  const b = req.body || {};
  const transcript = Array.isArray(b.transcript) ? b.transcript : [];
  const mode = b.mode || req.user.default_mode || 'care';
  const playbookRow = b.playbook_id ? db.prepare('SELECT * FROM playbooks WHERE id = ? AND company_id = ?').get(b.playbook_id, req.companyId) : null;
  const playbook = hydratePlaybook(playbookRow);
  const contactName = b.contact_name || 'the caller';

  const result = await analyzeCall(req.companyId, { transcript, mode, playbook, contactName, durationSec: b.duration || 0 });

  const cid = id('call');
  // Persist the call and all its children atomically — a crash mid-sequence must
  // not leave a call row with partial scores/moments/tasks that reporting then
  // aggregates as complete.
  persistAnalyzedCall({
    cid, companyId: req.companyId, userId: req.user.id, contactName,
    contactNumber: b.contact_number || null, mode, playbookId: b.playbook_id || null,
    callType: b.call_type || null, touchNumber: b.touch_number || 1,
    direction: b.direction || 'inbound', startedAt: now(), duration: b.duration || 0,
    transcript, result,
  });

  audit(req.user.id, req.companyId, 'analyze_call', cid, { engine: result.engine });
  await syncOnComplete(req.companyId, cid); // mirror into Zoho (sales→CRM, care→Desk) if connected; idempotent
  res.status(201).json({ engine: result.engine, ...callDetail(cid, req.companyId) });
});

// POST /calls/live/suggest — the HTTP equivalent of one WebSocket guidance frame.
// Serverless platforms can't hold a WS open, so the live HUD posts the running
// transcript here per turn and gets the same guidance shape back.
router.post('/calls/live/suggest', liveLimiter, async (req, res) => {
  if (!req.companyId) return res.status(400).json({ error: 'company_context_required' });
  const b = req.body || {};
  const transcript = Array.isArray(b.transcript) ? b.transcript : [];
  const mode = b.mode || req.user.default_mode || 'care';
  const playbookRow = b.playbook_id ? db.prepare('SELECT * FROM playbooks WHERE id = ? AND company_id = ?').get(b.playbook_id, req.companyId) : null;
  const g = await liveSuggest(req.companyId, {
    transcript, mode, playbook: hydratePlaybook(playbookRow),
    callType: b.call_type, touchNumber: b.touch_number,
  });
  res.json(g);
});

// ---- Tasks ----
router.get('/tasks', (req, res) => {
  if (!req.companyId) return res.status(400).json({ error: 'company_context_required' });
  const rows = isAdmin(req.user)
    ? db.prepare('SELECT * FROM tasks WHERE company_id = ? ORDER BY created_at DESC').all(req.companyId)
    : db.prepare('SELECT * FROM tasks WHERE company_id = ? AND owner_user_id = ? ORDER BY created_at DESC').all(req.companyId, req.user.id);
  res.json(rows.map(t => ({ id: t.id, call_id: t.call_id, text: t.text, kind: t.kind, source: t.source, done: !!t.done })));
});

router.patch('/tasks/:id', (req, res) => {
  const t = db.prepare('SELECT * FROM tasks WHERE id = ? AND company_id = ?').get(req.params.id, req.companyId);
  if (!t) return res.status(404).json({ error: 'not_found' });
  if (!isAdmin(req.user) && t.owner_user_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  if ('done' in (req.body || {})) db.prepare('UPDATE tasks SET done = ? WHERE id = ?').run(req.body.done ? 1 : 0, req.params.id);
  if ('text' in (req.body || {})) db.prepare('UPDATE tasks SET text = ? WHERE id = ?').run(req.body.text, req.params.id);
  res.json({ ok: true });
});
