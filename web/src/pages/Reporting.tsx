import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { Spinner, Bars, initials, fmtDuration } from '../ui';

export function Reporting() {
  const [team, setTeam] = useState<any>(null);
  const [rep, setRep] = useState<any>(null);
  const nav = useNavigate();

  useEffect(() => { api.team().then(setTeam); }, []);
  function open(id: string) { api.rep(id).then(setRep); window.scrollTo({ top: 0, behavior: 'smooth' }); }

  if (!team) return <div className="empty"><Spinner /></div>;

  return (
    <section className="view">
      <div className="topbar"><div>
        <div className="eyebrow">Admin only · whole team</div>
        <h1 className="page">Team reporting</h1>
        <div className="page-sub">Every call is saved and rated. Click any rep to open their profile — scoring, trends and their full call log.</div>
      </div></div>

      {!rep ? (
        <>
          <div className="statgrid">
            <Stat v={team.stats.calls} l="Calls (all time)" d="▲ live" />
            <Stat v={team.stats.avg_score} l="Avg call score" color="var(--care)" d="team avg" />
            <Stat v={`${team.stats.close_rate}%`} l="Sales close rate" d="score ≥ 80" />
            <Stat v={team.stats.csat} l="CSAT (care)" d="of 5" />
          </div>
          <div className="twocol">
            <div className="panel">
              <div className="p-head"><div className="p-title">Rep performance</div><span className="chip">click a rep →</span></div>
              <div className="lbrow head"><span>#</span><span>Rep</span><span className="calls">Calls</span><span style={{ textAlign: 'right' }}>Trend</span><span style={{ textAlign: 'right' }}>Score</span></div>
              {team.leaderboard.map((r: any, i: number) => (
                <div className="lbrow click" key={r.id} onClick={() => open(r.id)}>
                  <span className="rk">{i + 1}</span>
                  <span className="nm"><div className="ava" style={{ width: 28, height: 28, fontSize: 11 }}>{initials(r.name)}</div>{r.name} <span className={`role ${r.mode}`} style={{ padding: '2px 7px' }}>{r.mode}</span></span>
                  <span className="calls mono">{r.calls}</span>
                  <span className={r.trend === 'up' ? 'up' : 'down'} style={{ textAlign: 'right' }}>{r.trend === 'up' ? '▲' : '▼'}</span>
                  <span className="sc" style={{ color: r.avg >= 80 ? `var(--${r.mode})` : r.avg >= 70 ? 'var(--text)' : 'var(--amber)' }}>{r.avg}</span>
                </div>
              ))}
            </div>
            <div className="panel">
              <div className="p-head"><div className="p-title">Saved call logs</div><span className="chip">rated &amp; stored</span></div>
              {team.saved_logs.map((c: any) => (
                <div className="log" key={c.id} onClick={() => nav(`/calllog?call=${c.id}`)}>
                  <span className="lmode" style={{ background: `var(--${c.mode})` }} />
                  <div><div>{c.contact_name} · {c.rep}</div><div className="ltype">{c.mode === 'care' ? 'Care' : 'Sales'} · {c.call_type || '—'} · {fmtDuration(c.duration)}</div></div>
                  <span className="lscore" style={{ color: c.overall_score >= 80 ? `var(--${c.mode})` : c.overall_score >= 70 ? 'var(--text)' : 'var(--amber)' }}>{c.overall_score}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <RepProfile rep={rep} onBack={() => setRep(null)} onCall={(id: string) => nav(`/calllog?call=${id}`)} />
      )}
    </section>
  );
}

function Stat({ v, l, d, color }: { v: any; l: string; d?: string; color?: string }) {
  return <div className="stat"><div className="sv" style={color ? { color } : undefined}>{v}</div><div className="sl">{l}</div>{d && <div className="sd up">{d}</div>}</div>;
}

function RepProfile({ rep, onBack, onCall }: { rep: any; onBack: () => void; onCall: (id: string) => void }) {
  return (
    <div>
      <button className="backlink" onClick={onBack}>‹ Back to team</button>
      <div className="profhead">
        <div className="pa">{initials(rep.name)}</div>
        <div><div className="pn">{rep.name}</div><div className="pm"><span className={`role ${rep.mode}`} style={{ padding: '3px 9px' }}>● {roleLabel(rep.role)}</span> Default: {rep.default_playbook || rep.mode}</div></div>
      </div>
      <div className="statgrid">
        <Stat v={rep.avg} l="Avg call score" color={`var(--${rep.mode})`} />
        <Stat v={rep.calls} l="Calls (all time)" />
        <div className="stat"><div className="sv" style={{ fontSize: 20, marginTop: 6 }}>{rep.trend === 'up' ? <span className="up">▲ improving</span> : <span className="down">▼ dipping</span>}</div><div className="sl">Trend</div></div>
        <Stat v={rep.mode === 'care' ? `${(rep.avg / 20).toFixed(1)}` : `${Math.round(rep.avg * 0.45)}%`} l={rep.mode === 'care' ? 'CSAT' : 'Close rate'} />
      </div>
      <div className="twocol">
        <div className="panel">
          <div className="p-head"><div className="p-title">Scoring breakdown</div><span className="chip">avg</span></div>
          <Bars scores={rep.breakdown} />
          <div className="coach"><div className="ct">Coaching focus</div><p>{rep.note}</p></div>
        </div>
        <div className="panel">
          <div className="p-head"><div className="p-title">{rep.name.split(' ')[0]}'s call log</div><span className="chip">{rep.calls} total</span></div>
          <div className="loglist">
            {rep.log.map((l: any) => (
              <div className="logrow" key={l.id} onClick={() => onCall(l.id)} style={{ cursor: 'pointer' }}>
                <span className="lmode" style={{ background: `var(--${l.mode})` }} />
                <div className="lmain"><b>{l.contact_name}</b><small>{l.mode === 'care' ? 'Care' : 'Sales'} · {l.call_type || '—'} · {fmtDuration(l.duration)}</small></div>
                <span className="lsc" style={{ color: `var(--${l.mode})` }}>{l.overall_score}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function roleLabel(role: string) {
  return { sales_rep: 'Sales rep', customer_service_rep: 'Customer service' }[role] || role;
}
