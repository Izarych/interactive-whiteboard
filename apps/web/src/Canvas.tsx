import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Circle, Ellipse, Image as KonvaImage, Layer, Line, Rect, Stage, Text, Transformer } from 'react-konva';
import type Konva from 'konva';
import type { BoardBackground, DrawnElement, DrawingElement, DrawingTool, ImageElement } from '@whiteboard/shared';
import { loadImage } from './images';
import { backgroundImages } from './background';
import { eraseOutline, improveShape, touchesOutline } from './drawing-geometry';
import type { Point } from './drawing-geometry';
import { modifierHeld } from './drawing-settings';
import type { ShapeModifier } from './drawing-settings';

export type Tool = DrawingTool;
export interface CanvasHandle { finish: () => void }
interface Props {
  canvasRef?: React.RefObject<CanvasHandle | null>;
  elements: DrawingElement[];
  background: BoardBackground;
  tool: Tool;
  color: string;
  width: number;
  eraserWidth?: number;
  shapeModifier?: ShapeModifier;
  onChange: (elements: DrawingElement[]) => void;
  stageRef: React.RefObject<Konva.Stage | null>;
  selectedImageId: string | null;
  onSelectImage: (id: string | null) => void;
  onImageFiles: (files: File[], position?: { x: number; y: number }) => void;
}

function Element({ element, preview = false }: { element: DrawnElement; preview?: boolean }) {
  const { points: p, color, width } = element;
  const common = { id: preview ? undefined : element.id, listening: !preview, stroke: color, strokeWidth: width, hitStrokeWidth: Math.max(14, width) };
  if (element.kind === 'stroke') return <Line {...common} points={p} lineCap="round" lineJoin="round" />;
  const x = Math.min(p[0], p[2]);
  const y = Math.min(p[1], p[3]);
  const w = Math.abs(p[2] - p[0]);
  const h = Math.abs(p[3] - p[1]);
  return element.kind === 'rectangle'
    ? <Rect {...common} x={x} y={y} width={w} height={h} />
    : <Ellipse {...common} x={x + w / 2} y={y + h / 2} radiusX={w / 2} radiusY={h / 2} />;
}

function CanvasImage({ element, draggable, onChange }: {
  element: ImageElement; draggable: boolean; onChange: (element: ImageElement) => void;
}) {
  const [image, setImage] = useState<HTMLImageElement>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setImage(undefined);
    setFailed(false);
    void loadImage(element.assetId).then((value) => { if (!cancelled) setImage(value); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [element.assetId]);
  return <>
    <KonvaImage id={element.id} image={image} x={element.x} y={element.y} width={element.width} height={element.height}
      fill={image ? undefined : failed ? '#fee2e2' : '#e9edf5'} draggable={draggable}
      onDragEnd={(event) => {
        event.cancelBubble = true;
        onChange({ ...element, x: event.target.x(), y: event.target.y() });
      }}
      onTransformEnd={(event) => {
        const node = event.target;
        const width = Math.max(1, Math.min(10000, node.width() * node.scaleX()));
        const height = Math.max(1, Math.min(10000, node.height() * node.scaleY()));
        node.scale({ x: 1, y: 1 });
        onChange({ ...element, x: node.x(), y: node.y(), width, height });
      }} />
    {!image && <Text x={element.x} y={element.y + element.height / 2 - 7} width={element.width} align="center"
      text={failed ? 'Изображение недоступно' : 'Загрузка…'} fill="#747b8d" fontSize={14} listening={false} />}
  </>;
}

export function Canvas({ elements, background, tool, color, width, eraserWidth = 24, shapeModifier = 'Shift', onChange, stageRef, selectedImageId, onSelectImage, onImageFiles, canvasRef }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [draft, setDraft] = useState<DrawnElement | null>(null);
  const [erasedPreview, setErasedPreview] = useState<DrawingElement[] | null>(null);
  const [eraserPosition, setEraserPosition] = useState<Point | null>(null);
  const gesture = useRef<{ pointerId: number; element: DrawnElement | null; erasing: DrawingElement[] | null; baseIds: Set<string>; pan: boolean; snap: boolean; last: Point; radius: number } | null>(null);
  const keyboardModifier = useRef<boolean | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const elementsRef = useRef(elements);
  elementsRef.current = elements;

  useEffect(() => {
    const transformer = transformerRef.current;
    const node = tool === 'select' && selectedImageId ? stageRef.current?.findOne(`#${selectedImageId}`) : null;
    transformer?.nodes(node ? [node] : []);
  }, [selectedImageId, tool, elements, stageRef]);

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    if (container.current) observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  const point = (): Point | null => {
    const position = stageRef.current?.getPointerPosition();
    return position ? [(position.x - view.x) / view.scale, (position.y - view.y) / view.scale] : null;
  };

  const finish = (cancelled = false) => {
    const active = gesture.current;
    if (!active) return;
    gesture.current = null;
    if (!cancelled && active.element) onChange([...elementsRef.current, active.snap ? improveShape(active.element) : active.element]);
    if (!cancelled && active.erasing && (active.erasing.length !== active.baseIds.size || active.erasing.some((element, i) => element !== elementsRef.current[i]))) {
      onChange([...active.erasing, ...elementsRef.current.filter((element) => !active.baseIds.has(element.id))]);
    }
    setDraft(null);
    setErasedPreview(null);
    // An interrupted pan must not leave Konva dragging on the next tool.
    stageRef.current?.stopDrag();
  };
  useImperativeHandle(canvasRef, () => ({ finish: () => finish() }));

  useEffect(() => { keyboardModifier.current = null; }, [shapeModifier]);

  useEffect(() => {
    const modifier = (event: KeyboardEvent) => {
      // Keyboard release is authoritative: pen/pointer events may carry stale modifier flags.
      keyboardModifier.current = modifierHeld(event, shapeModifier);
      const active = gesture.current;
      if (!active) return;
      if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
        finish(true); event.preventDefault(); event.stopImmediatePropagation(); return;
      }
      if (!active.element || event.key !== shapeModifier) return;
      // Refinement belongs to this gesture, even if the key is released before the pointer.
      active.snap ||= keyboardModifier.current;
      setDraft(active.snap ? improveShape(active.element) : active.element);
      event.preventDefault();
    };
    const blur = () => { keyboardModifier.current = false; finish(); };
    const focus = () => { keyboardModifier.current = null; };
    window.addEventListener('keydown', modifier, true);
    window.addEventListener('keyup', modifier, true);
    window.addEventListener('blur', blur);
    window.addEventListener('focus', focus);
    return () => { window.removeEventListener('keydown', modifier, true); window.removeEventListener('keyup', modifier, true); window.removeEventListener('blur', blur); window.removeEventListener('focus', focus); };
  });

  const erase = (active: NonNullable<typeof gesture.current>, p: Point, whole: boolean) => {
    if (!active.erasing) return;
    if (whole) {
      const groups = new Set<string>();
      for (const element of active.erasing) {
        const hit = element.kind === 'image'
          ? (p[0] >= element.x && p[0] <= element.x + element.width && p[1] >= element.y && p[1] <= element.y + element.height) || touchesOutline({ id: element.id, kind: 'rectangle', color: '', width: 0, points: [element.x, element.y, element.x + element.width, element.y + element.height] }, active.last, p, active.radius)
          : touchesOutline(element, active.last, p, active.radius);
        if (hit) groups.add(element.kind === 'image' ? element.id : element.groupId ?? element.id);
      }
      active.erasing = active.erasing.filter((element) => !groups.has(element.kind === 'image' ? element.id : element.groupId ?? element.id));
    } else {
      active.erasing = active.erasing.flatMap<DrawingElement>((element) => element.kind === 'image' ? [element] : eraseOutline(element, active.last, p, active.radius));
    }
    active.last = p;
    setErasedPreview(active.erasing);
  };

  const zoom = (scale: number, anchor = { x: size.width / 2, y: size.height / 2 }) => {
    const next = Math.max(0.2, Math.min(4, scale));
    setView({
      x: anchor.x - (anchor.x - view.x) / view.scale * next,
      y: anchor.y - (anchor.y - view.y) / view.scale * next,
      scale: next,
    });
  };

  return (
    <div className={`canvas canvas--${tool}`} ref={container} data-testid="canvas" data-background={background.pattern}
      onPointerLeave={() => { if (!gesture.current) setEraserPosition(null); }}
      onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
      onDrop={(event) => {
        const files = Array.from(event.dataTransfer.files);
        if (!files.length) return;
        event.preventDefault();
        const rect = container.current!.getBoundingClientRect();
        onImageFiles(files, { x: (event.clientX - rect.left - view.x) / view.scale, y: (event.clientY - rect.top - view.y) / view.scale });
      }}
      style={{ backgroundImage: backgroundImages[background.pattern], backgroundSize: `${background.size * view.scale}px ${background.size * view.scale}px`,
        backgroundPosition: `${view.x}px ${view.y}px` }}>
      <Stage ref={stageRef} width={size.width} height={size.height} x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale}
        draggable={tool === 'hand'}
        onDragEnd={(event) => { if (event.target === stageRef.current) setView({ ...view, x: event.target.x(), y: event.target.y() }); }}
        onPointerDown={(event) => {
          if (gesture.current || (event.evt.button !== 0 && event.evt.button !== 1)) return;
          if (tool === 'select' && event.evt.button === 0) {
            if (event.target.getClassName() === 'Transformer' || event.target.findAncestor('Transformer')) return;
            const image = elementsRef.current.find((element) => element.id === event.target.id() && element.kind === 'image');
            onSelectImage(image?.id ?? null);
            return;
          }
          const p = point();
          if (!p) return;
          const pan = tool === 'hand' || event.evt.button === 1;
          const element: DrawnElement | null = !pan && tool !== 'eraser' ? {
            id: crypto.randomUUID(), kind: tool === 'pen' ? 'stroke' : tool === 'rectangle' ? 'rectangle' : 'ellipse',
            color, width, points: [...p, ...p],
          } : null;
          gesture.current = { pointerId: event.evt.pointerId, element, erasing: tool === 'eraser' && !pan ? [...elementsRef.current] : null,
            baseIds: new Set(elementsRef.current.map((element) => element.id)), pan, snap: keyboardModifier.current ?? modifierHeld(event.evt, shapeModifier), last: p, radius: eraserWidth / 2 / view.scale };
          // Capture outside the stage so releasing beyond its border still commits the stroke.
          (event.evt.target as HTMLElement).setPointerCapture(event.evt.pointerId);
          if (pan) stageRef.current?.startDrag();
          if (gesture.current.erasing) { setEraserPosition(p); erase(gesture.current, p, event.evt.shiftKey); }
          setDraft(element && gesture.current.snap ? improveShape(element) : element);
        }}
        onPointerMove={(event) => {
          const p = point();
          if (tool === 'eraser') setEraserPosition(p);
          const active = gesture.current;
          if (!active || active.pointerId !== event.evt.pointerId || active.pan) return;
          if (active.erasing) {
            if (p) erase(active, p, event.evt.shiftKey);
            return;
          }
          if (!p || !active.element) return;
          const previous = active.element.points;
          if (active.element.kind === 'stroke') {
            const dx = p[0] - previous[previous.length - 2];
            const dy = p[1] - previous[previous.length - 1];
            if (dx * dx + dy * dy < 1 / view.scale ** 2 || previous.length >= 40000) return;
          }
          active.element = { ...active.element, points: active.element.kind === 'stroke' ? [...previous, ...p] : [...previous.slice(0, 2), ...p] };
          active.snap ||= keyboardModifier.current ?? modifierHeld(event.evt, shapeModifier);
          setDraft(active.snap ? improveShape(active.element) : active.element);
        }}
        onPointerUp={(event) => {
          const active = gesture.current;
          if (active?.pointerId !== event.evt.pointerId) return;
          const p = point();
          if (p && active.erasing) erase(active, p, event.evt.shiftKey);
          finish();
        }}
        onPointerCancel={(event) => { if (gesture.current?.pointerId === event.evt.pointerId) finish(true); }}
        onWheel={(event) => {
          event.evt.preventDefault();
          if (!gesture.current) zoom(view.scale * (event.evt.deltaY > 0 ? 0.9 : 1.1), stageRef.current?.getPointerPosition() ?? undefined);
        }}>
        <Layer>
          {(erasedPreview ?? elements).map((element) => element.kind === 'image'
            ? <CanvasImage key={element.id} element={element} draggable={tool === 'select'}
              onChange={(changed) => onChange(elementsRef.current.map((item) => item.id === changed.id ? changed : item))} />
            : <Element key={element.id} element={element} />)}
          {draft && <Element element={draft} preview />}
          {tool === 'eraser' && eraserPosition && <Circle name="editor-overlay" x={eraserPosition[0]} y={eraserPosition[1]} radius={eraserWidth / 2 / view.scale}
            stroke="#6366f1" strokeWidth={1 / view.scale} fill="#6366f110" listening={false} />}
          {tool === 'select' && <Transformer ref={transformerRef} rotateEnabled={false} flipEnabled={false}
            enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']} keepRatio
            borderStroke="#6366f1" anchorStroke="#6366f1" anchorFill="#fff" anchorSize={9}
            boundBoxFunc={(oldBox, newBox) => Math.abs(newBox.width) < 16 || Math.abs(newBox.height) < 16 ||
              Math.abs(newBox.width) / view.scale > 10000 || Math.abs(newBox.height) / view.scale > 10000 ? oldBox : newBox} />}
        </Layer>
      </Stage>
      {!elements.length && !draft && <div className="canvas-hint">Начните рисовать или вставьте скриншот с помощью Ctrl+V</div>}
      <div className="zoom-controls">
        <button aria-label="Уменьшить масштаб" onClick={() => zoom(view.scale / 1.2)}>−</button>
        <button title="Сбросить положение и масштаб" onClick={() => setView({ x: 0, y: 0, scale: 1 })}>{Math.round(view.scale * 100)}%</button>
        <button aria-label="Увеличить масштаб" onClick={() => zoom(view.scale * 1.2)}>+</button>
      </div>
      <div className="canvas-tip">Колёсико — масштаб · Рука / средняя кнопка — перемещение</div>
    </div>
  );
}
