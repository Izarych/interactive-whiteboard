import { useId, useRef, useState } from 'react';
import { Highlighter, Pencil, RotateCcw, Sparkles } from 'lucide-react';
import type { PointerEvent } from 'react';

type DemoStroke = { points: number[]; color: string; marker: boolean };
const inks = [{ color: '#355dff', name: 'Синий' }, { color: '#232936', name: 'Графитовый' }, { color: '#ef7970', name: 'Коралловый' }, { color: '#339b7c', name: 'Зелёный' }];

export function LandingPreview() {
  const gridId = useId();
  const [color, setColor] = useState(inks[0].color);
  const [marker, setMarker] = useState(false);
  const [strokes, setStrokes] = useState<DemoStroke[]>([]);
  const pointer = useRef<number | null>(null);
  const position = (event: PointerEvent<SVGSVGElement>) => {
    const transform = event.currentTarget.getScreenCTM();
    const point = transform ? new DOMPoint(event.clientX, event.clientY).matrixTransform(transform.inverse()) : new DOMPoint();
    return [Math.max(0, Math.min(640, point.x)), Math.max(0, Math.min(430, point.y))];
  };
  return <div className="landing-preview">
    <div className="preview-sticker preview-sticker--top"><Sparkles size={16} />Место, где мысли становятся яснее</div>
    <div className="preview-window">
      <div className="preview-window-bar"><div className="preview-window-dots"><i /><i /><i /></div><span>Моя следующая идея</span><span className="preview-demo-label">ИНТЕРАКТИВНОЕ ДЕМО</span></div>
      <svg className="preview-surface" viewBox="0 0 640 430" aria-label="Демо-холст: попробуйте нарисовать линию" data-testid="landing-demo" onPointerDown={(event) => {
        if (event.button !== 0 || pointer.current !== null) return;
        pointer.current = event.pointerId;
        event.currentTarget.setPointerCapture(event.pointerId);
        // Read the SVG transform before React clears the event's currentTarget.
        const point = position(event);
        setStrokes((previous) => [...previous.slice(-39), { points: point, color, marker }]);
      }} onPointerMove={(event) => {
        if (pointer.current !== event.pointerId) return;
        const point = position(event);
        setStrokes((previous) => previous.map((stroke, index) => index === previous.length - 1 && stroke.points.length < 4000 ? { ...stroke, points: [...stroke.points, ...point] } : stroke));
      }} onPointerUp={(event) => { if (pointer.current === event.pointerId) pointer.current = null; }} onPointerCancel={() => { pointer.current = null; }} onLostPointerCapture={() => { pointer.current = null; }}>
        <defs><pattern id={gridId} width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="11" cy="11" r=".8" fill="#d7dce6" /></pattern></defs>
        <rect width="640" height="430" fill={`url(#${gridId})`} />
        <g className="preview-art" pointerEvents="none">
          <path d="M94 109q54-38 126-11" fill="none" stroke="#f0cf5e" strokeWidth="32" strokeLinecap="round" opacity=".65" />
          <text x="81" y="116" className="preview-handwriting" transform="rotate(-7 81 116)">а что, если…</text>
          <path className="preview-draw-in" pathLength="1" d="M238 111Q298 102 322 153M306 143l17 14 4-23" fill="none" stroke="#737d93" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <g transform="rotate(3 400 203)"><rect x="302" y="151" width="218" height="94" rx="13" fill="#e9edff" stroke="#cdd5ff" /><text x="331" y="191" className="preview-note-title">Большая идея</text><text x="331" y="218" className="preview-note-copy">начинается с одного штриха</text></g>
          <path className="preview-draw-in" pathLength="1" d="M303 235Q228 269 189 241M202 236l-18 4 11 15" fill="none" stroke="#355dff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <g transform="rotate(-5 160 285)"><rect x="76" y="246" width="169" height="92" rx="11" fill="#f9edbd" /><text x="97" y="280" className="preview-note-title">Сначала — набросок</text><path d="M98 300h99m-99 12h71" stroke="#baa975" strokeWidth="3" strokeLinecap="round" /></g>
          <path d="M368 286c43-28 91-4 88 28-5 39-96 41-97 2-1-12 4-23 16-30" fill="none" stroke="#439a7f" strokeWidth="3.5" strokeLinecap="round" />
          <text x="379" y="316" className="preview-small-handwriting">готово!</text>
          <path d="m524 102 6 13 14 2-10 10 2 14-12-7-13 6 3-14-10-10 15-1Z" fill="#f3c867" />
          <path d="M501 350q18-24 42-8t40-11" fill="none" stroke="#e99088" strokeWidth="4" strokeLinecap="round" />
        </g>
        {strokes.map((stroke, index) => <polyline key={index} data-demo-stroke points={Array.from({ length: stroke.points.length / 2 }, (_, i) => `${stroke.points[i * 2]},${stroke.points[i * 2 + 1]}`).join(' ')} fill="none" stroke={stroke.color} opacity={stroke.marker ? .35 : 1} strokeWidth={stroke.marker ? 18 : 3.5} strokeLinecap="round" strokeLinejoin="round" pointerEvents="none" />)}
      </svg>
      <div className="preview-toolbar" role="toolbar" aria-label="Инструменты демо-холста">
        <button aria-label="Карандаш в демо" aria-pressed={!marker} onClick={() => setMarker(false)}><Pencil size={17} /></button>
        <button aria-label="Маркер в демо" aria-pressed={marker} onClick={() => setMarker(true)}><Highlighter size={17} /></button>
        <span className="preview-tool-divider" />
        {inks.map((ink) => <button key={ink.color} className="preview-ink" aria-label={`${ink.name} цвет в демо`} aria-pressed={color === ink.color} onClick={() => setColor(ink.color)}><span style={{ background: ink.color }} /></button>)}
        <span className="preview-tool-divider" />
        <button aria-label="Убрать мои штрихи в демо" onClick={() => { if (pointer.current === null) setStrokes([]); }}><RotateCcw size={16} /></button>
      </div>
    </div>
    <div className="preview-sticker preview-sticker--bottom"><span>↗</span>Да, здесь можно порисовать</div>
    <p className="preview-disclaimer">Это демо. Чтобы сохранить рисунок, откройте свою доску.</p>
  </div>;
}
