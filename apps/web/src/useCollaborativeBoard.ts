import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Board } from '@whiteboard/shared';
import { Collaboration } from './collaboration';

export function useCollaborativeBoard(initial: Board, onSaved: (board: Board) => void, existing?: Collaboration) {
  const [connection] = useState(() => existing ?? new Collaboration(undefined, initial));
  const [legacyDraft] = useState<Board | null>(() => {
    if (existing) return null;
    try {
      const draft = JSON.parse(localStorage.getItem(`whiteboard:draft:${initial.id}`) ?? 'null');
      return draft?.id === initial.id && typeof draft.title === 'string' && draft.document?.version === 1 && Array.isArray(draft.document.elements) ? draft : null;
    } catch { return null; }
  });
  const state = useSyncExternalStore(connection.subscribe, connection.getState);
  useEffect(() => existing ? undefined : connection.start(), [connection, existing]);
  useEffect(() => { if (state.board) onSaved(state.board); }, [state.board, onSaved]);
  const legacyError = legacyDraft ? 'Найден несинхронизированный черновик, созданный до включения совместной работы. Сохраните его как новую доску, чтобы не заменить рисунки участников.' : '';
  return { ...state, error: legacyError || state.error, board: state.board ?? initial, edit: connection.edit,
    flush: async () => { if (legacyError) throw new Error(legacyError); await connection.flush(); },
    recoverySnapshot: legacyDraft ? () => legacyDraft : undefined,
    snapshot: () => connection.state.board ?? initial, previews: state.previews, preview: connection.preview };
}
