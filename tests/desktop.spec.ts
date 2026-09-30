import { test, expect } from '@playwright/test';
import type { Page, BrowserContext } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { cleanupWorkspaces } from './asset-test-utils.cjs';
import { version } from '../apps/desktop/package.json';

async function native(context: BrowserContext) {
  await context.addInitScript(() => {
    const target = window as Window & { nativeCloses: number; __TAURI_INTERNALS__: { invoke: (command: string) => Promise<void> } };
    Object.defineProperty(window, '__BLUVIBOARD_DESKTOP__', { value: true });
    target.nativeCloses = 0;
    target.__TAURI_INTERNALS__ = { invoke: async (command) => {
      if (command !== 'desktop_close') throw new Error(`Unexpected native command: ${command}`);
      target.nativeCloses += 1;
    } };
  });
}

const close = (page: Page) => page.evaluate(() => { void window.__BLUVIBOARD_PREPARE_CLOSE__!(); });
const closes = (page: Page) => page.evaluate(() => (window as Window & { nativeCloses: number }).nativeCloses);

async function createBoard(page: Page, context: BrowserContext) {
  const guest = await (await context.request.post('/api/auth/guest')).json();
  await page.goto('/');
  const response = page.waitForResponse((item) => item.url().endsWith('/api/boards') && item.request().method() === 'POST');
  await page.getByRole('button', { name: '+ Новая доска', exact: true }).click();
  const board = await (await response).json();
  await expect(page.getByTestId('canvas')).toBeVisible();
  return { workspaceId: guest.workspaceId as string, id: board.id as string };
}

async function stroke(page: Page, finish = true) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 250, box.y + 260, { steps: 8 });
  if (finish) await page.mouse.up();
}

test('website links to the versioned Windows installer; native client hides installation offers', async ({ page, context }) => {
  await page.goto('/');
  const download = page.getByRole('link', { name: 'Скачать для Windows', exact: true });
  await expect(download).toHaveAttribute('href', `https://github.com/Izarych/interactive-whiteboard/releases/download/desktop-v${version}/BluviBoard-Setup-${version}-x64.exe`);
  await expect(page.getByRole('button', { name: 'Установить BluviBoard', exact: true })).toBeVisible();
  await native(context);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'С возвращением' })).toBeVisible();
  await expect(download).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Установить BluviBoard', exact: true })).toHaveCount(0);
});

test('desktop close waits for uploads and finishes an active stroke before saving and calling native close', async ({ page, context }) => {
  let workspace: string | undefined;
  let releaseUpload = () => {};
  const uploadGate = new Promise<void>((resolve) => { releaseUpload = resolve; });
  try {
    await native(context);
    const board = await createBoard(page, context);
    workspace = board.workspaceId;
    await page.route('**/api/assets', async (route) => {
      await uploadGate;
      await route.fulfill({ response: await route.fetch() });
    });
    const image = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#2563eb' } }).png().toBuffer();
    await page.getByLabel('Загрузить изображения').setInputFiles({ name: 'close.png', mimeType: 'image/png', buffer: image });
    await expect(page.getByText('Загрузка изображения…', { exact: true })).toBeVisible();
    await stroke(page, false);
    await close(page);
    await expect(page.locator('.pwa-app')).toHaveAttribute('inert', '');
    await expect(page.getByRole('region', { name: 'Закрытие BluviBoard' })).toContainText('Сохраняем доску перед закрытием');
    await page.keyboard.press('Control+z');
    await expect(page.getByText('1 объектов', { exact: true })).toBeVisible();
    await close(page);
    expect(await closes(page)).toBe(0);
    releaseUpload();
    await expect.poll(() => closes(page)).toBe(1);
    const saved = await (await context.request.get(`/api/boards/${board.id}`)).json();
    expect(saved.document.elements.map((element: { kind: string }) => element.kind)).toEqual(['stroke', 'image']);
    expect(await page.evaluate((id) => localStorage.getItem(`whiteboard:draft:${id}`), board.id)).toBeNull();
  } finally {
    releaseUpload();
    if (workspace) await cleanupWorkspaces([workspace], process.env.BB_E2E_IMAGE_DIRECTORY);
  }
});

test('failed desktop save leaves a recoverable draft and supports retry or explicitly confirmed discard', async ({ page, context }) => {
  let workspace: string | undefined;
  try {
    await native(context);
    const board = await createBoard(page, context);
    workspace = board.workspaceId;
    await page.route(`**/api/boards/${board.id}`, (route) => route.request().method() === 'PUT'
      ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Проверка ошибки сохранения' }) }) : route.continue());
    await stroke(page);
    await close(page);
    const notice = page.getByRole('region', { name: 'Закрытие BluviBoard' });
    await expect(notice.getByRole('alert')).toContainText('Проверка ошибки сохранения');
    expect(await closes(page)).toBe(0);
    await expect(page.locator('.pwa-app')).not.toHaveAttribute('inert', '');
    expect(await page.evaluate((id) => JSON.parse(localStorage.getItem(`whiteboard:draft:${id}`)!).document.elements.length, board.id)).toBe(1);
    page.once('dialog', (dialog) => dialog.dismiss());
    await notice.getByRole('button', { name: 'Закрыть всё равно' }).click();
    expect(await closes(page)).toBe(0);
    await notice.getByRole('button', { name: 'Продолжить работу' }).click();
    await expect(notice).toHaveCount(0);
    await stroke(page);
    await close(page);
    await expect(notice).toBeVisible();
    await page.unroute(`**/api/boards/${board.id}`);
    await notice.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect.poll(() => closes(page)).toBe(1);
    expect((await (await context.request.get(`/api/boards/${board.id}`)).json()).document.elements).toHaveLength(2);
  } finally {
    if (workspace) await cleanupWorkspaces([workspace], process.env.BB_E2E_IMAGE_DIRECTORY);
  }
});

test('desktop force-close requires explicit confirmation after an image upload fails', async ({ page, context }) => {
  let workspace: string | undefined;
  try {
    await native(context);
    const board = await createBoard(page, context);
    workspace = board.workspaceId;
    await page.getByLabel('Загрузить изображения').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('invalid image') });
    await expect(page.getByRole('alert')).toContainText('Не удалось прочитать изображение');
    await close(page);
    const notice = page.getByRole('region', { name: 'Закрытие BluviBoard' });
    await expect(notice.getByRole('alert')).toContainText('Изображение не загрузилось');
    expect(await closes(page)).toBe(0);
    page.once('dialog', (dialog) => dialog.accept());
    await notice.getByRole('button', { name: 'Закрыть всё равно' }).click();
    await expect.poll(() => closes(page)).toBe(1);
  } finally {
    if (workspace) await cleanupWorkspaces([workspace], process.env.BB_E2E_IMAGE_DIRECTORY);
  }
});

test('embedded desktop launcher remains usable on a first offline start and retries without credentials', async ({ page, context }) => {
  const launcher = path.resolve('apps/desktop/launcher');
  let online = false;
  let credentialFree = false;
  await context.addCookies([{ name: 'browser-session', value: 'do-not-send-from-launcher', domain: 'bluviboard.ru', path: '/', secure: true }]);
  await page.route('https://tauri.localhost/**', async (route) => {
    const name = new URL(route.request().url()).pathname.slice(1) || 'index.html';
    const contentType = name.endsWith('.css') ? 'text/css' : name.endsWith('.js') ? 'application/javascript' : name.endsWith('.svg') ? 'image/svg+xml' : 'text/html';
    const source = name === 'favicon.svg' ? path.resolve('apps/web/public/favicon.svg') : path.join(launcher, name);
    await route.fulfill({ contentType, body: await readFile(source) });
  });
  await page.route('https://bluviboard.ru/', async (route) => {
    if (!online) return route.abort('internetdisconnected');
    if (!route.request().isNavigationRequest()) credentialFree = !route.request().headers().cookie;
    await route.fulfill({ contentType: 'text/html', body: '<h1>Connected</h1>' });
  });
  await page.goto('https://tauri.localhost/');
  await expect(page.getByRole('status')).toContainText('Не удалось подключиться');
  await expect(page.getByRole('button', { name: 'Попробовать снова' })).toBeEnabled();
  online = true;
  await page.getByRole('button', { name: 'Попробовать снова' }).click();
  await expect(page.getByRole('heading', { name: 'Connected' })).toBeVisible();
  expect(credentialFree).toBe(true);
});
