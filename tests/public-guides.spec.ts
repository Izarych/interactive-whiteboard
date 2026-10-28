import { test, expect } from '@playwright/test';
import { cleanupWorkspaces } from './asset-test-utils.cjs';

const guides = [
  { path: '/dlya-ucheby/', heading: 'Онлайн-доска для учёбы и решения задач', title: 'Онлайн-доска для учёбы и решения задач — BluviBoard', image: '/guide-study.svg', question: 'Подходит ли доска для онлайн-уроков с репетитором?', answer: 'Совместного редактирования доски по ссылке сейчас нет' },
  { path: '/doska-v-kletku/', heading: 'Онлайн-доска в клетку для математики и рисования', title: 'Онлайн-доска в клетку для математики и рисования — BluviBoard', image: '/guide-grid.svg', question: 'Попадает ли клетка в скачанный PNG?', answer: 'без клетки и точек' },
];

for (const guide of guides) {
  test(`${guide.path} is a standalone indexable document with working assets, accurate instructions and mobile navigation`, async ({ page, context }) => {
    const errors: string[] = [], apiRequests: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.route('**/api/**', (route) => { apiRequests.push(route.request().url()); return route.abort('connectionrefused'); });
    const response = await context.request.get(guide.path);
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain(`<h1 id="guide-title">${guide.heading}</h1>`);
    expect(html).toContain(`rel="canonical" href="https://bluviboard.ru${guide.path}"`);
    expect(html).not.toContain('/src/');
    expect(html).not.toContain('meta name="keywords"');
    await page.goto(guide.path);
    await expect(page).toHaveTitle(guide.title);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(guide.heading);
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://bluviboard.ru${guide.path}`);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', `https://bluviboard.ru${guide.path}`);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', guide.title);
    await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute('content', guide.title);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /.+/);
    expect(await page.locator(`img[src="${guide.image}"]`).evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
    expect(await page.locator('h1').evaluate((heading) => getComputedStyle(heading).fontSize)).not.toBe('32px');
    await page.screenshot({ path: `test-results${guide.path}desktop.png`, fullPage: true });
    await page.setViewportSize({ width: 360, height: 800 });
    await expect(page.getByRole('heading', { level: 1 })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
    await page.getByText(guide.question, { exact: true }).click();
    await expect(page.getByText(guide.answer, { exact: false })).toBeVisible();
    await page.screenshot({ path: `test-results${guide.path}mobile.png`, fullPage: true });
    const related = guides.find((item) => item.path !== guide.path)!;
    await page.getByRole('navigation', { name: 'Навигация', exact: true }).getByRole('link').first().click();
    await expect(page).toHaveURL(related.path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(related.heading);
    expect(errors).toEqual([]);
    expect(apiRequests).toEqual([]);
  });
}

test('the home and both guides can be read and linked without JavaScript', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:5174', javaScriptEnabled: false, viewport: { width: 360, height: 800 } });
  try {
    const page = await context.newPage();
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Онлайн-доска для учёбы и рисования');
    await page.getByRole('link', { name: 'Доска для учёбы', exact: true }).click();
    await expect(page).toHaveURL('/dlya-ucheby/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(guides[0].heading);
    await page.getByText(guides[0].question, { exact: true }).click();
    await expect(page.getByText(guides[0].answer, { exact: false })).toBeVisible();
    await page.getByRole('navigation', { name: 'Навигация', exact: true }).getByRole('link').first().click();
    await expect(page).toHaveURL('/doska-v-kletku/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(guides[1].heading);
    await page.getByText(guides[1].question, { exact: true }).click();
    await expect(page.getByText(guides[1].answer, { exact: false })).toBeVisible();
    await page.getByRole('link', { name: 'Перейти к доске', exact: true }).click();
    await expect(page).toHaveURL('/#start');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Онлайн-доска для учёбы и рисования');
  } finally { await context.close(); }
});

test('a guide opens the real guest board without indexing the private workspace or exposing it in the guide', async ({ page, context }) => {
  let workspace: string | undefined;
  try {
    await page.goto('/doska-v-kletku/');
    await page.getByRole('navigation', { name: 'Навигация', exact: true }).getByRole('link', { name: 'Открыть доску', exact: true }).click();
    await expect(page).toHaveURL('/#start');
    await page.getByRole('button', { name: 'Продолжить как гость', exact: true }).click();
    workspace = (await (await context.request.get('/api/auth/session')).json()).workspaceId;
    await expect(page.getByRole('button', { name: '+ Новая доска', exact: true })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
    await page.getByRole('button', { name: '+ Новая доска', exact: true }).click();
    await expect(page.getByTestId('canvas')).toBeVisible();
    await page.getByRole('textbox', { name: 'Название доски', exact: true }).fill('Private lesson draft');
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    await page.goto('/dlya-ucheby/');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'index, follow');
    await expect(page.getByTestId('canvas')).toHaveCount(0);
    await expect(page.getByText('Private lesson draft')).toHaveCount(0);
    await page.getByRole('navigation', { name: 'Навигация', exact: true }).getByRole('link', { name: 'Открыть доску', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Название доски', exact: true })).toHaveValue('Private lesson draft');
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
  } finally { if (workspace) await cleanupWorkspaces([workspace], process.env.BB_E2E_IMAGE_DIRECTORY); }
});

test('the public home remains reachable on short desktop and mobile screens with the new guide links', async ({ page }) => {
  for (const size of [{ width: 1024, height: 600 }, { width: 360, height: 800 }]) {
    await page.setViewportSize(size);
    await page.goto('/');
    const intro = page.getByRole('heading', { level: 1 });
    // A login input must not autofocus-scroll the useful landing text away.
    await expect(intro).toBeInViewport();
    expect((await intro.boundingBox())!.y).toBeGreaterThanOrEqual(0);
    await page.getByRole('link', { name: 'Открыть доску', exact: true }).click();
    await page.getByRole('button', { name: 'Продолжить как гость', exact: true }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: 'Продолжить как гость', exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(size.width);
  }
  await page.getByRole('heading', { level: 1 }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/public-home-mobile.png', fullPage: true });
});
