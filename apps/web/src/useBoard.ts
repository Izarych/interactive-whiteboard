import { useCallback, useEffect, useRef, useState } from 'react';
import type { Board, BoardDocument } from '@whiteboard/shared';
import { ApiError, api, errorMessage, temporaryConnectionError } from './api';
import { acknowledgesSave } from './board-sync';

const draftKey = (id: string) => `whiteboard:draft:${id}`;

function restore(board: Board) {
  try {
    const raw = localStorage.getItem(draftKey(board.id));
    if (raw) {
      const draft = JSON.parse(raw) as Board;
      if (draft.id === board.id && typeof draft.title === 'string' &&
          Number.isInteger(draft.revision) && draft.document?.version === 1 &&
          Array.isArray(draft.document.elements)) {
        return { board: { ...board, title: draft.title, document: draft.document, revision: draft.revision }, dirty: true };
      }
    }
  } catch { /* A damaged draft must not prevent opening the server document. */ }
  return { board, dirty: false };
}

export function useBoard(initial: Board, onSaved: (board: Board) => void) {
  const [initialState] = useState(() => restore(initial));
  const [board, setBoard] = useState(initialState.board);
  const [changes, setChanges] = useState(initialState.dirty ? 1 : 0);
  const [status, setStatus] = useState<'saved' | 'pending' | 'saving' | 'local' | 'error'>(initialState.dirty ? 'pending' : 'saved');
  const [error, setError] = useState('');
  const [draftWarning, setDraftWarning] = useState('');
  const session = useRef({ current: initialState.board, changes: initialState.dirty ? 1 : 0, saved: 0 });
  const inFlight = useRef<Promise<void> | null>(null);
  const retry = useRef({ failures: 0, timer: undefined as number | undefined });
  const mounted = useRef(true);
  const uncertain = useRef<{ board: Board; sequence: number } | null>(null);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const storeDraft = useCallback(() => {
    try {
      localStorage.setItem(draftKey(initial.id), JSON.stringify(session.current.current));
      setDraftWarning('');
      return true;
    } catch {
      setDraftWarning('Локальная резервная копия недоступна. Дождитесь сохранения на сервер перед закрытием.');
      return false;
    }
  }, [initial.id]);

  const edit = useCallback((patch: { title?: string; document?: BoardDocument }) => {
    const state = session.current;
    state.current = { ...state.current, ...patch };
    state.changes += 1;
    setBoard(state.current);
    setChanges(state.changes);
    const stored = storeDraft();
    setStatus(retry.current.failures ? stored ? 'local' : 'error' : 'pending');
  }, [storeDraft]);

  const flush = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    window.clearTimeout(retry.current.timer);
    retry.current.timer = undefined;
    const state = session.current;
    if (state.changes === state.saved) return Promise.resolve();
    const save = async () => {
      if (!retry.current.failures) setStatus('saving');
      setError('');
      try {
        // Serialize saves; edits made during a request are sent using its new revision.
        while (state.changes !== state.saved) {
          let sequence = state.changes;
          const snapshot = state.current;
          let saved: Board;
          try {
            if (!navigator.onLine) throw new ApiError('Нет подключения к серверу', 0);
            saved = await api.save(snapshot.id, {
              title: snapshot.title.trim() || 'Без названия', document: snapshot.document, revision: snapshot.revision,
            });
          } catch (reason) {
            // A request can commit successfully while its response is lost.
            // Only acknowledge that exact write, never overwrite another tab's changes.
            const attempt = uncertain.current ?? { board: snapshot, sequence };
            if (reason instanceof ApiError && reason.status === 409) {
              const remote = await api.get(snapshot.id);
              if (!acknowledgesSave(remote, attempt.board)) throw reason;
              saved = remote;
              sequence = attempt.sequence;
            } else {
              if (temporaryConnectionError(reason)) uncertain.current = { board: snapshot, sequence };
              throw reason;
            }
          }
          uncertain.current = null;
          retry.current.failures = 0;
          state.saved = sequence;
          state.current = sequence === state.changes ? saved : {
            ...state.current, revision: saved.revision, updatedAt: saved.updatedAt,
          };
          setBoard(state.current);
          onSavedRef.current(saved);
          if (state.saved === state.changes) {
            try { localStorage.removeItem(draftKey(initial.id)); } catch { /* Server copy is saved. */ }
          } else {
            storeDraft();
          }
        }
        setStatus('saved');
        setDraftWarning('');
      } catch (reason) {
        if (temporaryConnectionError(reason)) {
          const stored = storeDraft();
          setStatus(stored ? 'local' : 'error');
          // Back off even when the user keeps drawing. A server outage does not
          // fire the browser's online event, so recovery must also be timer-driven.
          const delay = Math.min(30000, 2000 * 2 ** Math.min(retry.current.failures++, 4));
          if (mounted.current) retry.current.timer = window.setTimeout(() => { void flush().catch(() => {}); }, delay);
        } else {
          retry.current.failures = 0;
          setStatus('error');
          setError(errorMessage(reason));
        }
        throw reason;
      }
    };
    inFlight.current = save().finally(() => { inFlight.current = null; });
    return inFlight.current;
  }, [initial.id, storeDraft]);

  useEffect(() => {
    if (!changes || retry.current.failures) return;
    const timer = window.setTimeout(() => { void flush().catch(() => {}); }, 800);
    return () => window.clearTimeout(timer);
  }, [changes, flush]);

  useEffect(() => {
    mounted.current = true;
    const unload = (event: BeforeUnloadEvent) => {
      if (session.current.changes !== session.current.saved) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const online = () => { if (retry.current.failures) void flush().catch(() => {}); };
    window.addEventListener('beforeunload', unload);
    window.addEventListener('online', online);
    return () => {
      mounted.current = false;
      window.clearTimeout(retry.current.timer);
      window.removeEventListener('beforeunload', unload);
      window.removeEventListener('online', online);
    };
  }, [flush]);

  return { board, edit, flush, status, error, draftWarning, snapshot: () => session.current.current };
}
