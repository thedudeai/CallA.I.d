import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { api } from '../api';
import { Spinner } from '../ui';

export function SuperAdmin() {
  const { openCompany } = useAuth();
  const nav = useNavigate();
  const [cos, setCos] = useState<any[] | null>(null);
  const [adding, setAdding] = useState(false);

  async function load() { setCos(await api.companies()); }
  useEffect(() => { load(); }, []);

  async function open(id: string) { await openCompany(id); nav('/'); }

  const totalSeats = cos?.reduce((s, c) => s + c.seats_used, 0) ?? 0;
  const totalCalls = cos?.reduce((s, c) => s + c.calls_count, 0) ?? 0;

  return (
    <section className="view">
      <div className="topbar">
        <div>
          <div className="eyebrow">Platform owner · CallA.I.d HQ</div>
          <h1 className="page">Super admin</h1>
          <div className="page-sub">A separate portal — only your team sees this. Add and manage every tenant company from here. Tenants never see each other; each one only ever sees its own workspace.</div>
        </div>
        <button className="btn primary" onClick={() => setAdding(true)}>+ Add company</button>
      </div>

      <div className="sabar"><span className="crown">👑</span><div>You're in the <b>platform view</b>. Switching or creating companies happens here — not inside a tenant's workspace. <b>Open</b> a company to manage its products, modes, keys, integrations and seats.</div></div>

      <div className="statgrid">
        <Stat v={cos?.length ?? '—'} l="Companies" d="tenants" />
        <Stat v={totalSeats} l="Active seats" d="across tenants" />
        <Stat v={totalCalls} l="Calls (all time)" d="platform-wide" />
        <Stat v={`$${(totalSeats * 0.15).toFixed(1)}k`} l="MRR (modeled)" color="var(--sales)" d="≈ seat-based" />
      </div>

      <div className="panel">
        <div className="p-head"><div className="p-title">Tenant companies</div><span className="chip">{cos?.length ?? 0} total</span></div>
        {!cos ? <Spinner /> : (
          <table>
            <thead><tr><th>Company</th><th>Plan</th><th>Seats</th><th>Calls</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {cos.map(c => (
                <tr key={c.id}>
                  <td><div className="who"><div className="cb" style={{ width: 28, height: 28, borderRadius: 8 }} />{c.name}</div></td>
                  <td className="modtxt">{c.plan}</td>
                  <td className="mono">{c.seats_used} / {c.seats}</td>
                  <td className="mono">{c.calls_count}</td>
                  <td className="acc" style={{ color: c.status === 'active' ? 'var(--care)' : c.status === 'trial' ? 'var(--amber)' : 'var(--coral)' }}>{c.status}</td>
                  <td style={{ textAlign: 'right' }}><button className="btn" style={{ padding: '6px 13px' }} onClick={() => open(c.id)}>Open →</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="hint" style={{ marginTop: 12 }}>Open a company to manage its products, modes, keys, integrations, seats and billing — or suspend it.</div>
      </div>

      {adding && <AddCompany onClose={() => setAdding(false)} onCreated={() => { setAdding(false); load(); }} />}
    </section>
  );
}

function Stat({ v, l, d, color }: { v: any; l: string; d?: string; color?: string }) {
  return <div className="stat"><div className="sv" style={color ? { color } : undefined}>{v}</div><div className="sl">{l}</div>{d && <div className="sd up">{d}</div>}</div>;
}

function AddCompany({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [plan, setPlan] = useState('Starter');
  const [adminName, setAdminName] = useState('');
  const [adminEmail, setAdminEmail] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      await api.createCompany({ name, plan, seats: plan === 'Scale' ? 10 : plan === 'Growth' ? 6 : 3, admin: adminName && adminEmail ? { name: adminName, email: adminEmail, password: 'demo1234' } : undefined });
      onCreated();
    } finally { setBusy(false); }
  }

  return (
    <div style={modalBack} onClick={onClose}>
      <div className="panel" style={{ maxWidth: 460, width: '100%' }} onClick={e => e.stopPropagation()}>
        <div className="p-head"><div className="p-title">New tenant company</div></div>
        <div className="field"><label>Company name</label><div className="inp"><input value={name} onChange={e => setName(e.target.value)} placeholder="Acme Audio" style={inp} /></div></div>
        <div className="field"><label>Plan</label><div className="inp"><select value={plan} onChange={e => setPlan(e.target.value)} style={{ ...inp, background: 'transparent', border: 0, color: 'var(--text)', width: '100%' }}><option>Starter</option><option>Growth</option><option>Scale</option></select></div></div>
        <div className="field"><label>Admin name (optional)</label><div className="inp"><input value={adminName} onChange={e => setAdminName(e.target.value)} placeholder="Jane Doe" style={inp} /></div></div>
        <div className="field"><label>Admin email (optional · password demo1234)</label><div className="inp"><input value={adminEmail} onChange={e => setAdminEmail(e.target.value)} placeholder="jane@acme.com" style={inp} /></div></div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!name || busy} onClick={create}>{busy ? '…' : 'Create company'}</button>
        </div>
      </div>
    </div>
  );
}

const modalBack: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(4,7,16,.72)', display: 'grid', placeItems: 'center', padding: 20, zIndex: 50, backdropFilter: 'blur(4px)' };
const inp: React.CSSProperties = { fontFamily: 'Inter', fontSize: 14 };
