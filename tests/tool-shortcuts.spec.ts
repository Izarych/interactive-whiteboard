import { test, expect } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
import { cleanupWorkspaces } from './asset-test-utils.cjs';

const shortcut = (code: string, ctrl = false) => ({ code, ctrl, alt: false, shift: false, meta: false });
async function prepare(context: BrowserContext) {
  const guest = await (await context.request.post('/api/auth/guest')).json();
  const board = await (await context.request.post('/api/boards', { data: { title: 'Shortcut board' } })).json();
  return { workspace: guest.workspaceId, board };
}
async function assign(page: Page, tool: string, keys: string, label: string) {
  await page.getByRole('button', { name: tool, exact: true }).click({ button: 'right' });
  const dialog = page.getByRole('dialog', { name: 'Хоткей инструмента', exact: true });
  const input = dialog.getByRole('textbox', { name: `Хоткей: ${tool}`, exact: true });
  await expect(input).toBeEnabled();
  await input.focus();
  await page.keyboard.press(keys);
  await expect(input).toHaveValue(label);
  await dialog.getByRole('button', { name: 'Сохранить хоткей', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Хоткей сохранён');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
}

test('CapsLock is opt-in, toggles back, ignores key repeat and text input, and persists across boards and browser sessions', async ({ page, context, browser }) => {
  const current = await prepare(context);
  try {
    expect(await (await context.request.get('/api/preferences/tools')).json()).toEqual({ shortcuts: {} });
    await page.goto('/');
    const pen = page.getByRole('button', { name: 'Карандаш', exact: true });
    const eraser = page.getByRole('button', { name: 'Ластик', exact: true });
    await expect(pen).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.press('CapsLock');
    await expect(pen).toHaveAttribute('aria-pressed', 'true');
    await assign(page, 'Ластик', 'CapsLock', 'CapsLock');
    await page.keyboard.down('CapsLock');
    await expect(eraser).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.down('CapsLock');
    await expect(eraser).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.up('CapsLock');
    await page.keyboard.press('CapsLock');
    await expect(pen).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('textbox', { name: 'Название доски', exact: true }).focus();
    await page.keyboard.press('CapsLock');
    await expect(pen).toHaveAttribute('aria-pressed', 'true');
    await pen.click();
    await page.getByRole('button', { name: '+ Новая доска', exact: true }).click();
    await expect(page.getByText('0 объектов', { exact: true })).toBeVisible();
    await page.keyboard.press('CapsLock');
    await expect(eraser).toHaveAttribute('aria-pressed', 'true');
    await page.reload();
    await expect(pen).toHaveAttribute('aria-pressed', 'true');
    await expect(pen).toBeEnabled();
    await expect.poll(async () => (await (await context.request.get('/api/preferences/tools')).json()).shortcuts).toEqual({ eraser: shortcut('CapsLock') });
    await page.getByRole('button', { name: 'Настроить хоткей инструмента', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Инструмент для хоткея' })).toBeEnabled();
    await page.getByRole('combobox', { name: 'Инструмент для хоткея' }).selectOption('eraser');
    await expect(page.getByRole('textbox', { name: 'Хоткей: Ластик' })).toHaveValue('CapsLock');
    await pen.click();
    const fresh = await browser.newContext({ baseURL: 'http://localhost:5174', storageState: await context.storageState() });
    try {
      const freshPage = await fresh.newPage();
      await freshPage.goto('/');
      await freshPage.getByRole('button', { name: 'Настроить хоткей инструмента', exact: true }).click();
      await expect(freshPage.getByRole('textbox', { name: 'Хоткей: Карандаш' })).toBeEnabled();
      await freshPage.getByRole('button', { name: 'Карандаш', exact: true }).click();
      await freshPage.keyboard.press('CapsLock');
      await expect(freshPage.getByRole('button', { name: 'Ластик', exact: true })).toHaveAttribute('aria-pressed', 'true');
    } finally { await fresh.close(); }
    await eraser.click({ button: 'right' });
    await page.getByRole('button', { name: 'Убрать хоткей', exact: true }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Хоткей убран' })).toBeVisible();
    await pen.click();
    await page.keyboard.press('CapsLock');
    await expect(pen).toHaveAttribute('aria-pressed', 'true');
    expect(await (await context.request.get('/api/preferences/tools')).json()).toEqual({ shortcuts: {} });
  } finally { await cleanupWorkspaces([current.workspace], process.env.BB_E2E_IMAGE_DIRECTORY); }
});

test('combination hotkeys finish active strokes, return to the prior tool, and reject duplicates and reserved combinations', async ({ page, context }) => {
  const current = await prepare(context);
  try {
    await page.goto('/');
    await expect(page.getByTestId('canvas')).toBeVisible();
    await assign(page, 'Рука', 'Control+F1', 'Ctrl + F1');
    const box = (await page.getByTestId('canvas').boundingBox())!;
    await page.mouse.move(box.x + 100, box.y + 260);
    await page.mouse.down();
    await page.mouse.move(box.x + 260, box.y + 280, { steps: 8 });
    await page.keyboard.press('Control+F1');
    await page.mouse.up();
    await expect(page.getByRole('button', { name: 'Рука', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText('1 объектов', { exact: true })).toBeVisible();
    await page.keyboard.press('Control+F1');
    await expect(page.getByRole('button', { name: 'Карандаш', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Эллипс', exact: true }).click();
    await page.keyboard.press('Control+F1');
    await page.keyboard.press('Control+F1');
    await expect(page.getByRole('button', { name: 'Эллипс', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Ластик', exact: true }).click({ button: 'right' });
    const input = page.getByRole('textbox', { name: 'Хоткей: Ластик', exact: true });
    await input.focus();
    await page.keyboard.press('Control+F1');
    await expect(page.getByRole('alert')).toContainText('уже назначен: Рука');
    await page.keyboard.press('Control+z');
    await expect(page.getByRole('alert')).toContainText('отмены, повтора и вставки');
    await page.keyboard.press('Escape');
    await expect(input).toHaveValue('Не назначен');
    await page.setViewportSize({ width: 360, height: 800 });
    const dialogBox = (await page.getByRole('dialog', { name: 'Хоткей инструмента' }).boundingBox())!;
    expect(dialogBox.x).toBeGreaterThanOrEqual(0);
    expect(dialogBox.x + dialogBox.width).toBeLessThanOrEqual(360);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
    await page.screenshot({ path: 'test-results/tool-shortcuts-mobile.png', fullPage: true });
  } finally { await cleanupWorkspaces([current.workspace], process.env.BB_E2E_IMAGE_DIRECTORY); }
});

test('shortcut API validates configuration and isolates different workspaces', async ({ context, browser }) => {
  const current = await prepare(context);
  const other = await browser.newContext({ baseURL: 'http://localhost:5174' });
  let otherWorkspace: string | undefined;
  try {
    expect((await other.request.get('/api/preferences/tools')).status()).toBe(401);
    expect((await other.request.put('/api/preferences/tools', { data: { shortcuts: {} } })).status()).toBe(401);
    expect((await context.request.put('/api/preferences/tools', { data: { shortcuts: { eraser: shortcut('CapsLock') } } })).status()).toBe(200);
    const configured = { eraser: shortcut('CapsLock'), highlighter: shortcut('F1', true) };
    expect((await context.request.put('/api/preferences/tools', { data: { shortcuts: configured } })).status()).toBe(200);
    for (const shortcuts of [{ eraser: shortcut('ShiftLeft') }, { eraser: shortcut('KeyZ', true) }, { eraser: shortcut('CapsLock'), hand: shortcut('CapsLock') }, { unknown: shortcut('KeyA') }, { eraser: null }]) {
      expect((await context.request.put('/api/preferences/tools', { data: { shortcuts } })).status()).toBe(400);
    }
    otherWorkspace = (await (await other.request.post('/api/auth/guest')).json()).workspaceId;
    expect(await (await other.request.get('/api/preferences/tools')).json()).toEqual({ shortcuts: {} });
    expect(await (await context.request.get('/api/preferences/tools')).json()).toEqual({ shortcuts: configured });
  } finally {
    await other.close();
    await cleanupWorkspaces([current.workspace, ...(otherWorkspace ? [otherWorkspace] : [])], process.env.BB_E2E_IMAGE_DIRECTORY);
  }
});
