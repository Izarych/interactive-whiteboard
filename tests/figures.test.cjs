const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { figureElement, figures } = require('../apps/web/src/figures.ts');
const { outlines, touchesOutline, eraseOutline } = require('../apps/web/src/drawing-geometry.ts');
const element = (points, kind = 'stroke') => ({ id: randomUUID(), kind, color: '#ef4444', width: 4, points });

test('all figure choices produce finite contours and squares/circles constrain every drag direction', () => {
  assert.equal(figures.length, 9);
  for (const figure of figures) for (const end of [[160, 90], [-160, 90], [160, -90], [-160, -90]]) {
    const result = figureElement(element([0, 0, ...end]), figure.id);
    assert.equal(result.points.length, 4);
    assert.ok(outlines(result).flat().flat().every(Number.isFinite));
    if (figure.id === 'square' || figure.id === 'circle') {
      assert.equal(Math.abs(result.points[2]), 160);
      assert.equal(Math.abs(result.points[3]), 160);
      assert.equal(Math.sign(result.points[2]), Math.sign(end[0]));
      assert.equal(Math.sign(result.points[3]), Math.sign(end[1]));
    }
  }
});

test('line and arrow retain drawing direction and the modifier constrains angles', () => {
  for (const figure of ['line', 'arrow']) {
    const raw = element([200, 150, 10, 143]);
    const normal = figureElement(raw, figure);
    assert.deepEqual(normal.points, raw.points);
    const constrained = figureElement(raw, figure, true);
    assert.ok(Math.abs(constrained.points[3] - 150) < 1e-6);
    assert.ok(constrained.points[2] < 200);
    assert.ok(outlines(figureElement(element([10, 10, 10, 10]), figure)).flat().flat().every(Number.isFinite));
  }
});

test('arrowhead hits and erasure include wings outside the anchor bounds', () => {
  const arrow = element([0, 0, 100, 0], 'arrow');
  assert.equal(touchesOutline(arrow, [88, 6], [88, 6], 1), true);
  const fragments = eraseOutline(arrow, [88, 6], [88, 6], 1);
  assert.ok(fragments.length >= 2);
  assert.ok(fragments.every((part) => part.kind === 'stroke' && part.groupId === arrow.id && part.color === arrow.color));
  assert.ok(fragments.some((part) => JSON.stringify(part.points) === JSON.stringify([0, 0, 100, 0])));
});

test('parallelepiped has twelve edges and does not invent diagonals between its separate contours', () => {
  const box = element([0, 0, 100, 100], 'parallelepiped');
  const paths = outlines(box);
  assert.equal(paths.reduce((count, path) => count + path.length - 1, 0), 12);
  assert.equal(touchesOutline(box, [50, 12.5], [50, 12.5], 2), false);
  assert.equal(eraseOutline(box, [50, 12.5], [50, 12.5], 2)[0], box);
  const fragments = eraseOutline(box, [50, 25], [50, 25], 2);
  assert.ok(fragments.length > 1);
  assert.ok(fragments.every((part) => part.groupId === box.id));
});
