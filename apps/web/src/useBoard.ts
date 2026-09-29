import { useCallback, useEffect, useRef, useState } from 'react';
import type { Board, BoardDocument } from '@whiteboard/shared';
import { api, errorMessage } from './api';

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
  const [status, setStatus] = useState<'saved' | 'pending' | 'saving' | 'error'>(initialState.dirty ? 'pending' : 'saved');
  const [error, setError] = useState('');
  const [draftWarning, setDraftWarning] = useState('');
  const session = useRef({ current: initialState.board, changes: initialState.dirty ? 1 : 0, saved: 0 });
  const inFlight = useRef<Promise<void> | null>(null);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;

  const storeDraft = useCallback(() => {
    try {
      localStorage.setItem(draftKey(initial.id), JSON.stringify(session.current.current));
      setDraftWarning('');
    } catch {
      setDraftWarning('Локальная резервная копия недоступна. Дождитесь сохранения на сервер перед закрытием.');
    }
  }, [initial.id]);

  const edit = useCallback((patch: { title?: string; document?: BoardDocument }) => {
    const state = session.current;
    state.current = { ...state.current, ...patch };
    state.changes += 1;
    setBoard(state.current);
    setChanges(state.changes);
    setStatus('pending');
    storeDraft();
  }, [storeDraft]);

  const flush = useCallback((): Promise<void> => {
    if (inFlight.current) return inFlight.current;
    const state = session.current;
    if (state.changes === state.saved) return Promise.resolve();
    const save = async () => {
      setStatus('saving');
      setError('');
      try {
        // Serialize saves; edits made during a request are sent using its new revision.
        while (state.changes !== state.saved) {
          const sequence = state.changes;
          const snapshot = state.current;
          const saved = await api.save(snapshot.id, {
            title: snapshot.title.trim() || 'Без названия', document: snapshot.document, revision: snapshot.revision,
          });
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
      } catch (reason) {
        setStatus('error');
        setError(errorMessage(reason));
        throw reason;
      }
    };
    inFlight.current = save().finally(() => { inFlight.current = null; });
    return inFlight.current;
  }, [initial.id, storeDraft]);

  useEffect(() => {
    if (!changes) return;
    const timer = window.setTimeout(() => { void flush().catch(() => {}); }, 800);
    return () => window.clearTimeout(timer);
  }, [changes, flush]);

  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (session.current.changes !== session.current.saved) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    const online = () => { void flush().catch(() => {}); };
    window.addEventListener('beforeunload', unload);
    window.addEventListener('online', online);
    return () => {
      window.removeEventListener('beforeunload', unload);
      window.removeEventListener('online', online);
    };
  }, [flush]);

  return { board, edit, flush, status, error, draftWarning, snapshot: () => session.current.current };
}
