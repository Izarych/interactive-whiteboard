import { useSyncExternalStore } from 'react';
import { desktopVersion, isDesktop } from './platform';

export interface ReleaseNotes { kind: 'web' | 'desktop'; version: string; title: string; notes: string }
const releases = __BLUVIBOARD_RELEASES__;
export const appVersion = releases.web.version;
const webKey = 'bluviboard:release-seen';
const desktopKey = 'bluviboard:desktop-release-seen';
const pendingKey = 'bluviboard:release-after-update';
const validVersion = (version: string | null): version is string => !!version && /^\d+\.\d+\.\d+$/.test(version);
function newer(candidate: string, previous: string) {
  const a = candidate.split('.').map(Number), b = previous.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
function read(key: string) {
  let local: string | null = null, session: string | null = null;
  try { local = localStorage.getItem(key); } catch { /* Storage may be blocked. */ }
  try { session = sessionStorage.getItem(key); } catch { /* Storage may be blocked. */ }
  if (validVersion(session) && (!validVersion(local) || newer(session, local))) return session;
  return local ?? session;
}
function remember(key: string, version: string) {
  const previous = read(key);
  // An older cached tab must not reset the acknowledgement of a newer version.
  if (validVersion(previous) && newer(previous, version)) return;
  try { localStorage.setItem(key, version); }
  catch { try { sessionStorage.setItem(key, version); } catch { /* Reading notes remains usable without storage. */ } }
}
export function markReleaseUpdate() {
  try { sessionStorage.setItem(pendingKey, String(Date.now())); } catch { /* Version comparison still handles a newer release. */ }
}
export function cancelReleaseUpdate() {
  try { sessionStorage.removeItem(pendingKey); } catch { /* Browser storage may be unavailable. */ }
}
function pendingUpdate() {
  try {
    const value = sessionStorage.getItem(pendingKey);
    sessionStorage.removeItem(pendingKey);
    const timestamp = Number(value);
    return value !== null && Number.isFinite(timestamp) && timestamp <= Date.now() && Date.now() - timestamp < 10 * 60 * 1000;
  } catch { return false; }
}
function desktopNotes(): ReleaseNotes {
  return releases.desktop[desktopVersion] ?? { kind: 'desktop', version: desktopVersion, title: `BluviBoard для Windows ${desktopVersion}`, notes: 'Описание этой версии доступно на странице релиза Windows-клиента.' };
}
function startup() {
  const entries: ReleaseNotes[] = [];
  const previous = read(webKey);
  const requested = pendingUpdate();
  const reopening = isDesktop || window.matchMedia('(display-mode: standalone)').matches || !!(navigator as Navigator & { standalone?: boolean }).standalone ||
    (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type === 'reload';
  const awaitingSession = !requested && !validVersion(previous) && !reopening;
  if (requested || (validVersion(previous) ? newer(appVersion, previous) : reopening)) entries.push(releases.web);
  if (isDesktop) {
    const installed = read(desktopKey);
    if (validVersion(installed) && newer(desktopVersion, installed)) entries.push(desktopNotes());
    else if (!validVersion(installed)) remember(desktopKey, desktopVersion);
  }
  return { open: entries.length > 0, entries, automatic: true, awaitingSession };
}
let state = startup();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
function publish(next: typeof state) { state = next; listeners.forEach((listener) => listener()); }
export const useReleaseNotes = () => useSyncExternalStore(subscribe, () => state);
export function initializeReleaseSession(active: boolean) {
  if (!state.awaitingSession) return;
  const previous = read(webKey);
  if (validVersion(previous) ? newer(appVersion, previous) : active) publish({ open: true, entries: [releases.web], automatic: true, awaitingSession: false });
  else { remember(webKey, appVersion); publish({ ...state, awaitingSession: false }); }
}
export function openReleaseNotes() {
  publish({ open: true, entries: [releases.web, ...(isDesktop ? [desktopNotes()] : [])], automatic: false, awaitingSession: false });
}
export function closeReleaseNotes() {
  for (const entry of state.entries) remember(entry.kind === 'web' ? webKey : desktopKey, entry.version);
  publish({ ...state, open: false });
}
window.addEventListener('storage', (event) => {
  if (!state.open || !state.automatic || ![webKey, desktopKey].includes(event.key ?? '')) return;
  const entries = state.entries.filter((entry) => {
    const seen = read(entry.kind === 'web' ? webKey : desktopKey);
    return !validVersion(seen) || newer(entry.version, seen);
  });
  if (entries.length !== state.entries.length) publish({ ...state, entries, open: entries.length > 0 });
});
