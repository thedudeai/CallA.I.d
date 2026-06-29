// Auth + session context. Holds the logged-in user, their company, the live
// mode (care/sales), and — for a super admin — the "opened" tenant.
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { api, setToken, getToken, setActiveCompany, getActiveCompany, User, Company, Mode } from './api';

interface AuthState {
  user: User | null;
  company: Company | null;
  mode: Mode;
  loading: boolean;
  isAdmin: boolean;
  isSuper: boolean;
  setMode: (m: Mode) => void;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  openCompany: (id: string | null) => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthState>(null as any);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [mode, setMode] = useState<Mode>('care');
  const [loading, setLoading] = useState(true);

  async function refresh() {
    if (!getToken()) { setLoading(false); return; }
    try {
      const { user, company } = await api.me();
      setUser(user); setCompany(company);
      setMode(user.default_mode || 'care');
    } catch { setToken(null); setActiveCompany(null); setUser(null); setCompany(null); }
    setLoading(false);
  }
  useEffect(() => { refresh(); }, []);

  // Reflect mode onto <html data-mode> so the whole theme retints.
  useEffect(() => { document.documentElement.dataset.mode = mode; }, [mode]);

  async function login(email: string, password: string) {
    const { token, user } = await api.login(email, password);
    setToken(token); setActiveCompany(null);
    setUser(user); setMode(user.default_mode || 'care');
    if (user.company_id) { const { company } = await api.me(); setCompany(company); }
    else setCompany(null);
  }
  function logout() {
    setToken(null); setActiveCompany(null); setUser(null); setCompany(null);
  }
  // Super admin opens a tenant: set the override header and load that company.
  async function openCompany(id: string | null) {
    setActiveCompany(id);
    if (!id) { setCompany(null); return; }
    const list = await api.companies();
    const c = list.find((x: any) => x.id === id);
    setCompany(c ? { id: c.id, name: c.name, plan: c.plan, status: c.status, theme: c.theme, seats: c.seats } : null);
  }

  const isAdmin = user?.role === 'company_admin' || user?.role === 'super_admin';
  const isSuper = user?.role === 'super_admin';

  return (
    <Ctx.Provider value={{ user, company, mode, loading, isAdmin, isSuper, setMode, login, logout, openCompany, refresh }}>
      {children}
    </Ctx.Provider>
  );
}
