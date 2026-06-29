// Zoho sync engine (Zoho spec §5). Hooked into post-call analysis: once a call is
// scored, enqueue a job that mirrors it into the tenant's Zoho — sales → CRM,
// care → Desk. Runs async (never blocks the HUD or call-log), is idempotent
// (guards on zoho_record_id so retries don't duplicate), and audit-logs results.
//
// Resolved open decisions (spec §10): new Ticket per care call; a single default
// Desk department per tenant; sales follow-ups → CRM Events, care follow-ups →
// Desk Tasks; score/gap → documented custom fields; new calls only with a manual
// re-sync for historical ones; push-only (no read-back) in v1.
import { db } from '../../db.js';
import { id, now, json } from '../../util.js';
import { audit } from '../../auth.js';
import { getConfig, isConnected } from './store.js';
import {
  isSandbox, upsertContactCRM, createCallCRM, createTaskCRM, createEventCRM,
  upsertContactDesk, createTicketDesk, createCommentDesk, createTaskDesk,
} from './adapters.js';

// Enqueue a sync for a freshly-scored call. No-op if the tenant isn't connected.
export function enqueueSync(companyId, callId) {
  if (!isConnected(companyId)) return null;
  const existing = db.prepare('SELECT zoho_record_id FROM calls WHERE id = ?').get(callId);
  if (existing?.zoho_record_id) return null; // already synced (idempotent)
  const jid = id('zj');
  db.prepare(`INSERT INTO zoho_sync_jobs (id, company_id, call_id, status, attempts, created_at, updated_at) VALUES (?,?,?,?,?,?,?)`)
    .run(jid, companyId, callId, 'queued', 0, now(), now());
  // Process out-of-band so the caller (analysis/HUD) never waits on Zoho.
  setImmediate(() => { processJob(jid).catch(() => {}); });
  return jid;
}

function setJob(jid, status, err) {
  db.prepare('UPDATE zoho_sync_jobs SET status = ?, attempts = attempts + 1, last_error = ?, updated_at = ? WHERE id = ?')
    .run(status, err || null, now(), jid);
}
function setCall(callId, status, recordId, product) {
  db.prepare('UPDATE calls SET zoho_sync_status = ?, zoho_record_id = COALESCE(?, zoho_record_id), zoho_product = COALESCE(?, zoho_product) WHERE id = ?')
    .run(status, recordId || null, product || null, callId);
}

export async function processJob(jid) {
  const job = db.prepare('SELECT * FROM zoho_sync_jobs WHERE id = ?').get(jid);
  if (!job || job.status === 'done') return;
  db.prepare("UPDATE zoho_sync_jobs SET status='running', updated_at=? WHERE id=?").run(now(), jid);
  try {
    const result = await syncCall(job.company_id, job.call_id);
    setJob(jid, result.skipped ? 'skipped' : 'done', result.reason || null);
  } catch (e) {
    setJob(jid, 'failed', String(e?.message || e).slice(0, 300));
    setCall(job.call_id, 'failed');
    audit(null, job.company_id, 'zoho_sync_failed', job.call_id, { error: String(e?.message || e).slice(0, 200) });
  }
}

// The core flow. Idempotent; returns { synced } or { skipped, reason }.
export async function syncCall(companyId, callId) {
  const cfg = getConfig(companyId);
  if (!cfg || cfg._status !== 'connected') return { skipped: true, reason: 'not_connected' };

  const call = db.prepare('SELECT * FROM calls WHERE id = ? AND company_id = ?').get(callId, companyId);
  if (!call) return { skipped: true, reason: 'no_call' };
  if (call.zoho_record_id) return { synced: true, reason: 'already' }; // idempotent guard

  const product = call.mode === 'sales' ? 'crm' : 'desk';
  const enabled = cfg.products_enabled || ['crm', 'desk'];
  if (!enabled.includes(product)) {
    setCall(callId, 'skipped', null, product);
    audit(null, companyId, 'zoho_sync_skipped', callId, { reason: `product_${product}_not_enabled` });
    return { skipped: true, reason: `product_${product}_not_enabled` };
  }

  const rep = db.prepare('SELECT id,name,zoho_crm_user_id,zoho_desk_agent_id FROM users WHERE id = ?').get(call.user_id);
  const owner = product === 'crm'
    ? (rep?.zoho_crm_user_id || cfg.default_crm_owner_id)
    : (rep?.zoho_desk_agent_id || cfg.default_desk_agent_id);
  if (!owner && !isSandbox(companyId)) {
    setCall(callId, 'skipped', null, product);
    audit(null, companyId, 'zoho_sync_skipped', callId, { reason: 'unmapped_rep' });
    return { skipped: true, reason: 'unmapped_rep' };
  }

  const tasks = db.prepare(`SELECT id,text,kind,zoho_task_id FROM tasks WHERE call_id = ?`).all(callId);
  const follow = db.prepare('SELECT id,title,starts_at,zoho_event_id FROM calendar_events WHERE call_id = ? LIMIT 1').get(callId);

  let recordId;
  if (product === 'crm') {
    const contactId = await upsertContactCRM(companyId, call, owner);
    recordId = await createCallCRM(companyId, call, contactId, owner);
    for (const t of tasks) {
      if (t.zoho_task_id) continue;
      const zid = await createTaskCRM(companyId, call, t, owner, contactId);
      db.prepare('UPDATE tasks SET zoho_task_id = ?, zoho_sync_status = ? WHERE id = ?').run(zid, 'synced', t.id);
    }
    if (follow && !follow.zoho_event_id) {
      const eid = await createEventCRM(companyId, call, follow, owner, contactId);
      db.prepare('UPDATE calendar_events SET zoho_event_id = ? WHERE id = ?').run(eid, follow.id);
    }
  } else {
    const contactId = await upsertContactDesk(companyId, call);
    recordId = await createTicketDesk(companyId, call, contactId, owner);
    if (call.summary) await createCommentDesk(companyId, call, recordId, call.summary); // full AI summary as a comment
    for (const t of tasks) {
      if (t.zoho_task_id) continue;
      const zid = await createTaskDesk(companyId, call, t, recordId, owner);
      db.prepare('UPDATE tasks SET zoho_task_id = ?, zoho_sync_status = ? WHERE id = ?').run(zid, 'synced', t.id);
    }
    // Care follow-up → a Desk Task with a due date (decision §10.3).
    if (follow && !follow.zoho_event_id) {
      const zid = await createTaskDesk(companyId, call, { text: follow.title, due: follow.starts_at }, recordId, owner);
      db.prepare('UPDATE calendar_events SET zoho_event_id = ? WHERE id = ?').run(zid, follow.id);
    }
  }

  setCall(callId, 'synced', recordId, product);
  audit(null, companyId, 'zoho_sync_done', callId, { product, record_id: recordId });
  return { synced: true, product, record_id: recordId };
}
