import type { DrawingTool, ImageElement } from '@whiteboard/shared';
import { shapeModifiers } from './drawing-settings';
import type { ShapeModifier } from './drawing-settings';

export const drawingColors = ['#202938', '#64748b', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6'];
export function ColorPalette({ color, onChange }: { color: string; onChange: (value: string) => void }) {
  return <div className="colors">{drawingColors.map((value) => <button key={value} className={`color-button ${color === value ? 'active' : ''}`} style={{ backgroundColor: value }} aria-label={`Цвет ${value}`} aria-pressed={color === value} onClick={() => onChange(value)} />)}
    <label className="custom-color" title="Произвольный цвет">+<input aria-label="Произвольный цвет" type="color" value={color} onChange={(event) => onChange(event.target.value)} /></label>
  </div>;
}

export function ToolSettings({ tool, label, color, width, opacity, eraserWidth, modifier, selectedImage, onColor, onWidth, onOpacity, onEraserWidth, onModifier, onDeleteImage, onZoomIn, onZoomOut, onResetView }: {
  tool: DrawingTool; label: string; color: string; width: number; opacity: number; eraserWidth: number; modifier: ShapeModifier; selectedImage: ImageElement | null;
  onColor: (value: string) => void; onWidth: (value: number) => void; onOpacity: (value: number) => void; onEraserWidth: (value: number) => void;
  onModifier: (value: ShapeModifier) => void; onDeleteImage: () => void; onZoomIn: () => void; onZoomOut: () => void; onResetView: () => void;
}) {
  const drawing = ['pen', 'highlighter', 'rectangle', 'ellipse'].includes(tool);
  const widthLabel = tool === 'pen' ? 'Толщина карандаша' : tool === 'highlighter' ? 'Толщина маркера' : 'Толщина контура';
  return <section id={`tool-settings-${tool}`} className={`editor-popover tool-settings ${['select', 'pen', 'highlighter'].includes(tool) ? 'tool-settings--left' : ''}`} role="dialog" aria-label={`Настройки: ${label}`}>
    <h2>{label}</h2>
    {drawing && <>
      <ColorPalette color={color} onChange={onColor} />
      <label className="width-control">Толщина<input aria-label={widthLabel} type="range" min={tool === 'highlighter' ? 4 : 1} max={tool === 'highlighter' ? 64 : 32} value={width} onChange={(event) => onWidth(Number(event.target.value))} /><span>{width}</span></label>
      {tool === 'highlighter' ? <>
        <label className="width-control">Непрозрачность<input aria-label="Непрозрачность маркера" type="range" min="10" max="80" value={Math.round(opacity * 100)} onChange={(event) => onOpacity(Number(event.target.value) / 100)} /><span>{Math.round(opacity * 100)}%</span></label>
      </> : <>
        <label className="shape-modifier-control">Выравнивание фигур<select aria-label="Хоткей выравнивания фигур" value={modifier} onChange={(event) => onModifier(event.target.value as ShapeModifier)}>{shapeModifiers.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
      </>}
    </>}
    {tool === 'eraser' && <>
      <label className="width-control">Размер<input aria-label="Размер ластика" type="range" min="8" max="80" value={eraserWidth} onChange={(event) => onEraserWidth(Number(event.target.value))} /><span>{eraserWidth}</span></label>
    </>}
    {tool === 'select' && <>
      {selectedImage && <p className="drawing-settings-note">Размер: {Math.round(selectedImage.width)} × {Math.round(selectedImage.height)}</p>}
      <button className="text-button" disabled={!selectedImage} onClick={onDeleteImage}>Удалить выбранное изображение</button>
    </>}
    {tool === 'hand' && <>
      <div className="tool-view-controls"><button className="text-button" aria-label="Уменьшить масштаб в настройках" onClick={onZoomOut}>−</button><button className="text-button" onClick={onResetView}>Сбросить вид</button><button className="text-button" aria-label="Увеличить масштаб в настройках" onClick={onZoomIn}>+</button></div>
    </>}
  </section>;
}
