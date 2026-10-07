import type { ToolShortcut } from '@whiteboard/shared';

const codes = /^(?:Key[A-Z]|Digit[0-9]|F(?:[1-9]|1[0-9]|2[0-4])|CapsLock|Space|Arrow(?:Up|Down|Left|Right)|Home|End|PageUp|PageDown|Insert|Delete|Backspace|Backquote|Minus|Equal|BracketLeft|BracketRight|Backslash|Semicolon|Quote|Comma|Period|Slash|Numpad(?:[0-9]|Add|Subtract|Multiply|Divide|Decimal|Enter))$/;
export function shortcutFromEvent(event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): ToolShortcut | null {
  return codes.test(event.code) ? { code: event.code, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey, meta: event.metaKey } : null;
}
export function shortcutMatches(shortcut: ToolShortcut, event: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>) {
  return shortcut.code === event.code && shortcut.ctrl === event.ctrlKey && shortcut.alt === event.altKey && shortcut.shift === event.shiftKey && shortcut.meta === event.metaKey;
}
export function shortcutLabel(shortcut?: ToolShortcut | null) {
  if (!shortcut) return 'Не назначен';
  const labels: Record<string, string> = { Space: 'Пробел', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Backquote: '`', Minus: '−', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/' };
  const key = labels[shortcut.code] ?? shortcut.code.replace(/^(Key|Digit)/, '').replace(/^Numpad/, 'Num ');
  return [shortcut.ctrl && 'Ctrl', shortcut.alt && 'Alt', shortcut.shift && 'Shift', shortcut.meta && 'Meta', key].filter(Boolean).join(' + ');
}
export function shortcutReserved(shortcut: ToolShortcut) {
  return (shortcut.ctrl || shortcut.meta) && ['KeyZ', 'KeyY', 'KeyV'].includes(shortcut.code);
}
