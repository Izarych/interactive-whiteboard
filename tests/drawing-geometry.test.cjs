const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { improveShape, eraseOutline, touchesOutline } = require('../apps/web/src/drawing-geometry.ts');

const stroke = (points, extra = {}) => ({ id: randomUUID(), kind: 'stroke', color: '#ef4444', width: 4, points, ...extra });
const trace = (vertices) => vertices.slice(1).flatMap((to, i) => Array.from({ length: 12 }, (_, j) => {
  const t = j / 12, from = vertices[i];
  return [from[0] + (to[0] - from[0]) * t + Math.sin(j) * 1.5, from[1] + (to[1] - from[1]) * t + Math.cos(j) * 1.5];
})).concat([vertices.at(-1)]).flat();

test('recognition straightens a wobbly line and preserves its style', () => {
  const original = stroke(Array.from({ length: 30 }, (_, i) => [i * 10, 120 + Math.sin(i) * 5]).flat());
  const line = improveShape(original);
  assert.equal(line.kind, 'stroke');
  assert.equal(line.points.length, 4);
  assert.equal(line.points[1], line.points[3]);
  assert.equal(line.id, original.id);
  assert.equal(line.color, original.color);
  assert.equal(line.width, original.width);
});

test('recognition closes a rough square, rectangle and triangle, including a mid-edge start', () => {
  for (const vertices of [ [[0, 0], [120, 3], [118, 119], [2, 121], [0, 0]], [[60, 0], [180, 0], [180, 100], [0, 100], [0, 0], [60, 0]] ]) {
    const shape = improveShape(stroke(trace(vertices)));
    assert.equal(shape.kind, 'rectangle');
    if (vertices.length === 5) assert.ok(Math.abs(Math.abs(shape.points[2] - shape.points[0]) - Math.abs(shape.points[3] - shape.points[1])) < 1e-6);
  }
  const triangle = improveShape(stroke(trace([[0, 140], [80, 0], [160, 140], [0, 140]])));
  assert.equal(triangle.kind, 'stroke');
  assert.equal(triangle.points.length, 8);
  assert.deepEqual(triangle.points.slice(0, 2), triangle.points.slice(-2));
});

test('recognition fits circles and ellipses while leaving a scribble intact', () => {
  for (const [rx, ry] of [[70, 73], [120, 50]]) {
    const points = Array.from({ length: 81 }, (_, i) => { const angle = i * Math.PI / 40; return [200 + (rx + Math.sin(i) * 2) * Math.cos(angle), 200 + (ry + Math.cos(i) * 2) * Math.sin(angle)]; }).flat();
    const result = improveShape(stroke(points));
    assert.equal(result.kind, 'ellipse');
    if (rx === 70) assert.ok(Math.abs((result.points[2] - result.points[0]) - (result.points[3] - result.points[1])) < 1e-6);
  }
  const scribble = stroke([0, 0, 100, 100, 20, 90, 130, 10, 30, 130, 150, 100]);
  assert.equal(improveShape(scribble), scribble);
});

test('primitive constraints work in all drag directions', () => {
  for (const kind of ['rectangle', 'ellipse']) for (const end of [[80, 60], [-80, 60], [80, -60], [-80, -60]]) {
    const shape = improveShape(stroke([0, 0, ...end], { kind }));
    assert.equal(Math.abs(shape.points[2]), 80);
    assert.equal(Math.abs(shape.points[3]), 80);
    assert.equal(Math.sign(shape.points[2]), Math.sign(end[0]));
    assert.equal(Math.sign(shape.points[3]), Math.sign(end[1]));
  }
});

test('point erasure splits a line, keeps both ends, and preserves grouping through repeated cuts', () => {
  const line = stroke([0, 100, 200, 100]);
  const result = eraseOutline(line, [100, 100], [100, 100], 10);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0].points, [0, 100, 88, 100]);
  assert.ok(Math.abs(result[1].points[0] - 112) < 1e-7);
  assert.deepEqual(result[1].points.slice(1), [100, 200, 100]);
  assert.ok(result.every((item) => item.groupId === line.id));
  assert.notEqual(result[0].id, result[1].id);
  const again = eraseOutline(result[1], [160, 100], [160, 100], 10);
  assert.equal(again.length, 2);
  assert.ok(again.every((item) => item.groupId === line.id));
});

test('swept erasure cuts fast diagonal movements without gaps and ignores untouched geometry', () => {
  const line = stroke([0, 100, 200, 100]);
  const result = eraseOutline(line, [90, 0], [110, 200], 8);
  assert.equal(result.length, 2);
  assert.ok(result[0].points[2] < 90);
  assert.ok(result[1].points[0] > 110);
  assert.equal(eraseOutline(line, [0, 0], [200, 0], 8)[0], line);
  assert.equal(touchesOutline(line, [90, 0], [110, 200], 8), true);
});

test('partial erasure cuts closed shapes rather than deleting or filling their interiors', () => {
  for (const kind of ['rectangle', 'ellipse']) {
    const shape = stroke([0, 0, 100, 100], { kind });
    assert.equal(eraseOutline(shape, [50, 50], [50, 50], 8)[0], shape);
    const fragments = eraseOutline(shape, [50, 0], [50, 0], 8);
    assert.equal(fragments.length, 1);
    assert.equal(fragments[0].kind, 'stroke');
    assert.equal(fragments[0].groupId, shape.id);
    assert.ok(fragments[0].points.length >= 8);
    assert.equal(touchesOutline(fragments[0], [50, 0], [50, 0], 5), false);
  }
});

test('eraser removes a dot completely and retains a nearby dot', () => {
  const dot = stroke([10, 10, 10, 10]);
  assert.deepEqual(eraseOutline(dot, [10, 10], [10, 10], 10), []);
  assert.equal(eraseOutline(dot, [50, 50], [50, 50], 10)[0], dot);
});
