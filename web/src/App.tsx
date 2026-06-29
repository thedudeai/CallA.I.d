import { Routes, Route, NavLink, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import { Icon, initials, Spinner } from './ui';
import { Login } from './pages/Login';
import { Live } from './pages/Live';
import { Feedback } from './pages/Feedback';
import { CallLog } from './pages/CallLog';
import { Playbooks } from './pages/Playbooks';
import { Reporting } from './pages/Reporting';
import { Settings } from './pages/Settings';
import { SuperAdmin } from './pages/SuperAdmin';

export function App() {
  const { user, loading } = useAuth();
  if (loading) return <div className="login"><Spinner /></div>;
  if (!user) return <Login />;
  return (
    <div className="app">
      <Rail />
      <main className="main">
        <Routes>
          <Route path="/" element={<TenantOnly><Live /></TenantOnly>} />
          <Route path="/feedback" element={<TenantOnly><Feedback /></TenantOnly>} />
          <Route path="/calllog" element={<TenantOnly><CallLog /></TenantOnly>} />
          <Route path="/playbooks" element={<TenantOnly><Playbooks /></TenantOnly>} />
          <Route path="/reporting" element={<AdminOnly><Reporting /></AdminOnly>} />
          <Route path="/settings" element={<AdminOnly><Settings /></AdminOnly>} />
          <Route path="/superadmin" element={<SuperOnly><SuperAdmin /></SuperOnly>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <TabBar />
    </div>
  );
}

// Super admin must "open" a tenant before tenant screens render.
function TenantOnly({ children }: { children: JSX.Element }) {
  const { isSuper, company } = useAuth();
  if (isSuper && !company) return <Navigate to="/superadmin" replace />;
  return children;
}
function AdminOnly({ children }: { children: JSX.Element }) {
  const { isAdmin, isSuper, company } = useAuth();
  if (!isAdmin) return <Navigate to="/" replace />;
  if (isSuper && !company) return <Navigate to="/superadmin" replace />;
  return children;
}
function SuperOnly({ children }: { children: JSX.Element }) {
  const { isSuper } = useAuth();
  if (!isSuper) return <Navigate to="/" replace />;
  return children;
}

function Rail() {
  const { user, company, isAdmin, isSuper, logout, openCompany } = useAuth();
  if (!user) return null;
  const tenantVisible = !isSuper || !!company;
  return (
    <aside className="rail">
      <div className="brand"><div className="dot" /><div className="name">Call<b>A.I.</b><span>d</span></div></div>

      <div className="coswitch" title={isSuper ? 'Opened tenant' : 'Your workspace'}>
        <div className="cb" />
        <div className="cinfo">
          <b>{company?.name || (isSuper ? 'Platform' : 'Workspace')}</b>
          <small>{isSuper ? (company ? 'Tenant (opened)' : 'CallA.I.d HQ') : 'Your workspace'}</small>
        </div>
        {isSuper && company && <span className="chev" style={{ cursor: 'pointer' }} title="Exit tenant" onClick={() => openCompany(null)}>✕</span>}
      </div>

      <nav className="nav">
        {tenantVisible && <>
          <div className="nav-label">Live</div>
          <NavItem to="/" icon="live">On the call</NavItem>
          <div className="nav-label">Review</div>
          <NavItem to="/feedback" icon="feedback">My feedback</NavItem>
          <NavItem to="/calllog" icon="calllog">Call log</NavItem>
          <NavItem to="/playbooks" icon="playbooks">Playbooks &amp; modes</NavItem>
        </>}
        {isAdmin && tenantVisible && <>
          <div className="nav-label">Admin <span className="lock">🔒</span></div>
          <NavItem to="/reporting" icon="reporting">Team reporting</NavItem>
          <NavItem to="/settings" icon="settings">Company &amp; settings</NavItem>
        </>}
        {isSuper && <>
          <div className="nav-label">Platform 👑</div>
          <NavItem to="/superadmin" icon="superadmin">Super admin</NavItem>
        </>}
      </nav>

      <div className="rail-foot">
        <div className="ava">{initials(user.name)}</div>
        <div className="who">{user.name}<small>{roleLabel(user.role)}</small></div>
        <button className="out" onClick={logout} title="Sign out">Sign out</button>
      </div>
    </aside>
  );
}

function NavItem({ to, icon, children }: { to: string; icon: string; children: React.ReactNode }) {
  return (
    <NavLink to={to} end={to === '/'} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
      <Icon name={icon} />{children}
    </NavLink>
  );
}

function TabBar() {
  const { isAdmin, isSuper, company } = useAuth();
  const loc = useLocation();
  if (isSuper && !company) return (
    <nav className="tabbar"><NavLink to="/superadmin" className={({ isActive }) => isActive ? 'active' : ''}><Icon name="superadmin" />Platform</NavLink></nav>
  );
  return (
    <nav className="tabbar">
      <NavLink to="/" end className={loc.pathname === '/' ? 'active' : ''}><Icon name="live" />Live</NavLink>
      <NavLink to="/calllog" className={({ isActive }) => isActive ? 'active' : ''}><Icon name="calllog" />Log</NavLink>
      <NavLink to="/playbooks" className={({ isActive }) => isActive ? 'active' : ''}><Icon name="playbooks" />Plays</NavLink>
      {isAdmin && <NavLink to="/reporting" className={({ isActive }) => isActive ? 'active' : ''}><Icon name="reporting" />Reports</NavLink>}
      {isAdmin && <NavLink to="/settings" className={({ isActive }) => isActive ? 'active' : ''}><Icon name="settings" />Company</NavLink>}
    </nav>
  );
}

function roleLabel(role: string) {
  return { super_admin: 'Platform owner', company_admin: 'Company admin', sales_rep: 'Sales rep', customer_service_rep: 'Customer service' }[role] || role;
}
