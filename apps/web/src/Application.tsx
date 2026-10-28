import App from './App';
import { ReleaseNotesDialog } from './ReleaseNotesControls';
import { closeReleaseNotes, releaseHistory, useReleaseNotes } from './release-notes';
import { usePwa } from './pwa';
import { useDesktop } from './desktop';
import { lazy, Suspense, useState } from 'react';
const SharedBoardPage = lazy(() => import('./SharedBoardPage'));

export default function Application() {
  const [unavailable, setUnavailable] = useState(() => new URLSearchParams(location.search).has('board-unavailable'));
  const notes = useReleaseNotes();
  const { updating } = usePwa();
  const { closing, preparingUpdate, error } = useDesktop();
  const visible = notes.open && !updating && !closing && !preparingUpdate && !error;
  const shared = location.pathname === '/join';
  const closeUnavailable = () => { setUnavailable(false); history.replaceState(null, '', '/'); };
  return <>{shared ? <Suspense fallback={<div className="loading-overlay">Подключаемся к доске…</div>}><SharedBoardPage blocked={visible} /></Suspense> : <App releaseNotesOpen={visible || unavailable} />}
    {unavailable && <div className="sharing-backdrop"><section className="sharing-dialog" role="dialog" aria-modal="true" aria-label="Доска больше недоступна"><h2>Доска больше недоступна</h2><p>Владелец отключил доступ или ссылка больше не действует.</p><button autoFocus className="primary-button" onClick={closeUnavailable}>Понятно</button></section></div>}
    {visible && <ReleaseNotesDialog entries={releaseHistory()} onClose={closeReleaseNotes} />}</>;
}
