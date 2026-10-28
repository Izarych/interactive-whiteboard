import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Share2, X } from 'lucide-react';
import type { SharingState } from '@whiteboard/shared';
import { errorMessage, request } from './api';

export function SharingControls({ id, flush, onEnabled, initiallyOpen = false }: { id: string; flush: () => Promise<void>; onEnabled: () => void; initiallyOpen?: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [state, setState] = useState<SharingState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const dialog = useRef<HTMLElement>(null);
  const load = async () => {
    setBusy(true); setError('');
    try { setState(await request<SharingState>(`/collaboration/${id}/sharing`)); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };
  useEffect(() => { if (open) void load(); }, [open, id]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    dialog.current?.focus();
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [open]);
  const toggle = async (enabled: boolean) => {
    setBusy(true); setError('');
    try {
      await flush();
      const next = await request<SharingState>(`/collaboration/${id}/sharing`, { method: 'PUT', body: JSON.stringify({ enabled }) });
      setState(next); setCopied(false);
      if (enabled) onEnabled();
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };
  const link = state?.token ? `${location.origin}/join#${state.token}` : '';
  return <>
    <button className="editor-icon-button sharing-button" aria-label="Поделиться доской" title="Поделиться доской" onClick={() => setOpen(true)}><Share2 size={18} /></button>
    {open && createPortal(<div className="sharing-backdrop" onPointerDown={event => event.stopPropagation()} onKeyDown={event => {
      event.stopPropagation();
      if (event.key === 'Escape' && !busy) setOpen(false);
      if (event.key === 'Tab') {
        const targets = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href]') ?? [])];
        if (!targets.length) { event.preventDefault(); return; }
        const current = targets.indexOf(document.activeElement as HTMLElement);
        if (event.shiftKey && current <= 0) { event.preventDefault(); targets.at(-1)?.focus(); }
        else if (!event.shiftKey && (current < 0 || current === targets.length - 1)) { event.preventDefault(); targets[0].focus(); }
      }
    }}>
      <section ref={dialog} tabIndex={-1} className="sharing-dialog" role="dialog" aria-modal="true" aria-label="Общий доступ к доске">
        <button className="sharing-close" aria-label="Закрыть общий доступ" disabled={busy} onClick={() => setOpen(false)}><X size={20} /></button>
        <h2>Поделиться доской</h2>
        <p>Ученик сможет открыть ссылку без регистрации и рисовать вместе с вами.</p>
        {state?.enabled ? <>
          <label>Ссылка на доску<input aria-label="Ссылка на доску" value={link} readOnly onFocus={event => event.target.select()} /></label>
          <button className="primary-button" disabled={busy} onClick={() => { void navigator.clipboard.writeText(link).then(() => setCopied(true)).catch(() => setError('Скопируйте ссылку из поля выше.')); }}>{copied ? 'Ссылка скопирована' : 'Скопировать ссылку'}</button>
          <button className="sharing-disable" disabled={busy} onClick={() => { void toggle(false); }}>Отключить общий доступ</button>
          <small>Отключение закроет доску для участников. При следующем включении ссылка будет новой.</small>
        </> : state ? <button className="primary-button" disabled={busy} onClick={() => { void toggle(true); }}>Включить общий доступ</button> : <button disabled={busy} onClick={() => { void load(); }}>{busy ? 'Загрузка…' : 'Повторить загрузку'}</button>}
        {error && <p className="error-message" role="alert">{error}</p>}
      </section>
    </div>, document.body)}
  </>;
}
