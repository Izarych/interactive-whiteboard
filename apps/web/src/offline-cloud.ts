import { useSyncExternalStore } from 'react';
import type { Board, BoardSummary, ImageAsset, SessionInfo } from '@whiteboard/shared';
import { invoke } from '@tauri-apps/api/core';
import {
  activeLocalBoard, changeRecords, equalContent, localAssets, localBoard, localChanged, localEvents, localProfile,
  localSession, putLocalAsset, recordKey, records,
} from './offline-store';
import type { LocalRecord } from './offline-store';

export class CloudError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
type Response = { status: number; body: unknown; warning?: string | null };
async function response<T>(result: Promise<Response>): Promise<T> {
  let value: Response;
  try { value = await result; }
  catch (error) { throw new CloudError(typeof error === 'string' ? error : error instanceof Error ? error.message : 'Облако недоступно. Локальные доски сохранены.', 0); }
  if (value.warning !== undefined) publish({ warning: value.warning ?? '' });
  if (value.status >= 400) throw new CloudError((value.body as { message?: string })?.message ?? 'Не удалось синхронизировать доски', value.status);
  return value.body as T;
}
export const cloudRequest = <T,>(path: string, method = 'GET', body?: unknown) =>
  response<T>(invoke('desktop_cloud_request', { path, method, body: body ?? null }));
const listeners = new Set<() => void>();
let state = { syncing: false, error: '', warning: '', conflicts: 0, pending: 0, incoming: 0, lastSync: '' };
const publish = (patch: Partial<typeof state>) => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
export const useOfflineCloud = () => useSyncExternalStore(fn => { listeners.add(fn); return () => { listeners.delete(fn); }; }, () => state);
let running: Promise<void> | null = null;
let timer: number | undefined;
let failures = 0;
let started = false;
let epoch = 0;

export async function imageBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Не удалось прочитать изображение'));
    reader.readAsDataURL(blob);
  });
}
export function imageBlob(data: string, mime: string) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime) || data.length > 15_000_000) throw new Error('Неверное облачное изображение');
  const raw = atob(data), bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}
async function download(remote: Board, profile: string): Promise<Board> {
  const assets = await localAssets(profile);
  const mapping = new Map<string, string>();
  for (const element of remote.document.elements) {
    if (element.kind !== 'image' || mapping.has(element.assetId)) continue;
    let asset = assets.find(item => item.remoteId === element.assetId);
    if (!asset) {
      const file = await cloudRequest<{ data: string; mime: string }>(`/assets/${element.assetId}`);
      const blob = imageBlob(file.data, file.mime);
      const bitmap = await createImageBitmap(blob);
      const id = crypto.randomUUID();
      asset = { key: recordKey(profile, id), profile, id, blob, width: bitmap.width, height: bitmap.height, remoteId: element.assetId };
      bitmap.close();
      await putLocalAsset(asset);
      assets.push(asset);
    }
    mapping.set(element.assetId, asset.id);
  }
  return { ...remote, document: { ...remote.document, elements: remote.document.elements.map(element => element.kind === 'image' ? { ...element, assetId: mapping.get(element.assetId)! } : element) } };
}
async function upload(snapshot: Board, profile: string): Promise<Board['document']> {
  const assets = await localAssets(profile);
  const mapping = new Map<string, string>();
  for (const element of snapshot.document.elements) {
    if (element.kind !== 'image' || mapping.has(element.assetId)) continue;
    const asset = assets.find(item => item.id === element.assetId);
    if (!asset) throw new Error('Локальное изображение не найдено. Облачная доска не изменена.');
    if (!asset.remoteId) {
      const remote = await response<ImageAsset>(invoke('desktop_cloud_upload', { data: await imageBase64(asset.blob), mime: asset.blob.type }));
      asset.remoteId = remote.id;
      await putLocalAsset(asset);
    }
    mapping.set(asset.id, asset.remoteId);
  }
  return { ...snapshot.document, elements: snapshot.document.elements.map(element => element.kind === 'image' ? { ...element, assetId: mapping.get(element.assetId)! } : element) };
}
function insertRemote(rows: LocalRecord[], store: IDBObjectStore, profile: string, remote: Board) {
  if (rows.some(row => row.cloudId === remote.id)) return;
  const id = crypto.randomUUID();
  store.add({ key: recordKey(profile, id), profile, board: localBoard(remote, id, 0), base: remote, cloudId: remote.id } satisfies LocalRecord);
}
function fork(row: LocalRecord) {
  row.cloudId = crypto.randomUUID();
  delete row.base; delete row.pending; delete row.incoming;
  row.conflict = 'Оффлайн-копия: конфликт с сайтом';
  publish({ conflicts: state.conflicts + 1 });
}
async function receive(profile: string, id: string, remote: Board) {
  await changeRecords(profile, (rows, store) => {
    const row = rows.find(item => item.board.id === id);
    if (!row) return;
    if (row.pending) return; // Retry the durable operation before interpreting remote revisions.
    if (row.base && !equalContent(row.board, row.base)) {
      fork(row); store.put(row);
      insertRemote(rows, store, profile, remote);
    } else if (activeLocalBoard() === id && !row.deleted) {
      row.incoming = remote; store.put(row);
    } else {
      row.board = localBoard(remote, id, row.board.revision + 1);
      row.base = remote;
      row.deleted = false;
      delete row.incoming;
      store.put(row);
    }
  });
}
async function pendingSave(profile: string, row: LocalRecord) {
  const pending = row.pending!;
  try {
    const remote = await download(await cloudRequest<Board>(`/desktop/boards/${row.cloudId}`, 'PUT', { ...pending.body, operationId: pending.operationId }), profile);
    await changeRecords(profile, (rows, store) => {
      const current = rows.find(item => item.board.id === row.board.id);
      if (!current || current.pending?.operationId !== pending.operationId) return;
      delete current.pending;
      if (!equalContent(remote, pending.source)) {
        if (!equalContent(current.board, pending.source) || current.deleted) {
          fork(current); store.put(current);
          insertRemote(rows, store, profile, remote);
        } else {
          // The operation committed earlier, but another client has since edited it.
          current.base = { ...pending.source, id: remote.id, revision: remote.revision };
          current.incoming = remote;
          store.put(current);
        }
      } else {
        current.base = remote; store.put(current);
      }
    });
  } catch (error) {
    if (!(error instanceof CloudError) || ![404, 409].includes(error.status)) throw error;
    let remote: Board | undefined;
    try { remote = await download(await cloudRequest<Board>(`/boards/${row.cloudId}`), profile); }
    catch (reason) { if (!(reason instanceof CloudError) || reason.status !== 404) throw reason; }
    await changeRecords(profile, (rows, store) => {
      const current = rows.find(item => item.board.id === row.board.id);
      if (!current || current.pending?.operationId !== pending.operationId) return;
      fork(current); store.put(current);
      if (remote) insertRemote(rows, store, profile, remote);
    });
  }
}
async function synchronize() {
  const session = await localSession();
  if (session.kind !== 'user') { publish({ pending: (await records()).filter(row => !row.deleted).length }); return; }
  const profile = localProfile(), generation = epoch;
  const current = await cloudRequest<SessionInfo>('/auth/session');
  if (current.kind !== 'user' || current.workspaceId !== session.workspaceId) throw new CloudError('Войдите в тот же аккаунт для синхронизации. Локальные доски сохранены.', 401);
  try {
    const capabilities = await cloudRequest<{ protocol: number }>('/desktop/sync-capabilities');
    if (capabilities.protocol !== 1) throw new Error('Версия протокола синхронизации не поддерживается');
  } catch (error) {
    if (error instanceof CloudError && error.status === 404) throw new Error('Для синхронизации нужно обновление серверной части BluviBoard. Локальные доски сохранены.');
    throw error;
  }
  const check = () => { if (generation !== epoch || localProfile() !== profile) throw new Error('Синхронизация остановлена: аккаунт изменился'); };
  // Recover committed writes whose acknowledgements were lost, including process termination.
  for (const row of await records(profile)) {
    check();
    if (row.pending) await pendingSave(profile, row);
  }
  check();
  const list = await cloudRequest<BoardSummary[]>('/boards');
  const cloud = new Map(list.map(board => [board.id, board]));
  for (const row of await records(profile)) {
    check();
    if (row.pending) continue;
    if (row.deleted) {
      if (row.base) {
        try {
          await cloudRequest(`/desktop/boards/${row.cloudId}`, 'DELETE', { revision: row.base.revision });
          await changeRecords(profile, (rows, store) => {
            const current = rows.find(item => item.key === row.key);
            if (current?.deleted) { delete current.base; store.put(current); }
          });
        } catch (error) {
          if (!(error instanceof CloudError) || error.status !== 409) throw error;
          await receive(profile, row.board.id, await download(await cloudRequest<Board>(`/boards/${row.cloudId}`), profile));
          publish({ warning: 'Доска изменилась на сайте и не была удалена. Облачная версия сохранена.' });
        }
      }
      continue;
    }
    const summary = cloud.get(row.cloudId);
    if (row.base && !summary) {
      await changeRecords(profile, (rows, store) => {
        const current = rows.find(item => item.key === row.key);
        if (!current || current.pending) return;
        if (current.base && !equalContent(current.board, current.base)) fork(current);
        else if (activeLocalBoard() === current.board.id) {
          current.conflict = 'Удалена на сайте. При изменении будет сохранена отдельная копия.';
        } else current.deleted = true;
        store.put(current);
      });
      continue;
    }
    if (row.base && (summary?.revision !== row.base.revision || row.incoming)) {
      const remote = row.incoming ?? await download(await cloudRequest<Board>(`/boards/${row.cloudId}`), profile);
      await receive(profile, row.board.id, remote);
      continue;
    }
    if (row.base && equalContent(row.board, row.base)) continue;
    if (row.base?.collaborative) {
      await receive(profile, row.board.id, await download(await cloudRequest<Board>(`/boards/${row.cloudId}`), profile));
      continue;
    }
    const document = await upload(row.board, profile);
    check();
    const staged = await changeRecords(profile, (rows, store) => {
      const current = rows.find(item => item.key === row.key);
      if (!current || current.deleted || current.pending || current.board.revision !== row.board.revision) return undefined;
      current.pending = { operationId: crypto.randomUUID(), source: current.board, body: { title: current.board.title, document, revision: current.base?.revision ?? 0 } };
      store.put(current);
      return current;
    });
    if (staged) await pendingSave(profile, staged);
  }
  for (const summary of list) {
    check();
    if ((await records(profile)).some(row => row.cloudId === summary.id)) continue;
    const remote = await download(await cloudRequest<Board>(`/boards/${summary.id}`), profile);
    check();
    await changeRecords(profile, (rows, store) => insertRemote(rows, store, profile, remote));
  }
  check();
  const remaining = await records(profile);
  publish({ pending: remaining.filter(row => row.pending || (!row.deleted && (!row.base || !equalContent(row.board, row.base))) || (row.deleted && row.base)).length,
    incoming: remaining.filter(row => row.incoming).length, lastSync: new Date().toISOString() });
  localChanged();
}
function schedule(delay: number) {
  window.clearTimeout(timer);
  timer = window.setTimeout(() => { void syncOfflineCloud(); }, delay);
}
export function syncOfflineCloud() {
  if (running) return running;
  publish({ syncing: true, error: '' });
  running = synchronize().then(() => { failures = 0; }).catch(error => {
    failures += 1;
    publish({ error: error instanceof Error ? error.message : 'Облако недоступно. Доски остаются на компьютере.' });
  }).finally(() => {
    running = null;
    publish({ syncing: false });
    if (started) schedule(Math.min(300000, failures ? 10000 * 2 ** Math.min(failures - 1, 5) : state.pending ? 2000 : 30000));
  });
  return running;
}
export async function pauseOfflineCloud() {
  epoch += 1;
  started = false;
  window.clearTimeout(timer);
  await running;
}
export function startOfflineCloud() {
  if (started) return;
  started = true;
  publish({ error: '', incoming: 0, pending: 0, conflicts: 0, lastSync: '' });
  localEvents.addEventListener('change', () => { if (started && !running) schedule(2000); });
  window.addEventListener('online', () => { if (started) schedule(1000); });
  void syncOfflineCloud();
}
