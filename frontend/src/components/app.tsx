import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type MutableRefObject, type ReactNode } from 'react';
import { BrowserRouter, Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { createApi, type ApiError } from '../api';
import type { AdminApi, Crumb, Session } from '../types';
import { Icon, type IconName } from '../icons';
import { Modal, ConfirmProvider, FormError, EmptyState, explainError, ToastProvider, useConfirm, useToast } from './ui';

type AdminContextValue = {
  api: AdminApi;
  session: Session;
  setDirty: (checker: () => boolean) => void;
  guardedNavigate: (to: string, options?: { replace?: boolean; force?: boolean }) => Promise<boolean>;
  setCrumbs: (crumbs: Crumb[]) => void;
  refreshPendingBadge: () => Promise<void>;
};

const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin() {
  const value = useContext(AdminContext);
  if (!value) throw new Error('useAdmin must be used inside AdminContext');
  return value;
}

export function App({ children }: { children?: ReactNode }) {
  const [api] = useState(() => createApi({ onExpired: () => setExpired(true) }));
  const [session, setSession] = useState<Session | null>(null);
  const [expired, setExpired] = useState(false);
  const [booting, setBooting] = useState(true);
  const [bootError, setBootError] = useState<unknown>();
  const dirtyRef = useRef<() => boolean>(() => false);

  const loadSession = useCallback(async () => {
    setBooting(true);
    setBootError(undefined);
    try {
      const current = await api.session();
      setSession(current);
    } catch (error) {
      if ((error as ApiError).code !== 'ADMIN_AUTH_REQUIRED') setBootError(error);
      else setExpired(false);
      setSession(null);
    } finally {
      setBooting(false);
    }
  }, [api]);

  useEffect(() => { void loadSession(); }, [loadSession]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current()) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, []);

  return <BrowserRouter basename="/admin"><ToastProvider><ConfirmProvider>{booting ? <main className="boot" aria-live="polite"><span className="brand-word">MailQuota<span>.</span></span><p>正在连接管理服务…</p></main> : bootError ? <main className="boot"><EmptyState message={explainError(bootError)} action={<button className="button primary" onClick={() => void loadSession()}><Icon name="refresh-cw" />重新连接</button>} /></main> : session ? <AdminLayout api={api} session={session} setSession={setSession} expired={expired} setExpired={setExpired} dirtyRef={dirtyRef}>{children}</AdminLayout> : <LoginPage api={api} onLoggedIn={setSession} />}</ConfirmProvider></ToastProvider></BrowserRouter>;
}

function LoginPage({ api, onLoggedIn }: { api: AdminApi; onLoggedIn: (session: Session) => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const showToast = useToast();
  const returnTo = useMemo(() => {
    const requested = new URLSearchParams(location.search).get('next');
    const current = `${location.pathname}${location.search}${location.hash}`;
    const candidate = requested || (location.pathname === '/login' ? '' : current);
    return candidate.startsWith('/') && !candidate.startsWith('//') && !candidate.startsWith('/login') && candidate !== '/' ? candidate : '/overview';
  }, [location.hash, location.pathname, location.search]);
  return <LoginForm initialUsername="" onSubmit={async (username, password) => {
    const logged = await api.login(username, password);
    onLoggedIn(logged);
    showToast('登录成功。');
    navigate(returnTo, { replace: true });
  }} />;
}

function LoginForm({ initialUsername, onSubmit, compact = false }: { initialUsername: string; onSubmit: (username: string, password: string) => Promise<void>; compact?: boolean }) {
  const [username, setUsername] = useState(initialUsername);
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(undefined);
    setBusy(true);
    try { await onSubmit(username, password); setPassword(''); }
    catch (submitError) { setError(submitError); }
    finally { setBusy(false); }
  };
  const form = <form className="login-form" onSubmit={submit}>
    <FormError error={error} />
    <label className="field"><span className="field-label">管理员账号</span><input value={username} onChange={event => setUsername(event.target.value)} required maxLength={200} autoComplete="username" placeholder="输入管理员账号" /></label>
    <label className="field"><span className="field-label">登录密码</span><span className="password-field"><input type={showPassword ? 'text' : 'password'} value={password} onChange={event => setPassword(event.target.value)} required maxLength={200} autoComplete="current-password" placeholder="输入登录密码" /><button type="button" className="button quiet icon-button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? '隐藏密码' : '显示密码'} title={showPassword ? '隐藏密码' : '显示密码'} aria-pressed={showPassword}><Icon name={showPassword ? 'eye-off' : 'eye'} /></button></span></label>
    <button className="button primary full-width" type="submit" disabled={busy}>{busy ? '正在登录…' : '登录'}</button>
  </form>;
  if (compact) return form;
  return <div className="login-shell"><aside className="login-story"><span className="brand-word">MailQuota<span>.</span></span><div className="login-copy"><h1>每一封邮件，<br /><span>都心中有数。</span></h1></div><p className="login-caption">邮件验证码与额度服务</p></aside><main className="login-main" id="main"><div className="login-box"><div className="login-mobile-brand"><span className="brand-word">MailQuota<span>.</span></span></div><h2>管理员登录</h2>{form}<p className="login-help">忘记密码？请在服务器上重设。</p></div></main></div>;
}

function AdminLayout({ api, session, setSession, expired, setExpired, dirtyRef, children }: { api: AdminApi; session: Session; setSession: (session: Session | null) => void; expired: boolean; setExpired: (value: boolean) => void; dirtyRef: MutableRefObject<() => boolean>; children?: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const confirm = useConfirm();
  const showToast = useToast();
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ label: '客户管理' }]);
  const [pending, setPending] = useState(0);
  const [navOpen, setNavOpen] = useState(false);

  const guardedNavigate = useCallback(async (to: string, options: { replace?: boolean; force?: boolean } = {}) => {
    if (!options.force && dirtyRef.current() && !await confirm('离开并放弃未保存的修改？', '当前输入尚未保存，离开后将丢失。', '放弃修改')) return false;
    navigate(to, { replace: options.replace });
    return true;
  }, [confirm, dirtyRef, navigate]);

  const setDirty = useCallback((checker: () => boolean) => { dirtyRef.current = checker; }, [dirtyRef]);
  const refreshPendingBadge = useCallback(async () => {
    try { const data = await api.requests({ status: 'unknown', page: 1, page_size: 1 }); setPending(data.total); } catch { /* 角标失败不影响页面 */ }
  }, [api]);

  useEffect(() => { void refreshPendingBadge(); }, [refreshPendingBadge, location.pathname, location.search]);
  useEffect(() => {
    document.title = `${crumbs.map(crumb => crumb.label).join(' / ')} · MailQuota`;
  }, [crumbs]);
  useEffect(() => {
    if (location.pathname.startsWith('/overview')) setCrumbs([{ label: '工作台' }]);
    else if (!location.pathname.startsWith('/customers')) setCrumbs(location.pathname.startsWith('/records') ? [{ label: '发送记录' }] : [{ label: '页面不存在' }]);
    setNavOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => document.getElementById('main')?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname]);
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setNavOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  const value = useMemo<AdminContextValue>(() => ({ api, session, setDirty, guardedNavigate, setCrumbs, refreshPendingBadge }), [api, session, setDirty, guardedNavigate, refreshPendingBadge]);
  const logout = async () => {
    if (dirtyRef.current() && !await confirm('放弃修改并退出？', '当前未保存的内容将丢失。', '退出登录')) return;
    try { await api.logout(); dirtyRef.current = () => false; setSession(null); setExpired(false); navigate('/login', { replace: true }); showToast('已退出登录。'); }
    catch (error) { showToast(explainError(error), 'error'); }
  };
  const closeMenu = () => setNavOpen(false);
  const activeNavigation = location.pathname.startsWith('/overview') ? 'overview' : location.pathname.startsWith('/records') ? 'records' : 'customers';

  return <AdminContext.Provider value={value}><div className={`app-shell${navOpen ? ' nav-open' : ''}`}><button className="nav-overlay" aria-label="收起导航" onClick={closeMenu} /><aside className="sidebar"><GuardedLink className="brand" to="/overview"><span className="brand-word">MailQuota<span>.</span></span></GuardedLink><nav className="nav" aria-label="主导航"><GuardedNavLink to="/overview" active={activeNavigation === 'overview'} onClick={closeMenu}><Icon name="monitor" /><span>工作台</span></GuardedNavLink><GuardedNavLink to="/customers" active={activeNavigation === 'customers'} onClick={closeMenu}><Icon name="users" /><span>客户管理</span></GuardedNavLink><GuardedNavLink to="/records" active={activeNavigation === 'records'} onClick={closeMenu}><Icon name="send" /><span>发送记录</span>{pending > 0 ? <b className="nav-count">{pending > 99 ? '99+' : pending}</b> : null}</GuardedNavLink></nav><div className="sidebar-foot"><span className="avatar" aria-hidden="true">{[...session.username][0]?.toUpperCase() || 'A'}</span><span className="account-name">{session.username}</span><button className="button quiet icon-button" onClick={() => void logout()} aria-label="退出登录" title="退出登录"><Icon name="log-out" /></button></div></aside><header className="topbar"><div className="breadcrumb"><button className="button quiet icon-button mobile-menu" onClick={() => setNavOpen(value => !value)} aria-label={navOpen ? '收起导航' : '展开导航'} aria-expanded={navOpen}><Icon name="menu" /></button><div className="breadcrumb-path">{crumbs.slice(0, -1).map((crumb, index) => <span key={`${crumb.label}-${index}`}>{crumb.to ? <GuardedLink to={crumb.to}>{crumb.label}</GuardedLink> : <span>{crumb.label}</span>}<span className="crumb-sep" aria-hidden="true">/</span></span>)}<h1 id="page-title" tabIndex={-1}>{crumbs[crumbs.length - 1]?.label || '工作台'}</h1></div></div><div className="topbar-tools">{pending > 0 ? <GuardedLink className="pending-link" to="/records?status=unknown"><Icon name="triangle-alert" />待确认 <b>{pending > 99 ? '99+' : pending}</b></GuardedLink> : null}</div></header><main id="main" className="content" tabIndex={-1}>{children}</main></div>{expired ? <Modal title="登录已过期" subtitle="重新登录后可继续操作，页面中未保存的输入会保留。之前的写入不会自动重试。" secret onClose={() => setExpired(false)}><LoginForm initialUsername={session.username} compact onSubmit={async (username, password) => { const logged = await api.login(username, password); setSession(logged); setExpired(false); showToast('已重新登录，请确认数据后继续操作。'); }} /></Modal> : null}</AdminContext.Provider>;
}

export function GuardedLink({ to, children, className, 'aria-current': ariaCurrent }: { to: string; children: ReactNode; className?: string; 'aria-current'?: 'page' | undefined }) {
  const { guardedNavigate } = useAdmin();
  return <Link className={className} to={to} aria-current={ariaCurrent} onClick={event => { if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); void guardedNavigate(to); }}>{children}</Link>;
}

function GuardedNavLink({ to, children, active, onClick }: { to: string; children: ReactNode; active: boolean; onClick: () => void }) {
  const { guardedNavigate } = useAdmin();
  return <NavLink to={to} className={active ? 'active' : undefined} aria-current={active ? 'page' : undefined} onClick={event => { onClick(); if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); void guardedNavigate(to); }}>{children}</NavLink>;
}

export function AppProviders() {
  return <App />;
}
