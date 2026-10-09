import { test, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { cleanupWorkspaces } from './asset-test-utils.cjs';

async function prepare(context: BrowserContext) {
  const guest = await (await context.request.post('/api/auth/guest')).json();
  const board = await (await context.request.post('/api/boards', { data: { title: 'Pinned tool panel test' } })).json();
  return { workspace: guest.workspaceId as string, id: board.id as string };
}
async function draw(page: Page, y = 480) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + y);
  await page.mouse.down();
  await page.mouse.move(box.x + 260, box.y + y + 20, { steps: 8 });
  await page.mouse.up();
}

test('pinning keeps the current tool settings visible while drawing and follows clicks, hotkeys, all boards and reloads', async ({ page, context, browser }) => {
  const current = await prepare(context);
  try {
    expect(await (await context.request.get('/api/preferences/tools/panel')).json()).toEqual({ pinned: false });
    expect((await context.request.put('/api/preferences/tools', { data: { shortcuts: { eraser: { code: 'CapsLock', ctrl: false, alt: false, shift: false, meta: false } } } })).ok()).toBe(true);
    await page.goto('/');
    const pen = page.getByRole('button', { name: 'Карандаш', exact: true });
    await pen.click();
    const pin = page.getByRole('checkbox', { name: 'Всегда показывать настройки', exact: true });
    await expect(pin).toBeEnabled();
    await expect(page.getByRole('toolbar', { name: 'Инструменты рисования' }).getByRole('checkbox', { name: 'Всегда показывать настройки' })).toHaveCount(1);
    const settingsBeforePin = page.getByRole('dialog', { name: 'Настройки: Карандаш', exact: true });
    await expect(settingsBeforePin.getByRole('checkbox')).toHaveCount(0);
    await expect(settingsBeforePin).not.toContainText('Нажмите модификатор');
    await expect(settingsBeforePin).not.toContainText('Для всех ваших досок');
    await expect(settingsBeforePin.getByRole('button', { name: 'Настроить хоткей', exact: true })).toHaveCount(0);
    expect((await pin.boundingBox())!.x).toBeLessThan((await pen.boundingBox())!.x);
    expect((await settingsBeforePin.boundingBox())!.height).toBeLessThan(200);
    await expect(pin).not.toBeChecked();
    await pin.click();
    await expect(pin).toBeEnabled();
    await expect(pin).toBeChecked();
    expect(await (await context.request.get('/api/preferences/tools/panel')).json()).toEqual({ pinned: true });
    await draw(page);
    await expect(page.getByText('1 объектов', { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Настройки: Карандаш', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Настройки: Карандаш', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Маркер', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Настройки: Маркер', exact: true })).toBeVisible();
    await draw(page, 580);
    await expect(page.getByRole('dialog', { name: 'Настройки: Маркер', exact: true })).toBeVisible();
    await page.keyboard.press('CapsLock');
    await expect(page.getByRole('dialog', { name: 'Настройки: Ластик', exact: true })).toBeVisible();
    await page.keyboard.press('CapsLock');
    await expect(page.getByRole('dialog', { name: 'Настройки: Маркер', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Фон доски', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Настройки фона', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Настройки: Маркер', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '+ Новая доска', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Название доски', exact: true })).toHaveValue('Новая доска');
    await expect(page.locator('.workspace--busy')).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'Настройки: Карандаш', exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('dialog', { name: 'Настройки: Карандаш', exact: true })).toBeVisible();
    await expect(pin).toBeChecked();
    const fresh = await browser.newContext({ baseURL: 'http://localhost:5174', storageState: await context.storageState() });
    try {
      const other = await fresh.newPage();
      await other.goto('/');
      await expect(other.getByRole('dialog', { name: 'Настройки: Карандаш', exact: true })).toBeVisible();
      await expect(other.getByRole('checkbox', { name: 'Всегда показывать настройки', exact: true })).toBeChecked();
    } finally { await fresh.close(); }
    await page.setViewportSize({ width: 360, height: 800 });
    const settings = page.getByRole('dialog', { name: 'Настройки: Карандаш', exact: true });
    const box = (await settings.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
    await page.screenshot({ path: 'test-results/pinned-tool-panel-mobile.png', fullPage: true });
    await pin.click();
    await expect.poll(async () => (await (await context.request.get('/api/preferences/tools/panel')).json()).pinned).toBe(false);
    await draw(page, 600);
    await expect(settings).toHaveCount(0);
    await page.reload();
    await expect(page.getByTestId('canvas')).toBeVisible();
    await expect(settings).toHaveCount(0);
    expect((await (await context.request.get('/api/preferences/tools')).json()).shortcuts.eraser.code).toBe('CapsLock');
  } finally { await cleanupWorkspaces([current.workspace], process.env.BB_E2E_IMAGE_DIRECTORY); }
});

test('panel preference validates booleans and stays isolated between users; a failed save leaves the original preference intact', async ({ page, context, browser }) => {
  const current = await prepare(context);
  const other = await browser.newContext({ baseURL: 'http://localhost:5174' });
  let otherWorkspace: string | undefined;
  try {
    expect((await other.request.get('/api/preferences/tools/panel')).status()).toBe(401);
    expect((await other.request.put('/api/preferences/tools/panel', { data: { pinned: true } })).status()).toBe(401);
    for (const data of [{ pinned: 'true' }, { pinned: null }, {}, { pinned: true, workspaceId: current.workspace }]) {
      expect((await context.request.put('/api/preferences/tools/panel', { data })).status()).toBe(400);
    }
    expect((await context.request.put('/api/preferences/tools/panel', { data: { pinned: true } })).ok()).toBe(true);
    otherWorkspace = (await (await other.request.post('/api/auth/guest')).json()).workspaceId;
    expect(await (await other.request.get('/api/preferences/tools/panel')).json()).toEqual({ pinned: false });
    await page.goto('/');
    const pin = page.getByRole('checkbox', { name: 'Всегда показывать настройки', exact: true });
    await expect(pin).toBeChecked();
    await page.route('**/api/preferences/tools/panel', (route) => route.request().method() === 'PUT'
      ? route.fulfill({ status: 503, json: { message: 'Настройка панели не сохранена' } }) : route.continue());
    await pin.click();
    await expect(page.getByRole('alert')).toContainText('Настройка панели не сохранена');
    await expect(pin).toBeChecked();
    expect(await (await context.request.get('/api/preferences/tools/panel')).json()).toEqual({ pinned: true });
    await page.unroute('**/api/preferences/tools/panel');
    await pin.click();
    await expect.poll(async () => (await (await context.request.get('/api/preferences/tools/panel')).json()).pinned).toBe(false);
  } finally {
    await other.close();
    await cleanupWorkspaces([current.workspace, ...(otherWorkspace ? [otherWorkspace] : [])], process.env.BB_E2E_IMAGE_DIRECTORY);
  }
});
