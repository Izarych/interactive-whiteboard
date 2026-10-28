import { test, expect } from '@playwright/test';
import { cleanupWorkspaces } from './asset-test-utils.cjs';

test('the landing demo draws with the selected ink, supports the marker and resets without writing board data', async ({ page }) => {
  const writes: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (new URL(request.url()).pathname.startsWith('/api/') && request.method() !== 'GET') writes.push(request.url()); });
  await page.goto('/');
  const demo = page.getByTestId('landing-demo');
  await expect(demo).toBeVisible();
  const draw = async (offset: number) => {
    const box = (await demo.boundingBox())!;
    await page.mouse.move(box.x + box.width * .35, box.y + box.height * offset);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .6, box.y + box.height * offset, { steps: 8 });
    await page.mouse.up();
  };
  await draw(.4);
  await expect(demo.locator('[data-demo-stroke]')).toHaveCount(1);
  await expect(demo.locator('[data-demo-stroke]').first()).toHaveAttribute('stroke', '#355dff');
  await page.getByRole('button', { name: 'Зелёный цвет в демо', exact: true }).click();
  await page.getByRole('button', { name: 'Маркер в демо', exact: true }).click();
  await draw(.6);
  await expect(demo.locator('[data-demo-stroke]')).toHaveCount(2);
  await expect(demo.locator('[data-demo-stroke]').last()).toHaveAttribute('stroke', '#339b7c');
  await expect(demo.locator('[data-demo-stroke]').last()).toHaveAttribute('opacity', '0.35');
  await page.getByRole('button', { name: 'Убрать мои штрихи в демо', exact: true }).click();
  await expect(demo.locator('[data-demo-stroke]')).toHaveCount(0);
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
});

test('the design fits desktop and mobile, keeps the real login form reachable and respects reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const viewport of [{ width: 1440, height: 1000 }, { width: 360, height: 800 }]) {
    await page.setViewportSize(viewport);
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Онлайн-доска для учёбы и рисования');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewport.width);
    expect(await page.locator('.preview-sticker--top').evaluate((node) => getComputedStyle(node).animationName)).toBe('none');
    await page.screenshot({ path: `test-results/landing-design-${viewport.width}.png`, fullPage: true });
    await page.getByRole('link', { name: 'Войти в аккаунт', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Вход и регистрация', exact: true });
    await expect(dialog.getByRole('heading', { name: 'С возвращением', exact: true })).toBeInViewport();
    await expect(dialog.getByRole('button', { name: 'Продолжить как гость', exact: true })).toBeVisible();
    await dialog.getByRole('button', { name: 'Регистрация', exact: true }).click();
    await expect(dialog.getByRole('textbox', { name: 'Имя', exact: true })).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'Создайте своё пространство', exact: true })).toBeVisible();
  }
});

test('the demo survives session initialization instead of being remounted', async ({ page }) => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/auth/session', async (route) => { await ready; await route.fulfill({ json: { kind: 'anonymous', workspaceId: null, user: null } }); });
  try {
    await page.goto('/');
    const demo = page.getByTestId('landing-demo');
    const box = (await demo.boundingBox())!;
    await page.mouse.move(box.x + box.width * .3, box.y + box.height * .5);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * .5, box.y + box.height * .6, { steps: 5 });
    await page.mouse.up();
    await expect(demo.locator('[data-demo-stroke]')).toHaveCount(1);
    release();
    await expect(page.getByRole('button', { name: 'Продолжить как гость', exact: true })).toBeVisible();
    await expect(demo.locator('[data-demo-stroke]')).toHaveCount(1);
  } finally { release(); }
});

test('the static first frame is styled before the application module arrives', async ({ page }) => {
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/*.js', async (route) => { await ready; await route.continue(); });
  try {
    await page.goto('/', { waitUntil: 'commit' });
    const bootstrap = page.locator('.public-bootstrap');
    await expect(bootstrap).toBeVisible();
    expect(await page.locator('head link[rel="stylesheet"]').count()).toBeGreaterThan(0);
    const firstHeading = bootstrap.locator('h1');
    const font = await firstHeading.evaluate((heading) => getComputedStyle(heading).fontSize);
    expect(parseFloat(font)).toBeGreaterThan(40);
    const x = (await firstHeading.boundingBox())!.x;
    release();
    await expect(bootstrap).toHaveCount(0);
    const heading = page.getByRole('heading', { level: 1, name: 'Онлайн-доска для учёбы и рисования' });
    await expect(heading).toBeVisible();
    expect(await heading.evaluate((node) => getComputedStyle(node).fontSize)).toBe(font);
    expect(Math.abs((await heading.boundingBox())!.x - x)).toBeLessThan(2);
  } finally { release(); }
});

test('the first-screen start link opens the redesigned working space directly', async ({ page, context }) => {
  let workspace: string | undefined;
  try {
    await page.goto('/');
    await page.getByRole('link', { name: 'Открыть доску', exact: true }).click();
    await expect(page.getByRole('button', { name: '+ Новая доска', exact: true })).toBeVisible();
    workspace = (await (await context.request.get('/api/auth/session')).json()).workspaceId;
    await expect(page.locator('.studio-workspace')).toBeVisible();
    await page.screenshot({ path: 'test-results/studio-empty.png', fullPage: true });
    await page.getByRole('button', { name: '+ Новая доска', exact: true }).click();
    await expect(page.getByTestId('canvas')).toBeVisible();
    await page.getByRole('textbox', { name: 'Название доски', exact: true }).fill('Идея для нового проекта');
    await page.getByRole('button', { name: 'Маркер', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Настройки: Маркер', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    const canvas = (await page.getByTestId('canvas').boundingBox())!;
    await page.mouse.move(canvas.x + 150, canvas.y + 300);
    await page.mouse.down();
    await page.mouse.move(canvas.x + 350, canvas.y + 360, { steps: 10 });
    await page.mouse.up();
    await expect(page.getByText('1 объектов', { exact: true })).toBeVisible();
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    await page.screenshot({ path: 'test-results/studio-board.png', fullPage: true });
    await page.reload();
    await expect(page.getByText('1 объектов', { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 360, height: 800 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(360);
    await page.screenshot({ path: 'test-results/studio-mobile.png', fullPage: true });
  } finally { if (workspace) await cleanupWorkspaces([workspace], process.env.BB_E2E_IMAGE_DIRECTORY); }
});
