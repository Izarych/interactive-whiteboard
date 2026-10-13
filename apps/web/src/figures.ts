import type { DrawnElement, FigureKind } from '@whiteboard/shared';

export const figures: { id: FigureKind; label: string }[] = [
  { id: 'triangle', label: 'Треугольник' }, { id: 'square', label: 'Квадрат' }, { id: 'rectangle', label: 'Прямоугольник' },
  { id: 'circle', label: 'Круг' }, { id: 'oval', label: 'Овал' }, { id: 'line', label: 'Прямая линия' },
  { id: 'arrow', label: 'Стрелка' }, { id: 'trapezoid', label: 'Трапеция' }, { id: 'parallelepiped', label: 'Параллелепипед' },
];
export function figureElement(element: DrawnElement, figure: FigureKind, constrained = false): DrawnElement {
  const kind = figure === 'square' ? 'rectangle' : figure === 'circle' || figure === 'oval' ? 'ellipse' : figure;
  const [x, y, endX, endY] = element.points;
  let points = element.points;
  if ((figure === 'line' || figure === 'arrow') && constrained) {
    const length = Math.hypot(endX - x, endY - y);
    const angle = Math.round(Math.atan2(endY - y, endX - x) / (Math.PI / 4)) * (Math.PI / 4);
    points = [x, y, x + Math.cos(angle) * length, y + Math.sin(angle) * length];
  } else if (figure === 'square' || figure === 'circle' || (constrained && figure !== 'line' && figure !== 'arrow')) {
    const size = Math.max(Math.abs(endX - x), Math.abs(endY - y));
    points = [x, y, x + (endX < x ? -size : size), y + (endY < y ? -size : size)];
  }
  return { ...element, kind, points };
}
