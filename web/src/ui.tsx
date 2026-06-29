// Shared presentational helpers — the gauge/ring/stepper SVGs and small utils
// ported from the mockup so screens stay faithful to the visual spec.
import { ReactNode } from 'react';

export function initials(name: string) {
  return name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}
export function fmtDuration(sec: number) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}
export function fmtClock(sec: number) {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
export function scoreColor(v: number) {
  if (v >= 80) return 'var(--accent)';
  if (v >= 70) return 'var(--text)';
  return 'var(--amber)';
}

// Half-circle needle gauge. value 0..100.
export function Gauge({ value, read, label, state, color }: { value: number; read: string; label: string; state: string; color?: string }) {
  const dash = 226; // arc length
  const offset = dash - (dash * Math.min(100, Math.max(0, value))) / 100;
  const angle = -90 + (value / 100) * 180; // needle rotation
  return (
    <div className="gauge">
      <svg viewBox="0 0 180 112">
        <path d="M18 100 A 72 72 0 0 1 162 100" fill="none" stroke="rgba(140,160,210,.16)" strokeWidth="11" strokeLinecap="round" />
        <path d="M18 100 A 72 72 0 0 1 162 100" fill="none" stroke={color || 'var(--accent)'} strokeWidth="11" strokeLinecap="round" strokeDasharray={dash} strokeDashoffset={offset} style={{ transition: 'stroke-dashoffset .5s ease' }} />
        <g transform={`rotate(${angle} 90 100)`} style={{ transition: 'transform .5s ease' }}>
          <line x1="90" y1="100" x2="90" y2="44" stroke="var(--text)" strokeWidth="3" strokeLinecap="round" />
          <circle cx="90" cy="100" r="6" fill="var(--text)" />
        </g>
      </svg>
      <div className="read" style={color ? { color } : undefined}>{read}</div>
      <div className="lab">{label}</div>
      <div className="state">{state}</div>
    </div>
  );
}

export function Ring({ value, sub = 'Overall' }: { value: number; sub?: string }) {
  const dash = 327;
  const offset = dash - (dash * Math.min(100, value)) / 100;
  return (
    <div className="ring">
      <svg viewBox="0 0 120 120" width="172" height="172">
        <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(140,160,210,.14)" strokeWidth="10" />
        <circle cx="60" cy="60" r="52" fill="none" stroke="var(--accent)" strokeWidth="10" strokeLinecap="round" strokeDasharray={dash} strokeDashoffset={offset} transform="rotate(-90 60 60)" style={{ transition: 'stroke-dashoffset .6s ease' }} />
      </svg>
      <div className="pct"><div><b>{value}</b><small>{sub}</small></div></div>
    </div>
  );
}

export function Stepper({ stages, current }: { stages: string[]; current: number }) {
  return (
    <div className="stepper">
      {stages.map((s, i) => (
        <span key={s} style={{ display: 'contents' }}>
          {i > 0 && <span className="step-sep" />}
          <div className={`step ${i < current ? 'done' : i === current ? 'now' : ''}`}>
            <span className="si">{i < current ? '✓' : i + 1}</span>{s}
          </div>
        </span>
      ))}
    </div>
  );
}

export function Bars({ scores }: { scores: { label?: string; dimension: string; value: number }[] }) {
  return (
    <div className="bars">
      {scores.map(b => (
        <div className="bar" key={b.dimension}>
          <div className="bt"><span>{b.label || b.dimension}</span><b>{b.value}</b></div>
          <div className="meter"><i style={{ width: `${b.value}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

export function Section({ children }: { children: ReactNode }) {
  return <div className="section-h">{children} <span className="ln" /></div>;
}

export function Spinner() { return <span className="spin" />; }

export const ICONS: Record<string, ReactNode> = {
  live: <path d="M5 4h4l2 5-3 2a13 13 0 0 0 6 6l2-3 5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 3 8a2 2 0 0 1 2-4z" />,
  feedback: <><path d="M4 19V9m6 10V5m6 14v-6" /><path d="M3 21h18" /></>,
  calllog: <><path d="M5 5h14M5 10h14M5 15h9" /><circle cx="18" cy="18" r="3" /></>,
  playbooks: <><path d="M4 5a2 2 0 0 1 2-2h6v18H6a2 2 0 0 1-2-2z" /><path d="M12 3h6a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-6" /></>,
  reporting: <><path d="M3 3v18h18" /><path d="M7 14l3-4 3 3 4-6" /></>,
  settings: <><circle cx="12" cy="12" r="3.2" /><path d="M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.2 2H9.8L9.4 4.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.7h4.4l.4-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5z" /></>,
  superadmin: <><rect x="3" y="4" width="7" height="7" rx="1.5" /><rect x="14" y="4" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="6" rx="1.5" /><rect x="14" y="14" width="7" height="6" rx="1.5" /></>,
};

export function Icon({ name }: { name: string }) {
  return <svg className="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">{ICONS[name]}</svg>;
}
