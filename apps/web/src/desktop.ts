import { useSyncExternalStore } from 'react';
import { errorMessage } from './api';
import { isPwaUpdating, prepareToLeave } from './pwa';
import { isDesktop } from './platform';
export { isDesktop } from './platform';

declare global {
  interface Window {
    __BLUVIBOARD_PREPARE_CLOSE__?: () => Promise<void>;
  }
}

let state = { closing: false, error: '' };
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function publish(patch: Partial<typeof state>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}
export const useDesktop = () => useSyncExternalStore(subscribe, () => state);

async function closeNative() {
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('desktop_close');
}

export async function requestDesktopClose() {
  if (!isDesktop || state.closing || isPwaUpdating()) return;
  publish({ closing: true, error: '' });
  try {
    await prepareToLeave();
    await closeNative();
  } catch (reason) {
    publish({ closing: false, error: errorMessage(reason) });
  }
}

export const cancelDesktopClose = () => publish({ error: '' });
export async function discardAndClose() {
  if (!isDesktop || state.closing || isPwaUpdating() || !window.confirm('Изменения могут быть потеряны. Закрыть BluviBoard всё равно?')) return;
  publish({ closing: true, error: '' });
  try { await closeNative(); }
  catch (reason) { publish({ closing: false, error: errorMessage(reason) }); }
}

export function startDesktop() {
  if (isDesktop) window.__BLUVIBOARD_PREPARE_CLOSE__ = requestDesktopClose;
}
