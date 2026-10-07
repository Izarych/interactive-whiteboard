import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { cleanupWorkspaces } from './asset-test-utils.cjs';

test('public landing has indexable metadata, crawl files and sharing image; private screens are noindex', async ({ page, context }) => {
  let workspace: string | undefined;
  try {
    const html = await (await context.request.get('/')).text();
    expect(html).toContain('itemtype="https://schema.org/WebApplication"');
    expect(html).toContain('Онлайн-доска для идей и заметок');
    expect(html).toContain('rel="canonical" href="https://bluviboard.ru/"');
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Онлайн-доска для идей и заметок' })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://bluviboard.ru/og-image.png');
    const robots = await (await context.request.get('/robots.txt')).text();
    expect(robots).toContain('Disallow: /admin');
    expect(robots).toContain('Disallow: /api/');
    expect(robots).toContain('Allow: /api/auth/session$');
    expect(robots).toContain('Sitemap: https://bluviboard.ru/sitemap.xml');
    const xml = await (await context.request.get('/sitemap.xml')).text();
    expect(xml).toContain('<loc>https://bluviboard.ru/</loc>');
    expect((xml.match(/<loc>/g) ?? []).length).toBe(1);
    expect(xml).not.toContain('/admin');
    const image = await context.request.get('/og-image.png');
    expect(image.status()).toBe(200);
    const metadata = await sharp(await image.body()).metadata();
    expect(metadata).toMatchObject({ format: 'png', width: 1200, height: 630 });
    await page.getByRole('button', { name: 'Продолжить как гость', exact: true }).click();
    await expect(page.getByRole('button', { name: '+ Новая доска', exact: true })).toBeVisible();
    workspace = (await (await context.request.get('/api/auth/session')).json()).workspaceId;
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    await page.goto('/admin');
    await expect(page.getByRole('heading', { name: 'Вход в админ-панель' })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    await expect(page.getByRole('button', { name: 'Забыли пароль?', exact: true })).toHaveCount(0);
  } finally {
    if (workspace) await cleanupWorkspaces([workspace], process.env.BB_E2E_IMAGE_DIRECTORY);
  }
});

test('public content remains visible and indexable while the session request is pending, including on mobile', async ({ page }) => {
  let releaseSession!: () => void;
  const sessionReady = new Promise<void>((resolve) => { releaseSession = resolve; });
  await page.route('**/api/auth/session', async (route) => {
    await sessionReady;
    await route.fulfill({ json: { kind: 'anonymous', workspaceId: null, user: null } });
  });
  try {
    await page.goto('/');
    await expect(page.getByText('Открываем ваше пространство…', { exact: true })).toBeVisible();
    const heading = page.getByRole('heading', { level: 1, name: 'Онлайн-доска для идей и заметок' });
    await expect(heading).toBeVisible();
    await expect(page.locator('[itemprop="description"]')).toContainText('Рисуйте, записывайте идеи');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText('Онлайн-доска для идей и заметок');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
    releaseSession();
    await expect(page.getByRole('button', { name: 'Продолжить как гость', exact: true })).toBeVisible();
    await expect(heading).toHaveCount(1);
  } finally { releaseSession(); }
});

test('public content survives blocked API requests and session retries; admin failures stay noindex', async ({ page }) => {
  let sessionAvailable = false;
  let sessionRequests = 0;
  await page.route('**/api/**', async (route) => {
    if (new URL(route.request().url()).pathname === '/api/auth/session') {
      sessionRequests += 1;
      if (sessionAvailable) {
        await route.fulfill({ json: { kind: 'anonymous', workspaceId: null, user: null } });
        return;
      }
    }
    await route.abort('blockedbyclient');
  });
  await page.goto('/');
  const retry = page.getByRole('button', { name: 'Попробовать снова', exact: true });
  const heading = page.getByRole('heading', { level: 1, name: 'Онлайн-доска для идей и заметок' });
  await expect(retry).toBeVisible();
  await expect(heading).toBeVisible();
  await expect(page.locator('[itemprop="description"]')).toContainText('Рисуйте, записывайте идеи');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
  const failedRequests = sessionRequests;
  await retry.click();
  await expect.poll(() => sessionRequests).toBeGreaterThan(failedRequests);
  await expect(retry).toBeVisible();
  await expect(heading).toBeVisible();
  sessionAvailable = true;
  await retry.click();
  await expect(page.getByRole('button', { name: 'Продолжить как гость', exact: true })).toBeVisible();
  await expect(heading).toHaveCount(1);
  sessionAvailable = false;
  await page.goto('/admin');
  await expect(retry).toBeVisible();
  await expect(heading).toHaveCount(0);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
});
