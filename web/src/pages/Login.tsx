import { useState } from 'react';
import { useAuth } from '../auth';
import { Spinner } from '../ui';

const DEMO = [
  ['dani@callaid.io', 'Platform owner (super admin)'],
  ['avery@northwind.example', 'Company admin — Northwind'],
  ['priya@northwind.example', 'Customer-service rep'],
  ['theo@northwind.example', 'Sales rep'],
];

export function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('priya@northwind.example');
  const [password, setPassword] = useState('demo1234');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(''); setBusy(true);
    try { await login(email.trim(), password); }
    catch { setErr('Invalid email or password.'); }
    finally { setBusy(false); }
  }

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="brand"><div className="dot" /><div className="name">Call<b>A.I.</b><span>d</span></div></div>
        <h2>Welcome back</h2>
        <div className="sub">Real-time call assist, scored and coached.</div>
        {err && <div className="err">{err}</div>}
        <input type="email" placeholder="you@company.com" value={email} onChange={e => setEmail(e.target.value)} autoFocus />
        <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
        <button className="btn primary" style={{ width: '100%', padding: 12 }} disabled={busy}>{busy ? <Spinner /> : 'Sign in'}</button>
        <div className="demo">
          <b>Demo accounts</b> (password <code>demo1234</code>):
          {DEMO.map(([e, label]) => (
            <button key={e} type="button" onClick={() => { setEmail(e); setPassword('demo1234'); }}>{e} — {label}</button>
          ))}
        </div>
      </form>
    </div>
  );
}
