import { test, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { emailCode, cleanupMail } from './mailhog-utils.cjs';
import { cleanupWorkspaces } from './asset-test-utils.cjs';

const password = 'Offline-desktop-test-123';
async function offline(context: BrowserContext, bridge = false) {
  await context.addInitScript(({ bridge }) => {
    const target = window as Window & {
      nativeCloses: number;
      __TAURI_INTERNALS__: { invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown> };
    };
    Object.defineProperty(window, '__BLUVIBOARD_DESKTOP__', { value: true });
    Object.defineProperty(window, '__BLUVIBOARD_DESKTOP_VERSION__', { value: '0.2.0' });
    Object.defineProperty(window, '__BLUVIBOARD_OFFLINE__', { value: true });
    Object.defineProperty(navigator, 'onLine', { get: () => false });
    target.nativeCloses = 0;
    target.__TAURI_INTERNALS__ = { invoke: async (command, args = {}) => {
      if (command === 'desktop_close') { target.nativeCloses += 1; return; }
      if (!bridge || localStorage.getItem('test:cloud-down')) throw new Error('Test cloud unavailable');
      let response: Response;
      if (command === 'desktop_cloud_upload') {
        const bytes = Uint8Array.from(atob(String(args.data)), value => value.charCodeAt(0));
        const form = new FormData();
        form.append('file', new Blob([bytes], { type: String(args.mime) }), 'image.png');
        response = await fetch('/api/assets', { method: 'POST', body: form });
      } else if (command === 'desktop_cloud_request') {
        const method = String(args.method);
        response = await fetch(`/api${args.path}`, { method, headers: { 'Content-Type': 'application/json' },
          ...(args.body !== null && args.body !== undefined ? { body: JSON.stringify(args.body) } : {}) });
        if (method === 'PUT' && String(args.path).startsWith('/desktop/boards/') && response.ok && localStorage.getItem('test:drop-save-response')) {
          localStorage.removeItem('test:drop-save-response');
          localStorage.setItem('test:cloud-down', 'true');
          throw new Error('Test: successful response lost');
        }
      } else throw new Error(`Unexpected command: ${command}`);
      if (String(args.path).startsWith('/assets/') && response.ok) {
        const bytes = new Uint8Array(await response.arrayBuffer());
        let raw = ''; for (const byte of bytes) raw += String.fromCharCode(byte);
        return { status: response.status, body: { data: btoa(raw), mime: response.headers.get('content-type')!.split(';')[0] } };
      }
      return { status: response.status, body: response.status === 204 ? null : await response.json() };
    } };
  }, { bridge });
}
async function draw(page: Page, y = 220, finish = true) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + 240, box.y + y + 40, { steps: 8 });
  if (finish) await page.mouse.up();
}
async function create(page: Page) {
  await page.getByRole('button', { name: '+ Новая доска', exact: true }).click();
  await expect(page.getByTestId('canvas')).toBeVisible();
}
async function account(context: BrowserContext) {
  const email = `offline-${randomUUID()}@example.test`;
  await context.request.post('/api/auth/guest');
  const challenge = await (await context.request.post('/api/auth/register', { data: { email, password, name: 'Offline user' } })).json();
  const verified = await context.request.post('/api/auth/verify-email', { data: { challengeId: challenge.challengeId, code: await emailCode(email) } });
  expect(verified.ok()).toBeTruthy();
  return { email, session: await verified.json() };
}
async function login(page: Page, email: string, adopt = false) {
  await page.getByRole('button', { name: 'Войти для синхронизации', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Синхронизация с аккаунтом', exact: true });
  await dialog.getByLabel('Email', { exact: true }).fill(email);
  await dialog.getByLabel('Пароль', { exact: true }).fill(password);
  if (adopt) await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button', { name: 'Войти и синхронизировать', exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
async function serverBoards(context: BrowserContext) {
  return (await context.request.get('/api/boards')).json() as Promise<{ id: string; title: string; revision: number }[]>;
}
async function serverBoard(context: BrowserContext, id: string) {
  return (await context.request.get(`/api/boards/${id}`)).json();
}

test('first standalone start, drawings, images, project files and reload work without a website or API', async ({ page, context }) => {
  await offline(context);
  const requests: string[] = [];
  await page.route('**/api/**', route => { requests.push(route.request().url()); return route.abort(); });
  await page.goto('/');
  await expect(page.getByRole('button', { name: '+ Новая доска', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Продолжить как гость', exact: true })).toHaveCount(0);
  await create(page);
  await page.getByRole('textbox', { name: 'Название доски', exact: true }).fill('Полностью оффлайн');
  await draw(page);
  const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#2563eb' } }).png().toBuffer();
  await page.getByLabel('Загрузить изображения').setInputFiles({ name: 'local.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByText('2 объектов', { exact: true })).toBeVisible();
  await expect(page.getByText('Сохранено на компьютере', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Название доски', exact: true })).toHaveValue('Полностью оффлайн');
  await expect(page.getByText('2 объектов', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Действия доски', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Сохранить файл доски', exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Полностью оффлайн.bluviboard');
  const location = await file.path();
  await page.getByLabel('Открыть файл доски', { exact: true }).setInputFiles(location!);
  await expect(page.getByText('Импортирована доска «Полностью оффлайн»', { exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Доски', exact: true }).getByRole('button', { name: /^Полностью оффлайн/ })).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Поделиться доской', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  expect(requests).toEqual([]);
  await page.getByRole('button', { name: 'Карандаш', exact: true }).click();
  await draw(page, 320, false);
  await page.evaluate(() => window.__BLUVIBOARD_PREPARE_CLOSE__!());
  await expect.poll(() => page.evaluate(() => (window as Window & { nativeCloses: number }).nativeCloses)).toBe(1);
  await page.reload();
  await expect(page.getByText('3 объектов', { exact: true })).toBeVisible();
});

test('a failed disk write prevents close and can be retried without losing the offline drawing', async ({ page, context }) => {
  await offline(context);
  await page.goto('/');
  await create(page);
  await page.evaluate(() => {
    const target = window as Window & { originalTransaction: typeof IDBDatabase.prototype.transaction };
    target.originalTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(names, mode, options) {
      if (mode === 'readwrite' && (typeof names === 'string' ? [names] : Array.from(names)).includes('boards')) throw new Error('Disk write refused');
      return target.originalTransaction.call(this, names, mode, options);
    };
  });
  await draw(page);
  await page.evaluate(() => window.__BLUVIBOARD_PREPARE_CLOSE__!());
  const notice = page.getByRole('region', { name: 'Закрытие BluviBoard', exact: true });
  await expect(notice.getByRole('alert')).toContainText('Disk write refused');
  expect(await page.evaluate(() => (window as Window & { nativeCloses: number }).nativeCloses)).toBe(0);
  await page.evaluate(() => { IDBDatabase.prototype.transaction = (window as Window & { originalTransaction: typeof IDBDatabase.prototype.transaction }).originalTransaction; });
  await notice.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as Window & { nativeCloses: number }).nativeCloses)).toBe(1);
  await page.reload();
  await expect(page.getByText('1 объектов', { exact: true })).toBeVisible();
});

test('account synchronization keeps offline and concurrent cloud edits as separate safe copies, including images', async ({ page, context }) => {
  test.setTimeout(90000);
  const { email, session } = await account(context);
  try {
    await offline(context, true);
    await page.goto('/');
    await create(page);
    await page.getByRole('textbox', { name: 'Название доски', exact: true }).fill('Desktop cloud');
    await draw(page);
    const png = await sharp({ create: { width: 64, height: 48, channels: 3, background: '#2563eb' } }).png().toBuffer();
    await page.getByLabel('Загрузить изображения').setInputFiles({ name: 'sync.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByText('Сохранено на компьютере', { exact: true })).toBeVisible();
    await login(page, email, true);
    await expect.poll(async () => (await serverBoards(context)).length).toBe(1);
    const initial = (await serverBoards(context))[0];
    await expect.poll(async () => (await serverBoard(context, initial.id)).document.elements.length).toBe(2);
    await expect(page.getByText('Копии синхронизированы с аккаунтом', { exact: true })).toBeVisible();
    await page.evaluate(() => localStorage.setItem('test:cloud-down', 'true'));
    await page.getByRole('textbox', { name: 'Название доски', exact: true }).fill('Изменено оффлайн');
    await page.getByRole('button', { name: 'Карандаш', exact: true }).click();
    await draw(page, 330);
    await expect(page.getByText('Сохранено на компьютере', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Название доски', exact: true })).toHaveValue('Изменено оффлайн');
    await expect(page.getByText('3 объектов', { exact: true })).toBeVisible();
    const remote = await serverBoard(context, initial.id);
    const serverStroke = { id: randomUUID(), kind: 'stroke', color: '#2563eb', width: 4, points: [20, 20, 90, 90] };
    const saved = await context.request.put(`/api/boards/${initial.id}`, { data: { title: 'Изменено на сайте', revision: remote.revision, document: { ...remote.document, elements: [...remote.document.elements, serverStroke] } } });
    expect(saved.ok()).toBeTruthy();
    await page.evaluate(() => localStorage.removeItem('test:cloud-down'));
    await page.getByRole('button', { name: 'Синхронизировать сейчас', exact: true }).click();
    await expect.poll(async () => (await serverBoards(context)).length, { timeout: 30000 }).toBe(2);
    const all = await serverBoards(context);
    const copy = all.find(board => board.id !== initial.id)!;
    expect((await serverBoard(context, initial.id)).title).toBe('Изменено на сайте');
    expect((await serverBoard(context, copy.id)).title).toBe('Изменено оффлайн');
    const offlineCopy = await serverBoard(context, copy.id);
    expect(offlineCopy.document.elements).toHaveLength(3);
    expect(offlineCopy.document.elements.some((element: { id: string }) => element.id === serverStroke.id)).toBe(false);
    expect(offlineCopy.document.elements.some((element: { kind: string }) => element.kind === 'image')).toBe(true);
    await expect(page.getByText('Оффлайн-копия: конфликт с сайтом', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Выйти из аккаунта', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Войти для синхронизации', exact: true })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Доски', exact: true }).getByRole('button', { name: /Изменено/ })).toHaveCount(0);
  } finally { await cleanupMail(email); await cleanupWorkspaces([session.workspaceId], process.env.BB_E2E_IMAGE_DIRECTORY); }
});

test('a lost cloud acknowledgement survives restart and reuses the durable operation instead of duplicating a board', async ({ page, context }) => {
  test.setTimeout(90000);
  const { email, session } = await account(context);
  try {
    await offline(context, true);
    await page.goto('/');
    await create(page);
    await draw(page);
    await expect(page.getByText('Сохранено на компьютере', { exact: true })).toBeVisible();
    await page.evaluate(() => localStorage.setItem('test:drop-save-response', 'true'));
    await login(page, email, true);
    await expect.poll(async () => (await serverBoards(context)).length).toBe(1);
    await expect(page.getByText('Test: successful response lost', { exact: true })).toBeVisible();
    const first = (await serverBoards(context))[0];
    await draw(page, 330);
    await expect(page.getByText('Сохранено на компьютере', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('2 объектов', { exact: true })).toBeVisible();
    await page.evaluate(() => localStorage.removeItem('test:cloud-down'));
    await page.getByRole('button', { name: 'Синхронизировать сейчас', exact: true }).click();
    await expect.poll(async () => (await serverBoard(context, first.id)).document.elements.length, { timeout: 30000 }).toBe(2);
    expect(await serverBoards(context)).toHaveLength(1);
    expect((await serverBoard(context, first.id)).revision).toBe(2);
  } finally { await cleanupMail(email); await cleanupWorkspaces([session.workspaceId], process.env.BB_E2E_IMAGE_DIRECTORY); }
});

test('desktop sync endpoint rejects guests, stale writes and writes over shared boards; retries are idempotent', async ({ context }) => {
  const guest = await (await context.request.post('/api/auth/guest')).json();
  const id = randomUUID(), operationId = randomUUID();
  const data = { title: 'Desktop protocol', document: { version: 1, elements: [] }, revision: 0, operationId };
  expect((await context.request.put(`/api/desktop/boards/${id}`, { data })).status()).toBe(403);
  await cleanupWorkspaces([guest.workspaceId], process.env.BB_E2E_IMAGE_DIRECTORY);
  const { email, session } = await account(context);
  try {
    const created = await context.request.put(`/api/desktop/boards/${id}`, { data });
    expect(created.status()).toBe(200);
    expect((await created.json()).revision).toBe(1);
    expect((await (await context.request.put(`/api/desktop/boards/${id}`, { data })).json()).revision).toBe(1);
    expect((await context.request.put(`/api/desktop/boards/${id}`, { data: { ...data, operationId: randomUUID() } })).status()).toBe(409);
    expect((await context.request.delete(`/api/desktop/boards/${id}`, { data: { revision: 0 } })).status()).toBe(409);
    await context.request.put(`/api/collaboration/${id}/sharing`, { data: { enabled: true } });
    expect((await context.request.put(`/api/desktop/boards/${id}`, { data: { ...data, revision: 1, operationId: randomUUID() } })).status()).toBe(409);
    expect((await context.request.delete(`/api/desktop/boards/${id}`, { data: { revision: 1 } })).status()).toBe(409);
    expect((await (await context.request.put(`/api/desktop/boards/${id}`, { data })).json()).revision).toBe(1);
    await context.request.delete(`/api/boards/${id}`);
    expect((await context.request.put(`/api/desktop/boards/${id}`, { data })).status()).toBe(404);
    expect(await serverBoards(context)).toHaveLength(0);
  } finally { await cleanupMail(email); await cleanupWorkspaces([session.workspaceId], process.env.BB_E2E_IMAGE_DIRECTORY); }
});

test('device-only boards are not uploaded without consent and cached accounts remain isolated', async ({ page, context }) => {
  test.setTimeout(90000);
  const first = await account(context);
  let second: Awaited<ReturnType<typeof account>> | undefined;
  try {
    await offline(context, true);
    await page.goto('/');
    await create(page);
    await page.getByRole('textbox', { name: 'Название доски', exact: true }).fill('Только на устройстве');
    await draw(page);
    await expect(page.getByText('Сохранено на компьютере', { exact: true })).toBeVisible();
    await login(page, first.email, false);
    await expect(page.getByText('Копии синхронизированы с аккаунтом', { exact: true })).toBeVisible();
    expect(await serverBoards(context)).toHaveLength(0);
    await expect(page.getByRole('navigation', { name: 'Доски', exact: true }).getByRole('button', { name: /^Только на устройстве/ })).toHaveCount(0);
    await create(page);
    await page.getByRole('textbox', { name: 'Название доски', exact: true }).fill('Личная доска A');
    await draw(page);
    await expect.poll(async () => (await serverBoards(context)).length).toBe(1);
    await page.getByRole('button', { name: 'Выйти из аккаунта', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Название доски', exact: true })).toHaveValue('Только на устройстве');
    second = await account(context);
    await login(page, second.email, false);
    await expect(page.getByText('Копии синхронизированы с аккаунтом', { exact: true })).toBeVisible();
    expect(await serverBoards(context)).toHaveLength(0);
    await expect(page.getByRole('navigation', { name: 'Доски', exact: true }).getByRole('button', { name: /Личная доска A/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Выйти из аккаунта', exact: true }).click();
    await login(page, first.email, false);
    await expect(page.getByRole('textbox', { name: 'Название доски', exact: true })).toHaveValue('Личная доска A');
  } finally {
    await cleanupMail(first.email);
    if (second) await cleanupMail(second.email);
    await cleanupWorkspaces([first.session.workspaceId, ...(second ? [second.session.workspaceId] : [])], process.env.BB_E2E_IMAGE_DIRECTORY);
  }
});
