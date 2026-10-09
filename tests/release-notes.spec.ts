import { test, expect } from '@playwright/test';
import { version as appVersion } from '../apps/web/package.json';
import { version as nativeVersion } from '../apps/desktop/package.json';
import { cleanupWorkspaces } from './asset-test-utils.cjs';
import { registerDifferentBuild, cleanupWorkerFixtures } from './pwa-test-utils.cjs';

test.afterEach(cleanupWorkerFixtures);

const webKey = 'bluviboard:release-seen';
const nativeKey = 'bluviboard:desktop-release-seen';
const pendingKey = 'bluviboard:release-after-update';
const historyTitles = [`BluviBoard ${appVersion}`, 'BluviBoard 1.3.1', 'BluviBoard 1.3.0'];

test('a newer browser version shows bundled notes, remembers dismissal, and allows reopening on mobile', async ({ page }) => {
  await page.goto('/');
  await page.evaluate((key) => localStorage.setItem(key, '1.2.0'), webKey);
  await page.reload();
  const dialog = page.getByRole('dialog', { name: 'Что нового', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: `BluviBoard ${appVersion}`, exact: true })).toBeVisible();
  await expect(dialog.locator('article > h3')).toHaveText(historyTitles);
  await expect(dialog).not.toContainText('Последние три версии BluviBoard — от новой к старым');
  await expect(dialog).not.toContainText('BluviBoard 1.1.1');
  await expect(dialog).toContainText('Полупрозрачный маркер');
  await expect(page.locator('.pwa-app')).toHaveAttribute('inert', '');
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Понятно', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Закрыть описание обновления', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), webKey)).toBe(appVersion);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'С возвращением', exact: true })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Что нового', exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('article > h3')).toHaveText(historyTitles);
  await page.setViewportSize({ width: 360, height: 800 });
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(360);
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(800);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
  const history = dialog.getByRole('region', { name: 'История изменений', exact: true });
  await history.focus();
  await page.keyboard.press('Control+End');
  await expect.poll(() => history.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await expect(dialog).toContainText('Плавность штрихов');
  await page.screenshot({ path: 'test-results/release-notes-mobile.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Понятно', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('a worker-only update does not repeat acknowledged release notes, even with a legacy update-click marker', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toContain('/sw.js');
  await registerDifferentBuild(page);
  const notice = page.getByRole('region', { name: 'Обновление BluviBoard', exact: true });
  await expect(notice).toBeVisible();
  const dialog = page.getByRole('dialog', { name: 'Что нового', exact: true });
  await expect(dialog).toHaveCount(0);
  const reloaded = page.waitForEvent('framenavigated', { predicate: (frame) => frame === page.mainFrame() });
  await page.evaluate((key) => sessionStorage.setItem(key, String(Date.now())), pendingKey);
  await notice.getByRole('button', { name: 'Обновить', exact: true }).click();
  await reloaded;
  await expect(page.getByRole('heading', { name: 'С возвращением', exact: true })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate((key) => sessionStorage.getItem(key), pendingKey)).toBeNull();
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state ?? null)).toBeNull();
  await expect(notice).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'С возвращением', exact: true })).toBeVisible();
  await expect(dialog).toHaveCount(0);
});

test('Windows shell upgrades show notes for the installed shell independently of the website version', async ({ page, context }) => {
  await context.route('**/api/desktop/latest', (route) => route.fulfill({ json: { release: null } }));
  await context.addInitScript((version) => {
    Object.defineProperty(window, '__BLUVIBOARD_DESKTOP__', { value: true });
    Object.defineProperty(window, '__BLUVIBOARD_DESKTOP_VERSION__', { value: version });
  }, nativeVersion);
  await page.goto('/');
  await page.evaluate((key) => localStorage.setItem(key, '0.1.0'), nativeKey);
  await page.reload();
  const dialog = page.getByRole('dialog', { name: 'Что нового', exact: true });
  await expect(dialog.getByRole('heading', { name: `BluviBoard для Windows ${nativeVersion}`, exact: true })).toBeVisible();
  await expect(dialog.locator('article > h3')).toHaveText([...historyTitles, `BluviBoard для Windows ${nativeVersion}`, 'BluviBoard для Windows 0.1.0']);
  await expect(dialog).toContainText('Автоматическая проверка Windows-обновлений');
  await dialog.getByRole('button', { name: 'Понятно', exact: true }).click();
  expect(await page.evaluate((key) => localStorage.getItem(key), nativeKey)).toBe(nativeVersion);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'С возвращением', exact: true })).toBeVisible();
  await expect(dialog).toHaveCount(0);
});

test('acknowledgement synchronizes browser tabs and an older cached version cannot replace it', async ({ page, context }) => {
  await page.goto('/');
  await page.evaluate((key) => localStorage.setItem(key, '1.2.0'), webKey);
  await page.reload();
  const other = await context.newPage();
  await other.goto('/');
  await expect(other.getByRole('dialog', { name: 'Что нового', exact: true })).toBeVisible();
  await page.getByRole('dialog', { name: 'Что нового', exact: true }).getByRole('button', { name: 'Понятно', exact: true }).click();
  await expect(other.getByRole('dialog', { name: 'Что нового', exact: true })).toHaveCount(0);
  await page.evaluate((key) => localStorage.setItem(key, '9.0.0'), webKey);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'С возвращением', exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Что нового', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Что нового', exact: true }).click();
  await page.getByRole('dialog', { name: 'Что нового', exact: true }).getByRole('button', { name: 'Понятно', exact: true }).click();
  expect(await page.evaluate((key) => localStorage.getItem(key), webKey)).toBe('9.0.0');
});

test('notes remain readable without the API and dismissal falls back to session storage when persistent writes fail', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:5174', storageState: { cookies: [], origins: [{ origin: 'http://localhost:5174', localStorage: [{ name: webKey, value: '1.2.0' }] }] } });
  try {
    await context.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (this === localStorage) throw new DOMException('Test quota exceeded', 'QuotaExceededError');
        return original.call(this, key, value);
      };
    });
    await context.route('**/api/**', (route) => route.abort('blockedbyclient'));
    const page = await context.newPage();
    await page.goto('/');
    const dialog = page.getByRole('dialog', { name: 'Что нового', exact: true });
    await expect(dialog).toContainText(`BluviBoard ${appVersion}`);
    await expect(dialog).toContainText('Полупрозрачный маркер');
    await expect(dialog.locator('article > h3')).toHaveText(historyTitles);
    await dialog.getByRole('button', { name: 'Понятно', exact: true }).click();
    expect(await page.evaluate((key) => sessionStorage.getItem(key), webKey)).toBe(appVersion);
    await page.reload();
    await expect(page.getByRole('button', { name: 'Попробовать снова', exact: true })).toBeVisible();
    await expect(dialog).toHaveCount(0);
  } finally { await context.close(); }
});

test.describe('unversioned profiles from before this feature', () => {
  test.use({ storageState: { cookies: [], origins: [] } });
  test('first-time public visitors keep the landing visible and can read notes manually', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'С возвращением', exact: true })).toBeVisible();
    await expect(page.getByRole('dialog', { name: 'Что нового', exact: true })).toHaveCount(0);
    expect(await page.evaluate((key) => localStorage.getItem(key), webKey)).toBe(appVersion);
    await page.getByRole('button', { name: 'Что нового', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Что нового', exact: true })).toContainText(`BluviBoard ${appVersion}`);
  });
  test('returning authenticated users receive notes on the first rollout of the feature', async ({ page, context }) => {
    const guest = await (await context.request.post('/api/auth/guest')).json();
    try {
      await page.goto('/');
      const dialog = page.getByRole('dialog', { name: 'Что нового', exact: true });
      await expect(dialog).toContainText(`BluviBoard ${appVersion}`);
      await dialog.getByRole('button', { name: 'Понятно', exact: true }).click();
      await expect(page.getByRole('button', { name: '+ Новая доска', exact: true })).toBeVisible();
    } finally { await cleanupWorkspaces([guest.workspaceId], process.env.BB_E2E_IMAGE_DIRECTORY); }
  });
});
