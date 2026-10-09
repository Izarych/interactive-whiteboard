import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import type Konva from 'konva';
import type { Board, BoardBackground, DrawingElement, ImageElement, ToolShortcuts } from '@whiteboard/shared';
import { Canvas } from './Canvas';
import type { Tool } from './Canvas';
import type { CanvasHandle } from './Canvas';
import { useBoard } from './useBoard';
import { api, errorMessage } from './api';
import { loadImage } from './images';
import { backgroundPatterns, DEFAULT_BACKGROUND } from './background';
import { BackgroundSizeControl } from './BackgroundSizeControl';
import { saveShapeModifier, shapeModifiers, storedShapeModifier } from './drawing-settings';
import type { ShapeModifier } from './drawing-settings';
import { ToolShortcutEditor } from './ToolShortcutEditor';
import { shortcutLabel, shortcutMatches } from './tool-shortcuts';
import { ColorPalette, drawingColors, ToolSettings } from './ToolSettings';
import { ToolPanelPinControl } from './ToolPanelPinControl';
import type { ToolPanelPinState } from './ToolPanelPinControl';
import { Circle, Download, Eraser, Grid2X2, Hand, Highlighter, ImagePlus, Keyboard, MoreHorizontal, MousePointer2, Palette, PanelLeftClose, PanelLeftOpen, Pencil, Plus, RectangleHorizontal, Redo2, Trash2, Undo2 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface EditorHandle {
  flush: (forUpdate?: boolean) => Promise<void>;
  snapshot: () => Board;
}

const tools: { id: Tool; label: string; icon: LucideIcon }[] = [
  { id: 'select', label: 'Выделение', icon: MousePointer2 },
  { id: 'pen', label: 'Карандаш', icon: Pencil },
  { id: 'highlighter', label: 'Маркер', icon: Highlighter },
  { id: 'eraser', label: 'Ластик', icon: Eraser },
  { id: 'rectangle', label: 'Прямоугольник', icon: RectangleHorizontal },
  { id: 'ellipse', label: 'Эллипс', icon: Circle },
  { id: 'hand', label: 'Рука', icon: Hand },
];
const colors = drawingColors;

export function BoardEditor({ initial, onSaved, onCopy, editorRef, disabled, sidebarCollapsed, onToggleSidebar, onNewBoard, toolShortcuts, shortcutsReady, shortcutsError, onReloadShortcuts, onSaveShortcuts, panelPin }: {
  initial: Board; onSaved: (board: Board) => void; onCopy: () => void;
  editorRef: React.RefObject<EditorHandle | null>;
  disabled: boolean;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  onNewBoard: () => void;
  toolShortcuts: ToolShortcuts;
  shortcutsReady: boolean;
  shortcutsError: string;
  onReloadShortcuts: () => void;
  onSaveShortcuts: (shortcuts: ToolShortcuts) => Promise<void>;
  panelPin: ToolPanelPinState;
}) {
  const { board, edit, flush, status, error, draftWarning, snapshot } = useBoard(initial, onSaved);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(colors[0]);
  const [width, setWidth] = useState(4);
  const [eraserWidth, setEraserWidth] = useState(24);
  const [highlighterColor, setHighlighterColor] = useState('#eab308');
  const [highlighterWidth, setHighlighterWidth] = useState(24);
  const [highlighterOpacity, setHighlighterOpacity] = useState(.35);
  const [shapeModifier, setShapeModifier] = useState(storedShapeModifier);
  const [history, setHistory] = useState<{ undo: DrawingElement[][]; redo: DrawingElement[][] }>({ undo: [], redo: [] });
  const stageRef = useRef<Konva.Stage | null>(null);
  const canvasRef = useRef<CanvasHandle | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploads = useRef<Promise<void>>(Promise.resolve());
  const pendingUploads = useRef(0);
  const failedUpload = useRef(false);
  const [uploading, setUploading] = useState(0);
  const [imageError, setImageError] = useState('');
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [panel, setPanel] = useState<'tool' | 'pen' | 'background' | 'board' | 'shortcut' | null>(null);
  const activePanel = panel ?? (panelPin.pinned ? 'tool' : null);
  const [shortcutTool, setShortcutTool] = useState<Tool>('pen');
  const previousTool = useRef<Tool>('pen');
  const editorRoot = useRef<HTMLElement>(null);
  const selectTool = (next: Tool, settings = false) => {
    canvasRef.current?.finish();
    if (next !== tool) previousTool.current = tool;
    setTool(next); setPanel(settings || panelPin.pinned ? 'tool' : null);
  };
  const setModifier = (value: ShapeModifier) => { setShapeModifier(value); saveShapeModifier(value); };
  const background = board.document.background ?? DEFAULT_BACKGROUND;
  const saveText = uploading ? 'Загрузка изображения…' : status === 'saved' ? 'Сохранено' : status === 'saving' ? 'Сохранение…' : status === 'pending' ? 'Есть изменения' : 'Не сохранено';
  const togglePanel = (next: NonNullable<typeof panel>) => setPanel((previous) => previous === next ? null : next);
  useEffect(() => {
    if (!activePanel) return;
    const closeOutside = (event: PointerEvent) => {
      const root = editorRoot.current?.querySelector(`[data-editor-panel="${activePanel}"]`);
      if (event.target instanceof Node && !root?.contains(event.target)) {
        if (document.activeElement instanceof HTMLElement && root?.contains(document.activeElement)) document.activeElement.blur();
        if (panelPin.pinned && (activePanel === 'tool' || activePanel === 'pen')) return;
        setPanel(null);
      }
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      editorRoot.current?.querySelector<HTMLButtonElement>(`[data-editor-panel="${activePanel}"] > button[aria-controls]`)?.focus();
      if (panelPin.pinned && (activePanel === 'tool' || activePanel === 'pen')) return;
      setPanel(null);
    };
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', closeOutside); window.removeEventListener('keydown', escape); };
  }, [activePanel, panelPin.pinned]);
  useImperativeHandle(editorRef, () => ({ flush: async (forUpdate) => {
    canvasRef.current?.finish();
    while (pendingUploads.current) await uploads.current;
    if (forUpdate && failedUpload.current) throw new Error('Изображение не загрузилось. Повторите загрузку или закройте сообщение об ошибке.');
    await flush();
  }, snapshot }));

  const changeElements = (elements: DrawingElement[]) => {
    const document = snapshot().document;
    setHistory((previous) => ({ undo: [...previous.undo.slice(-49), document.elements], redo: [] }));
    edit({ document: { ...document, elements } });
  };

  const changeBackground = (patch: Partial<BoardBackground>) => {
    const document = snapshot().document;
    edit({ document: { ...document, background: { ...(document.background ?? DEFAULT_BACKGROUND), ...patch } } });
  };

  const insertImages = (files: File[], position?: { x: number; y: number }) => {
    if (disabled) return;
    const stage = stageRef.current;
    if (!stage) return;
    setImageError('');
    failedUpload.current = false;
    const scale = stage.scaleX();
    const center = position ?? { x: (stage.width() / 2 - stage.x()) / scale, y: (stage.height() / 2 - stage.y()) / scale };
    const viewport = { width: stage.width(), height: stage.height() };
    files.forEach((file, index) => {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
        failedUpload.current = true;
        setImageError('Выберите PNG, JPEG или WebP размером до 10 МБ.');
        return;
      }
      pendingUploads.current += 1;
      setUploading(pendingUploads.current);
      uploads.current = uploads.current.then(async () => {
        try {
          const asset = await api.uploadImage(file);
          const factor = Math.max(1 / Math.min(asset.width, asset.height), Math.min(10000 / Math.max(asset.width, asset.height),
            Math.min(1, viewport.width * 0.65 / asset.width, viewport.height * 0.65 / asset.height) / scale));
          const image: ImageElement = {
            id: crypto.randomUUID(), kind: 'image', assetId: asset.id,
            x: center.x - asset.width * factor / 2 + index * 24 / scale,
            y: center.y - asset.height * factor / 2 + index * 24 / scale,
            width: asset.width * factor, height: asset.height * factor,
          };
          canvasRef.current?.finish();
          changeElements([...snapshot().document.elements, image]);
          setSelectedImageId(image.id);
          selectTool('select');
        } catch (reason) {
          failedUpload.current = true;
          setImageError(errorMessage(reason));
        } finally {
          pendingUploads.current -= 1;
          setUploading(pendingUploads.current);
        }
      });
    });
  };

  const deleteSelected = () => {
    if (!selectedImageId) return;
    changeElements(snapshot().document.elements.filter((element) => element.id !== selectedImageId));
    setSelectedImageId(null);
  };
  const undo = () => {
    const last = history.undo.at(-1);
    if (!last) return;
    setHistory({ undo: history.undo.slice(0, -1), redo: [...history.redo, board.document.elements] });
    edit({ document: { ...snapshot().document, elements: last } });
  };
  const redo = () => {
    const last = history.redo.at(-1);
    if (!last) return;
    setHistory({ undo: [...history.undo, board.document.elements], redo: history.redo.slice(0, -1) });
    edit({ document: { ...snapshot().document, elements: last } });
  };

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (disabled) return;
      if (event.target instanceof HTMLElement && (['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) || event.target.isContentEditable)) return;
      if (shortcutsReady && panel !== 'shortcut') {
        const matched = tools.find((item) => toolShortcuts[item.id] && shortcutMatches(toolShortcuts[item.id]!, event));
        if (matched) {
          event.preventDefault();
          if (!event.repeat) selectTool(tool === matched.id ? previousTool.current : matched.id);
          return;
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
        event.preventDefault(); redo();
      } else if (tool === 'select' && selectedImageId && ['Delete', 'Backspace'].includes(event.key)) {
        event.preventDefault(); deleteSelected();
      }
    };
    const paste = (event: ClipboardEvent) => {
      if (disabled || (event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable="true"]'))) return;
      const files = Array.from(event.clipboardData?.items ?? []).filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile()).filter((file): file is File => file !== null);
      if (files.length) { event.preventDefault(); insertImages(files); }
    };
    window.addEventListener('keydown', keydown);
    window.addEventListener('paste', paste);
    return () => { window.removeEventListener('keydown', keydown); window.removeEventListener('paste', paste); };
  });

  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (pendingUploads.current) { event.preventDefault(); event.returnValue = ''; }
    };
    window.addEventListener('beforeunload', unload);
    return () => window.removeEventListener('beforeunload', unload);
  }, []);

  const exportPng = async () => {
    const stage = stageRef.current;
    if (!stage) return;
    setExporting(true);
    const transformers = [...stage.find('Transformer'), ...stage.find('.editor-overlay')];
    try {
      await Promise.all(snapshot().document.elements.flatMap((element) => element.kind === 'image' ? [loadImage(element.assetId)] : []));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      if (stage !== stageRef.current) return;
      transformers.forEach((node) => node.hide());
      // Export the visible viewport on white, without the guide background or selection.
      const canvas = document.createElement('canvas');
      canvas.width = stage.width() * 2;
      canvas.height = stage.height() * 2;
      const context = canvas.getContext('2d');
      if (!context) return;
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(stage.toCanvas({ pixelRatio: 2 }), 0, 0);
      const link = document.createElement('a');
      link.download = `${board.title.trim() || 'Доска'}.png`;
      link.href = canvas.toDataURL('image/png');
      link.click();
    } catch (reason) {
      setImageError(errorMessage(reason));
    } finally {
      transformers.forEach((node) => node.show());
      setExporting(false);
    }
  };

  return (
    <section ref={editorRoot} className="editor" inert={disabled}>
      <Canvas elements={board.document.elements} background={background} tool={tool} color={tool === 'highlighter' ? highlighterColor : color} width={tool === 'highlighter' ? highlighterWidth : width} opacity={tool === 'highlighter' ? highlighterOpacity : 1} eraserWidth={eraserWidth} shapeModifier={shapeModifier} stageRef={stageRef} canvasRef={canvasRef} onChange={changeElements}
        selectedImageId={selectedImageId} onSelectImage={setSelectedImageId} onImageFiles={insertImages} />
      <div className="editor-chrome">
        <header className="board-info-panel">
          <button className="editor-icon-button" aria-label={sidebarCollapsed ? 'Показать боковую панель' : 'Свернуть боковую панель'} aria-expanded={!sidebarCollapsed} aria-controls="boards-sidebar" title="Список досок" onClick={onToggleSidebar}>{sidebarCollapsed ? <PanelLeftOpen size={19} /> : <PanelLeftClose size={19} />}</button>
          <div className="board-name-block"><input className="board-title" aria-label="Название доски" maxLength={120} value={board.title} onChange={(event) => edit({ title: event.target.value })} />
            <span className={`save-status save-status--${status}`} role="status"><span className="status-dot" />{saveText}</span></div>
          <span className="editor-divider" />
          <button className="editor-icon-button" aria-label="Отменить" title="Отменить (Ctrl+Z)" disabled={!history.undo.length} onClick={undo}><Undo2 size={18} /></button>
          <button className="editor-icon-button" aria-label="Повторить" title="Повторить (Ctrl+Shift+Z)" disabled={!history.redo.length} onClick={redo}><Redo2 size={18} /></button>
          <div className="editor-popover-anchor" data-editor-panel="board">
            <button className={`editor-icon-button ${panel === 'board' ? 'active' : ''}`} aria-label="Действия доски" aria-expanded={panel === 'board'} aria-controls="board-actions" title="Действия доски" onClick={() => togglePanel('board')}><MoreHorizontal size={19} /></button>
            {panel === 'board' && <section id="board-actions" className="editor-popover board-actions" role="dialog" aria-label="Действия доски">
              <button onClick={() => { setPanel(null); onNewBoard(); }}><Plus size={17} />Новая доска</button>
              <button disabled={exporting || uploading > 0} onClick={() => { setPanel(null); void exportPng(); }}><Download size={17} />Скачать PNG</button>
              <button disabled={!board.document.elements.length} onClick={() => { if (window.confirm('Очистить холст? Это действие можно отменить.')) { changeElements([]); setPanel(null); } }}><Trash2 size={17} />Очистить</button>
              {tool === 'select' && board.document.elements.some((element) => element.id === selectedImageId && element.kind === 'image') && <button onClick={() => { deleteSelected(); setPanel(null); }}><Eraser size={17} />Удалить изображение</button>}
            </section>}
          </div>
        </header>
        <div className="tool-dock" role="toolbar" aria-label="Инструменты рисования">
          <ToolPanelPinControl settings={panelPin} />
          {tools.map((item) => <div key={item.id} className="editor-popover-anchor" data-editor-panel={tool === item.id && activePanel === 'tool' ? 'tool' : undefined}>
            <button title={`${item.label}${toolShortcuts[item.id] ? ` (${shortcutLabel(toolShortcuts[item.id])})` : ''} · Клик — настройки · Правой кнопкой — хоткей`} aria-label={item.label} aria-pressed={tool === item.id} aria-expanded={tool === item.id && activePanel === 'tool'} aria-controls={`tool-settings-${item.id}`} className={`editor-icon-button ${tool === item.id ? 'active' : ''}`} onClick={() => selectTool(item.id, true)} onContextMenu={(event) => {
            event.preventDefault(); setShortcutTool(item.id); setPanel('shortcut');
          }}><item.icon size={19} strokeWidth={1.8} /></button>
            {tool === item.id && activePanel === 'tool' && <ToolSettings tool={tool} label={item.label} color={tool === 'highlighter' ? highlighterColor : color} width={tool === 'highlighter' ? highlighterWidth : width} opacity={highlighterOpacity} eraserWidth={eraserWidth} modifier={shapeModifier}
              selectedImage={board.document.elements.find((element): element is ImageElement => element.kind === 'image' && element.id === selectedImageId) ?? null}
              onColor={tool === 'highlighter' ? setHighlighterColor : setColor} onWidth={tool === 'highlighter' ? setHighlighterWidth : setWidth} onOpacity={setHighlighterOpacity} onEraserWidth={setEraserWidth} onModifier={setModifier}
              onDeleteImage={deleteSelected}
              onZoomIn={() => canvasRef.current?.zoomIn()} onZoomOut={() => canvasRef.current?.zoomOut()} onResetView={() => canvasRef.current?.resetView()} />}
          </div>)}
          <div className="editor-popover-anchor" data-editor-panel="shortcut">
            <button className={`editor-icon-button ${panel === 'shortcut' ? 'active' : ''}`} aria-label="Настроить хоткей инструмента" title="Настроить хоткей выбранного инструмента" aria-expanded={panel === 'shortcut'} aria-controls="tool-shortcut-settings" onClick={() => { setShortcutTool(tool); togglePanel('shortcut'); }}><Keyboard size={19} /></button>
            {panel === 'shortcut' && <ToolShortcutEditor key={shortcutTool} tool={shortcutTool} tools={tools} shortcuts={toolShortcuts} ready={shortcutsReady} loadError={shortcutsError} onTool={setShortcutTool} onReload={onReloadShortcuts} onSave={onSaveShortcuts} />}
          </div>
          <span className="editor-divider" />
          <div className="editor-popover-anchor" data-editor-panel="pen">
            <button className={`editor-icon-button pen-settings-button ${panel === 'pen' ? 'active' : ''}`} aria-label="Цвет и толщина" title="Цвет и толщина" aria-expanded={panel === 'pen'} aria-controls="pen-settings" onClick={() => togglePanel('pen')}><Palette size={19} /><span className="current-color" style={{ backgroundColor: tool === 'highlighter' ? highlighterColor : color }} /></button>
            {panel === 'pen' && <section id="pen-settings" className="editor-popover pen-settings" role="dialog" aria-label="Цвет и толщина">
              <h2>{tool === 'highlighter' ? 'Маркер' : 'Карандаш'}</h2><ColorPalette color={tool === 'highlighter' ? highlighterColor : color} onChange={tool === 'highlighter' ? setHighlighterColor : setColor} />
              <label className="width-control">Толщина<input aria-label={tool === 'highlighter' ? 'Толщина маркера' : 'Толщина карандаша'} type="range" min={tool === 'highlighter' ? 4 : 1} max={tool === 'highlighter' ? 64 : 32} value={tool === 'highlighter' ? highlighterWidth : width} onChange={(event) => { const value = Number(event.target.value); if (tool === 'highlighter') setHighlighterWidth(value); else setWidth(value); }} /><span>{tool === 'highlighter' ? highlighterWidth : width}</span></label>
              {tool === 'highlighter' && <label className="width-control">Непрозрачность<input aria-label="Непрозрачность маркера" type="range" min="10" max="80" value={Math.round(highlighterOpacity * 100)} onChange={(event) => setHighlighterOpacity(Number(event.target.value) / 100)} /><span>{Math.round(highlighterOpacity * 100)}%</span></label>}
              <label className="width-control">Ластик<input aria-label="Размер ластика" type="range" min="8" max="80" value={eraserWidth} onChange={(event) => setEraserWidth(Number(event.target.value))} /><span>{eraserWidth}</span></label>
              <label className="shape-modifier-control">Выравнивание фигур<select aria-label="Хоткей выравнивания фигур" value={shapeModifier} onChange={(event) => {
                setModifier(event.target.value as ShapeModifier);
              }}>{shapeModifiers.map((modifier) => <option key={modifier.value} value={modifier.value}>{modifier.label}</option>)}</select></label>
            </section>}
          </div>
          <button className="editor-icon-button" aria-label="Добавить изображение" title="Добавить изображение (или Ctrl+V)" onClick={() => { setPanel(null); fileInputRef.current?.click(); }}><ImagePlus size={19} /></button>
          <div className="editor-popover-anchor" data-editor-panel="background">
            <button className={`editor-icon-button ${panel === 'background' ? 'active' : ''}`} aria-label="Фон доски" title="Фон доски" aria-expanded={panel === 'background'} aria-controls="background-settings" onClick={() => togglePanel('background')}><Grid2X2 size={19} /></button>
            {panel === 'background' && <section id="background-settings" className="editor-popover background-settings" role="dialog" aria-label="Настройки фона">
              <h2>Фон доски</h2><div className="background-options" role="group" aria-label="Рисунок фона">{backgroundPatterns.map((pattern) => <button key={pattern.id} className={`background-option ${background.pattern === pattern.id ? 'active' : ''}`} aria-pressed={background.pattern === pattern.id} onClick={() => changeBackground({ pattern: pattern.id })}><span className={`background-swatch background-swatch--${pattern.id}`} aria-hidden="true" />{pattern.label}</button>)}</div>
              {background.pattern !== 'plain' && <BackgroundSizeControl background={background} onChange={(size) => changeBackground({ size })} />}
            </section>}
          </div>
        </div>
      </div>
      <input ref={fileInputRef} className="image-file-input" type="file" accept="image/png,image/jpeg,image/webp" multiple aria-label="Загрузить изображения" onChange={(event) => { insertImages(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
      <div className="editor-alerts">
        {panelPin.error && <div className="error-banner" role="alert"><span>{panelPin.error}</span><button disabled={panelPin.saving} onClick={panelPin.reload}>Повторить загрузку настройки</button></div>}
        {(error || draftWarning) && <div className="error-banner" role="alert">
          <span>{error || draftWarning} Рисунок остаётся в этой вкладке{draftWarning ? '.' : ' и в локальной резервной копии.'}</span>
          {error && <><button onClick={() => { void flush().catch(() => {}); }}>Повторить сохранение</button>
            <button onClick={onCopy}>Сохранить как новую доску</button></>}
        </div>}
        {imageError && <div className="error-banner" role="alert"><span>{imageError}</span><button onClick={() => { failedUpload.current = false; setImageError(''); }}>Закрыть</button></div>}
      </div>
      <footer className="editor-footer"><span>{board.document.elements.length} объектов</span>
        <span>{tool === 'select' ? 'Перетаскивайте изображение · Уголки — размер · Delete — удалить' :
          tool === 'eraser' ? 'Ластик — точечно · Shift — весь объект' : tool === 'highlighter' ? 'Маркер — полупрозрачное выделение цветом' : `${shapeModifiers.find((item) => item.value === shapeModifier)!.label} — выровнять фигуру · Ctrl+V — скриншот`}</span></footer>
    </section>
  );
}
