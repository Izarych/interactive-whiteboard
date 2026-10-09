import { test, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import { cleanupWorkspaces } from './asset-test-utils.cjs';

async function prepare(context: BrowserContext, elements: object[] = []) {
  const guest = await (await context.request.post('/api/auth/guest')).json();
  const board = await (await context.request.post('/api/boards', { data: { title: 'Drawing update test' } })).json();
  const response = await context.request.put(`/api/boards/${board.id}`, { data: { title: board.title, revision: 0, document: { version: 1, background: { pattern: 'plain', size: 24 }, elements } } });
  expect(response.ok()).toBe(true);
  return { workspace: guest.workspaceId, id: board.id, board: await response.json() };
}
async function trace(page: Page, points: [number, number][]) {
  await page.keyboard.press('Escape');
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.move(box.x + points[0][0], box.y + points[0][1]);
  await page.mouse.down();
  for (const [x, y] of points.slice(1)) await page.mouse.move(box.x + x, box.y + y, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
}
async function pixel(page: Page, x: number, y: number, layer = 0) {
  return page.getByTestId('canvas').locator('canvas').nth(layer).evaluate((node, point) => {
    const canvas = node as HTMLCanvasElement, bounds = canvas.getBoundingClientRect();
    return Array.from(canvas.getContext('2d')!.getImageData(Math.round(point.x * canvas.width / bounds.width), Math.round(point.y * canvas.height / bounds.height), 1, 1).data);
  }, { x, y });
}

test('highlighter remains translucent over handwriting and images, survives save/reload and PNG export, and erases with its style intact', async ({ page, context }) => {
  const current = await prepare(context, [{ id: randomUUID(), kind: 'stroke', color: '#202938', width: 4, points: [100, 340, 500, 340] }]);
  try {
    const image = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="white"/><rect x="10" y="38" width="180" height="5" fill="#202938"/></svg>')).png().toBuffer();
    const asset = await (await context.request.post('/api/assets', { multipart: { file: { name: 'text.png', mimeType: 'image/png', buffer: image } } })).json();
    const elements = [...current.board.document.elements, { id: randomUUID(), kind: 'image', assetId: asset.id, x: 650, y: 300, width: 200, height: 100 }];
    expect((await context.request.put(`/api/boards/${current.id}`, { data: { title: current.board.title, revision: 1, document: { ...current.board.document, elements } } })).ok()).toBe(true);
    await page.goto('/');
    await expect(page.getByText('2 объектов', { exact: true })).toBeVisible();
    await expect.poll(async () => (await pixel(page, 730, 340)).slice(0, 3)).toEqual([32, 41, 56]);
    await page.getByRole('button', { name: 'Маркер', exact: true }).click();
    const settings = page.getByRole('dialog', { name: 'Настройки: Маркер', exact: true });
    await expect(settings).toBeVisible();
    await settings.getByRole('button', { name: 'Цвет #22c55e', exact: true }).click();
    await settings.getByRole('slider', { name: 'Толщина маркера', exact: true }).fill('40');
    await settings.getByRole('slider', { name: 'Непрозрачность маркера', exact: true }).fill('35');
    await page.getByRole('button', { name: 'Цвет и толщина', exact: true }).click();
    const palette = page.getByRole('dialog', { name: 'Цвет и толщина', exact: true });
    await expect(palette.getByRole('button', { name: 'Цвет #22c55e', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(palette.getByRole('slider', { name: 'Толщина маркера', exact: true })).toHaveValue('40');
    await trace(page, [[100, 340], [830, 340]]);
    let saved = (await (await context.request.get(`/api/boards/${current.id}`)).json()).document.elements;
    const marker = saved[2];
    expect(marker).toMatchObject({ kind: 'stroke', color: '#22c55e', width: 40, opacity: .35 });
    for (const x of [250, 730]) {
      const rgba = await pixel(page, x, 340);
      expect(rgba[3]).toBe(255);
      expect(rgba[1]).toBeGreaterThan(41);
      expect(rgba[1]).toBeLessThan(197);
    }
    expect((await pixel(page, 250, 330))[3]).toBeGreaterThan(80);
    expect((await pixel(page, 250, 330))[3]).toBeLessThan(100);
    await page.keyboard.press('Control+z');
    await expect(page.getByText('2 объектов', { exact: true })).toBeVisible();
    await page.keyboard.press('Control+Shift+z');
    await expect(page.getByText('3 объектов', { exact: true })).toBeVisible();
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('3 объектов', { exact: true })).toBeVisible();
    const beforeExport = await pixel(page, 250, 340);
    await page.getByRole('button', { name: 'Действия доски', exact: true }).click();
    const downloadReady = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Скачать PNG', exact: true }).click();
    const download = await downloadReady;
    const exported = await sharp(await readFile((await download.path())!)).extract({ left: 500, top: 680, width: 1, height: 1 }).ensureAlpha().raw().toBuffer();
    expect(Array.from(exported)).toEqual(beforeExport);
    await page.getByRole('button', { name: 'Ластик', exact: true }).click();
    await trace(page, [[300, 340], [300, 340]]);
    saved = (await (await context.request.get(`/api/boards/${current.id}`)).json()).document.elements;
    const fragments = saved.filter((item: { groupId?: string }) => item.groupId === marker.id);
    expect(fragments).toHaveLength(2);
    for (const fragment of fragments) expect(fragment).toMatchObject({ kind: 'stroke', color: '#22c55e', width: 40, opacity: .35 });
    const invalid = await context.request.put(`/api/boards/${current.id}`, { data: { title: current.board.title, revision: 4, document: { version: 1, elements: [{ ...marker, opacity: 2 }] } } });
    expect(invalid.status()).toBe(400);
  } finally { await cleanupWorkspaces([current.workspace], process.env.BB_E2E_IMAGE_DIRECTORY); }
});

test('each clicked tool opens its own settings below the toolbar; hotkey switches close settings and preserve tool parameters', async ({ page, context }) => {
  const current = await prepare(context);
  try {
    expect((await context.request.put('/api/preferences/tools', { data: { shortcuts: { eraser: { code: 'CapsLock', ctrl: false, alt: false, shift: false, meta: false } } } })).ok()).toBe(true);
    await page.goto('/');
    await expect(page.getByTestId('canvas')).toBeVisible();
    for (const tool of ['Выделение', 'Карандаш', 'Маркер', 'Ластик', 'Прямоугольник', 'Эллипс', 'Рука']) {
      await page.getByRole('button', { name: tool, exact: true }).click();
      const settings = page.getByRole('dialog', { name: `Настройки: ${tool}`, exact: true });
      await expect(settings).toBeVisible();
      expect((await settings.boundingBox())!.y).toBeGreaterThan((await page.getByRole('toolbar', { name: 'Инструменты рисования' }).boundingBox())!.y);
      await expect(page.getByRole('dialog')).toHaveCount(1);
    }
    await page.getByRole('button', { name: 'Увеличить масштаб в настройках', exact: true }).click();
    await expect(page.getByRole('button', { name: '120%', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Сбросить вид', exact: true }).click();
    await expect(page.getByRole('button', { name: '100%', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Маркер', exact: true }).click();
    await page.getByRole('slider', { name: 'Толщина маркера', exact: true }).fill('48');
    await page.getByRole('button', { name: 'Карандаш', exact: true }).click();
    await expect(page.getByRole('slider', { name: 'Толщина карандаша', exact: true })).toHaveValue('4');
    await page.getByRole('button', { name: 'Маркер', exact: true }).click();
    await expect(page.getByRole('slider', { name: 'Толщина маркера', exact: true })).toHaveValue('48');
    await page.getByRole('button', { name: 'Маркер', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Настройки: Маркер', exact: true })).toBeVisible();
    await page.keyboard.press('CapsLock');
    await expect(page.getByRole('button', { name: 'Ластик', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.keyboard.press('CapsLock');
    await expect(page.getByRole('button', { name: 'Маркер', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.setViewportSize({ width: 360, height: 800 });
    for (const tool of ['Выделение', 'Карандаш', 'Маркер', 'Ластик', 'Прямоугольник', 'Эллипс', 'Рука']) {
      await page.getByRole('button', { name: tool, exact: true }).click();
      const bounds = (await page.getByRole('dialog', { name: `Настройки: ${tool}`, exact: true }).boundingBox())!;
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(360);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
    await page.screenshot({ path: 'test-results/tool-settings-mobile.png', fullPage: true });
  } finally { await cleanupWorkspaces([current.workspace], process.env.BB_E2E_IMAGE_DIRECTORY); }
});

test('a coalesced curved stroke keeps intermediate points on a large board without repainting its saved contents on each move', async ({ page, context }) => {
  const elements = Array.from({ length: 1200 }, (_, i) => ({ id: randomUUID(), kind: 'stroke', color: '#64748b', width: 2,
    points: Array.from({ length: 80 }, (_, j) => j % 2 ? 500 + i % 80 + Math.sin(j) * 5 : i % 100 * 8 + Math.floor(j / 2)) }));
  const current = await prepare(context, elements);
  try {
    await page.goto('/');
    await expect(page.getByText('1200 объектов', { exact: true })).toBeVisible();
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const box = (await page.getByTestId('canvas').boundingBox())!;
    await page.getByTestId('canvas').locator('canvas').first().evaluate((node) => {
      const target = window as typeof window & { savedStrokeCalls: number };
      target.savedStrokeCalls = 0;
      const context = (node as HTMLCanvasElement).getContext('2d')!;
      const original = context.stroke.bind(context);
      context.stroke = (...args: Parameters<typeof original>) => { target.savedStrokeCalls++; original(...args); };
    });
    const path: [number, number][] = [[130, 300], [150, 260], [180, 245], [210, 260], [240, 300]];
    await page.evaluate(({ box, path }) => {
      let injected = false;
      window.addEventListener('pointermove', (event) => {
        if (!event.buttons || injected) return;
        injected = true;
        Object.defineProperty(event, 'getCoalescedEvents', { value: () => path.map(([x, y]) => ({ clientX: box.x + x, clientY: box.y + y })) });
      }, true);
    }, { box, path });
    await page.mouse.move(box.x + 100, box.y + 340);
    await page.mouse.down();
    await page.mouse.move(box.x + 260, box.y + 340);
    await expect.poll(async () => (await pixel(page, 180, 245, 1))[3]).toBeGreaterThan(0);
    expect(await page.evaluate(() => (window as typeof window & { savedStrokeCalls: number }).savedStrokeCalls)).toBe(0);
    await page.mouse.up();
    await expect(page.getByText('1201 объектов', { exact: true })).toBeVisible();
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    const saved = (await (await context.request.get(`/api/boards/${current.id}`)).json()).document.elements;
    expect(saved[1200].kind).toBe('stroke');
    const points = saved[1200].points as number[];
    for (const [x, y] of path) expect(points.some((value, i) => i % 2 === 0 && value === x && points[i + 1] === y)).toBe(true);
    await page.reload();
    await expect(page.getByText('1201 объектов', { exact: true })).toBeVisible();
    await expect.poll(async () => (await pixel(page, 180, 245))[3]).toBeGreaterThan(0);
  } finally { await cleanupWorkspaces([current.workspace], process.env.BB_E2E_IMAGE_DIRECTORY); }
});
