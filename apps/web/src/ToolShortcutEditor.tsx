import { useEffect, useState } from 'react';
import type { DrawingTool, ToolShortcut, ToolShortcuts } from '@whiteboard/shared';
import { errorMessage } from './api';
import { shortcutFromEvent, shortcutLabel, shortcutMatches, shortcutReserved } from './tool-shortcuts';

export function ToolShortcutEditor({ tool, tools, shortcuts, ready, loadError, onTool, onReload, onSave }: {
  tool: DrawingTool; tools: { id: DrawingTool; label: string }[]; shortcuts: ToolShortcuts; ready: boolean; loadError: string;
  onTool: (tool: DrawingTool) => void; onReload: () => void; onSave: (shortcuts: ToolShortcuts) => Promise<void>;
}) {
  const [candidate, setCandidate] = useState<ToolShortcut | null>(shortcuts[tool] ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { setCandidate(shortcuts[tool] ?? null); }, [tool, shortcuts]);
  const label = tools.find((item) => item.id === tool)!.label;
  const save = async (value: ToolShortcut | null) => {
    setBusy(true); setError(''); setNotice('');
    const next = { ...shortcuts };
    if (value) next[tool] = value; else delete next[tool];
    try { await onSave(next); setCandidate(value); setNotice(value ? 'Хоткей сохранён для всех ваших досок' : 'Хоткей убран'); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };
  return <section id="tool-shortcut-settings" className="editor-popover tool-shortcut-settings" role="dialog" aria-label="Хоткей инструмента">
    <h2>Хоткей инструмента</h2>
    <label className="form-label">Инструмент<select aria-label="Инструмент для хоткея" value={tool} disabled={busy} onChange={(event) => onTool(event.target.value as DrawingTool)}>
      {tools.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
    </select></label>
    {loadError && <div className="form-error" role="alert">{loadError}<button onClick={onReload}>Повторить загрузку</button></div>}
    {!ready && !loadError && <p className="drawing-settings-note">Загружаем ваши настройки…</p>}
    <fieldset disabled={!ready || busy} className="shortcut-fields">
      <label className="form-label">Клавиша или сочетание<input aria-label={`Хоткей: ${label}`} readOnly value={shortcutLabel(candidate)} autoFocus placeholder="Нажмите клавишу или сочетание" onKeyDown={(event) => {
        if (event.key === 'Tab') return;
        event.preventDefault(); event.stopPropagation();
        if (event.repeat) return;
        if (event.key === 'Escape') { setCandidate(shortcuts[tool] ?? null); setError(''); return; }
        const value = shortcutFromEvent(event.nativeEvent);
        if (!value) return;
        setNotice('');
        if (shortcutReserved(value)) { setError('Сочетания отмены, повтора и вставки уже используются доской'); return; }
        const other = tools.find((item) => item.id !== tool && shortcuts[item.id] && shortcutMatches(shortcuts[item.id]!, event.nativeEvent));
        if (other) { setError(`Этот хоткей уже назначен: ${other.label}`); return; }
        setError(''); setCandidate(value);
      }} /></label>
      <p className="drawing-settings-note">Нажмите нужные кнопки в поле выше. Повторное нажатие хоткея возвращает предыдущий инструмент. Esc отменяет ввод.</p>
      <div className="shortcut-actions"><button className="primary-button" disabled={!candidate || !!error} onClick={() => { void save(candidate); }}>Сохранить хоткей</button>
        <button className="text-button" disabled={!shortcuts[tool]} onClick={() => { void save(null); }}>Убрать хоткей</button></div>
    </fieldset>
    {error && <div className="form-error" role="alert">{error}</div>}{notice && <div className="form-notice" role="status">{notice}</div>}
  </section>;
}
