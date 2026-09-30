import { useEffect, useImperativeHandle, useRef, useState } from 'react';
import type Konva from 'konva';
import type { Board, BoardBackground, DrawingElement, ImageElement } from '@whiteboard/shared';
import { Canvas } from './Canvas';
import type { Tool } from './Canvas';
import { useBoard } from './useBoard';
import { api, errorMessage } from './api';
import { loadImage } from './images';
import { backgroundPatterns, DEFAULT_BACKGROUND } from './background';
import { BackgroundSizeControl } from './BackgroundSizeControl';

export interface EditorHandle {
  flush: () => Promise<void>;
  snapshot: () => Board;
}

const tools: { id: Tool; label: string; icon: string }[] = [
  { id: 'select', label: 'Выделение', icon: '↖' },
  { id: 'pen', label: 'Карандаш', icon: '✎' },
  { id: 'eraser', label: 'Ластик', icon: '⌫' },
  { id: 'rectangle', label: 'Прямоугольник', icon: '▭' },
  { id: 'ellipse', label: 'Эллипс', icon: '◯' },
  { id: 'hand', label: 'Рука', icon: '✋' },
];
const colors = ['#202938', '#64748b', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6'];

export function BoardEditor({ initial, onSaved, onCopy, editorRef, disabled }: {
  initial: Board; onSaved: (board: Board) => void; onCopy: () => void;
  editorRef: React.RefObject<EditorHandle | null>;
  disabled: boolean;
}) {
  const { board, edit, flush, status, error, draftWarning, snapshot } = useBoard(initial, onSaved);
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState(colors[0]);
  const [width, setWidth] = useState(4);
  const [history, setHistory] = useState<{ undo: DrawingElement[][]; redo: DrawingElement[][] }>({ undo: [], redo: [] });
  const stageRef = useRef<Konva.Stage | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const uploads = useRef<Promise<void>>(Promise.resolve());
  const pendingUploads = useRef(0);
  const [uploading, setUploading] = useState(0);
  const [imageError, setImageError] = useState('');
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const background = board.document.background ?? DEFAULT_BACKGROUND;
  useImperativeHandle(editorRef, () => ({ flush: async () => {
    while (pendingUploads.current) await uploads.current;
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
    const scale = stage.scaleX();
    const center = position ?? { x: (stage.width() / 2 - stage.x()) / scale, y: (stage.height() / 2 - stage.y()) / scale };
    const viewport = { width: stage.width(), height: stage.height() };
    files.forEach((file, index) => {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) {
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
          changeElements([...snapshot().document.elements, image]);
          setSelectedImageId(image.id);
          setTool('select');
        } catch (reason) {
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
      if (event.target instanceof HTMLElement && (['INPUT', 'TEXTAREA'].includes(event.target.tagName) || event.target.isContentEditable)) return;
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
    const transformers = stage.find('Transformer');
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
    <section className="editor" inert={disabled}>
      <header className="editor-header">
        <input className="board-title" aria-label="Название доски" maxLength={120} value={board.title}
          onChange={(event) => edit({ title: event.target.value })} />
        <span className={`save-status save-status--${status}`} role="status">
          <span className="status-dot" />
          {uploading ? 'Загрузка изображения…' : status === 'saved' ? 'Сохранено' : status === 'saving' ? 'Сохранение…' : status === 'pending' ? 'Есть изменения' : 'Не сохранено'}
        </span>
        <button className="text-button export-button" disabled={exporting || uploading > 0} onClick={() => { void exportPng(); }}>{exporting ? 'Подготовка…' : 'Скачать PNG'}</button>
      </header>
      {(error || draftWarning) && <div className="error-banner" role="alert">
        <span>{error || draftWarning} Рисунок остаётся в этой вкладке{draftWarning ? '.' : ' и в локальной резервной копии.'}</span>
        {error && <><button onClick={() => { void flush().catch(() => {}); }}>Повторить сохранение</button>
          <button onClick={onCopy}>Сохранить как новую доску</button></>}
      </div>}
      {imageError && <div className="error-banner" role="alert"><span>{imageError}</span><button onClick={() => setImageError('')}>Закрыть</button></div>}
      <div className="toolbar" aria-label="Инструменты рисования">
        <div className="tool-group">
          {tools.map((item) => <button key={item.id} title={item.label} aria-label={item.label} aria-pressed={tool === item.id}
            className={`tool-button ${tool === item.id ? 'active' : ''}`} onClick={() => setTool(item.id)}>{item.icon}</button>)}
        </div>
        <button className="text-button image-upload-button" title="Добавить изображение (или Ctrl+V)" onClick={() => fileInputRef.current?.click()}>▧ Изображение</button>
        <input ref={fileInputRef} className="image-file-input" type="file" accept="image/png,image/jpeg,image/webp" multiple aria-label="Загрузить изображения"
          onChange={(event) => { insertImages(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
        <div className="tool-group colors">
          {colors.map((value) => <button key={value} className={`color-button ${color === value ? 'active' : ''}`}
            style={{ backgroundColor: value }} aria-label={`Цвет ${value}`} aria-pressed={color === value} onClick={() => setColor(value)} />)}
          <label className="custom-color" title="Произвольный цвет">+
            <input aria-label="Произвольный цвет" type="color" value={color} onChange={(event) => setColor(event.target.value)} />
          </label>
        </div>
        <label className="width-control">Толщина
          <input aria-label="Толщина карандаша" type="range" min="1" max="32" value={width} onChange={(event) => setWidth(Number(event.target.value))} />
          <span>{width}</span>
        </label>
        <div className="tool-group history-tools">
          <button className="tool-button" aria-label="Отменить" title="Отменить (Ctrl+Z)" disabled={!history.undo.length} onClick={undo}>↶</button>
          <button className="tool-button" aria-label="Повторить" title="Повторить (Ctrl+Shift+Z)" disabled={!history.redo.length} onClick={redo}>↷</button>
          <button className="text-button" disabled={!board.document.elements.length}
            onClick={() => { if (window.confirm('Очистить холст? Это действие можно отменить.')) changeElements([]); }}>Очистить</button>
        </div>
        {tool === 'select' && board.document.elements.some((element) => element.id === selectedImageId && element.kind === 'image') &&
          <button className="text-button" onClick={deleteSelected}>Удалить изображение</button>}
      </div>
      <div className="background-bar" aria-label="Настройки фона">
        <span className="background-label">Фон доски</span>
        <div className="background-options" role="group" aria-label="Рисунок фона">
          {backgroundPatterns.map((pattern) => <button key={pattern.id} className={`background-option ${background.pattern === pattern.id ? 'active' : ''}`}
            aria-pressed={background.pattern === pattern.id} onClick={() => changeBackground({ pattern: pattern.id })}>
            <span className={`background-swatch background-swatch--${pattern.id}`} aria-hidden="true" />{pattern.label}
          </button>)}
        </div>
        {background.pattern !== 'plain' && <BackgroundSizeControl background={background} onChange={(size) => changeBackground({ size })} />}
      </div>
      <Canvas elements={board.document.elements} background={background} tool={tool} color={color} width={width} stageRef={stageRef} onChange={changeElements}
        selectedImageId={selectedImageId} onSelectImage={setSelectedImageId} onImageFiles={insertImages} />
      <footer className="editor-footer"><span>{board.document.elements.length} объектов</span>
        <span>{tool === 'select' ? 'Перетаскивайте изображение · Уголки — размер · Delete — удалить' :
          tool === 'eraser' ? 'Ластик удаляет объекты целиком' : 'Ctrl+V — вставить скриншот'}</span></footer>
    </section>
  );
}
