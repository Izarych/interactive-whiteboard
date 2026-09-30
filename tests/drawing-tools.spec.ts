import { test, expect } from '@playwright/test';
import type { Page, BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { cleanupWorkspaces } from './asset-test-utils.cjs';

async function board(context: BrowserContext, elements: object[] = []) {
  const guest = await (await context.request.post('/api/auth/guest')).json();
  const created = await (await context.request.post('/api/boards', { data: { title: 'Drawing tools test' } })).json();
  if (elements.length) {
    const response = await context.request.put(`/api/boards/${created.id}`, { data: { title: created.title, revision: 0, document: { version: 1, elements } } });
    expect(response.ok()).toBe(true);
  }
  return { id: created.id as string, workspace: guest.workspaceId as string };
}

async function trace(page: Page, points: [number, number][], modifier?: string) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.move(box.x + points[0][0], box.y + points[0][1]);
  await page.mouse.down();
  for (const [x, y] of points.slice(1)) await page.mouse.move(box.x + x, box.y + y, { steps: 8 });
  await page.mouse.up();
  if (modifier) await page.keyboard.up(modifier);
}

async function saved(page: Page, context: BrowserContext, id: string) {
  await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
  return (await (await context.request.get(`/api/boards/${id}`)).json()).document.elements as { id: string; groupId?: string; kind: string; points: number[] }[];
}

test('Shift recognises a hand-drawn line and square, and the shape modifier can be changed and persists', async ({ page, context }) => {
  const current = await board(context);
  try {
    await page.goto('/');
    await expect(page.getByTestId('canvas')).toBeVisible();
    await trace(page, [[100, 260], [180, 265], [260, 257], [340, 263]], 'Shift');
    await trace(page, [[420, 260], [570, 263], [568, 411], [419, 408], [420, 260]], 'Shift');
    let elements = await saved(page, context, current.id);
    expect(elements[0].points).toHaveLength(4);
    expect(elements[0].points[1]).toBe(elements[0].points[3]);
    expect(elements[1].kind).toBe('rectangle');
    expect(Math.abs(elements[1].points[2] - elements[1].points[0])).toBeCloseTo(Math.abs(elements[1].points[3] - elements[1].points[1]), 5);
    await page.getByRole('button', { name: 'Цвет и толщина', exact: true }).click();
    await page.getByLabel('Хоткей выравнивания фигур').selectOption('Control');
    await page.keyboard.press('Escape');
    await trace(page, [[100, 520], [200, 526], [280, 515], [360, 523]], 'Control');
    await trace(page, [[430, 520], [530, 526], [610, 515], [690, 523]], 'Shift');
    elements = await saved(page, context, current.id);
    expect(elements[2].points).toHaveLength(4);
    expect(elements[3].points.length).toBeGreaterThan(4);
    await page.reload();
    await page.getByRole('button', { name: 'Цвет и толщина', exact: true }).click();
    await expect(page.getByLabel('Хоткей выравнивания фигур')).toHaveValue('Control');
  } finally { await cleanupWorkspaces([current.workspace], process.env.BB_E2E_IMAGE_DIRECTORY); }
});

test('point erasure preserves line ends, saves grouped fragments, and Shift removes the entire original contour', async ({ page, context }) => {
  const lineId = randomUUID(), rectangleId = randomUUID();
  const current = await board(context, [
    { id: lineId, kind: 'stroke', color: '#202938', width: 4, points: [100, 300, 500, 300] },
    { id: rectangleId, kind: 'rectangle', color: '#202938', width: 4, points: [600, 300, 800, 500] },
  ]);
  try {
    await page.goto('/');
    await expect(page.getByText('2 объектов', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Ластик', exact: true }).click();
    await trace(page, [[300, 300], [300, 300]]);
    let elements = await saved(page, context, current.id);
    expect(elements).toHaveLength(3);
    const fragments = elements.filter((item) => item.groupId === lineId);
    expect(fragments).toHaveLength(2);
    expect(fragments[0].points[0]).toBe(100);
    expect(fragments[0].points[2]).toBeLessThan(300);
    expect(fragments[1].points[0]).toBeGreaterThan(300);
    expect(fragments[1].points[2]).toBe(500);
    await page.keyboard.press('Control+z');
    await expect(page.getByText('2 объектов', { exact: true })).toBeVisible();
    await page.keyboard.press('Control+Shift+z');
    await expect(page.getByText('3 объектов', { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole('button', { name: 'Ластик', exact: true }).click();
    await trace(page, [[140, 300], [140, 300]], 'Shift');
    elements = await saved(page, context, current.id);
    expect(elements).toHaveLength(1);
    expect(elements[0].id).toBe(rectangleId);
    await trace(page, [[700, 300], [700, 300]]);
    elements = await saved(page, context, current.id);
    expect(elements).toHaveLength(1);
    expect(elements[0]).toMatchObject({ kind: 'stroke', groupId: rectangleId });
    await page.mouse.move(10, 10);
    await expect.poll(() => page.locator('[data-testid="canvas"] canvas').first().evaluate((node) => {
      const canvas = node as HTMLCanvasElement;
      const bounds = canvas.getBoundingClientRect();
      return canvas.getContext('2d')!.getImageData(Math.round(700 * canvas.width / bounds.width), Math.round(300 * canvas.height / bounds.height), 1, 1).data[3];
    })).toBe(0);
    await trace(page, [[600, 350], [600, 350]], 'Shift');
    await expect(page.getByText('0 объектов', { exact: true })).toBeVisible();
  } finally { await cleanupWorkspaces([current.workspace], process.env.BB_E2E_IMAGE_DIRECTORY); }
});

test('eraser follows fast movement and camera zoom, and a cancelled eraser gesture is reversible', async ({ page, context }) => {
  const id = randomUUID();
  const current = await board(context, [{ id, kind: 'stroke', color: '#202938', width: 4, points: [100, 400, 600, 400] }]);
  try {
    await page.goto('/');
    await expect(page.getByText('1 объектов', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Увеличить масштаб' }).click();
    await expect(page.getByRole('button', { name: '120%', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Ластик', exact: true }).click();
    const box = (await page.getByTestId('canvas').boundingBox())!;
    const x = 350 * 1.2 - box.width * .1, y = 400 * 1.2 - box.height * .1;
    await trace(page, [[x, y - 100], [x, y + 100]]);
    let elements = await saved(page, context, current.id);
    expect(elements).toHaveLength(2);
    expect(elements.every((item) => item.groupId === id)).toBe(true);
    await page.mouse.move(box.x + 200 * 1.2 - box.width * .1, box.y + y);
    await page.mouse.down();
    await page.keyboard.press('Control+z');
    await page.mouse.up();
    elements = await saved(page, context, current.id);
    expect(elements).toHaveLength(2);
    await page.keyboard.press('Control+z');
    await expect(page.getByText('1 объектов', { exact: true })).toBeVisible();
  } finally { await cleanupWorkspaces([current.workspace], process.env.BB_E2E_IMAGE_DIRECTORY); }
});
