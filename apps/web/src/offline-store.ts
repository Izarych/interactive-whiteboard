import type { ActiveSession, Board, BoardSummary, ImageAsset, SessionInfo, ToolShortcuts, UpdateBoard } from '@whiteboard/shared';
import { difference } from '@whiteboard/shared/board-operations';

export class OfflineError extends Error {
  constructor(message: string, readonly status = 507) { super(message); }
}
export interface LocalAsset {
  key: string; profile: string; id: string; blob: Blob; width: number; height: number; remoteId?: string;
}
export interface LocalRecord {
  key: string; profile: string; board: Board; cloudId: string; base?: Board; incoming?: Board; deleted?: boolean; conflict?: string;
  pending?: { operationId: string; source: Board; body: UpdateBoard };
}
let connection: Promise<IDBDatabase> | undefined;
let account: ActiveSession | null = null;
let initialized = false;
let activeBoard: string | null = null;
type Summary = BoardSummary & { localSyncLabel?: string };
const summaries = new Map<string, Summary[]>();
function summary(row: LocalRecord): Summary {
  const { document, collaborative, ...board } = row.board;
  return { ...board, localSyncLabel: row.conflict };
}
function cacheRecord(profile: string, row?: LocalRecord) {
  const cached = summaries.get(profile);
  if (!cached || !row) return;
  const next = cached.filter(board => board.id !== row.board.id);
  if (!row.deleted) next.push(summary(row));
  summaries.set(profile, next);
}
export const localEvents = new EventTarget();
export const recordKey = (profile: string, id: string) => `${profile}/${id}`;
export const localProfile = () => account?.kind === 'user' ? `account:${account.workspaceId}` : 'device';
export const activeLocalBoard = () => activeBoard;
export const selectLocalBoard = (id: string | null) => { activeBoard = id; };
export function localChanged() { localEvents.dispatchEvent(new Event('change')); }

function database() {
  if (connection) return connection;
  connection = new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('bluviboard-desktop', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of ['boards', 'assets']) {
        const store = db.createObjectStore(name, { keyPath: 'key' });
        store.createIndex('profile', 'profile');
      }
      db.createObjectStore('meta', { keyPath: 'key' });
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); connection = undefined; };
      resolve(request.result);
    };
    request.onerror = () => { connection = undefined; reject(new OfflineError('Не удалось открыть локальное хранилище. Не удаляйте данные приложения.')); };
    request.onblocked = () => { reject(new OfflineError('Закройте другие окна BluviBoard и повторите открытие хранилища.')); };
  });
  return connection;
}
async function transact<T>(names: string[], mode: IDBTransactionMode, run: (tx: IDBTransaction, result: (value: T) => void) => void): Promise<T> {
  const db = await database();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(names, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined);
    let value: T;
    let failure: unknown;
    tx.oncomplete = () => resolve(value);
    tx.onerror = tx.onabort = () => reject(failure ?? new OfflineError('Не удалось записать доску на диск. Освободите место и повторите сохранение.'));
    try { run(tx, result => { value = result; }); } catch (error) { failure = error; tx.abort(); }
  });
}
function getMeta<T>(key: string): Promise<T | undefined> {
  return transact(['meta'], 'readonly', (tx, result) => {
    const req = tx.objectStore('meta').get(key);
    req.onsuccess = () => result(req.result?.value as T | undefined);
  });
}
function putMeta(key: string, value: unknown) {
  return transact<void>(['meta'], 'readwrite', tx => { tx.objectStore('meta').put({ key, value }); });
}
export async function localSession(): Promise<ActiveSession> {
  if (!initialized) {
    account = await getMeta<ActiveSession>('account') ?? null;
    initialized = true;
    void navigator.storage?.persist?.().catch(() => {});
  }
  if (account?.kind === 'user') return account;
  let id = await getMeta<string>('deviceId');
  if (!id) { id = crypto.randomUUID(); await putMeta('deviceId', id); }
  return { kind: 'guest', workspaceId: id, user: null };
}
export async function setLocalAccount(session: SessionInfo) {
  if (session.kind !== 'user' && session.kind !== 'anonymous') throw new OfflineError('Для синхронизации нужен аккаунт', 400);
  const next = session.kind === 'user' ? session : null;
  await putMeta('account', next);
  account = next;
  initialized = true;
  activeBoard = null;
  localChanged();
}
export function equalContent(a: Board, b: Board) {
  const change = difference(a, b);
  return !change.title && !change.background && !change.elements.length;
}
export function records(profile = localProfile()): Promise<LocalRecord[]> {
  return transact(['boards'], 'readonly', (tx, result) => {
    const req = tx.objectStore('boards').index('profile').getAll(profile);
    req.onsuccess = () => result(req.result);
  });
}
export function changeRecords<T>(profile: string, update: (rows: LocalRecord[], store: IDBObjectStore) => T): Promise<T> {
  let failure: unknown;
  return transact<T>(['boards'], 'readwrite', (tx, result) => {
    const store = tx.objectStore('boards');
    const req = store.index('profile').getAll(profile);
    req.onsuccess = () => {
      try { result(update(req.result, store)); }
      catch (error) { failure = error; tx.abort(); }
    };
  }).then(value => { summaries.delete(profile); return value; }).catch(error => { summaries.delete(profile); throw failure ?? error; });
}
async function changeRecord<T>(profile: string, id: string, update: (row: LocalRecord | undefined, store: IDBObjectStore) => T): Promise<T> {
  let failure: unknown, row: LocalRecord | undefined;
  const value = await transact<T>(['boards'], 'readwrite', (tx, result) => {
    const store = tx.objectStore('boards'), request = store.get(recordKey(profile, id));
    request.onsuccess = () => {
      try { row = request.result; result(update(row, store)); }
      catch (error) { failure = error; tx.abort(); }
    };
  }).catch(error => { throw failure ?? error; });
  cacheRecord(profile, row);
  return value;
}
export const localBoard = (remote: Board, id: string, revision: number): Board => ({ ...remote, id, revision, collaborative: false });
export async function getLocalBoard(id: string) {
  activeBoard = id; // A background download may not replace a board being opened.
  const profile = localProfile();
  const board = await changeRecord(profile, id, (row, store) => {
    if (!row || row.deleted) return undefined;
    if (row.incoming && row.base && equalContent(row.board, row.base) && !row.pending) {
      row.base = row.incoming;
      row.board = localBoard(row.incoming, id, row.board.revision + 1);
      delete row.incoming;
      store.put(row);
    }
    return row.board;
  });
  if (!board) throw new OfflineError('Локальная доска не найдена', 404);
  return board;
}
export async function createLocalBoard(title: string, document: Board['document'] = { version: 1, elements: [] }, assets: LocalAsset[] = []): Promise<Board> {
  if (typeof title !== 'string') throw new OfflineError('Неверное название доски', 400);
  const id = crypto.randomUUID(), time = new Date().toISOString(), profile = localProfile();
  const board: Board = { id, title: title.trim().slice(0, 120) || 'Новая доска', document, revision: 0, createdAt: time, updatedAt: time, collaborative: false };
  if (assets.some(asset => asset.profile !== profile)) throw new OfflineError('Аккаунт изменился. Повторите импорт.', 409);
  const row: LocalRecord = { key: recordKey(profile, id), profile, board, cloudId: crypto.randomUUID() };
  await transact<void>(['boards', 'assets'], 'readwrite', tx => {
    for (const asset of assets) tx.objectStore('assets').add(asset);
    tx.objectStore('boards').add(row);
  });
  cacheRecord(profile, row);
  localChanged();
  return board;
}
export async function saveLocalBoard(id: string, body: UpdateBoard) {
  const profile = localProfile();
  let conflict = false;
  const saved = await changeRecord(profile, id, (row, store) => {
    if (!row || row.deleted) return undefined;
    if (row.board.revision !== body.revision) { conflict = true; return undefined; }
    const board = { ...row.board, title: body.title.trim().slice(0, 120) || 'Без названия', document: body.document, revision: body.revision + 1, updatedAt: new Date().toISOString() };
    row.board = board;
    store.put(row);
    return board;
  });
  if (!saved) throw new OfflineError(conflict ? 'Локальная доска изменилась в другом окне. Сохраните отдельную копию.' : 'Доска не найдена', conflict ? 409 : 404);
  localChanged();
  return saved;
}
export async function deleteLocalBoard(id: string) {
  await changeRecord(localProfile(), id, (row, store) => {
    if (row) { row.deleted = true; store.put(row); }
  });
  if (activeBoard === id) activeBoard = null;
  localChanged();
}
export async function localAssets(profile = localProfile()): Promise<LocalAsset[]> {
  return transact(['assets'], 'readonly', (tx, result) => {
    const req = tx.objectStore('assets').index('profile').getAll(profile);
    req.onsuccess = () => result(req.result);
  });
}
export async function putLocalAsset(asset: LocalAsset) {
  await transact<void>(['assets'], 'readwrite', tx => { tx.objectStore('assets').put(asset); });
}
export async function localImage(id: string): Promise<Blob> {
  const blob = await transact<Blob | undefined>(['assets'], 'readonly', (tx, result) => {
    const req = tx.objectStore('assets').get(recordKey(localProfile(), id));
    req.onsuccess = () => result(req.result?.blob);
  });
  if (!blob) throw new OfflineError('Изображение отсутствует в локальном хранилище', 404);
  return blob;
}
export async function storeLocalImage(file: File): Promise<ImageAsset> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) throw new OfflineError('Выберите PNG, JPEG или WebP размером до 10 МБ.', 400);
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  bitmap.close();
  if (!width || !height || width * height > 40_000_000) throw new OfflineError('Слишком большое изображение', 400);
  const id = crypto.randomUUID(), profile = localProfile();
  await putLocalAsset({ key: recordKey(profile, id), profile, id, blob: file, width, height });
  return { id, width, height, url: `local:${id}` };
}
export async function adoptDeviceBoards() {
  const profile = localProfile();
  if (profile === 'device') return;
  await transact<void>(['boards', 'assets'], 'readwrite', tx => {
    for (const name of ['boards', 'assets']) {
      const store = tx.objectStore(name), request = store.index('profile').getAll('device');
      request.onsuccess = () => {
        for (const row of request.result) {
          const id = name === 'boards' ? row.board.id : row.id;
          // IDs are generated locally; add() refuses to overwrite any existing data.
          store.add({ ...row, profile, key: recordKey(profile, id) });
          store.delete(row.key);
        }
      };
    }
  });
  summaries.delete('device'); summaries.delete(profile);
  localChanged();
}
export async function localRequest<T>(path: string, options?: RequestInit): Promise<T> {
  await localSession();
  const method = options?.method ?? 'GET';
  const body = typeof options?.body === 'string' ? JSON.parse(options.body) : {};
  if (path === '/auth/session') return await localSession() as T;
  if (path === '/boards' && method === 'GET') {
    const profile = localProfile();
    let list = summaries.get(profile);
    if (!list) {
      list = (await records(profile)).filter(row => !row.deleted).map(summary);
      summaries.set(profile, list);
    }
    return [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) as T;
  }
  if (path === '/boards' && method === 'POST') return await createLocalBoard(body.title) as T;
  const match = path.match(/^\/boards\/([0-9a-f-]{36})$/i);
  if (match) {
    if (method === 'GET') return await getLocalBoard(match[1]) as T;
    if (method === 'PUT') return await saveLocalBoard(match[1], body) as T;
    if (method === 'DELETE') { await deleteLocalBoard(match[1]); return undefined as T; }
  }
  if (path === '/preferences/tools' || path === '/preferences/tools/panel') {
    const key = `${localProfile()}:${path}`;
    if (method === 'PUT') await putMeta(key, body);
    return (await getMeta(key) ?? (path.endsWith('/panel') ? { pinned: false } : { shortcuts: {} as ToolShortcuts })) as T;
  }
  throw new OfflineError('Это действие доступно в онлайн-версии', 400);
}
