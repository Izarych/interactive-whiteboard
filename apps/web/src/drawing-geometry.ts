import type { DrawnElement } from '@whiteboard/shared';

export type Point = [number, number];
const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const pairs = (points: number[]): Point[] => Array.from({ length: points.length / 2 }, (_, i) => [points[i * 2], points[i * 2 + 1]]);
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1];
const subtract = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const at = (a: Point, b: Point, t: number): Point => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
const EPS = 1e-7;

export function segmentDistance(p: Point, a: Point, b: Point) {
  const delta = subtract(b, a);
  const length = dot(delta, delta);
  return distance(p, at(a, b, length ? Math.max(0, Math.min(1, dot(subtract(p, a), delta) / length)) : 0));
}

function bounds(points: Point[]) {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const [x, y] of points) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
  return { left, top, right, bottom, width: right - left, height: bottom - top };
}

function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length <= 2) return points;
  let farthest = 0, index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = segmentDistance(points[i], points[0], points.at(-1)!);
    if (d > farthest) { farthest = d; index = i; }
  }
  if (farthest <= tolerance) return [points[0], points.at(-1)!];
  return [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(points.slice(index), tolerance)];
}

function corners(points: Point[], tolerance: number) {
  let farthest = 1;
  for (let i = 2; i < points.length; i++) if (distance(points[0], points[i]) > distance(points[0], points[farthest])) farthest = i;
  const loop = [...points, points[0]];
  const result = [...simplify(loop.slice(0, farthest + 1), tolerance).slice(0, -1), ...simplify(loop.slice(farthest), tolerance).slice(0, -1)];
  for (let i = 0; result.length > 3 && i < result.length; i++) {
    if (segmentDistance(result[i], result[(i + result.length - 1) % result.length], result[(i + 1) % result.length]) <= tolerance) { result.splice(i, 1); i = -1; }
  }
  return result;
}

function fitsPolygon(points: Point[], polygon: Point[], tolerance: number) {
  return points.every((p) => polygon.some((a, i) => segmentDistance(p, a, polygon[(i + 1) % polygon.length]) <= tolerance));
}

/** Keep an unrecognised gesture intact; the caller only refines explicitly modified gestures. */
export function improveShape(element: DrawnElement): DrawnElement {
  if (element.kind !== 'stroke') {
    const [x, y, endX, endY] = element.points;
    const size = Math.max(Math.abs(endX - x), Math.abs(endY - y));
    return { ...element, points: [x, y, x + (endX < x ? -size : size), y + (endY < y ? -size : size)] };
  }
  const raw = pairs(element.points);
  const points = raw.length > 512 ? Array.from({ length: 512 }, (_, i) => raw[Math.round(i * (raw.length - 1) / 511)]) : raw;
  if (points.length < 3) return element;
  const box = bounds(points);
  const diagonal = Math.hypot(box.width, box.height);
  if (diagonal < Math.max(8, element.width * 2)) return element;
  let pathLength = 0;
  for (let i = 1; i < points.length; i++) pathLength += distance(points[i - 1], points[i]);

  // Least-squares direction makes a slightly wobbly line straight without moving its centre.
  const centre: Point = [points.reduce((sum, p) => sum + p[0], 0) / points.length, points.reduce((sum, p) => sum + p[1], 0) / points.length];
  let xx = 0, xy = 0, yy = 0;
  for (const p of points) { const d = subtract(p, centre); xx += d[0] ** 2; xy += d[0] * d[1]; yy += d[1] ** 2; }
  let angle = Math.atan2(2 * xy, xx - yy) / 2;
  if (Math.abs(Math.sin(angle)) < Math.sin(Math.PI / 15)) angle = 0;
  else if (Math.abs(Math.cos(angle)) < Math.sin(Math.PI / 15)) angle = Math.PI / 2;
  const axis: Point = [Math.cos(angle), Math.sin(angle)];
  const projection = points.map((p) => dot(subtract(p, centre), axis));
  const minimum = Math.min(...projection), maximum = Math.max(...projection);
  const lineStart: Point = [centre[0] + axis[0] * minimum, centre[1] + axis[1] * minimum];
  const lineEnd: Point = [centre[0] + axis[0] * maximum, centre[1] + axis[1] * maximum];
  if (distance(points[0], points.at(-1)!) > pathLength * .8 && points.every((p) => segmentDistance(p, lineStart, lineEnd) <= Math.max(element.width * 1.5, diagonal * .07))) {
    return { ...element, points: dot(subtract(points.at(-1)!, points[0]), axis) < 0 ? [...lineEnd, ...lineStart] : [...lineStart, ...lineEnd] };
  }
  if (points.length < 8 || distance(points[0], points.at(-1)!) > diagonal * .22) return element;
  const vertices = corners(points, diagonal * .065);
  if (vertices.length === 4) {
    const edge = subtract(vertices[1], vertices[0]);
    let direction = Math.atan2(edge[1], edge[0]);
    const nearestAxis = Math.round(direction / (Math.PI / 2)) * Math.PI / 2;
    if (Math.abs(direction - nearestAxis) < Math.PI / 15) direction = nearestAxis;
    const u: Point = [Math.cos(direction), Math.sin(direction)], v: Point = [-u[1], u[0]];
    const projected = bounds(points.map((p) => [dot(p, u), dot(p, v)]));
    let w = projected.width, h = projected.height;
    if (w / h > .8 && w / h < 1.25) w = h = (w + h) / 2;
    const cx = (projected.left + projected.right) / 2, cy = (projected.top + projected.bottom) / 2;
    const polygon: Point[] = [[cx - w / 2, cy - h / 2], [cx + w / 2, cy - h / 2], [cx + w / 2, cy + h / 2], [cx - w / 2, cy + h / 2]]
      .map(([x, y]) => [u[0] * x + v[0] * y, u[1] * x + v[1] * y]);
    if (fitsPolygon(points, polygon, diagonal * .09)) {
      if (Math.abs(Math.sin(direction * 2)) < EPS) {
        const result = bounds(polygon);
        return { ...element, kind: 'rectangle', points: [result.left, result.top, result.right, result.bottom] };
      }
      return { ...element, points: [...polygon, polygon[0]].flat() };
    }
  }
  if (vertices.length === 3 && fitsPolygon(points, vertices, diagonal * .08)) return { ...element, points: [...vertices, vertices[0]].flat() };
  if (box.width < 8 || box.height < 8) return element;
  const cx = (box.left + box.right) / 2, cy = (box.top + box.bottom) / 2;
  const radii = points.map((p) => Math.hypot((p[0] - cx) / (box.width / 2), (p[1] - cy) / (box.height / 2)));
  if (radii.every((r) => Math.abs(r - 1) < .25) && Math.sqrt(radii.reduce((sum, r) => sum + (r - 1) ** 2, 0) / radii.length) < .13) {
    let w = box.width, h = box.height;
    if (w / h > .8 && w / h < 1.25) w = h = (w + h) / 2;
    return { ...element, kind: 'ellipse', points: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2] };
  }
  return element;
}

export function outline(element: DrawnElement): Point[] {
  if (element.kind === 'stroke') return pairs(element.points);
  const [x, y, endX, endY] = element.points;
  if (element.kind === 'rectangle') return [[x, y], [endX, y], [endX, endY], [x, endY], [x, y]];
  const rx = Math.abs(endX - x) / 2, ry = Math.abs(endY - y) / 2;
  const cx = (x + endX) / 2, cy = (y + endY) / 2;
  const count = Math.max(32, Math.min(2048, Math.ceil(Math.PI * Math.sqrt(Math.max(rx, ry) / .4))));
  return Array.from({ length: count + 1 }, (_, i) => [cx + rx * Math.cos(i * Math.PI * 2 / count), cy + ry * Math.sin(i * Math.PI * 2 / count)]);
}

type Interval = [number, number];
function slab(value: number, delta: number, min: number, max: number): Interval | null {
  if (Math.abs(delta) < EPS) return value >= min && value <= max ? [0, 1] : null;
  const a = (min - value) / delta, b = (max - value) / delta;
  const start = Math.max(0, Math.min(a, b)), end = Math.min(1, Math.max(a, b));
  return start <= end ? [start, end] : null;
}

function disk(a: Point, b: Point, centre: Point, radius: number): Interval | null {
  const delta = subtract(b, a), offset = subtract(a, centre);
  const aa = dot(delta, delta), bb = 2 * dot(offset, delta), cc = dot(offset, offset) - radius ** 2;
  if (aa < EPS) return cc <= 0 ? [0, 1] : null;
  const discriminant = bb ** 2 - 4 * aa * cc;
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant);
  const start = Math.max(0, (-bb - root) / (2 * aa)), end = Math.min(1, (-bb + root) / (2 * aa));
  return start <= end ? [start, end] : null;
}

/** Exact intersections with the swept eraser disk, including movement between pointer events. */
function cuts(a: Point, b: Point, from: Point, to: Point, radius: number): Interval[] {
  const intervals = [disk(a, b, from, radius), disk(a, b, to, radius)].filter((value): value is Interval => value !== null);
  const movement = subtract(to, from), length = Math.hypot(...movement);
  if (length > EPS) {
    const u: Point = [movement[0] / length, movement[1] / length], v: Point = [-u[1], u[0]];
    const offset = subtract(a, from), delta = subtract(b, a);
    const along = slab(dot(offset, u), dot(delta, u), 0, length);
    const across = slab(dot(offset, v), dot(delta, v), -radius, radius);
    if (along && across && Math.max(along[0], across[0]) <= Math.min(along[1], across[1])) intervals.push([Math.max(along[0], across[0]), Math.min(along[1], across[1])]);
  }
  const merged: Interval[] = [];
  for (const interval of intervals.sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && last[1] >= interval[0] - EPS) last[1] = Math.max(last[1], interval[1]);
    else if (interval[1] - interval[0] > EPS) merged.push([...interval]);
  }
  return merged;
}

export function touchesOutline(element: DrawnElement, from: Point, to: Point, radius: number) {
  if (!nearEraser(element, from, to, radius)) return false;
  const points = outline(element);
  return points.slice(1).some((p, i) => cuts(points[i], p, from, to, radius + element.width / 2).length > 0);
}

export function eraseOutline(element: DrawnElement, from: Point, to: Point, radius: number): DrawnElement[] {
  if (!nearEraser(element, from, to, radius)) return [element];
  const points = outline(element);
  const fragments: Point[][] = [];
  let current: Point[] = [], changed = false;
  const flush = () => { if (current.length) fragments.push(current); current = []; };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const removed = cuts(a, b, from, to, radius + element.width / 2);
    changed ||= removed.length > 0;
    let start = 0;
    for (const [left, right] of [...removed, [1, 1] as Interval]) {
      if (left - start > EPS) {
        const first = at(a, b, start), last = at(a, b, left);
        if (current.length && distance(current.at(-1)!, first) > EPS) flush();
        if (!current.length) current.push(first);
        current.push(last);
      }
      if (right > left) flush();
      start = right;
    }
  }
  flush();
  if (!changed) return [element];
  // Rejoin the two ends of a closed contour if the cut happened elsewhere on it.
  if (fragments.length > 1 && distance(points[0], points.at(-1)!) < EPS && distance(fragments.at(-1)!.at(-1)!, fragments[0][0]) < EPS) {
    fragments[0] = [...fragments.pop()!.slice(0, -1), ...fragments[0]];
  }
  return fragments.map((fragment, i) => ({ ...element, id: i === 0 ? element.id : crypto.randomUUID(), groupId: element.groupId ?? element.id, kind: 'stroke', points: (fragment.length === 1 ? [fragment[0], fragment[0]] : fragment).flat() }));
}

function nearEraser(element: DrawnElement, from: Point, to: Point, radius: number) {
  const box = bounds(pairs(element.points)), padding = radius + element.width / 2;
  return box.right >= Math.min(from[0], to[0]) - padding && box.left <= Math.max(from[0], to[0]) + padding &&
    box.bottom >= Math.min(from[1], to[1]) - padding && box.top <= Math.max(from[1], to[1]) + padding;
}
