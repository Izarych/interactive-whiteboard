import { useSyncExternalStore } from 'react';
import { errorMessage } from './api';
import { isDesktop } from './platform';

interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
interface PwaState {
  installed: boolean;
  installPrompt: InstallPrompt | null;
  installing: boolean;
  waiting: ServiceWorker | null;
  updating: boolean;
  deferred: boolean;
  error: string;
}
const displayMode = window.matchMedia('(display-mode: standalone)');
let state: PwaState = {
  installed: isDesktop || displayMode.matches || !!(navigator as Navigator & { standalone?: boolean }).standalone,
  installPrompt: null, installing: false, waiting: null, updating: false, deferred: false, error: '',
};
const listeners = new Set<() => void>();
const guards = new Set<() => Promise<void>>();
let started = false;
let reloadRequested = false;
let reloadTimeout: number | undefined;
const workerBuilds = new WeakMap<ServiceWorker, Promise<string | null>>();

function workerBuild(worker: ServiceWorker): Promise<string | null> {
  const known = workerBuilds.get(worker);
  if (known) return known;
  const result = new Promise<string | null>((resolve) => {
    const channel = new MessageChannel();
    const finish = (value: string | null) => { window.clearTimeout(timeout); channel.port1.close(); resolve(value); };
    const timeout = window.setTimeout(() => finish(null), 2000);
    channel.port1.onmessage = (event) => {
      const data = event.data;
      finish(data?.type === 'BUILD_INFO' && typeof data.buildId === 'string' && /^[a-f0-9]{20}$/.test(data.buildId) ? data.buildId : null);
    };
    try { worker.postMessage({ type: 'GET_BUILD_INFO' }, [channel.port2]); } catch { finish(null); }
  });
  workerBuilds.set(worker, result);
  return result;
}

function publish(patch: Partial<PwaState>) {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const usePwa = () => useSyncExternalStore(subscribe, () => state);
export function registerUpdateGuard(guard: () => Promise<void>) {
  guards.add(guard);
  return () => { guards.delete(guard); };
}
export async function prepareToLeave() {
  for (const guard of guards) await guard();
}
export const isPwaUpdating = () => state.updating;
export async function checkPwaUpdate() {
  if (!('serviceWorker' in navigator)) return;
  const registration = await navigator.serviceWorker.getRegistration('/');
  await registration?.update();
}

export function startPwa() {
  if (started) return;
  started = true;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    publish({ installPrompt: event as InstallPrompt });
  });
  window.addEventListener('appinstalled', () => publish({ installed: true, installPrompt: null, installing: false }));
  displayMode.addEventListener('change', () => publish({ installed: isDesktop || displayMode.matches }));
  if (!import.meta.env.PROD || !window.isSecureContext || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadRequested) {
      window.clearTimeout(reloadTimeout);
      window.location.reload();
    } else if (state.waiting?.state === 'activated') {
      publish({ waiting: null, deferred: false });
    }
  });
  void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then((registration) => {
    const report = async () => {
      const worker = registration.waiting;
      if (!worker || !navigator.serviceWorker.controller || worker === state.waiting) return;
      const candidate = await workerBuild(worker);
      if (registration.waiting !== worker || worker.state !== 'installed') return;
      if (candidate === __BLUVIBOARD_BUILD_ID__) {
        // The interface was already fetched from the network. Only the public
        // offline worker needs activation; reloading would interrupt the board.
        publish({ waiting: null, deferred: false, error: '' });
        try { worker.postMessage({ type: 'APPLY_UPDATE' }); } catch { /* A replacement worker may have won the activation race. */ }
      } else publish({ waiting: worker, deferred: false, error: '' });
    };
    const watch = () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => { void report(); });
      void report();
    };
    registration.addEventListener('updatefound', watch);
    watch();
    const check = () => { if (navigator.onLine) void registration.update().catch(() => {}); };
    window.addEventListener('online', check);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
    window.setInterval(check, 60 * 60 * 1000);
  }).catch(() => { /* The website remains usable if service workers are unavailable. */ });
}

export async function installPwa() {
  const prompt = state.installPrompt;
  if (!prompt || state.installing) return;
  publish({ installing: true });
  try {
    await prompt.prompt();
    await prompt.userChoice;
  } finally {
    publish({ installing: false, installPrompt: null });
  }
}

export const deferPwaUpdate = () => publish({ deferred: true, error: '' });
export async function applyPwaUpdate() {
  const worker = state.waiting;
  if (!worker || state.updating) return;
  if (!navigator.onLine) { publish({ error: 'Для обновления восстановите подключение к интернету.' }); return; }
  publish({ updating: true, error: '' });
  try {
    await prepareToLeave();
    // Another window may already have activated the same worker while we saved.
    if (worker.state === 'activated') { window.location.reload(); return; }
    if (worker.state !== 'installed') throw new Error('Версия приложения изменилась. Повторите обновление.');
    reloadRequested = true;
    reloadTimeout = window.setTimeout(() => {
      reloadRequested = false;
      publish({ updating: false, error: 'Не удалось запустить обновление. Попробуйте снова.' });
    }, 15000);
    worker.postMessage({ type: 'APPLY_UPDATE' });
  } catch (reason) {
    reloadRequested = false;
    window.clearTimeout(reloadTimeout);
    publish({ updating: false, error: `Обновление отложено. ${errorMessage(reason)}` });
  }
}
