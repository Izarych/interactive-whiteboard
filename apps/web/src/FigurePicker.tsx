import type { FigureKind } from '@whiteboard/shared';
import { figureElement, figures } from './figures';
import { outlines } from './drawing-geometry';

export function FigurePicker({ value, onChange }: { value: FigureKind; onChange: (value: FigureKind) => void }) {
  return <div className="figure-picker" role="group" aria-label="Выбор фигуры">{figures.map((figure) => {
    const element = figureElement({ id: 'preview', kind: 'stroke', color: '', width: 2, points: [4, 4, 36, 28] }, figure.id);
    return <button key={figure.id} className={`figure-option ${value === figure.id ? 'active' : ''}`} aria-label={figure.label} aria-pressed={value === figure.id} title={figure.label} onClick={() => onChange(figure.id)}>
      <svg viewBox="0 0 44 44" width="32" height="32" aria-hidden="true">{outlines(element).map((path, i) => <polyline key={i} points={path.map(([x, y]) => `${x},${y}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />)}</svg>
      <span>{figure.id === 'parallelepiped' ? <>Параллеле<br />пипед</> : figure.label}</span>
    </button>;
  })}</div>;
}
