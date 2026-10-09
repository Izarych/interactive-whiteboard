export interface ToolPanelPinState {
  pinned: boolean;
  ready: boolean;
  saving: boolean;
  error: string;
  setPinned: (pinned: boolean) => Promise<void>;
  reload: () => void;
}

export function ToolPanelPinControl({ settings }: { settings: ToolPanelPinState }) {
  return <div className="tool-panel-pin">
    <label><input type="checkbox" checked={settings.pinned} disabled={!settings.ready || settings.saving} onChange={(event) => { void settings.setPinned(event.target.checked); }} />Всегда показывать настройки</label>
    <small>{settings.saving ? 'Сохраняем…' : 'Для всех ваших досок'}</small>
    {settings.error && <div className="form-error" role="alert">{settings.error}<button className="text-button" disabled={settings.saving} onClick={settings.reload}>Повторить загрузку настройки</button></div>}
  </div>;
}
