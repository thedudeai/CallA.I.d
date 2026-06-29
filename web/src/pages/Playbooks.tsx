import { useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { api, Playbook } from '../api';
import { Spinner, Section } from '../ui';

export function Playbooks() {
  const { isAdmin } = useAuth();
  const [pbs, setPbs] = useState<Playbook[] | null>(null);
  const [proposals, setProposals] = useState<any[]>([]);
  const [editing, setEditing] = useState<Playbook | 'new-care' | 'new-sales' | null>(null);

  async function load() {
    const [p, pr] = await Promise.all([api.playbooks(), isAdmin ? api.proposals() : Promise.resolve([])]);
    setPbs(p); setProposals(pr);
  }
  useEffect(() => { load(); }, []); // eslint-disable-line

  async function accept(id: string) { await api.acceptProposal(id); await load(); }
  async function dismiss(id: string) { await api.dismissProposal(id); await load(); }
  async function del(id: string) { if (confirm('Delete this playbook?')) { await api.deletePlaybook(id); await load(); } }

  if (!pbs) return <div className="empty"><Spinner /></div>;
  const care = pbs.filter(p => p.mode === 'care');
  const sales = pbs.filter(p => p.mode === 'sales');

  return (
    <section className="view">
      <div className="topbar"><div>
        <div className="eyebrow">Generated from your data</div>
        <h1 className="page">Playbooks &amp; modes</h1>
        <div className="page-sub">Every mode drives its own gauges, stages and cues. CallA.I.d reads each file you upload and proposes new modes — accept, edit, or delete any of them.</div>
      </div></div>

      {isAdmin && proposals.map(p => (
        <div className="proposed" key={p.id}>
          <div className="pi">✨</div>
          <div className="pt">
            <div className="k">Proposed from your upload</div>
            <h3>{p.draft.name}</h3>
            <p>Built from <b>{p.source_filename}</b>. {p.draft.description}</p>
          </div>
          <div className="pa">
            <button className="btn primary" onClick={() => accept(p.id)}>Add mode</button>
            <button className="btn" onClick={() => dismiss(p.id)}>Dismiss</button>
          </div>
        </div>
      ))}

      <Section>Customer care</Section>
      <div className="cards">
        {care.map(p => <Card key={p.id} p={p} isAdmin={isAdmin} onEdit={() => setEditing(p)} onDelete={() => del(p.id)} />)}
        {isAdmin && <div className="pcard add" onClick={() => setEditing('new-care')}><div className="plus">+</div><div>Add a care style</div></div>}
      </div>

      <Section>Sales models</Section>
      <div className="cards">
        {sales.map(p => <Card key={p.id} p={p} isAdmin={isAdmin} onEdit={() => setEditing(p)} onDelete={() => del(p.id)} />)}
        {isAdmin && <div className="pcard add" onClick={() => setEditing('new-sales')}><div className="plus">+</div><div>Add a sales model</div></div>}
      </div>

      {editing && <Editor editing={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </section>
  );
}

function Card({ p, isAdmin, onEdit, onDelete }: { p: Playbook; isAdmin: boolean; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className="pcard">
      {isAdmin && <div className="pmenu"><button onClick={onEdit} title="Edit">✎</button><button onClick={onDelete} title="Delete">🗑</button></div>}
      <div className="ph"><div className="em">{p.emoji}</div><div><h3>{p.name}</h3><div className="meta">{p.source === 'default' ? 'Default · ' : p.source === 'ai-proposed' ? 'AI · ' : ''}{p.mode}</div></div></div>
      <p>{p.description}</p>
      <div className="ptags">{p.tactics.map(t => <span className="chip" key={t}>{t}</span>)}</div>
    </div>
  );
}

function Editor({ editing, onClose, onSaved }: { editing: Playbook | 'new-care' | 'new-sales'; onClose: () => void; onSaved: () => void }) {
  const isNew = typeof editing === 'string';
  const mode = isNew ? (editing === 'new-sales' ? 'sales' : 'care') : editing.mode;
  const init = isNew ? null : editing as Playbook;
  const [name, setName] = useState(init?.name || '');
  const [emoji, setEmoji] = useState(init?.emoji || (mode === 'sales' ? '💼' : '🫶'));
  const [description, setDescription] = useState(init?.description || '');
  const [stages, setStages] = useState((init?.stages || (mode === 'sales' ? ['Discovery', 'Problem', 'Solution', 'Close'] : ['Listen', 'Diagnose', 'Resolve', 'Confirm'])).join(', '));
  const [bank, setBank] = useState((init?.discovery_bank || []).join('\n'));
  const [tactics, setTactics] = useState((init?.tactics || []).join(', '));
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    const body = {
      mode, name, emoji, description,
      stages: stages.split(',').map(s => s.trim()).filter(Boolean),
      discovery_bank: bank.split('\n').map(s => s.trim()).filter(Boolean),
      tactics: tactics.split(',').map(s => s.trim()).filter(Boolean),
      rubric_weights: mode === 'sales'
        ? { discovery: 0.25, objections: 0.2, value: 0.2, pacing: 0.15, close: 0.2 }
        : { empathy: 0.25, tone: 0.2, pacing: 0.15, discovery: 0.2, resolution: 0.2 },
    };
    try {
      if (isNew) await api.createPlaybook(body);
      else await api.updatePlaybook((editing as Playbook).id, body);
      onSaved();
    } finally { setBusy(false); }
  }

  return (
    <div className="modal-back" onClick={onClose} style={modalBack}>
      <div className="panel" style={{ maxWidth: 520, width: '100%' }} onClick={e => e.stopPropagation()}>
        <div className="p-head"><div className="p-title">{isNew ? 'New playbook' : 'Edit playbook'} <span className="tag">{mode}</span></div></div>
        <div className="field"><label>Name</label><div className="inp"><input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. De-escalation" style={inpStyle} /></div></div>
        <div className="field"><label>Emoji</label><div className="inp"><input value={emoji} onChange={e => setEmoji(e.target.value)} style={inpStyle} /></div></div>
        <div className="field"><label>Description</label><div className="inp"><input value={description} onChange={e => setDescription(e.target.value)} style={inpStyle} /></div></div>
        <div className="field"><label>Stages (comma-separated)</label><div className="inp"><input value={stages} onChange={e => setStages(e.target.value)} style={inpStyle} /></div></div>
        <div className="field"><label>Discovery prompts (one per line)</label>
          <textarea value={bank} onChange={e => setBank(e.target.value)} rows={4} style={{ ...inpStyle, width: '100%', background: 'var(--base)', border: '1px solid var(--line)', borderRadius: 10, padding: 11, fontFamily: 'Inter' }} /></div>
        <div className="field"><label>Tactic tags (comma-separated)</label><div className="inp"><input value={tactics} onChange={e => setTactics(e.target.value)} style={inpStyle} /></div></div>
        <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" disabled={!name || busy} onClick={save}>{busy ? '…' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

const modalBack: React.CSSProperties = { position: 'fixed', inset: 0, background: 'rgba(4,7,16,.72)', display: 'grid', placeItems: 'center', padding: 20, zIndex: 50, backdropFilter: 'blur(4px)' };
const inpStyle: React.CSSProperties = { fontFamily: 'Inter', fontSize: 14 };
