import { test, expect } from '@playwright/test';
import type { Page, BrowserContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import WebSocket from 'ws';
import { cleanupWorkspaces } from './asset-test-utils.cjs';

async function draw(page: Page, y = 350) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.move(box.x + 160, box.y + y); await page.mouse.down();
  await page.mouse.move(box.x + 310, box.y + y + 35, { steps: 12 }); await page.mouse.up();
}
async function connect(page: Page, link: string) {
  await page.goto(link);
  await expect(page.getByTestId('collaboration-status')).toContainText('Подключено');
}
async function enable(page: Page) {
  await page.getByRole('button', { name: 'Поделиться доской', exact: true }).click();
  await page.getByRole('button', { name: 'Включить общий доступ', exact: true }).click();
  const link = page.getByRole('textbox', { name: 'Ссылка на доску', exact: true });
  await expect(link).toBeVisible();
  const value = await link.inputValue();
  await page.getByRole('button', { name: 'Закрыть общий доступ', exact: true }).click();
  await expect(page.getByTestId('collaboration-status')).toContainText('Подключено');
  return value;
}
async function setup(page: Page, context: BrowserContext, owners: string[]) {
  const owner = await (await context.request.post('/api/auth/guest')).json(); owners.push(owner.workspaceId);
  const board = await (await context.request.post('/api/boards', { data: { title: 'Совместный урок' } })).json();
  await page.goto('/'); await expect(page.getByTestId('canvas')).toBeVisible();
  return board.id as string;
}

test('two independent participants see live strokes, merge concurrent drawing, undo only their edits and retain the board after reload', async ({ page, context, browser }) => {
  const owners: string[] = [];
  const student = await browser.newContext(); const pupil = await student.newPage();
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message)); pupil.on('pageerror', e => errors.push(e.message));
  try {
    const id = await setup(page, context, owners); const link = await enable(page);
    await connect(pupil, link);
    await page.getByRole('textbox', { name: 'Название доски', exact: true }).fill('Математика с учеником');
    await expect(pupil.getByRole('textbox', { name: 'Название доски', exact: true })).toHaveValue('Математика с учеником');
    expect((await (await student.request.get('http://localhost:5174/api/auth/session')).json()).kind).toBe('anonymous');
    const box = (await page.getByTestId('canvas').boundingBox())!;
    await page.mouse.move(box.x + 160, box.y + 300); await page.mouse.down();
    await page.mouse.move(box.x + 290, box.y + 350, { steps: 10 });
    await expect(pupil.getByTestId('canvas')).toHaveAttribute('data-remote-previews', '1');
    await expect(pupil.getByText('0 объектов', { exact: true })).toBeVisible();
    await draw(pupil, 450); await page.mouse.up();
    for (const client of [page, pupil]) await expect(client.getByText('2 объектов', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Отменить', exact: true }).click();
    for (const client of [page, pupil]) await expect(client.getByText('1 объектов', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect(pupil.getByText('2 объектов', { exact: true })).toBeVisible();
    await expect.poll(async () => (await (await context.request.get(`/api/boards/${id}`)).json()).document.elements.length).toBe(2);
    await pupil.reload(); await expect(pupil.getByText('2 объектов', { exact: true })).toBeVisible();
    await page.reload(); await expect(page.getByText('2 объектов', { exact: true })).toBeVisible();
    await pupil.setViewportSize({ width: 360, height: 800 });
    expect(await pupil.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
    expect(errors).toEqual([]);
  } finally { await student.close(); await cleanupWorkspaces(owners, process.env.BB_E2E_IMAGE_DIRECTORY); }
});

test('revocation disconnects an open student, rejects the old link forever and creates a different link on re-enable', async ({ page, context, browser }) => {
  const owners: string[] = []; const student = await browser.newContext(); const pupil = await student.newPage();
  try {
    await setup(page, context, owners); const old = await enable(page); await connect(pupil, old);
    await page.getByRole('button', { name: 'Поделиться доской', exact: true }).click();
    await page.getByRole('button', { name: 'Отключить общий доступ', exact: true }).click();
    await expect(pupil.getByRole('dialog', { name: 'Доска больше недоступна', exact: true })).toBeVisible();
    expect(new URL(pupil.url()).pathname).toBe('/');
    await page.getByRole('button', { name: 'Включить общий доступ', exact: true }).click();
    const link = await page.getByRole('textbox', { name: 'Ссылка на доску', exact: true }).inputValue(); expect(link).not.toBe(old);
    await pupil.goto(old); await expect(pupil.getByRole('dialog', { name: 'Доска больше недоступна', exact: true })).toBeVisible();
    await connect(pupil, link); await draw(pupil); await expect(page.getByText('1 объектов', { exact: true })).toBeVisible();
  } finally { await student.close(); await cleanupWorkspaces(owners, process.env.BB_E2E_IMAGE_DIRECTORY); }
});

test('disconnected shared edits survive reload and merge with new owner strokes without duplication', async ({ page, context, browser }) => {
  const owners: string[] = []; const student = await browser.newContext(); const pupil = await student.newPage();
  try {
    await setup(page, context, owners); const link = await enable(page); await connect(pupil, link);
    await student.setOffline(true);
    await expect(pupil.getByTestId('collaboration-status')).toContainText('Переподключение');
    await draw(pupil); await expect(pupil.getByText('Сохранено на устройстве', { exact: true })).toBeVisible();
    await draw(page, 500); await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    await student.setOffline(false); await pupil.reload();
    await expect(pupil.getByText('2 объектов', { exact: true })).toBeVisible();
    await expect(page.getByText('2 объектов', { exact: true })).toBeVisible();
    await pupil.reload(); await expect(pupil.getByText('2 объектов', { exact: true })).toBeVisible();
    await student.setOffline(true);
    await expect(pupil.getByTestId('collaboration-status')).toContainText('Переподключение');
    await draw(pupil, 600); await draw(page, 650);
    await student.setOffline(false);
    await expect(page.getByText('4 объектов', { exact: true })).toBeVisible();
    await expect(pupil.getByText('4 объектов', { exact: true })).toBeVisible();
  } finally { await student.close(); await cleanupWorkspaces(owners, process.env.BB_E2E_IMAGE_DIRECTORY); }
});

test('images work for both participants, export and undo; tokens cannot read unrelated assets or manage sharing', async ({ page, context, browser }) => {
  const owners: string[] = []; const student = await browser.newContext(); const pupil = await student.newPage();
  try {
    const id = await setup(page, context, owners);
    const png = await sharp({ create: { width: 100, height: 70, channels: 3, background: '#3b82f6' } }).png().toBuffer();
    await page.getByLabel('Загрузить изображения').setInputFiles({ name: 'owner.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    const unrelated = await (await context.request.post('/api/assets', { multipart: { file: { name: 'other.png', mimeType: 'image/png', buffer: png } } })).json();
    const link = await enable(page); const token = new URL(link).hash.slice(1); await connect(pupil, link);
    await expect.poll(() => pupil.locator('[data-testid="canvas"] canvas').first().evaluate(node => {
      const canvas = node as HTMLCanvasElement, pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      return pixels.some((v, i) => i % 4 === 0 && v === 59 && pixels[i + 1] === 130 && pixels[i + 2] === 246);
    })).toBe(true);
    await pupil.getByLabel('Загрузить изображения').setInputFiles({ name: 'student.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByText('2 объектов', { exact: true })).toBeVisible();
    await pupil.getByRole('button', { name: 'Отменить', exact: true }).click(); await expect(page.getByText('1 объектов', { exact: true })).toBeVisible();
    await pupil.getByRole('button', { name: 'Повторить', exact: true }).click(); await expect(page.getByText('2 объектов', { exact: true })).toBeVisible();
    const download = pupil.waitForEvent('download');
    await pupil.getByRole('button', { name: 'Действия доски', exact: true }).click(); await pupil.getByRole('button', { name: 'Скачать PNG', exact: true }).click();
    const pixels = await sharp((await (await download).path())!).ensureAlpha().raw().toBuffer();
    expect(pixels.some((v, i) => i % 4 === 0 && v === 59 && pixels[i + 1] === 130 && pixels[i + 2] === 246)).toBe(true);
    const headers = { 'X-Board-Token': token };
    expect((await student.request.get(`http://localhost:5174/api/collaboration/${id}/assets/${unrelated.id}`, { headers })).status()).toBe(404);
    expect((await student.request.get(`http://localhost:5174/api/boards/${id}`, { headers })).status()).toBe(401);
    expect((await student.request.put(`http://localhost:5174/api/collaboration/${id}/sharing`, { headers, data: { enabled: false } })).status()).toBe(404);
    expect((await student.request.get(`http://localhost:5174/api/collaboration/${randomUUID()}/assets/${unrelated.id}`, { headers })).status()).toBe(404);
    await context.request.put(`/api/collaboration/${id}/sharing`, { data: { enabled: false } });
    expect((await student.request.get(`http://localhost:5174/api/collaboration/${id}/assets/${unrelated.id}`, { headers })).status()).toBe(404);
  } finally { await student.close(); await cleanupWorkspaces(owners, process.env.BB_E2E_IMAGE_DIRECTORY); }
});

test('socket rejects foreign origins, deduplicates retries and refuses mutations after revocation', async ({ context, page }) => {
  const owners: string[] = []; const sockets: WebSocket[] = [];
  try {
    const id = await setup(page, context, owners);
    const token = (await (await context.request.put(`/api/collaboration/${id}/sharing`, { data: { enabled: true } })).json()).token;
    const denied = new WebSocket('ws://localhost:3102/api/collaboration/socket', { origin: 'https://foreign.example' });
    sockets.push(denied);
    const status = await new Promise<number>(resolve => { denied.on('unexpected-response', (_, response) => resolve(response.statusCode!)); denied.on('error', () => {}); }); expect(status).toBe(403);
    const socket = new WebSocket('ws://localhost:3102/api/collaboration/socket', { origin: 'http://localhost:5174' }); sockets.push(socket);
    const messages: any[] = []; socket.on('message', bytes => messages.push(JSON.parse(bytes.toString())));
    await new Promise<void>(resolve => socket.on('open', resolve)); socket.send(JSON.stringify({ type: 'join', token }));
    await expect.poll(() => messages.some(m => m.type === 'ready')).toBe(true);
    const element = { id: randomUUID(), kind: 'stroke', color: '#355dff', width: 4, points: [10, 10, 20, 20] };
    const message = { type: 'operation', operationId: randomUUID(), operation: { elements: [{ id: element.id, before: null, after: element }] } };
    socket.send(JSON.stringify(message)); socket.send(JSON.stringify(message));
    await expect.poll(() => messages.filter(m => m.type === 'ack').length).toBe(2);
    const board = await (await context.request.get(`/api/boards/${id}`)).json(); expect(board.revision).toBe(1); expect(board.document.elements).toHaveLength(1);
    socket.send(JSON.stringify({ type: 'operation', operationId: randomUUID(), operation: { elements: [{ id: element.id, before: element, after: { ...element, src: 'https://foreign.example/pixel' } }] } }));
    await expect.poll(() => messages.some(m => m.type === 'error')).toBe(true);
    await context.request.put(`/api/collaboration/${id}/sharing`, { data: { enabled: false } });
    await expect.poll(() => messages.some(m => m.type === 'unavailable')).toBe(true);
    expect((await (await context.request.get(`/api/boards/${id}`)).json()).revision).toBe(1);
  } finally { sockets.forEach(s => s.terminate()); await cleanupWorkspaces(owners, process.env.BB_E2E_IMAGE_DIRECTORY); }
});

test('an older full-document draft is offered as a separate copy after sharing is enabled elsewhere', async ({ page, context }) => {
  const owners: string[] = [];
  try {
    const id = await setup(page, context, owners);
    const board = await (await context.request.get(`/api/boards/${id}`)).json();
    const element = { id: randomUUID(), kind: 'stroke', color: '#355dff', width: 4, points: [10, 10, 20, 20] };
    await page.evaluate(draft => localStorage.setItem(`whiteboard:draft:${draft.id}`, JSON.stringify(draft)), { ...board, document: { version: 1, elements: [element] } });
    await context.request.put(`/api/collaboration/${id}/sharing`, { data: { enabled: true } });
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('до включения совместной работы');
    await page.getByRole('button', { name: 'Сохранить как новую доску', exact: true }).click();
    await expect(page.getByText('1 объектов', { exact: true })).toBeVisible();
    expect((await (await context.request.get(`/api/boards/${id}`)).json()).document.elements).toEqual([]);
    const list = await (await context.request.get('/api/boards')).json(); expect(list).toHaveLength(2);
    const copy = await (await context.request.get(`/api/boards/${list.find((b: { id: string }) => b.id !== id).id}`)).json();
    expect(copy.document.elements).toEqual([element]);
  } finally { await cleanupWorkspaces(owners, process.env.BB_E2E_IMAGE_DIRECTORY); }
});

test('shared storage failures remain visible instead of claiming an offline drawing is saved on the device', async ({ page, context, browser }) => {
  const owners: string[] = []; const student = await browser.newContext(); const pupil = await student.newPage();
  try {
    await setup(page, context, owners); const link = await enable(page);
    await pupil.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function(key, value) {
        if (key.startsWith('whiteboard:shared-draft:')) throw new DOMException('Quota exceeded', 'QuotaExceededError');
        return original.call(this, key, value);
      };
    });
    await connect(pupil, link); await student.setOffline(true);
    await expect(pupil.getByTestId('collaboration-status')).toContainText('Переподключение');
    await draw(pupil);
    await expect(pupil.getByRole('alert')).toContainText('Локальная резервная копия недоступна');
    await expect(pupil.getByText('Сохранено на устройстве', { exact: true })).toHaveCount(0);
    await student.setOffline(false);
    await expect(page.getByText('1 объектов', { exact: true })).toBeVisible();
    await expect(pupil.getByText('Сохранено', { exact: true })).toBeVisible();
  } finally { await student.close(); await cleanupWorkspaces(owners, process.env.BB_E2E_IMAGE_DIRECTORY); }
});
