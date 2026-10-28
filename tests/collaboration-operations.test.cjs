const { test } = require('node:test');
const assert = require('node:assert/strict');
const { difference, applyOperation } = require('../packages/shared/board-operations');
const stroke = (id, x = 1) => ({ id, kind: 'stroke', color: '#355dff', width: 4, points: [x, 1, 2, 2] });
const board = elements => ({ id: 'board', title: 'Доска', document: { version: 1, elements } });
test('independent additions merge regardless of arrival order; retries do not duplicate', () => {
  const base = board([]), a = difference(base, board([stroke('a')])), b = difference(base, board([stroke('b')]));
  const merged = applyOperation(applyOperation(base, a), b);
  assert.deepEqual(new Set(merged.document.elements.map(e => e.id)), new Set(['a', 'b']));
  assert.deepEqual(applyOperation(merged, a), merged);
});
test('a stale eraser or undo cannot remove a concurrent new stroke', () => {
  const before = board([stroke('a')]), erase = difference(before, board([]));
  const latest = board([stroke('a'), stroke('b')]);
  assert.deepEqual(applyOperation(latest, erase).document.elements, [stroke('b')]);
});
test('stale edits and undo never replace another participant’s updated object', () => {
  const before = board([stroke('a')]), edit = difference(before, board([stroke('a', 20)]));
  const latest = board([stroke('a', 50)]);
  assert.deepEqual(applyOperation(latest, edit), latest);
});
test('jsonb key order does not affect conditional changes', () => {
  const original = stroke('a');
  const reordered = Object.fromEntries(Object.entries(original).reverse());
  assert.deepEqual(difference(board([original]), board([reordered])).elements, []);
  assert.deepEqual(applyOperation(board([reordered]), difference(board([original]), board([]))).document.elements, []);
});
test('title and background changes leave simultaneous drawing untouched', () => {
  const base = board([]), updated = { ...base, title: 'Урок', document: { ...base.document, background: { pattern: 'grid', size: 24 } } };
  const result = applyOperation(board([stroke('a')]), difference(base, updated));
  assert.equal(result.title, 'Урок'); assert.deepEqual(result.document.background, { pattern: 'grid', size: 24 });
  assert.deepEqual(result.document.elements, [stroke('a')]);
});
