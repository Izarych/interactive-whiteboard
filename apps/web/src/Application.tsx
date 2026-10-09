import App from './App';
import { ReleaseNotesDialog } from './ReleaseNotesControls';
import { closeReleaseNotes, releaseHistory, useReleaseNotes } from './release-notes';
import { usePwa } from './pwa';
import { useDesktop } from './desktop';

export default function Application() {
  const notes = useReleaseNotes();
  const { updating } = usePwa();
  const { closing, preparingUpdate, error } = useDesktop();
  const visible = notes.open && !updating && !closing && !preparingUpdate && !error;
  return <><App releaseNotesOpen={visible} />{visible && <ReleaseNotesDialog entries={releaseHistory()} onClose={closeReleaseNotes} />}</>;
}
