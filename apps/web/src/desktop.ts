import { useSyncExternalStore } from 'react';
import type { DesktopRelease } from '@whiteboard/shared';
import { api, errorMessage } from './api';
import { checkPwaUpdate, isPwaUpdating, prepareToLeave } from './pwa';
import { desktopVersion, isDesktop } from './platform';
export { isDesktop } from './platform';

declare global {
  interface Window {
    __BLUVIBOARD_PREPARE_CLOSE__?: () => Promise<void>;
  }
}

let state = { closing: false, error: '', checking: false, preparingUpdate: false, updateError: '', updateVisible: false, latest: null as DesktopRelease | null, checked: false };
let checkRequest: Promise<void> | null = null;
let started = false;
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
  if (!isDesktop || state.closing || state.preparingUpdate || isPwaUpdating()) return;
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
  if (!isDesktop || state.closing || state.preparingUpdate || isPwaUpdating() || !window.confirm('Изменения могут быть потеряны. Закрыть BluviBoard всё равно?')) return;
  publish({ closing: true, error: '' });
  try { await closeNative(); }
  catch (reason) { publish({ closing: false, error: errorMessage(reason) }); }
}

export function startDesktop() {
  if (!isDesktop || started) return;
  started = true;
  window.__BLUVIBOARD_PREPARE_CLOSE__ = requestDesktopClose;
  void checkDesktopUpdates();
}

export function newerDesktopVersion(candidate: string, installed = desktopVersion) {
  if (!/^\d+\.\d+\.\d+$/.test(candidate) || !/^\d+\.\d+\.\d+$/.test(installed)) return false;
  const next = candidate.split('.').map(Number), current = installed.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (next[i] !== current[i]) return next[i] > current[i];
  return false;
}

export function checkDesktopUpdates(manual = false): Promise<void> {
  if (!isDesktop) return Promise.resolve();
  if (manual) publish({ updateVisible: true });
  if (checkRequest) return checkRequest;
  publish({ checking: true, updateError: '' });
  checkRequest = (async () => {
    try {
      const latest = await api.desktopRelease();
      publish({ latest, checked: true, updateVisible: manual || state.updateVisible || !!(latest && newerDesktopVersion(latest.version)) });
      // A desktop window also receives safely applied website updates.
      void checkPwaUpdate().catch(() => {});
    } catch (reason) {
      publish({ updateError: errorMessage(reason), updateVisible: manual || state.updateVisible });
    } finally { publish({ checking: false }); checkRequest = null; }
  })();
  return checkRequest;
}

export const dismissDesktopUpdate = () => publish({ updateVisible: false });
export async function downloadDesktopUpdate() {
  const release = state.latest;
  if (!release || !newerDesktopVersion(release.version) || state.closing || state.preparingUpdate || isPwaUpdating()) return;
  publish({ preparingUpdate: true, updateError: '' });
  try {
    await prepareToLeave();
    window.open(release.downloadUrl, '_blank', 'noopener,noreferrer');
  } catch (reason) { publish({ updateError: `Сначала сохраните доску. ${errorMessage(reason)}` }); }
  finally { publish({ preparingUpdate: false }); }
}
