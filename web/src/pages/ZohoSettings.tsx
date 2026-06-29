// Zoho integration panel for Company & settings (Zoho spec §8): connect (real
// OAuth popup, or sandbox/demo), rep mapping table, default owners, records
// pushed, and disconnect.
import { useEffect, useState } from 'react';
import { api } from '../api';
import { Spinner, initials } from '../ui';

export function ZohoSettings() {
  const [status, setStatus] = useState<any>(null);
  const [maps, setMaps] = useState<any>(null);
  const [records, setRecords] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    const s = await api.zohoStatus();
    setStatus(s);
    if (s.connected) {
      const [m, r] = await Promise.all([api.zohoMappings(), api.zohoRecords()]);
      setMaps(m); setRecords(r);
    } else { setMaps(null); setRecords(null); }
  }
  useEffect(() => { load(); }, []);

  async function connect() {
    setBusy(true);
    try {
      const r = await api.zohoConnect();
      if (r.sandbox) { await api.zohoConnectSandbox(); await load(); }
      else if (r.auth_url) {
        // Real OAuth: open Zoho consent; poll status until connected.
        window.open(r.auth_url, 'zoho-oauth', 'width=560,height=720');
        const t = setInterval(async () => { const s = await api.zohoStatus(); if (s.connected) { clearInterval(t); await load(); } }, 2500);
        setTimeout(() => clearInterval(t), 180000);
      }
    } finally { setBusy(false); }
  }
  async function disconnect() {
    if (!confirm('Disconnect Zoho? This revokes the token for this company.')) return;
    setBusy(true); try { await api.zohoDisconnect(); await load(); } finally { setBusy(false); }
  }
  async function setMap(userId: string, field: 'crm' | 'desk', value: string) {
    await api.zohoSetMapping(userId, { [field]: value } as any);
    setMaps((m: any) => ({ ...m, users: m.users.map((u: any) => u.id === userId ? { ...u, [field === 'crm' ? 'zoho_crm_user_id' : 'zoho_desk_agent_id']: value } : u) }));
  }
  async function setDefault(field: 'crm' | 'desk', value: string) {
    await api.zohoDefaults({ [field]: value } as any);
    setMaps((m: any) => ({ ...m, [field === 'crm' ? 'default_crm_owner_id' : 'default_desk_agent_id']: value }));
  }

  if (!status) return <div className="panel"><div className="empty"><Spinner /></div></div>;

  if (!status.connected) {
    return (
      <div className="panel">
        <div className="p-head"><div className="p-title">Zoho CRM &amp; Desk</div><span className="chip">record every call in Zoho</span></div>
        <p style={{ color: 'var(--mist)', fontSize: 13.5, margin: '0 0 14px' }}>
          Push every call into your Zoho org — <b>sales → CRM</b> (Contacts, Calls, Tasks, Events),
          <b> care → Desk</b> (Tickets, Contacts, Tasks). Reps are attributed by Owner/Assignee via per-rep mapping.
        </p>
        <button className="btn primary" onClick={connect} disabled={busy}>{busy ? '…' : 'Connect Zoho'}</button>
        {status.sandbox_available && <div className="hint" style={{ marginTop: 10 }}>No Zoho OAuth client configured on the server — "Connect" runs a <b>sandbox</b> connection that simulates a Zoho org so you can see the full flow. Set <code>CALLAID_ZOHO_CLIENT_ID/SECRET</code> to enable real OAuth.</div>}
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="p-head"><div className="p-title">Zoho CRM &amp; Desk</div>
        <span className="chip" style={{ color: status.status === 'connected' ? 'var(--care)' : 'var(--amber)' }}>
          {status.status === 'needs_reauth' ? 'needs reconnect' : status.sandbox ? 'sandbox · connected' : 'connected'}
        </span>
      </div>
      {status.status === 'needs_reauth' && <div className="banner" style={{ marginBottom: 12 }}>Zoho needs re-authorization. <button className="btn" style={{ padding: '4px 10px', marginLeft: 8 }} onClick={connect}>Reconnect</button></div>}

      <div className="intgrid" style={{ marginBottom: 6 }}>
        <div className="intg"><span className="il">🗂️</span>Org<span className="st on" style={{ cursor: 'default' }}>{status.org_name || '—'}</span></div>
        <div className="intg"><span className="il">🌍</span>Data center<span className="st on" style={{ cursor: 'default' }}>{(status.dc_location || 'us').toUpperCase()}</span></div>
        <div className="intg"><span className="il">📇</span>CRM<span className={`st ${status.products_enabled?.includes('crm') ? 'on' : 'off'}`} style={{ cursor: 'default' }}>{status.products_enabled?.includes('crm') ? 'sales calls' : 'off'}</span></div>
        <div className="intg"><span className="il">🎫</span>Desk<span className={`st ${status.products_enabled?.includes('desk') ? 'on' : 'off'}`} style={{ cursor: 'default' }}>{status.products_enabled?.includes('desk') ? 'care calls' : 'off'}</span></div>
      </div>

      {records && (
        <div className="gen" style={{ marginTop: 12 }}>
          <span className="gi">📤</span>
          <div><b>{records.counts.reduce((s: number, c: any) => s + c.n, 0)} records</b> pushed to Zoho — {records.counts.map((c: any) => `${c.n} ${c.product}/${c.kind}`).join(', ') || 'none yet'}.</div>
        </div>
      )}

      {/* Rep mapping (Zoho spec §8) */}
      {maps && (
        <>
          <div className="section-h" style={{ fontSize: 13, margin: '20px 0 8px' }}>Rep mapping <span className="ln" /></div>
          <div className="hint" style={{ marginTop: 0, marginBottom: 8 }}>Each rep maps to a Zoho CRM user and Desk agent (pre-matched by email). Unmapped reps fall back to the default owner.</div>
          <table>
            <thead><tr><th>Member</th><th>Zoho CRM user</th><th>Zoho Desk agent</th></tr></thead>
            <tbody>
              {maps.users.map((u: any) => (
                <tr key={u.id}>
                  <td><div className="who"><div className="ava" style={{ width: 28, height: 28, fontSize: 11 }}>{initials(u.name)}</div>{u.name}{!u.zoho_crm_user_id && !u.zoho_desk_agent_id && <span className="chip hot" style={{ marginLeft: 6 }}>unmapped</span>}</div></td>
                  <td><MapSelect options={maps.crm_users} value={u.zoho_crm_user_id} onChange={v => setMap(u.id, 'crm', v)} /></td>
                  <td><MapSelect options={maps.desk_agents} value={u.zoho_desk_agent_id} onChange={v => setMap(u.id, 'desk', v)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="twocol" style={{ marginTop: 14 }}>
            <div className="field"><label>Default CRM owner (unmapped reps)</label><MapSelect options={maps.crm_users} value={maps.default_crm_owner_id} onChange={v => setDefault('crm', v)} /></div>
            <div className="field"><label>Default Desk agent (unmapped reps)</label><MapSelect options={maps.desk_agents} value={maps.default_desk_agent_id} onChange={v => setDefault('desk', v)} /></div>
          </div>
        </>
      )}

      <div style={{ marginTop: 16 }}><button className="btn" onClick={disconnect} disabled={busy}>Disconnect Zoho</button></div>
    </div>
  );
}

function MapSelect({ options, value, onChange }: { options: any[]; value: string | null; onChange: (v: string) => void }) {
  return (
    <select value={value || ''} onChange={e => onChange(e.target.value)}
      style={{ background: 'var(--base)', border: '1px solid var(--line)', borderRadius: 8, color: 'var(--text)', padding: '8px 10px', fontFamily: 'Inter', fontSize: 13, width: '100%' }}>
      <option value="">— unmapped —</option>
      {options.map(o => <option key={o.id} value={o.id}>{o.name} ({o.email})</option>)}
    </select>
  );
}
