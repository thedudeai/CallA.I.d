import { useEffect, useState } from 'react';
import { api, CallDetail } from '../api';
import { Ring, Bars, Spinner, fmtDuration } from '../ui';

export function Feedback() {
  const [call, setCall] = useState<CallDetail | null | undefined>(undefined);
  useEffect(() => { api.feedbackLatest().then(setCall).catch(() => setCall(null)); }, []);

  if (call === undefined) return <div className="empty"><Spinner /></div>;
  if (!call) return (
    <section className="view">
      <Header />
      <div className="panel"><div className="empty">No calls yet. Run a call on the <b>On the call</b> screen, then come back for your coaching.</div></div>
    </section>
  );

  return (
    <section className="view">
      <Header sub={`Call with ${call.contact_name} · ${fmtDuration(call.duration)} · ${call.mode === 'care' ? 'Customer care' : 'Sales'}. You only see your own calls here — admins see the whole team under Reporting.`} />
      <div className="grid2">
        <div className="panel scorebig">
          <Ring value={call.overall_score} />
          <div className="verdict">{renderVerdict(call.verdict)}</div>
        </div>
        <div className="panel">
          <div className="p-head"><div className="p-title">Breakdown</div></div>
          <Bars scores={call.scores} />
          <div className="moments">
            {call.moments.map((m, i) => (
              <div className="moment" key={i}>
                <div className="t">{m.ts}</div>
                <div><div className="h"><span className={`dotg ${m.severity}`} />{m.label}</div><div className="d">{m.detail}</div></div>
              </div>
            ))}
          </div>
          {call.coaching && (
            <div className="coach"><div className="ct">Try next time</div><p><b>One change:</b> {call.coaching}</p></div>
          )}
        </div>
      </div>
    </section>
  );
}

function Header({ sub }: { sub?: string }) {
  return (
    <div className="topbar"><div>
      <div className="eyebrow">After the call · your coaching</div>
      <h1 className="page">My feedback</h1>
      {sub && <div className="page-sub">{sub}</div>}
    </div></div>
  );
}

function renderVerdict(v: string | null) {
  if (!v) return 'Scored.';
  // Bold the leading clause for the accent flourish from the mockup.
  const [head, ...rest] = v.split('.');
  return <>{head}. <span>{rest.join('.').trim()}</span></>;
}
