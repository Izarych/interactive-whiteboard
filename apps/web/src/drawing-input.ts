import type { Point } from './drawing-geometry';

interface PointerSample { clientX: number; clientY: number }
interface PointerBatch extends PointerSample { getCoalescedEvents?: () => PointerSample[] }

/** Recover the actual input samples instead of connecting only dispatched pointer endpoints. */
export function pointerSamples(event: PointerBatch, bounds: { left: number; top: number; width: number; height: number }, size: { width: number; height: number }, view: { x: number; y: number; scale: number }): Point[] {
  let batch: PointerSample[] = [];
  try { batch = event.getCoalescedEvents?.() ?? []; } catch { /* Older pointer implementations still provide the dispatched event. */ }
  if (!bounds.width || !bounds.height) return [];
  return [...batch, event].filter((sample) => Number.isFinite(sample.clientX) && Number.isFinite(sample.clientY)).map((sample) => [
    ((sample.clientX - bounds.left) * size.width / bounds.width - view.x) / view.scale,
    ((sample.clientY - bounds.top) * size.height / bounds.height - view.y) / view.scale,
  ]);
}

/** The gesture owns this array; copying it per input sample would grow quadratically. */
export function appendStrokePoints(points: number[], samples: Point[], scale: number, includeEnd = false) {
  let changed = false;
  for (let i = 0; i < samples.length && points.length < 40000; i++) {
    const [x, y] = samples[i];
    const dx = x - points[points.length - 2], dy = y - points[points.length - 1];
    const distance = dx * dx + dy * dy;
    if (!distance || (distance < .25 / scale ** 2 && !(includeEnd && i === samples.length - 1))) continue;
    points.push(x, y);
    changed = true;
  }
  return changed;
}
