import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { ActiveSession, Board, BoardSummary, SessionInfo } from '@whiteboard/shared';
import { api, errorMessage } from './api';
import type { EditorHandle } from './BoardEditor';
import { PanelLeftClose, PanelLeftOpen, X } from 'lucide-react';
import { InstallControls } from './InstallControls';
import { registerUpdateGuard } from './pwa';

const BoardEditor = lazy(() => import('./BoardEditor').then((module) => ({ default: module.BoardEditor })));
const sidebarPreference = 'bluviboard:sidebar-collapsed';
function sidebarDefault() {
  try {
    const stored = localStorage.getItem(sidebarPreference);
    if (stored !== null) return stored === 'true';
  } catch { /* Layout still works when browser storage is unavailable. */ }
  return window.matchMedia('(max-width: 760px)').matches;
}

function Workspace({ session, blocked, onAuth, onProfile, onSession, onAdmin }: {
  session: ActiveSession; blocked: boolean; onAuth: (mode: 'login' | 'register') => void;
  onProfile: () => void; onSession: (session: SessionInfo) => void;
  onAdmin: () => void;
}) {
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [active, setActive] = useState<Board | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  const editorRef = useRef<EditorHandle | null>(null);
  const operation = useRef<Promise<void> | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(sidebarDefault);
  const toggleSidebar = () => {
    setSidebarCollapsed((previous) => {
      const next = !previous;
      try { localStorage.setItem(sidebarPreference, String(next)); } catch { /* Session-only preference. */ }
      return next;
    });
  };
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const resize = () => setSidebarCollapsed(media.matches ? true : sidebarDefault());
    media.addEventListener('change', resize);
    return () => media.removeEventListener('change', resize);
  }, []);

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

  useEffect(() => registerUpdateGuard(async () => {
    await operation.current;
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await editorRef.current?.flush(true);
  }), []);

  const run = (action: () => Promise<void>) => {
    if (operation.current || busy) return Promise.resolve();
    setBusy(true);
    setError('');
    operation.current = (async () => {
      try { await action(); } catch (reason) { setError(errorMessage(reason)); }
      finally { setBusy(false); operation.current = null; }
    })();
    return operation.current;
  };

  const create = () => run(async () => {
    await editorRef.current?.flush();
    const board = await api.create('Новая доска');
    setBoards((previous) => [board, ...previous]);
    setActive(board);
    if (window.matchMedia('(max-width: 760px)').matches) setSidebarCollapsed(true);
  });

  const open = (id: string) => {
    if (id === active?.id) {
      if (window.matchMedia('(max-width: 760px)').matches) setSidebarCollapsed(true);
      return;
    }
    return run(async () => {
      await editorRef.current?.flush();
      setActive(await api.get(id));
      if (window.matchMedia('(max-width: 760px)').matches) setSidebarCollapsed(true);
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

  const openAccount = (mode?: 'login' | 'register') => run(async () => {
    await editorRef.current?.flush();
    if (mode) onAuth(mode); else onProfile();
  });
  const logout = () => run(async () => {
    await editorRef.current?.flush();
    await api.logout();
    onSession(await api.session());
  });

  return (
    <main className={`app-shell ${sidebarCollapsed ? 'app-shell--sidebar-collapsed' : ''}`} inert={blocked}>
      {!sidebarCollapsed && <button className="sidebar-backdrop" aria-label="Закрыть список досок" onClick={toggleSidebar} />}
      <aside id="boards-sidebar" className="sidebar" aria-label="Боковая панель" hidden={sidebarCollapsed}>
        <div className="brand"><img className="brand-icon" src="/favicon.svg" alt="" aria-hidden="true" />
          <div><span className="brand-name">Bluvi<span>Board</span></span><small>Пространство для идей</small></div>
          <button className="sidebar-close" aria-label="Скрыть список досок" title="Скрыть список досок" onClick={toggleSidebar}><X size={17} /></button></div>
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
        <div className="sidebar-account">
          <button className="account-button" disabled={busy} aria-label={session.kind === 'user' ? 'Открыть профиль' : 'Войти или зарегистрироваться'}
            onClick={() => { void openAccount(session.kind === 'guest' ? 'register' : undefined); }}>
            <span className="account-avatar">{session.user?.avatarUrl ? <img src={session.user.avatarUrl} alt="" /> : (Array.from(session.user?.name ?? '')[0]?.toUpperCase() ?? 'Г')}</span>
            <span className="account-details"><strong>{session.user?.name ?? 'Гость'}</strong><small>{session.user?.email ?? 'Сохраните доски в аккаунте'}</small></span>
          </button>
        <div className="account-actions">{session.kind === 'guest' ? <>
            <button disabled={busy} onClick={() => { void openAccount('login'); }}>Войти</button>
            <button disabled={busy} onClick={() => { void openAccount('register'); }}>Создать аккаунт</button>
          </> : <button disabled={busy} onClick={() => { void logout(); }}>Выйти</button>}</div>
          {session.user?.role === 'admin' && <button className="admin-entry-button" disabled={busy} onClick={() => { void run(async () => { await editorRef.current?.flush(); onAdmin(); }); }}>Админ-панель →</button>}
        </div>
        <InstallControls />
        <div className="sidebar-footer">Всё сохраняется автоматически<br /><span>Ваши идеи остаются с вами</span></div>
      </aside>
      <div className={`workspace ${busy ? 'workspace--busy' : ''}`}>
        {error && <div className="error-banner" role="alert"><span>{error}</span><button disabled={busy} onClick={reloadList}>Обновить список</button></div>}
        {active ? <Suspense fallback={<div className="loading-overlay">Загрузка холста…</div>}>
          <BoardEditor key={active.id} initial={active} onSaved={onSaved} onCopy={copy} editorRef={editorRef} disabled={busy || blocked}
            sidebarCollapsed={sidebarCollapsed} onToggleSidebar={toggleSidebar} onNewBoard={create} /></Suspense> :
          <section className="empty-state"><button className="empty-sidebar-toggle editor-icon-button" aria-label={sidebarCollapsed ? 'Показать боковую панель' : 'Свернуть боковую панель'} aria-expanded={!sidebarCollapsed} aria-controls="boards-sidebar" onClick={toggleSidebar}>{sidebarCollapsed ? <PanelLeftOpen size={20} /> : <PanelLeftClose size={20} />}</button>
            <img className="empty-icon" src="/favicon.svg" alt="" aria-hidden="true" /><h1>Место для вашей следующей идеи</h1>
            <p>Рисуйте, пробуйте цвета и создавайте столько досок, сколько нужно.</p>
            <button className="primary-button" disabled={busy} onClick={create}>Создать первую доску</button></section>}
        {busy && <div className="loading-overlay" role="status">Загрузка…</div>}
      </div>
    </main>
  );
}

export default Workspace;
