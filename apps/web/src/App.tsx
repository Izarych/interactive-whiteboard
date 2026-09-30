import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { SessionInfo, UserProfile } from '@whiteboard/shared';
import { api, errorMessage } from './api';
import { AuthPanel, pendingRegistration } from './AuthPanel';
import type { AuthMode } from './AuthPanel';
import { ProfilePanel } from './ProfilePanel';
import { clearImageCache } from './images';
import Workspace from './Workspace';
import { usePageMetadata } from './seo';
import { usePwa } from './pwa';
import { PwaUpdateNotice } from './PwaControls';
import { useDesktop } from './desktop';
import { DesktopCloseNotice } from './DesktopControls';
const AdminPanel = lazy(() => import('./AdminPanel'));

function App() {
  const { updating } = usePwa();
  const { closing } = useDesktop();
  const leaving = updating || closing;
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [bootError, setBootError] = useState('');
  const [auth, setAuth] = useState<{ mode: AuthMode; email?: string } | null>(null);
  const [profile, setProfile] = useState(false);
  const [admin, setAdmin] = useState(window.location.pathname.startsWith('/admin'));
  const channel = useRef<BroadcastChannel | null>(null);
  const bootRequest = useRef(0);
  usePageMetadata(admin || (!!session && session.kind !== 'anonymous'), admin);

  const load = useCallback(async () => {
    const sequence = ++bootRequest.current;
    setBootError('');
    try {
      const current = await api.session();
      if (sequence !== bootRequest.current) return;
      setSession(current);
      if (!window.location.pathname.startsWith('/admin') && current.kind === 'guest' && pendingRegistration(current.workspaceId)) setAuth({ mode: 'register' });
    } catch (reason) { if (sequence === bootRequest.current) setBootError(errorMessage(reason)); }
  }, []);
  useEffect(() => { void load(); return () => { bootRequest.current += 1; }; }, [load]);
  useEffect(() => { const pop = () => setAdmin(window.location.pathname.startsWith('/admin')); window.addEventListener('popstate', pop); return () => window.removeEventListener('popstate', pop); }, []);
  const navigate = (show: boolean) => {
    if (show) { window.location.assign('/admin'); return; }
    setAdmin(false); window.history.pushState(null, '', '/');
  };

  useEffect(() => {
    const refresh = () => {
      void api.session().then((current) => {
        clearImageCache(); setSession(current); setProfile(false); setAuth(null);
      }).catch((reason) => setBootError(errorMessage(reason)));
    };
    if ('BroadcastChannel' in window) {
      channel.current = new BroadcastChannel('bluviboard:auth');
      channel.current.onmessage = refresh;
    }
    window.addEventListener('whiteboard:session-expired', refresh);
    return () => { channel.current?.close(); window.removeEventListener('whiteboard:session-expired', refresh); };
  }, []);

  const changeSession = (next: SessionInfo) => {
    bootRequest.current += 1;
    clearImageCache(); setSession(next); setAuth(null); setProfile(false);
    channel.current?.postMessage('changed');
  };
  const saveProfile = (user: UserProfile) => {
    if (session?.kind === 'user') changeSession({ ...session, user });
  };

  if (!session) return <main className="auth-shell"><section className="auth-card auth-loading">
    <img src="/favicon.svg" width="64" height="64" alt="BluviBoard" />
    <p>{bootError || 'Открываем ваше пространство…'}</p>
    {bootError && <button className="primary-button" onClick={() => { void load(); }}>Попробовать снова</button>}
  </section></main>;

  const active = session.kind !== 'anonymous';
  const needsAdminLogin = admin && (session.kind !== 'user' || session.user.role !== 'admin');
  return <><div className="pwa-app" inert={leaving}>
    {active && !needsAdminLogin && (admin ? session.kind === 'user' && session.user.role === 'admin' ? <Suspense fallback={<div className="loading-overlay">Открываем панель управления…</div>}>
      <AdminPanel user={session.user} blocked={profile || !!auth || leaving} onBack={() => navigate(false)} onProfile={() => setProfile(true)}
        onLogout={async () => { await api.logout(); changeSession(await api.session()); }} /></Suspense>
      : <div className="auth-shell"><section className="auth-card"><h1>Недостаточно прав</h1><p className="auth-subtitle">Панель управления доступна только администратору.</p><button className="primary-button" onClick={() => navigate(false)}>Вернуться к доскам</button></section></div>
      : <Workspace key={`${session.workspaceId}:${session.kind}`} session={session} blocked={!!auth || profile || leaving}
        onAuth={(mode) => setAuth({ mode })} onProfile={() => setProfile(true)} onSession={changeSession} onAdmin={() => navigate(true)} />)}
    {(!active || auth || needsAdminLogin) && <AuthPanel key={admin ? 'admin-auth' : 'public-auth'} adminOnly={admin} session={session} initialMode={auth?.mode ?? 'login'} initialEmail={auth?.email}
      onDone={changeSession} onClose={active && !needsAdminLogin ? () => setAuth(null) : undefined}
      onResetSession={() => {
        void api.session().then((next) => {
          clearImageCache(); setSession(next); channel.current?.postMessage('changed');
        }).catch((reason) => setBootError(errorMessage(reason)));
      }} />}
    {profile && session.kind === 'user' && <ProfilePanel user={session.user} onSaved={saveProfile} onClose={() => setProfile(false)}
      onResetPassword={() => { setProfile(false); setAuth({ mode: 'forgot', email: session.user.email }); }}
      onLogout={async () => { await api.logout(); changeSession(await api.session()); }} />}
  </div>{!closing && <PwaUpdateNotice />}<DesktopCloseNotice /></>;
}

export default App;
