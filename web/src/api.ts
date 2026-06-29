// Typed API client. Injects the JWT and, for a super-admin who has "opened" a
// tenant, the X-Company-Id override header (the backend audit-logs cross-tenant
// access). All calls go through request().

export type Role = 'super_admin' | 'company_admin' | 'sales_rep' | 'customer_service_rep';
export type Mode = 'care' | 'sales';

export interface User {
  id: string; company_id: string | null; name: string; email: string; role: Role;
  default_mode: Mode; default_playbook_id: string | null; access_level: string; status: string;
}
export interface Company { id: string; name: string; plan: string; status: string; theme: string; seats: number; }
export interface Playbook {
  id: string; mode: Mode; name: string; emoji: string; description: string;
  stages: string[]; discovery_bank: string[]; rubric_weights: Record<string, number>;
  tactics: string[]; source: string;
}
export interface CallRow {
  id: string; contact_name: string; mode: Mode; call_type: string | null; rep_id: string;
  started_at: string; duration: number; overall_score: number; gap: number; summary: string;
}
export interface Score { dimension: string; value: number; label?: string; }
export interface Moment { ts: string; severity: 'good' | 'warn' | 'bad'; label: string; detail: string; }
export interface Task { id: string; call_id?: string; text: string; kind: string; source: string; done: boolean; }
export interface CallDetail {
  id: string; contact_name: string; contact_number: string | null; mode: Mode; call_type: string | null;
  touch_number: number; direction: string; rep: { id: string; name: string } | null;
  playbook: { name: string; emoji: string } | null; started_at: string; duration: number;
  overall_score: number; gap: number; verdict: string | null; summary: string | null;
  transcript: { speaker: string; text: string; t?: string }[];
  scores: Score[]; moments: Moment[]; coaching: string | null; tasks: Task[];
  follow: { id: string; title: string; starts_at: string; status: string } | null;
}

let _token: string | null = localStorage.getItem('callaid_token');
let _activeCompany: string | null = localStorage.getItem('callaid_active_company');

export function setToken(t: string | null) {
  _token = t;
  if (t) localStorage.setItem('callaid_token', t); else localStorage.removeItem('callaid_token');
}
export function getToken() { return _token; }
export function setActiveCompany(id: string | null) {
  _activeCompany = id;
  if (id) localStorage.setItem('callaid_active_company', id); else localStorage.removeItem('callaid_active_company');
}
export function getActiveCompany() { return _activeCompany; }

async function request<T>(method: string, path: string, body?: unknown, isForm = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (_token) headers['authorization'] = `Bearer ${_token}`;
  if (_activeCompany) headers['x-company-id'] = _activeCompany;
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    if (isForm) { payload = body as FormData; }
    else { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
  }
  const res = await fetch(`/api${path}`, { method, headers, body: payload });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as any)?.error || `http_${res.status}`, res.status);
  return data as T;
}

export class ApiError extends Error { constructor(public code: string, public status: number) { super(code); } }

export const api = {
  login: (email: string, password: string) => request<{ token: string; user: User }>('POST', '/auth/login', { email, password }),
  me: () => request<{ user: User; company: Company | null }>('GET', '/me'),
  // companies (super admin)
  companies: () => request<any[]>('GET', '/companies'),
  createCompany: (b: any) => request<any>('POST', '/companies', b),
  // users
  users: () => request<User[]>('GET', '/users'),
  createUser: (b: any) => request<User>('POST', '/users', b),
  updateUser: (id: string, b: any) => request<User>('PATCH', `/users/${id}`, b),
  // settings
  apiKey: () => request<any>('GET', '/settings/api-key'),
  putApiKey: (key: string) => request<any>('PUT', '/settings/api-key', { key }),
  integrations: () => request<any[]>('GET', '/settings/integrations'),
  setIntegration: (type: string, status: string) => request<any>('POST', '/settings/integrations', { type, status }),
  updateCompany: (b: any) => request<Company>('PATCH', '/settings/company', b),
  kbDocs: () => request<any[]>('GET', '/kb/documents'),
  uploadKb: (fd: FormData) => request<any>('POST', '/kb/documents', fd, true),
  deleteKb: (id: string) => request<any>('DELETE', `/kb/documents/${id}`),
  // playbooks
  playbooks: () => request<Playbook[]>('GET', '/playbooks'),
  createPlaybook: (b: any) => request<Playbook>('POST', '/playbooks', b),
  updatePlaybook: (id: string, b: any) => request<Playbook>('PATCH', `/playbooks/${id}`, b),
  deletePlaybook: (id: string) => request<any>('DELETE', `/playbooks/${id}`),
  proposals: () => request<any[]>('GET', '/playbook-proposals'),
  acceptProposal: (id: string) => request<Playbook>('POST', `/playbook-proposals/${id}/accept`),
  dismissProposal: (id: string) => request<any>('POST', `/playbook-proposals/${id}/dismiss`),
  // calls
  calls: (userId?: string) => request<CallRow[]>('GET', `/calls${userId ? `?user_id=${userId}` : ''}`),
  call: (id: string) => request<CallDetail>('GET', `/calls/${id}`),
  feedbackLatest: () => request<CallDetail | null>('GET', '/feedback/latest'),
  analyze: (b: any) => request<CallDetail & { engine: string }>('POST', '/calls/analyze', b),
  tasks: () => request<Task[]>('GET', '/tasks'),
  toggleTask: (id: string, done: boolean) => request<any>('PATCH', `/tasks/${id}`, { done }),
  // reporting
  team: () => request<any>('GET', '/reporting/team'),
  rep: (id: string) => request<any>('GET', `/reporting/reps/${id}`),
};
