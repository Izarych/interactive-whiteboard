import { Flag } from 'lucide-react';

export interface ToolPanelPinState {
  pinned: boolean;
  ready: boolean;
  saving: boolean;
  error: string;
  setPinned: (pinned: boolean) => Promise<void>;
  reload: () => void;
}

export function ToolPanelPinControl({ settings }: { settings: ToolPanelPinState }) {
  return <label className={`editor-icon-button tool-panel-pin ${settings.pinned ? 'active' : ''}`} title={settings.saving ? 'Сохраняем закрепление панели…' : 'Всегда показывать настройки'}>
    <input type="checkbox" aria-label="Всегда показывать настройки" checked={settings.pinned} disabled={!settings.ready || settings.saving} onChange={(event) => { void settings.setPinned(event.target.checked); }} />
    <Flag size={18} strokeWidth={1.8} fill={settings.pinned ? 'currentColor' : 'none'} aria-hidden="true" />
  </label>;
}
