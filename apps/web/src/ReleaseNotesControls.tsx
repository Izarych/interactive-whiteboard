import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Sparkles, X } from 'lucide-react';
import { appVersion, openReleaseNotes } from './release-notes';
import type { ReleaseNotes } from './release-notes';

export function ReleaseNotesButton() {
  return <button className="release-notes-button" aria-label="Что нового" onClick={openReleaseNotes}><Sparkles size={15} />Что нового <span>{appVersion}</span></button>;
}
function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => part.startsWith('**') ? <strong key={i}>{part.slice(2, -2)}</strong> : part.startsWith('`') ? <code key={i}>{part.slice(1, -1)}</code> : part);
}
function NotesBody({ notes }: { notes: string }) {
  const blocks: ReactNode[] = [];
  let bullets: string[] = [], paragraph: string[] = [];
  const flush = () => {
    if (bullets.length) { blocks.push(<ul key={blocks.length}>{bullets.map((item, i) => <li key={i}>{inline(item)}</li>)}</ul>); bullets = []; }
    if (paragraph.length) { blocks.push(<p key={blocks.length}>{inline(paragraph.join(' '))}</p>); paragraph = []; }
  };
  for (const line of notes.split('\n')) {
    if (line.startsWith('## ')) { flush(); blocks.push(<h4 key={blocks.length}>{line.slice(3)}</h4>); }
    else if (line.startsWith('- ')) { if (paragraph.length) flush(); bullets.push(line.slice(2)); }
    else if (!line.trim()) flush();
    else { if (bullets.length) flush(); paragraph.push(line); }
  }
  flush();
  return <>{blocks}</>;
}
export function ReleaseNotesDialog({ entries, onClose }: { entries: ReleaseNotes[]; onClose: () => void }) {
  const dialog = useRef<HTMLElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    close.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); onClose(); return; }
      if (event.key !== 'Tab') return;
      const buttons = dialog.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]');
      if (!buttons?.length) return;
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', keyboard, true);
    return () => { window.removeEventListener('keydown', keyboard, true); if (previous?.isConnected && !previous.closest('[inert]')) previous.focus(); };
  }, [onClose]);
  return <div className="auth-shell auth-shell--modal release-notes-overlay">
    <section ref={dialog} className="auth-card release-notes-dialog" role="dialog" aria-modal="true" aria-labelledby="release-notes-title">
      <button ref={close} className="modal-close" aria-label="Закрыть описание обновления" onClick={onClose}><X size={20} /></button>
      <header className="release-notes-header"><Sparkles size={22} /><div><h2 id="release-notes-title">Что нового</h2></div></header>
      <div className="release-notes-content" tabIndex={0} role="region" aria-label="История изменений">{entries.map((entry) => <article key={`${entry.kind}:${entry.version}`}>
        <h3>{entry.title}</h3><NotesBody notes={entry.notes} />
      </article>)}</div>
      <footer className="release-notes-footer"><button className="primary-button" onClick={onClose}>Понятно</button></footer>
    </section>
  </div>;
}
