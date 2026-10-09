const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pointerSamples, appendStrokePoints } = require('../apps/web/src/drawing-input.ts');

test('coalesced input preserves a curved path and transforms CSS coordinates through pan and zoom', () => {
  const event = { clientX: 300, clientY: 250, getCoalescedEvents: () => [{ clientX: 220, clientY: 180 }, { clientX: 250, clientY: 150 }] };
  const result = pointerSamples(event, { left: 100, top: 50, width: 400, height: 300 }, { width: 800, height: 600 }, { x: 40, y: 20, scale: 2 });
  assert.deepEqual(result, [[100, 120], [130, 90], [180, 190]]);
  const points = [80, 180, 80, 180];
  assert.equal(appendStrokePoints(points, result, 2), true);
  assert.deepEqual(points, [80, 180, 80, 180, 100, 120, 130, 90, 180, 190]);
});

test('unsupported coalescing falls back to the event, duplicates are skipped, and a short final movement is retained', () => {
  const bounds = { left: 0, top: 0, width: 100, height: 100 }, size = { width: 100, height: 100 }, view = { x: 0, y: 0, scale: 1 };
  const event = { clientX: 10, clientY: 10, getCoalescedEvents: () => { throw new Error('unsupported'); } };
  assert.deepEqual(pointerSamples(event, bounds, size, view), [[10, 10]]);
  const points = [0, 0, 10, 10];
  assert.equal(appendStrokePoints(points, [[10, 10], [10.2, 10]], 1), false);
  assert.equal(appendStrokePoints(points, [[10.2, 10]], 1, true), true);
  assert.deepEqual(points.slice(-2), [10.2, 10]);
});

test('input respects the document point limit even when a large batch is dispatched', () => {
  const points = Array.from({ length: 39998 }, (_, i) => i % 2 ? 0 : i);
  appendStrokePoints(points, [[50000, 10], [50010, 20]], 1);
  assert.equal(points.length, 40000);
  assert.deepEqual(points.slice(-2), [50000, 10]);
});
