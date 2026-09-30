import { test, expect } from '@playwright/test';
import type { Page, APIRequestContext } from '@playwright/test';
import sharp from 'sharp';
import path from 'node:path';
import { cleanupAssets, cleanupWorkspaces } from './asset-test-utils.cjs';
const imageDirectory = process.env.BB_E2E_IMAGE_DIRECTORY ?? path.resolve('.test-data/e2e-assets');

let guestCookie = '';
let guestWorkspace = '';
test.beforeEach(async ({ context, request }) => {
  const response = await request.post('/api/auth/guest');
  expect(response.ok()).toBeTruthy();
  guestWorkspace = (await response.json()).workspaceId;
  const state = await request.storageState();
  guestCookie = state.cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
  await context.addCookies(state.cookies);
});
test.afterEach(async () => {
  await cleanupWorkspaces([guestWorkspace], imageDirectory);
});

async function draw(page: Page, from: [number, number], to: [number, number]) {
  const box = await page.getByTestId('canvas').boundingBox();
  if (!box) throw new Error('Canvas missing');
  await page.mouse.move(box.x + from[0], box.y + from[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + to[0], box.y + to[1], { steps: 12 });
  await page.mouse.up();
}

async function create(page: Page, ids: string[], title: string) {
  const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/boards') && response.request().method() === 'POST');
  await page.getByRole('button', { name: '+ Новая доска', exact: true }).click();
  const board = await (await responsePromise).json();
  ids.push(board.id);
  await page.getByRole('textbox', { name: 'Название доски' }).fill(title);
  return board.id as string;
}

async function read(request: APIRequestContext, id: string) {
  const response = await request.get(`/api/boards/${id}`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function cleanup(ids: string[]) {
  // Native requests still work if Playwright has disposed a timed-out test's context.
  for (const id of ids) {
    await fetch(`http://localhost:5174/api/boards/${id}`, {
      method: 'DELETE', headers: { Cookie: guestCookie }, signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  }
}

async function expectRendered(page: Page) {
  await expect.poll(() => page.locator('[data-testid="canvas"] canvas').first().evaluate((node) => {
    const canvas = node as HTMLCanvasElement;
    const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    return pixels.some((value, index) => index % 4 === 3 && value > 0);
  })).toBe(true);
}

test('drawing tools, autosave, undo/redo, independent boards, reload and deletion', async ({ page, request }) => {
  const ids: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());
  try {
    await page.goto('/');
    const firstTitle = `E2E drawing ${Date.now()}`;
    const id = await create(page, ids, firstTitle);
    await page.getByRole('button', { name: 'Цвет #ef4444', exact: true }).click();
    await page.getByRole('slider', { name: 'Толщина карандаша' }).fill('8');
    await draw(page, [150, 160], [340, 230]);
    await expect(page.getByText('1 объектов', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Прямоугольник', exact: true }).click();
    await draw(page, [400, 180], [580, 330]);
    await page.getByRole('button', { name: 'Эллипс', exact: true }).click();
    await draw(page, [620, 200], [790, 340]);
    await expect(page.getByText('3 объектов', { exact: true })).toBeVisible();
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    await expectRendered(page);
    const saved = await read(request, id);
    expect(saved.document.elements.map((element: { kind: string }) => element.kind)).toEqual(['stroke', 'rectangle', 'ellipse']);
    expect(saved.document.elements[0]).toMatchObject({ color: '#ef4444', width: 8 });

    await page.getByRole('button', { name: 'Отменить', exact: true }).click();
    await expect(page.getByText('2 объектов', { exact: true })).toBeVisible();
    await page.keyboard.press('Control+Shift+Z');
    await expect(page.getByText('3 объектов', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Ластик', exact: true }).click();
    await draw(page, [200, 178], [260, 200]);
    await expect(page.getByText('2 объектов', { exact: true })).toBeVisible();
    await page.keyboard.press('Control+z');
    await expect(page.getByText('3 объектов', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Увеличить масштаб', exact: true }).click();
    await expect(page.getByRole('button', { name: '120%', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '120%', exact: true }).click();
    await page.getByRole('button', { name: 'Рука', exact: true }).click();
    await draw(page, [700, 450], [780, 500]);
    await page.getByRole('button', { name: 'Карандаш', exact: true }).click();
    await draw(page, [200, 400], [300, 460]);
    await expect(page.getByText('4 объектов', { exact: true })).toBeVisible();

    // Creating another board must flush the previous board immediately.
    const secondTitle = `E2E second ${Date.now()}`;
    const second = await create(page, ids, secondTitle);
    await expect(page.getByText('0 объектов', { exact: true })).toBeVisible();
    expect((await read(request, id)).document.elements).toHaveLength(4);
    await draw(page, [140, 180], [250, 300]);
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Название доски' })).toHaveValue(secondTitle);
    await expect(page.getByText('1 объектов', { exact: true })).toBeVisible();
    expect((await read(request, id)).document.elements).toHaveLength(4);

    await page.getByRole('navigation', { name: 'Доски' }).locator('.board-open').filter({ hasText: firstTitle }).click();
    await expect(page.getByText('4 объектов', { exact: true })).toBeVisible();
    await page.getByRole('navigation', { name: 'Доски' }).locator('.board-open').filter({ hasText: secondTitle }).click();
    await expect(page.getByText('1 объектов', { exact: true })).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Скачать PNG' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`${secondTitle}.png`);
    await page.getByRole('button', { name: 'Очистить', exact: true }).click();
    await expect(page.getByText('0 объектов', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Отменить', exact: true }).click();
    await expect(page.getByText('1 объектов', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: `Удалить доску ${secondTitle}`, exact: true }).click();
    await expect(page.getByText('4 объектов', { exact: true })).toBeVisible();
    expect((await request.get(`/api/boards/${second}`)).status()).toBe(404);
    await expectRendered(page);
    await page.screenshot({ path: 'test-results/whiteboard.png', fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    await cleanup(ids);
  }
});

test('square grid follows the camera, survives editing and reload, and stays independent per board', async ({ page, request }) => {
  const ids: string[] = [];
  page.on('dialog', (dialog) => dialog.accept());
  try {
    await page.goto('/');
    await expect(page).toHaveTitle('BluviBoard — доска для ваших идей');
    await expect(page.locator('.brand-name')).toHaveText('BluviBoard');
    const icon = await request.get('/favicon.svg');
    expect(icon.status()).toBe(200);
    expect(icon.headers()['content-type']).toContain('image/svg+xml');
    expect(await icon.text()).toContain('<svg');
    const firstTitle = `E2E grid ${Date.now()}`;
    const id = await create(page, ids, firstTitle);
    const canvas = page.getByTestId('canvas');
    await expect(canvas).toHaveAttribute('data-background', 'dots');
    await page.getByRole('button', { name: 'Клетка', exact: true }).click();
    await page.getByRole('slider', { name: 'Размер клетки', exact: true }).fill('32');
    await expect(canvas).toHaveCSS('background-image', /linear-gradient/);
    await expect(canvas).toHaveCSS('background-size', '32px 32px, 32px 32px');

    // Write a handwritten 2 inside a 32-unit cell, using one persisted stroke.
    const box = (await canvas.boundingBox())!;
    const points = [[100, 136], [103, 133], [116, 133], [120, 138], [118, 143], [104, 153], [101, 156], [120, 156]];
    await page.mouse.move(box.x + points[0][0], box.y + points[0][1]);
    await page.mouse.down();
    for (const [x, y] of points.slice(1)) await page.mouse.move(box.x + x, box.y + y, { steps: 2 });
    await page.mouse.up();
    await expect(page.getByText('1 объектов', { exact: true })).toBeVisible();
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    const original = await read(request, id);
    expect(original.document.background).toEqual({ pattern: 'grid', size: 32 });
    await page.getByRole('button', { name: 'Увеличить масштаб', exact: true }).click();
    await expect(canvas).toHaveCSS('background-size', '38.4px 38.4px, 38.4px 38.4px');
    await page.getByRole('button', { name: '120%', exact: true }).click();
    await page.getByRole('button', { name: 'Рука', exact: true }).click();
    await draw(page, [700, 400], [770, 450]);
    await expect(canvas).toHaveCSS('background-position', '70px 50px, 70px 50px');
    await page.getByRole('button', { name: '100%', exact: true }).click();
    await page.getByRole('button', { name: 'Отменить', exact: true }).click();
    await expect(page.getByText('0 объектов', { exact: true })).toBeVisible();
    await expect(canvas).toHaveAttribute('data-background', 'grid');
    await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    await page.getByRole('button', { name: 'Очистить', exact: true }).click();
    await expect(page.getByText('0 объектов', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Отменить', exact: true }).click();
    await expect(page.getByText('1 объектов', { exact: true })).toBeVisible();

    const secondTitle = `E2E plain ${Date.now()}`;
    const secondId = await create(page, ids, secondTitle);
    await expect(canvas).toHaveAttribute('data-background', 'dots');
    await page.getByRole('button', { name: 'Чистый', exact: true }).click();
    await expect(canvas).toHaveCSS('background-image', 'none');
    await page.getByRole('navigation', { name: 'Доски' }).locator('.board-open').filter({ hasText: firstTitle }).click();
    await expect(canvas).toHaveAttribute('data-background', 'grid');
    await expect(page.getByRole('slider', { name: 'Размер клетки', exact: true })).toHaveValue('32');
    const renamed = `${firstTitle} renamed`;
    await page.getByRole('textbox', { name: 'Название доски' }).fill(renamed);
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('textbox', { name: 'Название доски' })).toHaveValue(renamed);
    await expect(canvas).toHaveAttribute('data-background', 'grid');
    await expect(canvas).toHaveCSS('background-size', '32px 32px, 32px 32px');
    const persisted = await read(request, id);
    expect(persisted.document.background).toEqual({ pattern: 'grid', size: 32 });
    expect(persisted.document.elements).toEqual(original.document.elements);
    expect((await read(request, secondId)).document.background).toEqual({ pattern: 'plain', size: 24 });
    await expectRendered(page);
    await page.screenshot({ path: 'test-results/grid-board.png', fullPage: true });
  } finally {
    await cleanup(ids);
  }
});

test('background size supports precise input and a slider for cells and dots, including reload and input correction', async ({ page, request }) => {
  const ids: string[] = [];
  try {
    await page.goto('/');
    const id = await create(page, ids, `E2E background size ${Date.now()}`);
    const canvas = page.getByTestId('canvas');
    await page.getByRole('button', { name: 'Клетка', exact: true }).click();
    const cellValue = page.getByRole('spinbutton', { name: 'Размер клетки: значение', exact: true });
    await cellValue.fill('37');
    await cellValue.press('Enter');
    await expect(canvas).toHaveCSS('background-size', '37px 37px, 37px 37px');
    await expect(page.getByRole('slider', { name: 'Размер клетки', exact: true })).toHaveValue('37');
    await cellValue.fill('8');
    await expect(canvas).toHaveCSS('background-size', '37px 37px, 37px 37px');
    await cellValue.press('Tab');
    await expect(cellValue).toHaveValue('12');
    await expect(canvas).toHaveCSS('background-size', '12px 12px, 12px 12px');
    await cellValue.fill('120');
    await cellValue.press('Enter');
    await expect(cellValue).toHaveValue('96');
    await expect(canvas).toHaveCSS('background-size', '96px 96px, 96px 96px');

    await page.getByRole('button', { name: 'Точки', exact: true }).click();
    await page.getByRole('slider', { name: 'Шаг точек', exact: true }).fill('53');
    const dotValue = page.getByRole('spinbutton', { name: 'Шаг точек: значение', exact: true });
    await expect(dotValue).toHaveValue('53');
    await expect(canvas).toHaveCSS('background-size', '53px 53px');
    await dotValue.fill('');
    await dotValue.press('Enter');
    await expect(dotValue).toHaveValue('53');
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    expect((await read(request, id)).document.background).toEqual({ pattern: 'dots', size: 53 });
    await page.reload();
    await expect(canvas).toHaveAttribute('data-background', 'dots');
    await expect(canvas).toHaveCSS('background-size', '53px 53px');
    await expect(dotValue).toHaveValue('53');
    await page.getByRole('button', { name: 'Чистый', exact: true }).click();
    await expect(page.getByRole('slider', { name: /^(Размер клетки|Шаг точек)$/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Точки', exact: true }).click();
    await expect(dotValue).toHaveValue('53');
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(dotValue).toBeVisible();
    const box = (await dotValue.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(360);
  } finally {
    await cleanup(ids);
  }
});

test('paste a screenshot, move and resize it, export, undo deletion and reload saved images', async ({ page, context, request }) => {
  const ids: string[] = [];
  const assets: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());
  page.on('response', async (response) => {
    if (response.url().endsWith('/api/assets') && response.request().method() === 'POST' && response.status() === 201) {
      assets.push((await response.json()).id);
    }
  });
  try {
    await page.goto('/');
    const title = `E2E screenshots ${Date.now()}`;
    const id = await create(page, ids, title);
    await expect(page.getByText(/PostgreSQL|NestJS|Object Storage/)).toHaveCount(0);
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    await page.getByLabel('Загрузить изображения').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('not png') });
    await expect(page.getByRole('alert')).toContainText('Не удалось прочитать изображение');
    await expect(page.getByText('0 объектов', { exact: true })).toBeVisible();

    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.evaluate(async () => {
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = 180;
      const context = canvas.getContext('2d')!;
      context.fillStyle = '#3b82f6';
      context.fillRect(0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve) => canvas.toBlob((value) => resolve(value!), 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    });
    await page.getByRole('button', { name: 'Выделение', exact: true }).click();
    await page.keyboard.press('Control+v');
    await expect(page.getByText('1 объектов', { exact: true })).toBeVisible();
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    await expect.poll(() => page.locator('[data-testid="canvas"] canvas').first().evaluate((node) => {
      const canvas = node as HTMLCanvasElement;
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      return pixels.some((value, index) => index % 4 === 0 && value === 59 && pixels[index + 1] === 130 && pixels[index + 2] === 246);
    })).toBe(true);
    let image = (await read(request, id)).document.elements[0];
    expect(image.kind).toBe('image');
    expect(image.width).toBe(320);
    const box = (await page.getByTestId('canvas').boundingBox())!;
    await page.mouse.move(box.x + image.x + image.width / 2, box.y + image.y + image.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + image.x + image.width / 2 + 70, box.y + image.y + image.height / 2 + 50, { steps: 10 });
    await page.mouse.up();
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    const moved = (await read(request, id)).document.elements[0];
    expect(moved.x).toBeCloseTo(image.x + 70);
    expect(moved.y).toBeCloseTo(image.y + 50);
    image = moved;
    await page.mouse.move(box.x + image.x + image.width, box.y + image.y + image.height);
    await page.mouse.down();
    await page.mouse.move(box.x + image.x + image.width + 80, box.y + image.y + image.height + 45, { steps: 10 });
    await page.mouse.up();
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    const resized = (await read(request, id)).document.elements[0];
    expect(resized.width).toBeGreaterThan(image.width + 40);
    expect(resized.width / resized.height).toBeCloseTo(320 / 180);

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Скачать PNG' }).click();
    const download = await downloadPromise;
    const pixels = await sharp((await download.path())!).ensureAlpha().raw().toBuffer();
    expect(pixels.some((value, index) => index % 4 === 0 && value === 59 && pixels[index + 1] === 130 && pixels[index + 2] === 246)).toBe(true);
    expect(pixels.some((value, index) => index % 4 === 0 && value === 99 && pixels[index + 1] === 102 && pixels[index + 2] === 241)).toBe(false);
    await page.keyboard.press('Delete');
    await expect(page.getByText('0 объектов', { exact: true })).toBeVisible();
    await page.keyboard.press('Control+z');
    await expect(page.getByText('1 объектов', { exact: true })).toBeVisible();

    const jpeg = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#22c55e' } }).jpeg().toBuffer();
    await page.getByLabel('Загрузить изображения').setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: jpeg });
    await expect(page.getByText('2 объектов', { exact: true })).toBeVisible();
    const drop = await page.evaluateHandle((bytes) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([new Uint8Array(bytes)], 'dropped.jpg', { type: 'image/jpeg' }));
      return transfer;
    }, Array.from(jpeg));
    await page.getByTestId('canvas').dispatchEvent('drop', { dataTransfer: drop, clientX: box.x + 160, clientY: box.y + 160 });
    await drop.dispose();
    await expect(page.getByText('3 объектов', { exact: true })).toBeVisible();
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    const saved = await read(request, id);
    expect(saved.document.elements.every((element: { kind: string }) => element.kind === 'image')).toBe(true);
    expect(saved.document.elements[0].width).toBeCloseTo(resized.width);
    await page.reload();
    await expect(page.getByText('3 объектов', { exact: true })).toBeVisible();
    await expectRendered(page);
    await page.screenshot({ path: 'test-results/screenshots-board.png', fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    await cleanup(ids);
    await cleanupAssets(assets, imageDirectory);
  }
});

test('a pending image upload is saved on its original board when switching, preserving intervening strokes', async ({ page, request }) => {
  const ids: string[] = [];
  const assets: string[] = [];
  page.on('response', async (response) => {
    if (response.url().endsWith('/api/assets') && response.status() === 201) assets.push((await response.json()).id);
  });
  try {
    await page.goto('/');
    const id = await create(page, ids, `E2E pending upload ${Date.now()}`);
    await page.route('**/api/assets', async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      await route.fulfill({ response: await route.fetch() });
    });
    const png = await sharp({ create: { width: 100, height: 80, channels: 3, background: '#3b82f6' } }).png().toBuffer();
    await page.getByLabel('Загрузить изображения').setInputFiles({ name: 'pending.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByText('Загрузка изображения…', { exact: true })).toBeVisible();
    await draw(page, [100, 140], [200, 180]);
    const other = await create(page, ids, `E2E upload next ${Date.now()}`);
    const original = await read(request, id);
    expect(original.document.elements.map((element: { kind: string }) => element.kind)).toEqual(['stroke', 'image']);
    expect((await read(request, other)).document.elements).toHaveLength(0);
  } finally {
    await cleanup(ids);
    await cleanupAssets(assets, imageDirectory);
  }
});

test('edits during a slow save are serialized and no drawing is lost', async ({ page, request }) => {
  const ids: string[] = [];
  try {
    await page.goto('/');
    const id = await create(page, ids, `E2E queued save ${Date.now()}`);
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    const initial = await read(request, id);
    let pending = 0;
    let maximum = 0;
    let writes = 0;
    await page.route(`**/api/boards/${id}`, async (route) => {
      if (route.request().method() !== 'PUT') { await route.continue(); return; }
      pending += 1;
      writes += 1;
      maximum = Math.max(maximum, pending);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const response = await route.fetch();
      await route.fulfill({ response });
      pending -= 1;
    });
    await draw(page, [120, 160], [220, 250]);
    await expect(page.getByText('Сохранение…', { exact: true })).toBeVisible();
    await draw(page, [320, 160], [420, 250]);
    await page.getByRole('textbox', { name: 'Название доски' }).fill('E2E edits while saving');
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible({ timeout: 10000 });
    const saved = await read(request, id);
    expect(saved.document.elements).toHaveLength(2);
    expect(saved.title).toBe('E2E edits while saving');
    expect(saved.revision).toBe(initial.revision + 2);
    expect(writes).toBe(2);
    expect(maximum).toBe(1);
  } finally {
    await cleanup(ids);
  }
});

test('stale writes show a conflict and the local drawing can be saved as a separate board', async ({ page, request }) => {
  const ids: string[] = [];
  try {
    await page.goto('/');
    const id = await create(page, ids, `E2E conflict ${Date.now()}`);
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    const original = await read(request, id);
    const updated = await request.put(`/api/boards/${id}`, { data: {
      title: 'E2E another tab', document: original.document, revision: original.revision,
    } });
    expect(updated.ok()).toBeTruthy();
    await draw(page, [120, 160], [220, 250]);
    await expect(page.getByText('Не сохранено', { exact: true })).toBeVisible();
    expect((await read(request, id)).document.elements).toHaveLength(0);
    const responsePromise = page.waitForResponse((response) => response.url().endsWith('/api/boards') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Сохранить как новую доску', exact: true }).click();
    const copy = await (await responsePromise).json();
    ids.push(copy.id);
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    expect((await read(request, copy.id)).document.elements).toHaveLength(1);
    expect((await read(request, id)).title).toBe('E2E another tab');
    expect((await read(request, id)).document.elements).toHaveLength(0);
  } finally {
    await cleanup(ids);
  }
});

test('failed autosave preserves a local draft across reload and can be retried', async ({ page, request }) => {
  const ids: string[] = [];
  page.on('dialog', (dialog) => dialog.accept());
  try {
    await page.goto('/');
    const id = await create(page, ids, `E2E offline ${Date.now()}`);
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    await page.route(`**/api/boards/${id}`, (route) => route.request().method() === 'PUT'
      ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Temporary offline test' }) })
      : route.continue());
    await draw(page, [140, 200], [300, 280]);
    await expect(page.getByText('Не сохранено', { exact: true })).toBeVisible();
    expect((await read(request, id)).document.elements).toHaveLength(0);
    await page.reload();
    await expect(page.getByText('1 объектов', { exact: true })).toBeVisible();
    await expect(page.getByText('Не сохранено', { exact: true })).toBeVisible();
    await page.unroute(`**/api/boards/${id}`);
    await page.getByRole('button', { name: 'Повторить сохранение', exact: true }).click();
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    expect((await read(request, id)).document.elements).toHaveLength(1);
    await page.reload();
    await expect(page.getByText('1 объектов', { exact: true })).toBeVisible();
  } finally {
    await cleanup(ids);
  }
});
