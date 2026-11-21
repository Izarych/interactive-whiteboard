import { test, expect } from '@playwright/test';
import sharp from 'sharp';
import { cleanupWorkspaces } from './asset-test-utils.cjs';

test('public landing has indexable metadata, crawl files and sharing image; private screens are noindex', async ({ page, context }) => {
  let workspace: string | undefined;
  try {
    const html = await (await context.request.get('/')).text();
    expect(html).toContain('itemtype="https://schema.org/WebApplication"');
    const headingHtml = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/)?.[1] ?? '';
    expect(headingHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).toBe('Онлайн-доска для учёбы и рисования');
    expect(html).toContain('rel="canonical" href="https://bluviboard.ru/"');
    await page.goto('/');
    await expect(page).toHaveTitle('Интерактивная онлайн-доска для обучения — BluviBoard');
    await expect(page.getByRole('heading', { name: 'Онлайн-доска для учёбы и рисования' })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', 'https://bluviboard.ru/og-image.png');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /учёбы.*без регистрации/);
    await expect(page.getByRole('navigation', { name: 'Как использовать BluviBoard' }).getByRole('link', { name: 'Доска для учёбы', exact: false })).toHaveAttribute('href', '/dlya-ucheby/');
    await expect(page.getByRole('navigation', { name: 'Как использовать BluviBoard' }).getByRole('link', { name: 'Онлайн-доска в клетку', exact: false })).toHaveAttribute('href', '/doska-v-kletku/');
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

test('public learning content is identical with and without JavaScript and links to a real lesson guide', async ({ browser }) => {
  const contents: string[] = [];
  for (const javaScriptEnabled of [false, true]) {
    const context = await browser.newContext({ baseURL: 'http://localhost:5174', javaScriptEnabled, viewport: { width: 360, height: 800 } });
    try {
      const page = await context.newPage();
      await page.route('**/api/auth/session', (route) => route.fulfill({ json: { kind: 'anonymous', workspaceId: null, user: null } }));
      await page.goto('/');
      if (javaScriptEnabled) await expect(page.locator('.public-bootstrap')).toHaveCount(0);
      const content = page.locator('.public-learning');
      await expect(content).toHaveCount(1);
      expect(await content.locator('ol li').first().evaluate((item) => getComputedStyle(item).display)).toBe('list-item');
      expect(await content.locator('ol strong').first().evaluate((item) => getComputedStyle(item).display)).toBe('inline');
      contents.push((await content.textContent())!.replace(/\s+/g, ' ').trim());
      await content.getByText('Могут ли учитель и ученик рисовать одновременно?', { exact: true }).click();
      await expect(content.getByText('Да. Владелец включает общий доступ', { exact: false })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
      await content.getByRole('link', { name: 'Как провести занятие на доске с репетитором →', exact: true }).click();
      await expect(page).toHaveURL('/dlya-repetitorov/');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText('Онлайн-доска для репетиторов и учеников');
    } finally { await context.close(); }
  }
  expect(contents[0]).toBe(contents[1]);
});

test('public pages have distinct search metadata and factual structured data in the initial HTML', async ({ context }) => {
  const titles = new Set<string>(), descriptions = new Set<string>();
  for (const path of ['/', '/dlya-ucheby/', '/doska-v-kletku/', '/dlya-repetitorov/']) {
    const response = await context.request.get(path);
    expect(response.status()).toBe(200);
    const html = await response.text();
    const title = html.match(/<title>([^<]+)<\/title>/)![1];
    const description = html.match(/name="description" content="([^"]+)"/)![1];
    expect(titles.has(title)).toBe(false);
    expect(descriptions.has(description)).toBe(false);
    titles.add(title); descriptions.add(description);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).not.toContain('Совместного редактирования доски по ссылке сейчас нет');
    expect(html).not.toContain('<!-- public-learning -->');
    const data = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)![1]);
    expect(data['@context']).toBe('https://schema.org');
    const page = data['@graph'].find((item: { '@type': string }) => item['@type'] === 'WebPage');
    expect(page).toMatchObject({ url: `https://bluviboard.ru${path}`, name: title, description, inLanguage: 'ru' });
    expect(JSON.stringify(data)).not.toMatch(/aggregateRating|reviewCount|priceCurrency|SearchAction/);
    if (path === '/') {
      expect(data['@graph']).toEqual(expect.arrayContaining([expect.objectContaining({ '@type': 'WebSite', name: 'BluviBoard' }), expect.objectContaining({ '@type': 'WebApplication' })]));
    } else {
      const breadcrumbs = data['@graph'].find((item: { '@type': string }) => item['@type'] === 'BreadcrumbList');
      expect(breadcrumbs.itemListElement.map((item: { item: string }) => item.item)).toEqual(['https://bluviboard.ru/', `https://bluviboard.ru${path}`]);
    }
    for (const match of html.matchAll(/(?:href|src)="(\/[^"#?]*)"/g)) {
      const asset = await context.request.get(match[1]);
      expect(asset.status(), `${path}: ${match[1]}`).toBe(200);
    }
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
    const heading = page.getByRole('heading', { level: 1, name: 'Онлайн-доска для учёбы и рисования' });
    await expect(heading).toBeVisible();
    await expect(page.locator('[itemprop="description"]')).toContainText('Решайте задачи, рисуйте схемы');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText('Онлайн-доска для учёбы и рисования');
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
  const heading = page.getByRole('heading', { level: 1, name: 'Онлайн-доска для учёбы и рисования' });
  await expect(retry).toBeVisible();
  await expect(heading).toBeVisible();
  await expect(page.locator('[itemprop="description"]')).toContainText('Решайте задачи, рисуйте схемы');
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
