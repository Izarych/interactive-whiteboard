import type { Board } from '@whiteboard/shared';

function canonicalDocument(document: Board['document']) {
  // PostgreSQL jsonb can reorder object keys, but array order is meaningful.
  return JSON.stringify(document, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
}

export function acknowledgesSave(remote: Board, attempted: Board) {
  return remote.id === attempted.id && remote.revision === attempted.revision + 1 &&
    remote.title === (attempted.title.trim() || 'Без названия') &&
    canonicalDocument(remote.document) === canonicalDocument(attempted.document);
}
