import { test, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { cleanupWorkspaces } from './asset-test-utils.cjs';

async function prepare(context: BrowserContext, page: Page) {
  await context.addInitScript(() => {
    Object.defineProperty(window, '__BLUVIBOARD_DESKTOP__', { value: true });
    Object.defineProperty(window, '__BLUVIBOARD_DESKTOP_VERSION__', { value: '0.2.0' });
  });
  await context.route('**/api/desktop/latest', (route) => route.fulfill({ json: { release: null } }));
  const guest = await (await context.request.post('/api/auth/guest')).json();
  const board = await (await context.request.post('/api/boards', { data: { title: 'Offline sync test' } })).json();
  await page.goto('/');
  await expect(page.getByTestId('canvas')).toBeVisible();
  return { workspace: guest.workspaceId, board };
}

async function draw(page: Page, y = 300) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + 250, box.y + y + 30, { steps: 4 });
  await page.mouse.up();
}

test('desktop keeps drawing quietly through repeated server failures and syncs the latest edits without an online event', async ({ page, context }) => {
  const { workspace, board } = await prepare(context, page);
  let failing = true, attempts = 0, pending = 0, maximum = 0;
  try {
    const dialogs: string[] = [];
    page.on('dialog', (dialog) => { dialogs.push(dialog.message()); void dialog.dismiss(); });
    await page.route(`**/api/boards/${board.id}`, async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      attempts++; pending++; maximum = Math.max(maximum, pending);
      if (failing) await route.fulfill({ status: 503, json: { message: 'Server is restarting' } });
      else await route.fulfill({ response: await route.fetch() });
      pending--;
    });
    await draw(page);
    await expect(page.getByText('Сохранено на устройстве', { exact: true })).toBeVisible();
    await expect.poll(() => attempts, { timeout: 10000 }).toBeGreaterThanOrEqual(2);
    const before = attempts;
    for (let i = 0; i < 4; i++) await draw(page, 400 + i * 40);
    await expect(page.getByText('5 объектов', { exact: true })).toBeVisible();
    await expect(page.getByText('Сохранено на устройстве', { exact: true })).toBeVisible();
    // Drawing cannot reset the backoff and trigger a write for each stroke.
    expect(attempts).toBe(before);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('.pwa-app')).not.toHaveAttribute('inert', '');
    expect(await page.evaluate(() => navigator.onLine)).toBe(true);
    expect(await page.evaluate((id) => JSON.parse(localStorage.getItem(`whiteboard:draft:${id}`)!).document.elements.length, board.id)).toBe(5);
    failing = false;
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible({ timeout: 12000 });
    expect((await (await context.request.get(`/api/boards/${board.id}`)).json()).document.elements).toHaveLength(5);
    expect(await page.evaluate((id) => localStorage.getItem(`whiteboard:draft:${id}`), board.id)).toBeNull();
    expect(maximum).toBe(1);
    expect(dialogs).toEqual([]);
  } finally { await cleanupWorkspaces([workspace], process.env.BB_E2E_IMAGE_DIRECTORY); }
});

test('a disconnected desktop catches up automatically on reconnect', async ({ page, context }) => {
  const { workspace, board } = await prepare(context, page);
  try {
    await context.setOffline(true);
    await draw(page);
    await expect(page.getByText('Сохранено на устройстве', { exact: true })).toBeVisible();
    await draw(page, 400);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await context.setOffline(false);
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    expect((await (await context.request.get(`/api/boards/${board.id}`)).json()).document.elements).toHaveLength(2);
  } finally {
    await context.setOffline(false);
    await cleanupWorkspaces([workspace], process.env.BB_E2E_IMAGE_DIRECTORY);
  }
});

test('a lost save response is acknowledged without overwriting or duplicating edits made during the outage', async ({ page, context }) => {
  const { workspace, board } = await prepare(context, page);
  let loseReply = true;
  try {
    await page.route(`**/api/boards/${board.id}`, async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      if (loseReply) {
        loseReply = false;
        expect((await route.fetch()).ok()).toBe(true);
        return route.abort('connectionreset');
      }
      return route.fulfill({ response: await route.fetch() });
    });
    await draw(page);
    await expect(page.getByText('Сохранено на устройстве', { exact: true })).toBeVisible();
    await draw(page, 400);
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible({ timeout: 10000 });
    const saved = await (await context.request.get(`/api/boards/${board.id}`)).json();
    expect(saved.document.elements).toHaveLength(2);
    expect(saved.revision).toBe(2);
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally { await cleanupWorkspaces([workspace], process.env.BB_E2E_IMAGE_DIRECTORY); }
});

test('recovery never overwrites a different version saved by another client', async ({ page, context }) => {
  const { workspace, board } = await prepare(context, page);
  let failing = true, attempts = 0;
  try {
    await page.route(`**/api/boards/${board.id}`, async (route) => {
      if (route.request().method() !== 'PUT') return route.continue();
      attempts++;
      return failing ? route.fulfill({ status: 502, body: 'Bad Gateway' }) : route.fulfill({ response: await route.fetch() });
    });
    await draw(page);
    await expect(page.getByText('Сохранено на устройстве', { exact: true })).toBeVisible();
    expect((await context.request.put(`/api/boards/${board.id}`, { data: { title: 'Another client', document: board.document, revision: board.revision } })).ok()).toBe(true);
    failing = false;
    await expect(page.getByText('Не сохранено', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: 'Сохранить как новую доску', exact: true })).toBeVisible();
    const writes = attempts;
    await page.waitForTimeout(4500);
    expect(attempts).toBe(writes);
    const remote = await (await context.request.get(`/api/boards/${board.id}`)).json();
    expect(remote.title).toBe('Another client');
    expect(remote.document.elements).toHaveLength(0);
    expect(await page.evaluate((id) => JSON.parse(localStorage.getItem(`whiteboard:draft:${id}`)!).document.elements.length, board.id)).toBe(1);
  } finally { await cleanupWorkspaces([workspace], process.env.BB_E2E_IMAGE_DIRECTORY); }
});

test('storage failure is never hidden behind a saved-on-device status', async ({ page, context }) => {
  const { workspace, board } = await prepare(context, page);
  try {
    await page.evaluate(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith('whiteboard:draft:')) throw new DOMException('Storage full', 'QuotaExceededError');
        original.call(this, key, value);
      };
    });
    await page.route(`**/api/boards/${board.id}`, (route) => route.request().method() === 'PUT' ? route.abort('connectionreset') : route.continue());
    await draw(page);
    await expect(page.getByText('Не сохранено', { exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('Локальная резервная копия недоступна');
    await expect(page.getByText('Сохранено на устройстве', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('alert')).not.toContainText('и в локальной резервной копии');
    await page.unroute(`**/api/boards/${board.id}`);
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally { await cleanupWorkspaces([workspace], process.env.BB_E2E_IMAGE_DIRECTORY); }
});
