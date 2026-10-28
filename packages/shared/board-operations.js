// Conditional, per-object changes: stale undo/eraser operations cannot replace
// another participant's newer version or erase unrelated, concurrent additions.
function equal(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equal(a[key], b[key]));
}
function difference(before, after) {
  const old = new Map(before.document.elements.map(e => [e.id, e]));
  const next = new Map(after.document.elements.map(e => [e.id, e]));
  const elements = [...new Set([...old.keys(), ...next.keys()])].flatMap(id =>
    equal(old.get(id), next.get(id)) ? [] : [{ id, before: old.get(id) ?? null, after: next.get(id) ?? null }]);
  return { elements,
    ...(before.title !== after.title ? { title: { before: before.title, after: after.title } } : {}),
    ...(!equal(before.document.background, after.document.background) ? { background: { before: before.document.background ?? null, after: after.document.background ?? null } } : {}),
  };
}
function applyOperation(board, operation) {
  const elements = new Map(board.document.elements.map(e => [e.id, e]));
  for (const change of operation.elements) {
    if (!equal(elements.get(change.id) ?? null, change.before)) continue;
    if (change.after) elements.set(change.id, change.after); else elements.delete(change.id);
  }
  const document = { ...board.document, elements: [...elements.values()] };
  if (operation.background && equal(document.background ?? null, operation.background.before)) {
    if (operation.background.after) document.background = operation.background.after; else delete document.background;
  }
  return { ...board, document, title: operation.title && board.title === operation.title.before ? operation.title.after : board.title };
}
module.exports = { equal, difference, applyOperation };
