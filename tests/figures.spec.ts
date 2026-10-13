import { test, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { cleanupWorkspaces } from './asset-test-utils.cjs';

const choices = ['Треугольник', 'Квадрат', 'Прямоугольник', 'Круг', 'Овал', 'Прямая линия', 'Стрелка', 'Трапеция', 'Параллелепипед'];
async function prepare(context: BrowserContext) {
  const guest = await (await context.request.post('/api/auth/guest')).json();
  const board = await (await context.request.post('/api/boards', { data: { title: 'Figure picker test' } })).json();
  return { workspace: guest.workspaceId, id: board.id };
}
async function choose(page: Page, name: string) {
  await page.getByRole('toolbar', { name: 'Инструменты рисования' }).getByRole('button', { name: 'Фигуры', exact: true }).click();
  await page.getByRole('group', { name: 'Выбор фигуры', exact: true }).getByRole('button', { name, exact: true }).click();
  await page.keyboard.press('Escape');
}
async function draw(page: Page, start: [number, number], end: [number, number], modifier = false) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  if (modifier) await page.keyboard.down('Shift');
  await page.mouse.move(box.x + start[0], box.y + start[1]);
  await page.mouse.down();
  await page.mouse.move(box.x + end[0], box.y + end[1], { steps: 8 });
  await page.mouse.up();
  if (modifier) await page.keyboard.up('Shift');
}

test('one shape tool draws all nine choices, persists geometry and exports their visible contours', async ({ page, context }) => {
  const current = await prepare(context);
  try {
    await page.goto('/');
    const toolbar = page.getByRole('toolbar', { name: 'Инструменты рисования' });
    await expect(toolbar.getByRole('button', { name: 'Прямоугольник', exact: true })).toHaveCount(0);
    await expect(toolbar.getByRole('button', { name: 'Эллипс', exact: true })).toHaveCount(0);
    for (let i = 0; i < choices.length; i++) {
      await choose(page, choices[i]);
      const x = 100 + i % 3 * 260, y = 260 + Math.floor(i / 3) * 160;
      await draw(page, [x, y], [x + 160, y + 100]);
      await expect(page.getByText(`${i + 1} объектов`, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    const saved = await (await context.request.get(`/api/boards/${current.id}`)).json();
    expect(saved.document.elements.map((element: { kind: string }) => element.kind)).toEqual(['triangle', 'rectangle', 'rectangle', 'ellipse', 'ellipse', 'line', 'arrow', 'trapezoid', 'parallelepiped']);
    for (const element of saved.document.elements) expect(element.points).toHaveLength(4);
    for (const index of [1, 3]) {
      const points = saved.document.elements[index].points;
      expect(Math.abs(points[2] - points[0])).toBe(Math.abs(points[3] - points[1]));
    }
    await page.getByRole('button', { name: 'Отменить', exact: true }).click();
    await expect(page.getByText('8 объектов', { exact: true })).toBeVisible();
    await page.keyboard.press('Control+Shift+z');
    await expect(page.getByText('9 объектов', { exact: true })).toBeVisible();
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByText('9 объектов', { exact: true })).toBeVisible();
    const samples: [number, number][] = [[180, 260], [360, 310], [620, 310], [260, 500], [520, 470], [700, 470], [180, 630], [440, 680], [680, 605]];
    for (const [x, y] of samples) {
      await expect.poll(() => page.getByTestId('canvas').locator('canvas').first().evaluate((node, point) => {
        const canvas = node as HTMLCanvasElement, bounds = canvas.getBoundingClientRect();
        return canvas.getContext('2d')!.getImageData(Math.round(point.x * canvas.width / bounds.width), Math.round(point.y * canvas.height / bounds.height), 1, 1).data[3];
      }, { x, y })).toBeGreaterThan(0);
    }
    await page.getByRole('button', { name: 'Действия доски', exact: true }).click();
    const ready = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Скачать PNG', exact: true }).click();
    const download = await ready;
    const buffer = await readFile((await download.path())!);
    const info = await sharp(buffer).metadata();
    expect(info.format).toBe('png');
    const pixel = await sharp(buffer).extract({ left: 1360, top: 1210, width: 1, height: 1 }).raw().toBuffer();
    expect(pixel[0]).toBeLessThan(200);
    await page.getByRole('button', { name: 'Фигуры', exact: true }).click();
    await page.screenshot({ path: 'test-results/figures-picker.png', fullPage: true });
  } finally { await cleanupWorkspaces([current.workspace], process.env.BB_E2E_IMAGE_DIRECTORY); }
});

test('legacy primitive shortcuts and the new shape shortcut select figures, and the picker fits mobile', async ({ page, context }) => {
  const current = await prepare(context);
  const key = (code: string, ctrl = false) => ({ code, ctrl, alt: false, shift: false, meta: false });
  try {
    expect((await context.request.put('/api/preferences/tools', { data: { shortcuts: { rectangle: key('F2', true), ellipse: key('F3', true), shapes: key('CapsLock') } } })).ok()).toBe(true);
    await page.goto('/');
    await expect(page.getByTestId('canvas')).toBeVisible();
    await page.getByRole('button', { name: 'Настроить хоткей инструмента', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Хоткей: Карандаш', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Карандаш', exact: true }).click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+F2');
    const shapes = page.getByRole('toolbar', { name: 'Инструменты рисования' }).getByRole('button', { name: 'Фигуры', exact: true });
    await expect(shapes).toHaveAttribute('aria-pressed', 'true');
    await shapes.click();
    await expect(page.getByRole('group', { name: 'Выбор фигуры' }).getByRole('button', { name: 'Прямоугольник', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Control+F3');
    await shapes.click();
    await expect(page.getByRole('group', { name: 'Выбор фигуры' }).getByRole('button', { name: 'Овал', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('Control+F3');
    await expect(page.getByRole('button', { name: 'Карандаш', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('CapsLock');
    await expect(shapes).toHaveAttribute('aria-pressed', 'true');
    await choose(page, 'Стрелка');
    await draw(page, [300, 400], [140, 393], true);
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    const arrow = (await (await context.request.get(`/api/boards/${current.id}`)).json()).document.elements[0];
    expect(arrow.kind).toBe('arrow');
    expect(arrow.points[2]).toBeLessThan(arrow.points[0]);
    expect(arrow.points[3]).toBeCloseTo(arrow.points[1], 5);
    await page.setViewportSize({ width: 360, height: 800 });
    await shapes.click();
    const picker = page.getByRole('dialog', { name: 'Настройки: Фигуры', exact: true });
    const bounds = (await picker.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(360);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(800);
    await expect(picker.getByRole('group', { name: 'Выбор фигуры' }).getByRole('button')).toHaveCount(9);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
    await page.screenshot({ path: 'test-results/figures-mobile.png', fullPage: true });
  } finally { await cleanupWorkspaces([current.workspace], process.env.BB_E2E_IMAGE_DIRECTORY); }
});

test('new figure documents are validated and both point erasure and whole-group deletion work', async ({ page, context }) => {
  const current = await prepare(context);
  try {
    await page.goto('/');
    await choose(page, 'Параллелепипед');
    await draw(page, [100, 300], [300, 500]);
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    let saved = await (await context.request.get(`/api/boards/${current.id}`)).json();
    const original = saved.document.elements[0];
    for (const element of [{ ...original, points: [0, 0, 100, 100, 200, 200] }, { ...original, kind: 'unknown-shape' }]) {
      expect((await context.request.put(`/api/boards/${current.id}`, { data: { title: saved.title, revision: saved.revision, document: { version: 1, elements: [element] } } })).status()).toBe(400);
    }
    await page.getByRole('button', { name: 'Ластик', exact: true }).click();
    await page.keyboard.press('Escape');
    await draw(page, [175, 350], [175, 350]);
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    saved = await (await context.request.get(`/api/boards/${current.id}`)).json();
    expect(saved.document.elements.length).toBeGreaterThan(1);
    for (const part of saved.document.elements) expect(part).toMatchObject({ kind: 'stroke', groupId: original.id, color: original.color, width: original.width });
    await page.keyboard.down('Shift');
    await draw(page, [100, 450], [100, 450]);
    await page.keyboard.up('Shift');
    await expect(page.getByText('0 объектов', { exact: true })).toBeVisible();
  } finally { await cleanupWorkspaces([current.workspace], process.env.BB_E2E_IMAGE_DIRECTORY); }
});
