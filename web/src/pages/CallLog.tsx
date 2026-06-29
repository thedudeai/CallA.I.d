import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, CallRow, CallDetail } from '../api';
import { Spinner, fmtDuration } from '../ui';

export function CallLog() {
  const [rows, setRows] = useState<CallRow[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [detail, setDetail] = useState<CallDetail | null>(null);
  const [params] = useSearchParams();

  useEffect(() => {
    api.calls().then(r => {
      setRows(r);
      const initial = params.get('call') || r[0]?.id || null;
      setSel(initial);
    });
  }, []); // eslint-disable-line

  useEffect(() => { if (sel) api.call(sel).then(setDetail).catch(() => setDetail(null)); }, [sel]);

  async function toggle(taskId: string, done: boolean) {
    await api.toggleTask(taskId, done);
    if (detail) setDetail({ ...detail, tasks: detail.tasks.map(t => t.id === taskId ? { ...t, done } : t) });
  }

  return (
    <section className="view">
      <div className="topbar"><div>
        <div className="eyebrow">Full history · every call kept</div>
        <h1 className="page">Call log</h1>
        <div className="page-sub">Each call is saved with its score, the gap, and an AI summary. Follow-ups and to-dos are pulled out automatically as tasks and pushed to your calendar.</div>
      </div></div>

      <div className="loglayout">
        <div className="loglist">
          {!rows ? <Spinner /> : rows.length === 0 ? <div className="empty">No calls yet.</div> :
            rows.map(c => (
              <div key={c.id} className={`logrow ${sel === c.id ? 'sel' : ''}`} onClick={() => setSel(c.id)}>
                <span className="lmode" style={{ background: `var(--${c.mode})` }} />
                <div className="lmain"><b>{c.contact_name}</b><small>{typeLabel(c)} · {when(c.started_at)}</small></div>
                <span className="lsc" style={{ color: `var(--${c.mode})` }}>{c.overall_score}</span>
              </div>
            ))}
        </div>
        <div className="panel detail">
          {!detail ? <div className="empty"><Spinner /></div> : (
            <>
              <div className="dhead">
                <div className="pic">{detail.contact_name.split(' ').map(w => w[0]).join('')}</div>
                <div>
                  <div className="dn">{detail.contact_name}</div>
                  <div className="dm">{typeLabel(detail)} · {detail.rep?.name} · {fmtDuration(detail.duration)}</div>
                </div>
                <div className="gap"><b style={{ color: `var(--${detail.mode})` }}>{detail.overall_score}</b><small>score · gap {detail.gap >= 0 ? '+' : ''}{detail.gap}</small></div>
              </div>
              <div className="dblock"><div className="dt">AI summary</div><p>{detail.summary}</p></div>
              <div className="dblock">
                <div className="dt">Tasks &amp; notes <span className="chip">auto-extracted</span></div>
                <div className="tasks">
                  {detail.tasks.length === 0 ? <div className="empty">No tasks.</div> : detail.tasks.map(t => (
                    <div className="task" key={t.id}>
                      <span className="cbx" data-done={t.done} onClick={() => toggle(t.id, !t.done)}>{t.done ? '✓' : ''}</span>
                      <div className="tg">{t.text}<small>{t.source === 'ai' ? 'auto' : 'manual'} · {t.kind}</small></div>
                      {t.source === 'ai' && <span className="auto">AI</span>}
                    </div>
                  ))}
                </div>
              </div>
              <div className="dblock">
                <div className="dt">Scheduled follow-up</div>
                {detail.follow ? (
                  <div className="calchip">
                    <div className="cal"><div className="m">{month(detail.follow.starts_at)}</div><div className="d">{day(detail.follow.starts_at)}</div></div>
                    <div className="ci2"><b>{detail.follow.title}</b><small>{niceTime(detail.follow.starts_at)} · added to calendar</small></div>
                    <span className="added">✓ on calendar</span>
                  </div>
                ) : <p>No follow-up needed — call closed on the spot.</p>}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function typeLabel(c: { mode: string; call_type: string | null; playbook?: any }) {
  const m = c.mode === 'care' ? 'Care' : 'Sales';
  const pb = c.playbook?.name ? ` · ${c.playbook.name.toLowerCase()}` : (c.call_type ? ` · ${c.call_type}` : '');
  return `${m}${pb}`;
}
function when(iso: string) {
  const d = new Date(iso); const now = new Date();
  const same = d.toDateString() === now.toDateString();
  const yest = new Date(now.getTime() - 86400000).toDateString() === d.toDateString();
  const t = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${same ? 'Today' : yest ? 'Yesterday' : d.toLocaleDateString()} · ${t}`;
}
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
function month(iso: string) { return MONTHS[new Date(iso).getMonth()]; }
function day(iso: string) { return String(new Date(iso).getDate()).padStart(2, '0'); }
function niceTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString([], { weekday: 'short' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
