import { useEffect, useState } from 'react';
import type { ActiveSession, EmailChallenge, SessionInfo } from '@whiteboard/shared';
import { api, errorMessage } from './api';
import { AvatarPicker } from './AvatarPicker';

export type AuthMode = 'login' | 'register' | 'verify' | 'forgot' | 'reset';
interface PendingRegistration extends EmailChallenge { workspaceId: string; retryAt: number }
const pendingKey = 'bluviboard:registration';

export function pendingRegistration(workspaceId: string | null): PendingRegistration | null {
  try {
    const pending = JSON.parse(localStorage.getItem(pendingKey) ?? 'null') as PendingRegistration | null;
    return pending && pending.workspaceId === workspaceId && Date.parse(pending.expiresAt) > Date.now() ? pending : null;
  } catch { return null; }
}
const clearPending = () => { try { localStorage.removeItem(pendingKey); } catch { /* Browser storage may be unavailable. */ } };

export function AuthPanel({ session, initialMode = 'login', initialEmail = '', onDone, onResetSession, onClose, adminOnly = false }: {
  session: SessionInfo; initialMode?: AuthMode; initialEmail?: string;
  onDone: (session: ActiveSession) => void; onResetSession: () => void; onClose?: () => void;
  adminOnly?: boolean;
}) {
  const [pending] = useState(() => adminOnly ? null : pendingRegistration(session.workspaceId));
  const [mode, setMode] = useState<AuthMode>(adminOnly && ['register', 'verify'].includes(initialMode) ? 'login' : pending && ['register', 'verify'].includes(initialMode) ? 'verify' : initialMode);
  const [email, setEmail] = useState(pending?.email ?? initialEmail);
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [avatar, setAvatar] = useState<File | null>(null);
  const [challenge, setChallenge] = useState<EmailChallenge | null>(pending);
  const [retryAt, setRetryAt] = useState(pending?.retryAt ?? 0);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const retrySeconds = Math.max(0, Math.ceil((retryAt - now) / 1000));

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!onClose) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose, busy]);

  const switchMode = (next: AuthMode) => {
    if (adminOnly && ['register', 'verify'].includes(next)) return;
    setMode(next); setError(''); setNotice(''); setPassword(''); setConfirmPassword(''); setCode('');
  };
  const work = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError('');
    try { await operation(); } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };
  const remember = (next: EmailChallenge, workspaceId?: string) => {
    setChallenge(next); setEmail(next.email); setCode('');
    const time = Date.now() + next.retryAfterSeconds * 1000;
    setRetryAt(time); setNow(Date.now());
    if (workspaceId) {
      try { localStorage.setItem(pendingKey, JSON.stringify({ ...next, workspaceId, retryAt: time })); } catch { /* The active form still holds the challenge. */ }
    }
  };
  const submit = () => work(async () => {
    if (mode === 'login') {
      const next = adminOnly ? await api.adminLogin(email, password) : await api.login(email, password);
      clearPending(); onDone(next);
    } else if (mode === 'register') {
      const guest = await api.guest();
      if (guest.kind !== 'guest') throw new Error('Выйдите из текущего аккаунта перед регистрацией.');
      const asset = avatar ? await api.uploadAvatar(avatar) : null;
      const next = await api.register({ email, password, name, avatarAssetId: asset?.id });
      remember(next, guest.workspaceId); setPassword(''); setMode('verify');
      setNotice('Мы отправили код подтверждения на вашу почту.');
    } else if (mode === 'verify' && challenge) {
      const next = await api.verifyEmail(challenge.challengeId, code);
      clearPending(); onDone(next);
    } else if (mode === 'forgot') {
      remember(await api.forgotPassword(email)); setMode('reset');
      setNotice('Если аккаунт с этой почтой существует, мы отправили код восстановления.');
    } else if (mode === 'reset' && challenge) {
      if (password !== confirmPassword) throw new Error('Пароли не совпадают');
      await api.resetPassword(challenge.challengeId, code, password);
      setPassword(''); setConfirmPassword(''); setCode(''); setMode('login');
      setNotice('Пароль изменён. Войдите с новым паролем.');
      onResetSession();
    }
  });
  const resend = () => work(async () => {
    if (!challenge || retrySeconds) return;
    if (mode === 'verify') {
      const next = await api.resendVerification(challenge.challengeId);
      const owner = await api.session();
      remember(next, owner.workspaceId ?? undefined);
    } else remember(await api.forgotPassword(email));
    setNotice('Новый код отправлен. Используйте последнее письмо.');
  });
  const titles: Record<AuthMode, string> = { login: 'С возвращением', register: 'Создайте своё пространство', verify: 'Подтвердите почту', forgot: 'Забыли пароль?', reset: 'Новый пароль' };
  const subtitles: Record<AuthMode, string> = {
    login: 'Войдите, чтобы ваши доски всегда были под рукой.', register: 'Ваши идеи, рисунки и доски в одном аккаунте.',
    verify: `Введите код из 6 цифр, отправленный на ${email}.`, forgot: 'Укажите почту аккаунта — отправим код для восстановления.',
    reset: `Введите код из письма на ${email} и придумайте новый пароль.`,
  };

  return <div className={`auth-shell ${onClose ? 'auth-shell--modal' : ''}`}>
    <section className="auth-card" role={onClose ? 'dialog' : undefined} aria-modal={onClose ? true : undefined} aria-label="Вход и регистрация">
      {onClose && <button className="modal-close" type="button" aria-label="Вернуться к доске" disabled={busy} onClick={onClose}>×</button>}
      <div className="auth-brand"><img src="/favicon.svg" alt="" /><span>Bluvi<span>Board</span></span></div>
      {!adminOnly && ['login', 'register'].includes(mode) && <div className="auth-tabs">
        <button className={mode === 'login' ? 'active' : ''} disabled={busy} onClick={() => switchMode('login')}>Вход</button>
        <button className={mode === 'register' ? 'active' : ''} disabled={busy} onClick={() => switchMode('register')}>Регистрация</button>
      </div>}
      <h1>{adminOnly && mode === 'login' ? 'Вход в админ-панель' : titles[mode]}</h1><p className="auth-subtitle">{adminOnly && mode === 'login' ? 'Введите данные административного аккаунта BluviBoard.' : subtitles[mode]}</p>
      {error && <div className="form-error" role="alert">{error}</div>}
      {notice && <div className="form-notice" role="status">{notice}</div>}
      <form onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <fieldset disabled={busy}>
          {mode === 'register' && <>
            <label className="form-label">Имя<input name="name" autoComplete="name" maxLength={80} autoFocus required value={name} onChange={(event) => setName(event.target.value)} /></label>
            <AvatarPicker name={name} file={avatar} onChange={setAvatar} onRemove={() => setAvatar(null)} onError={setError} />
          </>}
          {['login', 'register', 'forgot'].includes(mode) && <label className="form-label">Почта<input name="email" type="email" autoComplete="email" autoFocus={mode !== 'register'} maxLength={254} required value={email} onChange={(event) => setEmail(event.target.value)} /></label>}
          {['verify', 'reset'].includes(mode) && <label className="form-label">Код из письма<input className="code-input" name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus pattern="[0-9]{6}" minLength={6} maxLength={6} required value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} /></label>}
          {['login', 'register', 'reset'].includes(mode) && <label className="form-label">{mode === 'reset' ? 'Новый пароль' : 'Пароль'}
            <input name="password" type="password" aria-label={mode === 'reset' ? 'Новый пароль' : 'Пароль'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'login' ? 1 : 8} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} />
            {mode !== 'login' && <small>Не менее 8 символов</small>}
          </label>}
          {mode === 'reset' && <label className="form-label">Повторите пароль<input type="password" autoComplete="new-password" minLength={8} maxLength={128} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} /></label>}
          {mode === 'login' && <button type="button" className="auth-link forgot-link" onClick={() => switchMode('forgot')}>Забыли пароль?</button>}
          <button className="primary-button form-submit" type="submit">{busy ? 'Подождите…' : mode === 'login' ? 'Войти' : mode === 'register' ? 'Создать аккаунт' : mode === 'verify' ? 'Подтвердить почту' : mode === 'forgot' ? 'Отправить код' : 'Сохранить новый пароль'}</button>
        </fieldset>
      </form>
      {['verify', 'reset'].includes(mode) && <button className="auth-link resend-button" disabled={busy || retrySeconds > 0} onClick={() => { void resend(); }}>Отправить код ещё раз{retrySeconds ? ` (${retrySeconds} с)` : ''}</button>}
      {['forgot', 'reset', 'verify'].includes(mode) && <button className="auth-link" disabled={busy} onClick={() => switchMode(mode === 'verify' ? 'register' : 'login')}>{mode === 'verify' ? 'Изменить данные регистрации' : 'Вернуться ко входу'}</button>}
      {!adminOnly && session.kind === 'guest' && <p className="guest-transfer-note">Ваши гостевые доски сохранятся в аккаунте после входа или регистрации.</p>}
      {!adminOnly && session.kind !== 'user' && <>
        <div className="auth-divider"><span>или</span></div>
        <button className="guest-button" disabled={busy} onClick={() => { void work(async () => onDone(await api.guest())); }}>Продолжить как гость</button>
      </>}
      {adminOnly && <a className="auth-link" href="/">Вернуться на сайт</a>}
    </section>
  </div>;
}
