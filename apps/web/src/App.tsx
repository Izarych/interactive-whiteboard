import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { Board, BoardSummary } from '@whiteboard/shared';
import { api, errorMessage } from './api';
import type { EditorHandle } from './BoardEditor';

const BoardEditor = lazy(() => import('./BoardEditor').then((module) => ({ default: module.BoardEditor })));

function App() {
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [active, setActive] = useState<Board | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const editorRef = useRef<EditorHandle | null>(null);
  const operation = useRef(false);

  const onSaved = useCallback((board: Board) => {
    setBoards((previous) => previous.map((item) => item.id === board.id ? board : item)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const list = await api.list();
        const first = list.length ? await api.get(list[0].id) : null;
        if (!cancelled) { setBoards(list); setActive(first); }
      } catch (reason) {
        if (!cancelled) setError(errorMessage(reason));
      } finally {
        if (!cancelled) setBusy(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, []);

  const run = async (action: () => Promise<void>) => {
    if (operation.current || busy) return;
    operation.current = true;
    setBusy(true);
    setError('');
    try { await action(); } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); operation.current = false; }
  };

  const create = () => run(async () => {
    await editorRef.current?.flush();
    const board = await api.create('Новая доска');
    setBoards((previous) => [board, ...previous]);
    setActive(board);
  });

  const open = (id: string) => {
    if (id === active?.id) return;
    return run(async () => {
      await editorRef.current?.flush();
      setActive(await api.get(id));
    });
  };

  const remove = (board: BoardSummary) => {
    if (!window.confirm(`Удалить доску «${board.title}»? Восстановить её после удаления нельзя.`)) return;
    return run(async () => {
      // Wait out an active save before deleting, but allow discarding an unsaved/offline draft.
      if (board.id === active?.id) await editorRef.current?.flush().catch(() => {});
      await api.delete(board.id);
      try { localStorage.removeItem(`whiteboard:draft:${board.id}`); } catch { /* Deleted on the server. */ }
      const remaining = boards.filter((item) => item.id !== board.id);
      setBoards(remaining);
      if (active?.id === board.id) {
        setActive(null);
        if (remaining.length) setActive(await api.get(remaining[0].id));
      }
    });
  };

  const copy = () => run(async () => {
    const source = editorRef.current?.snapshot();
    if (!source) return;
    const created = await api.create(`${source.title.trim() || 'Доска'} — копия`.slice(0, 120));
    let saved: Board;
    try {
      saved = await api.save(created.id, { title: created.title, document: source.document, revision: created.revision });
    } catch (reason) {
      await api.delete(created.id).catch(() => {});
      throw reason;
    }
    try { localStorage.removeItem(`whiteboard:draft:${source.id}`); } catch { /* Copy is saved. */ }
    setBoards((previous) => [saved, ...previous]);
    setActive(saved);
  });

  const reloadList = () => run(async () => {
    const list = await api.list();
    setBoards(list);
    if (!active && list.length) setActive(await api.get(list[0].id));
  });

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-icon">✎</span><div>Whiteboard<small>Пространство для идей</small></div></div>
        <button className="primary-button" disabled={busy} onClick={create}>+ Новая доска</button>
        <div className="sidebar-heading">Мои доски <span>{boards.length}</span></div>
        <nav className="board-list" aria-label="Доски">
          {boards.map((board) => <div className={`board-item ${active?.id === board.id ? 'active' : ''}`} key={board.id}>
            <button className="board-open" disabled={busy} onClick={() => { void open(board.id); }} aria-current={active?.id === board.id ? 'page' : undefined}>
              <span className="board-thumbnail">▤</span><span className="board-details"><strong>{board.title}</strong>
                <small>{new Date(board.updatedAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</small></span>
            </button>
            <button className="delete-button" disabled={busy} title="Удалить доску" aria-label={`Удалить доску ${board.title}`} onClick={() => { void remove(board); }}>×</button>
          </div>)}
          {!boards.length && !busy && <p className="empty-list">Ваши доски появятся здесь</p>}
        </nav>
        <div className="sidebar-footer">Всё сохраняется автоматически<br /><span>Ваши идеи остаются с вами</span></div>
      </aside>
      <div className={`workspace ${busy ? 'workspace--busy' : ''}`}>
        {error && <div className="error-banner" role="alert"><span>{error}</span><button disabled={busy} onClick={reloadList}>Обновить список</button></div>}
        {active ? <Suspense fallback={<div className="loading-overlay">Загрузка холста…</div>}>
          <BoardEditor key={active.id} initial={active} onSaved={onSaved} onCopy={copy} editorRef={editorRef} disabled={busy} /></Suspense> :
          <section className="empty-state"><div className="empty-icon">✎</div><h1>Место для вашей следующей идеи</h1>
            <p>Рисуйте, пробуйте цвета и создавайте столько досок, сколько нужно.</p>
            <button className="primary-button" disabled={busy} onClick={create}>Создать первую доску</button></section>}
        {busy && <div className="loading-overlay" role="status">Загрузка…</div>}
      </div>
    </main>
  );
}

export default App;
