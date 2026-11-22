import { useEffect, useRef, useState } from 'react';
import type { ActiveSession, SessionInfo } from '@whiteboard/shared';
import Workspace from './Workspace';
import { DesktopCloseNotice, DesktopUpdateNotice } from './DesktopControls';
import { useDesktop } from './desktop';
import { prepareToLeave } from './pwa';
import { clearImageCache } from './images';
import { activeLocalBoard, adoptDeviceBoards, localSession, records, setLocalAccount } from './offline-store';
import { cloudRequest, pauseOfflineCloud, startOfflineCloud, syncOfflineCloud, useOfflineCloud } from './offline-cloud';
import { importLocalProject } from './offline-project';
import { errorMessage } from './api';
import './offline.css';

export default function OfflineApp({ blocked }: { blocked: boolean }) {
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [bootError, setBootError] = useState('');
  const [accountOpen, setAccountOpen] = useState(false);
  const [email, setEmail] = useState(''), [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [adopt, setAdopt] = useState(false), [deviceCount, setDeviceCount] = useState(0);
  const [generation, setGeneration] = useState(0), [preferredBoard, setPreferredBoard] = useState<string>();
  const input = useRef<HTMLInputElement>(null), dialog = useRef<HTMLElement>(null);
  const cloud = useOfflineCloud(), desktop = useDesktop();
  const leaving = desktop.closing || desktop.preparingUpdate;
  const load = () => {
    setBootError('');
    void localSession().then(value => { setSession(value); startOfflineCloud(); }).catch(reason => setBootError(errorMessage(reason)));
  };
  useEffect(() => { load(); return () => { void pauseOfflineCloud(); }; }, []);
  useEffect(() => { if (accountOpen) { dialog.current?.querySelector<HTMLInputElement>('input')?.focus(); } }, [accountOpen]);
  const openAccount = async () => {
    await prepareToLeave();
    setDeviceCount((await records('device')).filter(row => !row.deleted).length);
    setError(''); setNotice(''); setAccountOpen(true);
  };
  const login = async (event: React.FormEvent) => {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await pauseOfflineCloud();
      const value = await cloudRequest<SessionInfo>('/auth/login', 'POST', { email, password });
      if (value.kind !== 'user') throw new Error('Не удалось войти в аккаунт');
      await setLocalAccount(value);
      if (adopt) await adoptDeviceBoards();
      clearImageCache(); setPassword(''); setSession(value); setAccountOpen(false); setPreferredBoard(undefined); setGeneration(n => n + 1);
    } catch (reason) {
      await setLocalAccount(session?.kind === 'user' ? session : { kind: 'anonymous', workspaceId: null, user: null }).catch(() => {});
      setError(errorMessage(reason));
    }
    finally { setBusy(false); startOfflineCloud(); }
  };
  const logout = async () => {
    setBusy(true); setError('');
    try {
      await prepareToLeave(); await pauseOfflineCloud();
      // The native bridge clears the protected credential even without a network.
      await cloudRequest('/auth/logout', 'POST').catch(() => {});
      await setLocalAccount({ kind: 'anonymous', workspaceId: null, user: null });
      clearImageCache(); setSession(await localSession()); setPreferredBoard(undefined); setGeneration(n => n + 1);
      setNotice('Вы вышли. Облачные копии остаются на этом компьютере и доступны после входа в тот же аккаунт.');
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); startOfflineCloud(); }
  };
  const refresh = async () => {
    await prepareToLeave();
    setPreferredBoard(activeLocalBoard() ?? undefined);
    clearImageCache(); setGeneration(n => n + 1);
  };
  const controls = <section className="offline-cloud-panel" aria-label="Локальные доски и синхронизация">
    {window.__BLUVIBOARD_PREVIEW__ && <p>Offline Preview · отдельное хранилище тестовой версии</p>}
    <strong>Доски на этом компьютере</strong>
    <p>Работают без интернета. Изображения и изменения сохраняются локально.</p>
    {session?.kind === 'user' ? <>
      <span>{session.user.name} · {session.user.email}</span>
      <p role="status">{cloud.syncing ? 'Синхронизация с аккаунтом…' : cloud.error ? 'Облако недоступно · работа продолжается локально' : cloud.incoming ? 'Есть изменения с сайта' : cloud.pending ? `Ожидают синхронизации: ${cloud.pending}` : cloud.lastSync ? 'Копии синхронизированы с аккаунтом' : 'Ожидание синхронизации'}</p>
      <button disabled={busy || cloud.syncing} onClick={() => { void syncOfflineCloud(); }}>Синхронизировать сейчас</button>
      <button disabled={busy} onClick={() => { void logout(); }}>Выйти из аккаунта</button>
      {cloud.incoming > 0 && <button disabled={busy} onClick={() => { void refresh().catch(reason => setError(errorMessage(reason))); }}>Открыть изменения с сайта</button>}
    </> : <button disabled={busy} onClick={() => { void openAccount().catch(reason => setError(errorMessage(reason))); }}>Войти для синхронизации</button>}
    <button disabled={busy} onClick={() => input.current?.click()}>Открыть файл доски</button>
    <a href="https://bluviboard.ru/" target="_blank" rel="noopener noreferrer">Онлайн-доски и общий доступ ↗</a>
    {cloud.conflicts > 0 && <p role="status">Есть конфликт: обе версии сохранены отдельными досками. Оффлайн-копия помечена в списке.</p>}
    {cloud.warning && <p>{cloud.warning}</p>}
    {session?.kind === 'user' && cloud.error && <p className="offline-error">{cloud.error}</p>}
    {error && <p role="alert" className="offline-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
  </section>;
  return <>
    <div className="pwa-app" inert={blocked || leaving || busy || accountOpen}>
      {session ? <Workspace key={`${session.workspaceId}:${generation}`} preferredBoard={preferredBoard} localControls={controls} session={session} blocked={blocked || leaving || accountOpen || busy}
        onAuth={() => { void openAccount().catch(reason => setError(errorMessage(reason))); }} onProfile={() => { void openAccount().catch(reason => setError(errorMessage(reason))); }} onSession={() => {}} onAdmin={() => {}} /> :
        <main className="auth-shell"><section className="auth-card"><h1>BluviBoard · локальные доски</h1><p>{bootError || 'Открываем локальное хранилище…'}</p>{bootError && <button onClick={load}>Повторить открытие</button>}</section></main>}
      <input ref={input} hidden type="file" accept=".bluviboard,application/json" aria-label="Открыть файл доски" onChange={event => {
        const file = event.target.files?.[0]; event.target.value = '';
        if (!file) return;
        setBusy(true); setError(''); setNotice('');
        void prepareToLeave().then(() => importLocalProject(file)).then(board => setNotice(`Импортирована доска «${board.title}»`)).catch(reason => setError(errorMessage(reason))).finally(() => setBusy(false));
      }} />
    </div>
    {accountOpen && <div className="auth-shell auth-shell--modal" onKeyDown={event => {
      if (event.key === 'Escape' && !busy) setAccountOpen(false);
      if (event.key === 'Tab') {
        const targets = [...(dialog.current?.querySelectorAll<HTMLElement>('input:not(:disabled),button:not(:disabled),a[href]') ?? [])];
        const index = targets.indexOf(document.activeElement as HTMLElement);
        if (event.shiftKey && index <= 0) { event.preventDefault(); targets.at(-1)?.focus(); }
        else if (!event.shiftKey && index === targets.length - 1) { event.preventDefault(); targets[0]?.focus(); }
      }
    }}><section ref={dialog} className="auth-card" role="dialog" aria-modal="true" aria-label="Синхронизация с аккаунтом">
      <button className="modal-close" disabled={busy} aria-label="Закрыть вход" onClick={() => setAccountOpen(false)}>×</button>
      <h2>Синхронизация с аккаунтом</h2><p>Доски доступны оффлайн. Для входа и обмена с сайтом нужно подключение.</p>
      <form onSubmit={event => { void login(event); }}>
        <label className="form-label">Email<input type="email" required autoComplete="username" disabled={busy} value={email} onChange={event => setEmail(event.target.value)} /></label>
        <label className="form-label">Пароль<input type="password" required autoComplete="current-password" disabled={busy} value={password} onChange={event => setPassword(event.target.value)} /></label>
        {deviceCount > 0 && <label className="offline-adopt"><input type="checkbox" checked={adopt} disabled={busy} onChange={event => setAdopt(event.target.checked)} />Добавить в аккаунт локальные доски: {deviceCount}</label>}
        {error && <p role="alert" className="offline-error">{error}</p>}
        <button type="submit" className="primary-button" disabled={busy}>{busy ? 'Входим…' : 'Войти и синхронизировать'}</button>
      </form>
      <p><a href="https://bluviboard.ru/#start" target="_blank" rel="noopener noreferrer">Создать аккаунт или восстановить пароль на сайте</a></p>
    </section></div>}
    <div className="application-notices"><DesktopCloseNotice /><DesktopUpdateNotice /></div>
  </>;
}
