import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BoardEditor } from './BoardEditor';
import type { EditorHandle } from './BoardEditor';
import { Collaboration, boardUnavailable } from './collaboration';
import { setSharedImageAccess } from './images';
import { registerUpdateGuard } from './pwa';
import { api, errorMessage } from './api';
import type { ToolShortcuts } from '@whiteboard/shared';

const noop = () => {};
export default function SharedBoardPage({ blocked }: { blocked: boolean }) {
  const [connection] = useState(() => new Collaboration(location.hash.slice(1) || 'invalid'));
  const state = useSyncExternalStore(connection.subscribe, connection.getState);
  const [ready, setReady] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [shortcuts, setShortcuts] = useState<ToolShortcuts>({});
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [preferencesError, setPreferencesError] = useState('');
  const [panelSaving, setPanelSaving] = useState(false);
  const [panelError, setPanelError] = useState('');
  const signedIn = useRef(false);
  const editor = useRef<EditorHandle | null>(null);
  useEffect(() => connection.start(), [connection]);
  const loadPreferences = async () => {
    setPreferencesReady(false); setPreferencesError('');
    try {
      signedIn.current = (await api.session()).kind !== 'anonymous';
      if (signedIn.current) {
        const [tools, panel] = await Promise.all([api.toolShortcuts(), api.toolPanel()]);
        setShortcuts(tools.shortcuts); setPinned(panel.pinned);
      } else {
        const saved = JSON.parse(localStorage.getItem('whiteboard:participant-tools') ?? '{}');
        setShortcuts(saved.shortcuts && typeof saved.shortcuts === 'object' ? saved.shortcuts : {}); setPinned(saved.pinned === true);
      }
      setPreferencesReady(true);
    } catch (reason) { setPreferencesError(errorMessage(reason)); }
  };
  useEffect(() => { void loadPreferences(); }, []);
  const saveShortcuts = async (value: ToolShortcuts) => {
    if (signedIn.current) await api.saveToolShortcuts(value);
    else localStorage.setItem('whiteboard:participant-tools', JSON.stringify({ shortcuts: value, pinned }));
    setShortcuts(value);
  };
  const savePanel = async (value: boolean) => {
    setPanelSaving(true); setPanelError('');
    try {
      if (signedIn.current) await api.saveToolPanel(value);
      else localStorage.setItem('whiteboard:participant-tools', JSON.stringify({ shortcuts, pinned: value }));
      setPinned(value);
    } catch (reason) { setPanelError(errorMessage(reason)); }
    finally { setPanelSaving(false); }
  };
  useEffect(() => {
    if (!state.board) return;
    setSharedImageAccess({ boardId: state.board.id, token: connection.token! });
    return () => { setSharedImageAccess(null); };
  }, [state.board?.id, connection]);
  useEffect(() => { if (state.connected && state.board) setReady(true); }, [state.connected, state.board?.id]);
  useEffect(() => registerUpdateGuard(async () => { await editor.current?.flush(true); }), []);
  useEffect(() => {
    document.querySelector('meta[name="robots"]')?.setAttribute('content', 'noindex, nofollow');
    document.title = 'Совместная доска — BluviBoard';
    if (!/^[\w-]{43}$/.test(connection.token ?? '')) boardUnavailable();
  }, [connection]);
  return <main className="app-shell studio-workspace app-shell--sidebar-collapsed" inert={blocked}>
    <div className="workspace">
      {ready && state.board ? <BoardEditor initial={state.board} collaboration={connection} participant onSaved={noop} onCopy={noop} editorRef={editor} disabled={blocked}
        sidebarCollapsed onToggleSidebar={() => { location.assign('/'); }} onNewBoard={noop}
        toolShortcuts={shortcuts} shortcutsReady={preferencesReady} shortcutsError={preferencesError} onReloadShortcuts={() => { void loadPreferences(); }} onSaveShortcuts={saveShortcuts}
        panelPin={{ pinned, ready: preferencesReady, saving: panelSaving, error: panelError || preferencesError, setPinned: savePanel, reload: () => { void loadPreferences(); } }} /> :
        <section className="empty-state"><h1>Подключаемся к доске…</h1><p>Если связь прервётся, подключение восстановится автоматически.</p><a href="/">На главную</a></section>}
    </div>
  </main>;
}
