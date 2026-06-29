import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { api, getToken, Playbook, Mode } from '../api';
import { Gauge, Stepper, fmtClock } from '../ui';

interface Guidance {
  engine: string; degraded?: boolean;
  cue: { kicker: string; line: string; why: string; alts: string[] };
  stage: { name: string; index: number; all: string[] };
  gauges: { tone: any; pace: any; energy: any };
  discovery: { key: string; label: string; captured: boolean }[];
  discoveryComplete: boolean; listen: boolean; score: number; scoreTrend: string;
  elapsed?: number;
}

// Demo scenarios so the live HUD can be exercised without telephony. In
// production these turns arrive from Twilio Media Streams → streaming STT.
const SCENARIOS: Record<Mode, { contact: string; number: string; callType: string; turns: { speaker: string; text: string }[] }> = {
  care: {
    contact: 'Marcus Reyes', number: '+1 (415) 555-0148', callType: 'returning',
    turns: [
      { speaker: 'caller', text: "This is the third time I'm calling — my headphones still won't sync and I'm really frustrated." },
      { speaker: 'rep', text: 'I hear you, three calls on the same issue is genuinely frustrating. Let me own this and get it fixed today.' },
      { speaker: 'caller', text: "I already tried reinstalling the app twice and it didn't help at all." },
      { speaker: 'rep', text: 'Thanks for trying that. Can I confirm the account on file is the one tied to this order?' },
      { speaker: 'caller', text: "Yes that's me. It just keeps failing to sync." },
      { speaker: 'rep', text: "Found it — your app build is outdated, that's the sync bug. Let's update it now and I'll stay on until it works." },
    ],
  },
  sales: {
    contact: 'Lena Ford', number: '+1 (628) 555-0112', callType: 'inbound',
    turns: [
      { speaker: 'caller', text: 'We saw your demo and wanted to learn more about the platform.' },
      { speaker: 'rep', text: 'Before I show you anything — what are you using to handle onboarding today, and where is it falling short?' },
      { speaker: 'caller', text: "It's all manual right now, probably six hours a week across the team." },
      { speaker: 'rep', text: "Six hours a week is real money. Here's exactly how we'd remove that, and what it's worth back to you." },
      { speaker: 'caller', text: "That sounds great — what would a trial look like?" },
    ],
  },
};

export function Live() {
  const { mode, setMode, user } = useAuth();
  const nav = useNavigate();
  const [playbooks, setPlaybooks] = useState<Playbook[]>([]);
  const [playbookId, setPlaybookId] = useState<string>('');
  const [status, setStatus] = useState<'idle' | 'connecting' | 'live' | 'ended'>('idle');
  const [g, setG] = useState<Guidance | null>(null);
  const [transcript, setTranscript] = useState<{ speaker: string; text: string }[]>([]);
  const [listen, setListen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [input, setInput] = useState('');
  const [speaker, setSpeaker] = useState<'caller' | 'rep'>('caller');
  const wsRef = useRef<WebSocket | null>(null);
  const playRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const transcriptRef = useRef<{ speaker: string; text: string }[]>([]);
  const httpRef = useRef(false);          // true once we fall back to per-turn HTTP (no WS)
  const elapsedRef = useRef(0);

  const scenario = SCENARIOS[mode];
  const modePlaybooks = playbooks.filter(p => p.mode === mode);

  useEffect(() => { api.playbooks().then(setPlaybooks).catch(() => {}); }, []);
  useEffect(() => {
    const dft = modePlaybooks.find(p => p.id === user?.default_playbook_id) || modePlaybooks[0];
    setPlaybookId(dft?.id || '');
  }, [playbooks, mode]); // eslint-disable-line

  useEffect(() => () => teardown(), []);

  function teardown() {
    if (playRef.current) clearInterval(playRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    try { wsRef.current?.close(); } catch { /* ignore */ }
  }

  function startTimer() {
    elapsedRef.current = 0;
    timerRef.current = window.setInterval(() => { elapsedRef.current += 1; setElapsed(e => e + 1); }, 1000);
  }

  function start() {
    teardown();
    setTranscript([]); transcriptRef.current = []; setG(null); setListen(false); setElapsed(0);
    httpRef.current = false; setStatus('connecting');
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    let ready = false;
    let ws: WebSocket;
    try { ws = new WebSocket(`${proto}://${location.host}/calls/live?token=${getToken()}`); }
    catch { startHttp(); return; }
    wsRef.current = ws;
    // If the WS can't establish quickly (e.g. serverless platforms), fall back to HTTP.
    const fallback = window.setTimeout(() => { if (!ready) startHttp(); }, 1800);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: 'start', mode, playbook_id: playbookId, contact_name: scenario.contact, contact_number: scenario.number, call_type: scenario.callType, touch_number: mode === 'care' ? 3 : 1 }));
    };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.type === 'ready') { ready = true; clearTimeout(fallback); setStatus('live'); startTimer(); }
      else if (m.type === 'guidance') { setG(m); if (m.listen) setListen(true); }
      else if (m.type === 'analysis') { setStatus('ended'); if (m.call_id) setTimeout(() => nav('/feedback'), 900); }
    };
    ws.onclose = () => { if (timerRef.current) clearInterval(timerRef.current); if (!ready && !httpRef.current) { clearTimeout(fallback); startHttp(); } };
    ws.onerror = () => { /* close handler drives the fallback */ };
  }

  // HTTP transport: no persistent connection — each turn posts the running
  // transcript and gets the same guidance shape back. Used wherever WS isn't held.
  function startHttp() {
    if (httpRef.current) return;
    httpRef.current = true;
    try { wsRef.current?.close(); } catch { /* ignore */ }
    setStatus('live'); startTimer();
    requestHttpGuidance(mode);
  }

  async function requestHttpGuidance(modeArg: Mode) {
    try {
      const g = await api.liveSuggest({ transcript: transcriptRef.current, mode: modeArg, playbook_id: playbookId, call_type: scenario.callType, touch_number: modeArg === 'care' ? 3 : 1 });
      setG(g); if (g.listen) setListen(true);
    } catch { /* keep last guidance */ }
  }

  function sendTurn(sp: string, text: string) {
    const next = [...transcriptRef.current, { speaker: sp, text }];
    transcriptRef.current = next; setTranscript(next);
    if (httpRef.current) requestHttpGuidance(mode);
    else wsRef.current?.send(JSON.stringify({ type: 'turn', speaker: sp, text }));
  }

  function playScenario() {
    if (status !== 'live') return;
    let i = 0;
    if (playRef.current) clearInterval(playRef.current);
    playRef.current = window.setInterval(() => {
      if (i >= scenario.turns.length) { clearInterval(playRef.current!); return; }
      const turn = scenario.turns[i++];
      sendTurn(turn.speaker, turn.text);
    }, 2600);
  }

  async function end() {
    if (playRef.current) clearInterval(playRef.current);
    if (timerRef.current) clearInterval(timerRef.current);
    setStatus('ended');
    if (httpRef.current) {
      if (!transcriptRef.current.length) return;
      try {
        await api.analyze({ contact_name: scenario.contact, contact_number: scenario.number, mode, playbook_id: playbookId, call_type: scenario.callType, touch_number: mode === 'care' ? 3 : 1, duration: elapsedRef.current, transcript: transcriptRef.current });
        setTimeout(() => nav('/feedback'), 700);
      } catch { /* stay on screen */ }
    } else {
      wsRef.current?.send(JSON.stringify({ type: 'end' }));
    }
  }

  function toggleListen() {
    const v = !listen; setListen(v);
    if (!httpRef.current) wsRef.current?.send(JSON.stringify({ type: 'listen', on: v }));
  }

  function switchMode(m: Mode) {
    setMode(m);
    if (status === 'live') {
      if (httpRef.current) requestHttpGuidance(m);
      else wsRef.current?.send(JSON.stringify({ type: 'mode', mode: m }));
    }
  }

  const stages = g?.stage.all || (mode === 'care' ? ['Listen', 'Diagnose', 'Resolve', 'Confirm'] : ['Discovery', 'Problem', 'Solution', 'Close']);
  const tone = g?.gauges.tone, pace = g?.gauges.pace, energy = g?.gauges.energy;

  return (
    <section className="view">
      <div className="topbar">
        <div><div className="eyebrow">Live assist · opens in your default mode</div><h1 className="page">On the call</h1></div>
        <div className="modesw">
          <button className="care" data-on={mode === 'care'} onClick={() => switchMode('care')}><span className="pip" />Customer care</button>
          <button className="sales" data-on={mode === 'sales'} onClick={() => switchMode('sales')}><span className="pip" />Sales</button>
        </div>
      </div>

      {user?.role === 'super_admin' && (
        <div className="banner">You're viewing the live HUD as the platform owner. Live calls run under a rep's account — this is a preview.</div>
      )}

      <div className="ctxbar">
        <div className="ctx-left">
          <span className="chip">Detected</span>
          <span className="ct-type">{labelType(g?.engine ? scenario.callType : scenario.callType, mode)}</span>
          <span className="ct-j">{mode === 'care' ? `touch ${3} · same issue` : `inbound demo · touch 1`}</span>
          {g && <span className="chip" title="Which engine produced this">{g.engine === 'claude' ? '✨ Claude' : 'rules engine'}{g.degraded ? ' (degraded)' : ''}</span>}
        </div>
        <Stepper stages={stages} current={g?.stage.index ?? 0} />
      </div>

      <div className="hud" data-listen={listen}>
        {/* Left: caller + gauges + energy */}
        <div className="panel">
          <div className="caller">
            <div className="pic">{scenario.contact.split(' ').map(w => w[0]).join('')}</div>
            <div>
              <div className="nm">{scenario.contact}</div>
              <div className="meta"><span className="chip">{scenario.number}</span>
                <span className={`chip ${mode === 'care' ? 'hot' : ''}`}>{mode === 'care' ? 'Frustrated · 3rd call' : 'Curious · new lead'}</span></div>
            </div>
            <div className="live"><span className="blip" />{fmtClock(elapsed)}</div>
          </div>
          <div className="wave" aria-hidden>{Array.from({ length: 40 }).map((_, i) => (
            <i key={i} style={{ animationDelay: `${(i % 10) * 0.11}s`, animationDuration: `${0.7 + (i % 7) * 0.1}s` }} />
          ))}</div>
          <div className="gauges">
            <Gauge value={tone?.value ?? 60} read={tone?.read ?? '—'} label="Tone" state={tone?.state ?? 'waiting'} />
            <Gauge value={pace?.value ?? 45} read={pace?.read ?? '—'} label="Pace" state={pace?.state ?? 'waiting'} color={(pace?.value ?? 0) > 62 ? 'var(--amber)' : undefined} />
          </div>
          <div className="energy">
            <div className="row"><span>Energy match</span><span className="mono">gap {energy?.gap ?? 0} steps</span></div>
            <div className="track">
              <span className="mk cust" style={{ left: `${energy?.caller ?? 60}%` }} />
              <span className="mk you" style={{ left: `${energy?.you ?? 40}%` }} />
            </div>
            <div className="legend">
              <span><i style={{ background: 'var(--coral)' }} />Caller: {energy?.callerLabel ?? '—'}</span>
              <span><i style={{ background: 'var(--accent)' }} />You: {energy?.youLabel ?? '—'}</span>
            </div>
          </div>

          {/* Call simulator */}
          <div className="sim">
            <div className="section-h" style={{ margin: '20px 0 6px', fontSize: 13 }}>Call simulator <span className="ln" /></div>
            <div className="simrow">
              <select value={playbookId} onChange={e => setPlaybookId(e.target.value)} disabled={status === 'live'}>
                {modePlaybooks.map(p => <option key={p.id} value={p.id}>{p.emoji} {p.name}</option>)}
              </select>
              {status === 'idle' || status === 'ended'
                ? <button className="btn primary" onClick={start}>Start call</button>
                : <button className="btn" onClick={end}>End &amp; score</button>}
              {status === 'live' && <button className="btn" onClick={playScenario}>▶ Play scenario</button>}
            </div>
            {status === 'live' && (
              <div className="simrow">
                <select value={speaker} onChange={e => setSpeaker(e.target.value as any)} style={{ flex: 'none' }}>
                  <option value="caller">Caller</option><option value="rep">You (rep)</option>
                </select>
                <input placeholder="Type a line and press Enter…" value={input}
                  onChange={e => setInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && input.trim()) { sendTurn(speaker, input.trim()); setInput(''); } }} />
              </div>
            )}
            {transcript.length > 0 && (
              <div className="transcriptbox">
                {transcript.map((t, i) => <div key={i} className={`tline ${t.speaker}`}><b>{t.speaker === 'rep' ? 'YOU' : 'CALLER'}</b> · {t.text}</div>)}
              </div>
            )}
          </div>
        </div>

        {/* Right: say-next */}
        <div className="panel glassy">
          <div className="p-head"><div className="p-title">Say next <span className="tag">{mode === 'care' ? 'CARE' : 'SELL'}</span></div></div>
          <div className="saynext">
            <div className="cue">
              <div className="k"><span>›</span> <span>{g?.cue.kicker || (status === 'live' ? 'Listening…' : 'Start a call to get cues')}</span></div>
              <div className="line">{g?.cue.line || (status === 'idle' ? '“Start the call simulator to see live, KB-grounded guidance appear here.”' : '…')}</div>
              {g?.cue.why && <div className="why">{g.cue.why}</div>}
            </div>
            <div className="alt">
              {(g?.cue.alts || []).map((a, i) => <button key={i} onClick={() => sendTurn('rep', a)}>{a}</button>)}
            </div>
            {g && !g.discoveryComplete && (
              <div className="disco"><span>◆</span><div><b>{mode === 'sales' ? 'Keep digging — no problem captured yet.' : 'Diagnose first.'}</b> {mode === 'sales' ? 'Map the product to a pain you have actually heard.' : 'Reflect the problem back before offering a fix.'}</div></div>
            )}
            {g && g.discovery.length > 0 && (
              <div className="captured">
                <div className="cl">{mode === 'sales' ? 'Discovery captured' : 'Issue captured'}</div>
                {g.discovery.map(d => (
                  <div key={d.key} className={`ci ${d.captured ? '' : 'miss'}`}><span className="tick">{d.captured ? '✓' : '…'}</span>{d.label}</div>
                ))}
              </div>
            )}
            <div className="listenbar">
              <div className="lt"><b>Just listen</b> — let them finish without interrupting</div>
              <div className="toggle" data-on={listen} role="switch" onClick={toggleListen} />
            </div>
            <div className="listen-prompt"><span className="pulse" /> Listening — don't interrupt. Let them get it all out.</div>
            <div className="livescore">
              <div className="num">{g?.score ?? '—'}</div>
              <div className="meta">Live call score · <b>{g?.scoreTrend || '—'}</b><br />{mode === 'care' ? 'Empathy strong · watch your pace' : 'Discovery first · then map value'}</div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function labelType(t: string, mode: Mode) {
  const map: Record<string, string> = { returning: 'Returning customer', inbound: 'Inbound demo request', cold: 'Cold outreach', 'follow-up': 'Follow-up', new: 'New customer' };
  return map[t] || (mode === 'care' ? 'Customer' : 'Lead');
}
