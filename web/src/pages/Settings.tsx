import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { api, User } from '../api';
import { Section, Spinner, initials } from '../ui';
import { ZohoSettings } from './ZohoSettings';

const THEMES = [
  ['aurora', 'conic-gradient(from 200deg,#36E5C8,#A78BFA)'],
  ['azure', 'conic-gradient(from 200deg,#6EA8FF,#2DE2E6)'],
  ['sunset', 'conic-gradient(from 200deg,#FF9E6E,#FF6B9D)'],
  ['ink', '#0B1020'],
];
const PROVIDERS = [['twilio', '☎️', 'Twilio'], ['ringcentral', '🔵', 'RingCentral'], ['aircall', '🟢', 'Aircall'], ['genesys', '🟣', 'Genesys']];

export function Settings() {
  const { company, refresh } = useAuth();
  const nav = useNavigate();
  const [docs, setDocs] = useState<any[]>([]);
  const [proposalNote, setProposalNote] = useState<string | null>(null);
  const [key, setKey] = useState<any>(null);
  const [newKey, setNewKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [integrations, setIntegrations] = useState<any[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [theme, setTheme] = useState(company?.theme || 'aurora');
  const [seats, setSeats] = useState(company?.seats || 5);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    const [d, k, i, u, props] = await Promise.all([api.kbDocs(), api.apiKey(), api.integrations(), api.users(), api.proposals()]);
    setDocs(d); setKey(k); setIntegrations(i); setUsers(u);
    if (props.length) setProposalNote(`${props[0].draft.name} — from ${props[0].source_filename}`);
  }
  useEffect(() => { load(); }, []); // eslint-disable-line

  async function upload(file: File) {
    setUploading(true);
    const fd = new FormData(); fd.append('file', file);
    try {
      const r = await api.uploadKb(fd);
      if (r.proposal) setProposalNote(`${r.proposal.draft.name} — from ${r.proposal.source_filename}`);
      await load();
    } finally { setUploading(false); }
  }

  async function saveKey() { if (!newKey) return; await api.putApiKey(newKey); setNewKey(''); await load(); }
  async function toggleIntegration(type: string, status: string) {
    await api.setIntegration(type, status === 'connected' ? 'disconnected' : 'connected'); await load();
  }
  async function pickTheme(t: string) { setTheme(t); await api.updateCompany({ theme: t }); refresh(); }
  async function addSeat() { const s = seats + 1; setSeats(s); await api.updateCompany({ seats: s }); refresh(); }

  return (
    <section className="view">
      <div className="topbar"><div>
        <div className="eyebrow">Per-company · admin manages everything</div>
        <h1 className="page">Company &amp; settings</h1>
        <div className="page-sub">Nothing is hard-coded. Upload your material and the AI works off it. Manage products, modes, the AI key, phone integration, seats, themes and access — all here.</div>
      </div></div>

      <Section>Knowledge base</Section>
      <div className="panel">
        <div className="p-head"><div className="p-title">Product details &amp; guidelines</div><span className="chip">{company?.name}</span></div>
        <div className="upload" onClick={() => fileRef.current?.click()}>
          <input ref={fileRef} type="file" hidden onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); }} />
          <div className="ui">{uploading ? <Spinner /> : <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 16V4m0 0L7 9m5-5 5 5" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></svg>}</div>
          <b>Drop product docs &amp; guidelines</b><small>PDF, docs, FAQs, brand voice, returns — the AI reads it all and proposes modes</small>
        </div>
        <div className="filelist">
          {docs.map(d => (
            <div className="file" key={d.id}>{fileEmoji(d.type)} {d.filename} <span className="ok">{d.status}</span></div>
          ))}
        </div>
        {proposalNote && (
          <div className="gen"><span className="gi">✨</span><div><b>New mode suggested</b> — "{proposalNote}".</div><span className="glink" onClick={() => nav('/playbooks')}>Review →</span></div>
        )}
      </div>

      <Section>AI &amp; phone</Section>
      <div className="twocol">
        <div className="panel">
          <div className="p-head"><div className="p-title">Your AI key</div><span className="chip">bring your own</span></div>
          <div className="field">
            <label>API key — runs on your account &amp; billing</label>
            <div className="inp">
              <input type={showKey ? 'text' : 'password'} value={newKey || (key ? `sk-…${key.last4}` : '')} placeholder="sk-ant-…" onChange={e => setNewKey(e.target.value)} />
              <span className="eye" onClick={() => setShowKey(s => !s)}>{showKey ? 'hide' : 'show'}</span>
            </div>
            <div className="hint">Calls use your key, not ours. Rotate or revoke anytime.{!key && ' No key set — guidance uses the built-in rules engine.'}</div>
            {newKey && <button className="btn primary" style={{ marginTop: 10 }} onClick={saveKey}>Save key</button>}
          </div>
        </div>
        <div className="panel">
          <div className="p-head"><div className="p-title">Phone integration</div><span className="chip">any system</span></div>
          <div className="intgrid">
            {PROVIDERS.map(([type, emoji, label]) => {
              const cur = integrations.find(i => i.type === type);
              const on = cur?.status === 'connected';
              return (
                <div className="intg" key={type}>
                  <span className="il">{emoji}</span>{label}
                  <span className={`st ${on ? 'on' : 'off'}`} onClick={() => toggleIntegration(type, cur?.status || 'disconnected')}>{on ? 'connected' : 'connect'}</span>
                </div>
              );
            })}
          </div>
          <div className="hint">Connect your provider, or pipe live audio in via SIP / API.</div>
        </div>
      </div>

      <Section>CRM &amp; helpdesk · Zoho</Section>
      <ZohoSettings />

      <Section>Appearance &amp; seats</Section>
      <div className="twocol">
        <div className="panel">
          <div className="p-head"><div className="p-title">Theme</div></div>
          <div className="themes">
            {THEMES.map(([t, bg]) => <div key={t} className="swatch" data-sel={theme === t} style={{ background: bg, ...(t === 'ink' ? { border: '2px solid var(--line)' } : {}) }} onClick={() => pickTheme(t)} />)}
          </div>
          <div className="hint">Set the workspace look and brand accent per company.</div>
        </div>
        <div className="panel">
          <div className="p-head"><div className="p-title">Plan &amp; seats</div></div>
          <div className="field"><label>Seats used</label>
            <div className="inp" style={{ justifyContent: 'space-between' }}><span className="mono">{users.length} of {seats}</span><button className="btn primary" style={{ padding: '6px 13px' }} onClick={addSeat}>Add seats</button></div>
          </div>
          <div className="hint">Add reps any time — each gets a default mode and an access level.</div>
        </div>
      </div>

      <Section>Team, roles &amp; access</Section>
      <div className="panel">
        <table>
          <thead><tr><th>Member</th><th>Role</th><th>Default mode</th><th>Access</th></tr></thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id}>
                <td><div className="who"><div className="ava" style={{ width: 30, height: 30, fontSize: 11 }}>{initials(u.name)}</div>{u.name}</div></td>
                <td>{roleBadge(u.role)}</td>
                <td className="modtxt">{u.role === 'company_admin' ? '—' : (u.default_mode === 'care' ? 'Customer care' : 'Sales')}</td>
                <td className={`acc ${u.access_level === 'full' ? 'full' : 'self'}`}>{u.access_level === 'full' ? 'full · all reps' : 'self only'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="hint" style={{ marginTop: 12 }}>Reps see only their own feedback. Only admins see team reporting and saved logs.</div>
      </div>
    </section>
  );
}

function roleBadge(role: string) {
  if (role === 'company_admin') return <span className="role admin">Admin</span>;
  if (role === 'sales_rep') return <span className="role sales">● Sales rep</span>;
  return <span className="role care">● Customer service</span>;
}
function fileEmoji(type: string) { return type === 'pdf' ? '📕' : type === 'docx' ? '📘' : '📄'; }
