const { test } = require('node:test');
const assert = require('node:assert/strict');
const { acknowledgesSave } = require('../apps/web/src/board-sync.ts');

const original = { id: 'board', revision: 1, title: ' Draft ', document: { version: 1, elements: [
  { id: 'marker', kind: 'stroke', color: '#ff0000', opacity: .35, width: 24, points: [10, 20, 30, 40] },
], background: { pattern: 'grid', size: 32 } } };
const saved = { ...original, revision: 2, title: 'Draft' };

test('save acknowledgement ignores jsonb key order, including highlighter opacity and backgrounds', () => {
  const reordered = JSON.parse(JSON.stringify(saved, (_key, value) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).reverse()) : value));
  assert.equal(acknowledgesSave(reordered, original), true);
});

test('save acknowledgement rejects different boards, revisions, titles and element/point order', () => {
  for (const patch of [{ id: 'other' }, { revision: 1 }, { revision: 3 }, { title: 'Other title' },
    { document: { ...saved.document, elements: [] } },
    { document: { ...saved.document, elements: [{ ...saved.document.elements[0], points: [20, 10, 30, 40] }] } }]) {
    assert.equal(acknowledgesSave({ ...saved, ...patch }, original), false);
  }
  const elements = [original.document.elements[0], { ...original.document.elements[0], id: 'second' }];
  assert.equal(acknowledgesSave({ ...saved, document: { ...saved.document, elements: elements.toReversed() } },
    { ...original, document: { ...original.document, elements } }), false);
});
