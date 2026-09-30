import { useEffect, useState } from 'react';
import type { UserProfile } from '@whiteboard/shared';
import { api, errorMessage } from './api';
import { AvatarPicker } from './AvatarPicker';

export function ProfilePanel({ user, onSaved, onClose, onResetPassword, onLogout }: {
  user: UserProfile; onSaved: (user: UserProfile) => void; onClose: () => void; onResetPassword: () => void; onLogout: () => Promise<void>;
}) {
  const [name, setName] = useState(user.name);
  const [avatar, setAvatar] = useState<File | null>(null);
  const [removed, setRemoved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose, busy]);
  const run = async (operation: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await operation(); } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };
  return <div className="auth-shell auth-shell--modal">
    <section className="auth-card profile-card" role="dialog" aria-modal="true" aria-label="Профиль">
      <button type="button" className="modal-close" aria-label="Закрыть профиль" disabled={busy} onClick={onClose}>×</button>
      <h1>Ваш профиль</h1><p className="auth-subtitle">Как вас будут видеть в BluviBoard.</p>
      {error && <div className="form-error" role="alert">{error}</div>}
      <form onSubmit={(event) => { event.preventDefault(); void run(async () => {
        const asset = avatar ? await api.uploadAvatar(avatar) : null;
        onSaved(await api.updateProfile(name, asset?.id ?? (removed ? null : undefined)));
      }); }}>
        <fieldset disabled={busy}>
          <AvatarPicker name={name} file={avatar} imageUrl={removed ? null : user.avatarUrl}
            onChange={(file) => { setAvatar(file); setRemoved(false); }} onRemove={() => { setAvatar(null); setRemoved(true); }} onError={setError} />
          <label className="form-label">Имя<input autoComplete="name" maxLength={80} required value={name} onChange={(event) => setName(event.target.value)} /></label>
          <div className="profile-email"><span>Почта</span><strong>{user.email}</strong><small>✓ Подтверждена</small></div>
          <button className="primary-button form-submit" type="submit">{busy ? 'Сохранение…' : 'Сохранить профиль'}</button>
          <button className="auth-link" type="button" onClick={onResetPassword}>Сбросить пароль</button>
          <button className="auth-link logout-link" type="button" onClick={() => { void run(onLogout); }}>Выйти из аккаунта</button>
        </fieldset>
      </form>
    </section>
  </div>;
}
