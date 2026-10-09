import { test, expect } from '@playwright/test';
import type { Page, BrowserContext } from '@playwright/test';
import sharp from 'sharp';
import { cleanupWorkspaces } from './asset-test-utils.cjs';

async function controlled(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toContain('/sw.js');
}

async function offerUpdate(page: Page) {
  await controlled(page);
  // A new script URL starts a real worker lifecycle without changing build files.
  await page.evaluate(() => navigator.serviceWorker.register(`/sw.js?update-test=${crypto.randomUUID()}`, { scope: '/', updateViaCache: 'none' }).then(() => {}));
  await expect(page.getByRole('region', { name: 'Обновление BluviBoard' })).toBeVisible();
}

async function createBoard(page: Page, context: BrowserContext) {
  const guest = await (await context.request.post('/api/auth/guest')).json();
  await page.goto('/');
  const response = page.waitForResponse((item) => item.url().endsWith('/api/boards') && item.request().method() === 'POST');
  await page.getByRole('button', { name: '+ Новая доска', exact: true }).click();
  const board = await (await response).json();
  await expect(page.getByText('0 объектов', { exact: true })).toBeVisible();
  return { workspaceId: guest.workspaceId as string, id: board.id as string };
}

async function draw(page: Page) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 180);
  await page.mouse.down();
  await page.mouse.move(box.x + 240, box.y + 240, { steps: 8 });
  await page.mouse.up();
}

test('PWA manifest and icons are installable; offline launch uses only the public connection page', async ({ page, context }) => {
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
  const manifestResponse = await context.request.get('/manifest.webmanifest');
  expect(manifestResponse.ok()).toBeTruthy();
  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({ id: '/', start_url: '/', scope: '/', display: 'standalone', short_name: 'BluviBoard' });
  expect(manifest.icons).toHaveLength(3);
  for (const icon of manifest.icons) {
    const response = await context.request.get(icon.src);
    expect(response.ok()).toBeTruthy();
    const size = Number(icon.sizes.split('x')[0]);
    expect(await sharp(await response.body()).metadata()).toMatchObject({ format: 'png', width: size, height: size });
  }
  await controlled(page);
  const cdp = await context.newCDPSession(page);
  const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
  expect(installabilityErrors).toEqual([]);
  const session = await page.evaluate(() => fetch('/api/auth/session').then((response) => response.json()));
  expect(session.kind).toBe('anonymous');
  const cached = await page.evaluate(async () => {
    const entries = await Promise.all((await caches.keys()).map(async (key) => (await (await caches.open(key)).keys()).map((request) => new URL(request.url).pathname)));
    return entries.flat();
  });
  expect(cached).toEqual(['/offline.html']);
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: 'Нет подключения к интернету' })).toBeVisible();
  expect(await page.evaluate(() => fetch('/api/auth/session').then(() => false).catch(() => true))).toBe(true);
  await context.setOffline(false);
  await page.getByRole('link', { name: 'Попробовать снова' }).click();
  await expect(page.getByRole('heading', { name: 'С возвращением' })).toBeVisible();
});

test('installation offers browser instructions or the native prompt and hides after installation', async ({ page }) => {
  await page.goto('/');
  const button = page.getByRole('button', { name: 'Установить BluviBoard', exact: true });
  await expect(button).toBeVisible();
  await page.evaluate(() => {
    const target = window as Window & { promptCalls?: number };
    target.promptCalls = 0;
    const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: async () => { target.promptCalls! += 1; },
      userChoice: Promise.resolve({ outcome: 'dismissed' }),
    });
    window.dispatchEvent(event);
  });
  await button.click();
  await expect.poll(() => page.evaluate(() => (window as Window & { promptCalls?: number }).promptCalls)).toBe(1);
  await expect(button).toBeEnabled();
  await button.click();
  const help = page.getByRole('region', { name: 'Как установить BluviBoard' });
  await expect(help).toContainText('Chrome или Edge');
  await page.setViewportSize({ width: 360, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(button).toHaveCount(0);
});

test('a real worker update can be postponed, waits for image uploads and saves drawings before reloading', async ({ page, context }) => {
  let workspace: string | undefined;
  let releaseUpload: () => void = () => {};
  const uploadGate = new Promise<void>((resolve) => { releaseUpload = resolve; });
  try {
    const board = await createBoard(page, context);
    workspace = board.workspaceId;
    await offerUpdate(page);
    await page.getByRole('button', { name: 'Позже', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Обновление BluviBoard' })).toHaveCount(0);
    await draw(page);
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('region', { name: 'Обновление BluviBoard' })).toBeVisible();
    await page.route('**/api/assets', async (route) => {
      await uploadGate;
      await route.fulfill({ response: await route.fetch() });
    });
    const image = await sharp({ create: { width: 100, height: 80, channels: 3, background: '#2563eb' } }).png().toBuffer();
    await page.getByLabel('Загрузить изображения').setInputFiles({ name: 'update.png', mimeType: 'image/png', buffer: image });
    await expect(page.getByText('Загрузка изображения…', { exact: true })).toBeVisible();
    await draw(page);
    const reloaded = page.waitForEvent('framenavigated', { predicate: (frame) => frame === page.mainFrame() });
    await page.getByRole('button', { name: 'Обновить', exact: true }).click();
    await expect(page.locator('.pwa-app')).toHaveAttribute('inert', '');
    await expect(page.getByText('Сохраняем доску и обновляем…', { exact: true })).toBeVisible();
    await page.keyboard.press('Control+z');
    await expect(page.getByText('2 объектов', { exact: true })).toBeVisible();
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state)).toBe('installed');
    releaseUpload();
    await reloaded;
    await expect(page.getByText('3 объектов', { exact: true })).toBeVisible();
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    const saved = await (await context.request.get(`/api/boards/${board.id}`)).json();
    expect(saved.document.elements.map((element: { kind: string }) => element.kind)).toEqual(['stroke', 'stroke', 'image']);
  } finally {
    releaseUpload();
    if (workspace) await cleanupWorkspaces([workspace], process.env.BB_E2E_IMAGE_DIRECTORY);
  }
});

test('failed saves keep the worker waiting and the draft editable; retry saves before update', async ({ page, context }) => {
  let workspace: string | undefined;
  try {
    const board = await createBoard(page, context);
    workspace = board.workspaceId;
    await offerUpdate(page);
    await page.route(`**/api/boards/${board.id}`, (route) => route.request().method() === 'PUT'
      ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Не удалось сохранить тестовую доску' }) })
      : route.continue());
    await draw(page);
    const previousController = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL);
    await page.getByRole('button', { name: 'Обновить', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Обновление BluviBoard' }).getByRole('alert')).toContainText('Обновление отложено');
    await expect(page.getByRole('dialog', { name: 'Что нового', exact: true })).toHaveCount(0);
    expect(await page.evaluate(() => sessionStorage.getItem('bluviboard:release-after-update'))).toBeNull();
    await expect(page.locator('.pwa-app')).not.toHaveAttribute('inert', '');
    expect(await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toBe(previousController);
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state)).toBe('installed');
    await draw(page);
    await expect(page.getByText('2 объектов', { exact: true })).toBeVisible();
    expect(await page.evaluate((id) => JSON.parse(localStorage.getItem(`whiteboard:draft:${id}`)!).document.elements.length, board.id)).toBe(2);
    await page.unroute(`**/api/boards/${board.id}`);
    const reloaded = page.waitForEvent('framenavigated', { predicate: (frame) => frame === page.mainFrame() });
    await page.getByRole('button', { name: 'Обновить', exact: true }).click();
    await reloaded;
    await expect(page.getByText('2 объектов', { exact: true })).toBeVisible();
    const saved = await (await context.request.get(`/api/boards/${board.id}`)).json();
    expect(saved.document.elements).toHaveLength(2);
  } finally {
    if (workspace) await cleanupWorkspaces([workspace], process.env.BB_E2E_IMAGE_DIRECTORY);
  }
});

test('update finishes an active stroke and stays postponed until a failed image upload is acknowledged', async ({ page, context }) => {
  let workspace: string | undefined;
  try {
    const board = await createBoard(page, context);
    workspace = board.workspaceId;
    await offerUpdate(page);
    await page.getByLabel('Загрузить изображения').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not an image') });
    await expect(page.getByRole('alert')).toContainText('Не удалось прочитать изображение');
    const box = (await page.getByTestId('canvas').boundingBox())!;
    await page.mouse.move(box.x + 100, box.y + 180);
    await page.mouse.down();
    await page.mouse.move(box.x + 240, box.y + 240, { steps: 8 });
    await expect(page.getByText('0 объектов', { exact: true })).toBeVisible();
    // A second pointer or keyboard action can request an update during drawing.
    await page.getByRole('button', { name: 'Обновить', exact: true }).evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.getByRole('region', { name: 'Обновление BluviBoard' }).getByRole('alert')).toContainText('Изображение не загрузилось');
    await expect(page.getByText('1 объектов', { exact: true })).toBeVisible();
    await page.mouse.up();
    await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
    const reloaded = page.waitForEvent('framenavigated', { predicate: (frame) => frame === page.mainFrame() });
    await page.getByRole('button', { name: 'Обновить', exact: true }).click();
    await reloaded;
    await expect(page.getByText('1 объектов', { exact: true })).toBeVisible();
    const saved = await (await context.request.get(`/api/boards/${board.id}`)).json();
    expect(saved.document.elements).toHaveLength(1);
    expect(saved.document.elements[0]).toMatchObject({ kind: 'stroke' });
  } finally {
    if (workspace) await cleanupWorkspaces([workspace], process.env.BB_E2E_IMAGE_DIRECTORY);
  }
});
