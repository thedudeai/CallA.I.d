// High-level Zoho operations used by the sync engine (Zoho spec §6 CRM / §7 Desk).
// Each op returns a Zoho record id and logs to zoho_mirror for the in-app audit.
// Sandbox tenants use the mock; real tenants hit client.js. The two share this
// interface so the sync engine is transport-agnostic.
import { getConfig } from './store.js';
import { GLOBAL_SANDBOX } from './config.js';
import { crmRequest, deskRequest } from './client.js';
import { mockCrmUsers, mockDeskAgents, mirror, logMirror } from './mock.js';

export function isSandbox(companyId) {
  const cfg = getConfig(companyId);
  return GLOBAL_SANDBOX || !!cfg?.sandbox;
}

function splitName(name = '') {
  const parts = name.trim().split(/\s+/);
  return { first: parts.slice(0, -1).join(' ') || parts[0] || 'Caller', last: parts.slice(-1)[0] || 'Caller' };
}
const crmId = (r) => r?.data?.[0]?.details?.id || r?.data?.[0]?.id;

// ---- Identity (Zoho spec §3.4 step 5) ----
export async function fetchIdentities(companyId) {
  if (isSandbox(companyId)) return { crmUsers: mockCrmUsers(companyId), deskAgents: mockDeskAgents(companyId) };
  const [users, agents] = await Promise.all([
    crmRequest(companyId, '/users?type=AllUsers').catch(() => ({ users: [] })),
    deskRequest(companyId, '/agents?limit=200').catch(() => ({ data: [] })),
  ]);
  return {
    crmUsers: (users.users || []).map(u => ({ id: u.id, name: u.full_name || u.name, email: u.email })),
    deskAgents: (agents.data || []).map(a => ({ id: a.id, name: a.name || `${a.firstName || ''} ${a.lastName || ''}`.trim(), email: a.emailId || a.email })),
  };
}

export async function fetchDeskOrg(companyId) {
  if (isSandbox(companyId)) return { id: null, name: 'sandbox' };
  const r = await deskRequest(companyId, '/organizations').catch(() => ({ data: [] }));
  const org = (r.data || [])[0];
  return org ? { id: org.id, name: org.companyName } : { id: null, name: null };
}

// ---- CRM (sales) ----
export async function upsertContactCRM(companyId, call, ownerId) {
  const { first, last } = splitName(call.contact_name);
  const payload = { Last_Name: last, First_Name: first, Phone: call.contact_number || undefined, Owner: ownerId ? { id: ownerId } : undefined };
  if (isSandbox(companyId)) return mirror(companyId, { call_id: call.id, product: 'crm', kind: 'contact', owner: ownerId, payload });
  // Search then create (could be collapsed to /Contacts/upsert with duplicate_check_fields).
  if (call.contact_number) {
    const found = await crmRequest(companyId, `/Contacts/search?criteria=(Phone:equals:${encodeURIComponent(call.contact_number)})`).catch(() => null);
    if (found?.data?.[0]?.id) { logMirror(companyId, { call_id: call.id, product: 'crm', kind: 'contact', owner: ownerId, payload, sandbox: 0, zoho_id: found.data[0].id }); return found.data[0].id; }
  }
  const r = await crmRequest(companyId, '/Contacts', { method: 'POST', body: { data: [payload] } });
  const rid = crmId(r);
  logMirror(companyId, { call_id: call.id, product: 'crm', kind: 'contact', owner: ownerId, payload, sandbox: 0, zoho_id: rid });
  return rid;
}

export async function createCallCRM(companyId, call, contactId, ownerId) {
  const payload = {
    Subject: `${call.contact_name} — ${call.call_type || call.mode}`,
    Call_Type: call.direction === 'outbound' ? 'Outbound' : 'Inbound',
    Call_Start_Time: call.started_at,
    Call_Duration: secsToHHMM(call.duration),
    Description: call.summary || '',
    Who_Id: contactId ? { id: contactId } : undefined,
    Owner: ownerId ? { id: ownerId } : undefined,
    // Score/gap → custom fields (created once per tenant; see docs/ZOHO_INTEGRATION.md).
    CallAId_Score: call.overall_score, CallAId_Gap: call.gap,
  };
  if (isSandbox(companyId)) return mirror(companyId, { call_id: call.id, product: 'crm', kind: 'call', owner: ownerId, payload });
  const r = await crmRequest(companyId, '/Calls', { method: 'POST', body: { data: [payload] } });
  const rid = crmId(r);
  logMirror(companyId, { call_id: call.id, product: 'crm', kind: 'call', owner: ownerId, payload, sandbox: 0, zoho_id: rid });
  return rid;
}

export async function createTaskCRM(companyId, call, task, ownerId, contactId) {
  const payload = { Subject: task.text, Status: 'Not Started', Owner: ownerId ? { id: ownerId } : undefined, Who_Id: contactId ? { id: contactId } : undefined, Due_Date: task.due || undefined };
  if (isSandbox(companyId)) return mirror(companyId, { call_id: call.id, product: 'crm', kind: 'task', owner: ownerId, payload });
  const r = await crmRequest(companyId, '/Tasks', { method: 'POST', body: { data: [payload] } });
  const rid = crmId(r);
  logMirror(companyId, { call_id: call.id, product: 'crm', kind: 'task', owner: ownerId, payload, sandbox: 0, zoho_id: rid });
  return rid;
}

export async function createEventCRM(companyId, call, follow, ownerId, contactId) {
  const start = follow.starts_at; const end = new Date(new Date(start).getTime() + 30 * 60000).toISOString();
  const payload = { Event_Title: follow.title, Start_DateTime: start, End_DateTime: end, Owner: ownerId ? { id: ownerId } : undefined, Who_Id: contactId ? { id: contactId } : undefined };
  if (isSandbox(companyId)) return mirror(companyId, { call_id: call.id, product: 'crm', kind: 'event', owner: ownerId, payload });
  const r = await crmRequest(companyId, '/Events', { method: 'POST', body: { data: [payload] } });
  const rid = crmId(r);
  logMirror(companyId, { call_id: call.id, product: 'crm', kind: 'event', owner: ownerId, payload, sandbox: 0, zoho_id: rid });
  return rid;
}

// ---- Desk (care) ----
export async function upsertContactDesk(companyId, call) {
  const { first, last } = splitName(call.contact_name);
  const payload = { lastName: last, firstName: first, phone: call.contact_number || undefined };
  if (isSandbox(companyId)) return mirror(companyId, { call_id: call.id, product: 'desk', kind: 'contact', payload });
  if (call.contact_number) {
    const found = await deskRequest(companyId, `/contacts/search?phone=${encodeURIComponent(call.contact_number)}`).catch(() => null);
    if (found?.data?.[0]?.id) { logMirror(companyId, { call_id: call.id, product: 'desk', kind: 'contact', payload, sandbox: 0, zoho_id: found.data[0].id }); return found.data[0].id; }
  }
  const r = await deskRequest(companyId, '/contacts', { method: 'POST', body: payload });
  logMirror(companyId, { call_id: call.id, product: 'desk', kind: 'contact', payload, sandbox: 0, zoho_id: r.id });
  return r.id;
}

export async function createTicketDesk(companyId, call, contactId, assigneeId) {
  const cfg = getConfig(companyId);
  const payload = {
    subject: `${call.contact_name} — ${call.call_type || 'care'} call`,
    description: call.summary || '',
    contactId, assigneeId: assigneeId || undefined,
    departmentId: cfg?.desk_department_id || undefined,
    // Score/gap → Desk custom fields (cf_callaid_score / cf_callaid_gap; see docs).
    cf: { cf_callaid_score: String(call.overall_score ?? ''), cf_callaid_gap: String(call.gap ?? '') },
  };
  if (isSandbox(companyId)) return mirror(companyId, { call_id: call.id, product: 'desk', kind: 'ticket', owner: assigneeId, payload });
  const r = await deskRequest(companyId, '/tickets', { method: 'POST', body: payload });
  logMirror(companyId, { call_id: call.id, product: 'desk', kind: 'ticket', owner: assigneeId, payload, sandbox: 0, zoho_id: r.id });
  return r.id;
}

export async function createCommentDesk(companyId, call, ticketId, text) {
  const payload = { content: text, isPublic: false };
  if (isSandbox(companyId)) return mirror(companyId, { call_id: call.id, product: 'desk', kind: 'comment', payload });
  const r = await deskRequest(companyId, `/tickets/${ticketId}/comments`, { method: 'POST', body: payload });
  logMirror(companyId, { call_id: call.id, product: 'desk', kind: 'comment', payload, sandbox: 0, zoho_id: r.id });
  return r.id;
}

export async function createTaskDesk(companyId, call, task, ticketId, assigneeId) {
  const payload = { subject: task.text, assigneeId: assigneeId || undefined, dueDate: task.due || undefined, ...(ticketId ? { entityType: 'Tickets', entityId: ticketId } : {}) };
  if (isSandbox(companyId)) return mirror(companyId, { call_id: call.id, product: 'desk', kind: 'task', owner: assigneeId, payload });
  const r = await deskRequest(companyId, '/tasks', { method: 'POST', body: payload });
  logMirror(companyId, { call_id: call.id, product: 'desk', kind: 'task', owner: assigneeId, payload, sandbox: 0, zoho_id: r.id });
  return r.id;
}

function secsToHHMM(s = 0) { const m = Math.floor(s / 60), r = s % 60; return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`; }
