import { test, expect } from '@playwright/test';
import type { Page, BrowserContext } from '@playwright/test';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { emailCode, cleanupMail } from './mailhog-utils.cjs';
import { cleanupWorkspaces } from './asset-test-utils.cjs';

const password = 'Browser-test-password-123';
const directory = process.env.BB_E2E_IMAGE_DIRECTORY ?? path.resolve('.test-data/e2e-assets');

async function createBoard(page: Page, title: string) {
  const response = page.waitForResponse((item) => item.url().endsWith('/api/boards') && item.request().method() === 'POST');
  await page.getByRole('button', { name: '+ Новая доска', exact: true }).click();
  const board = await (await response).json();
  await page.getByRole('textbox', { name: 'Название доски' }).fill(title);
  return board.id as string;
}
async function draw(page: Page) {
  const box = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.move(box.x + 100, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + 200, box.y + 200, { steps: 10 });
  await page.mouse.up();
}
async function session(context: BrowserContext) {
  const response = await context.request.get('/api/auth/session');
  expect(response.ok()).toBeTruthy();
  return response.json();
}

test('guest registration confirms email, transfers drawings/images and supports profile updates and login', async ({ page, context, browser }) => {
  test.setTimeout(90000);
  const email = `browser-auth-${randomUUID()}@example.test`;
  const owners: string[] = [];
  const seen = new Set<string>();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let outsider: BrowserContext | undefined;
  try {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'С возвращением' })).toBeVisible();
    await page.screenshot({ path: 'test-results/auth-login.png', fullPage: true });
    await page.getByRole('button', { name: 'Продолжить как гость', exact: true }).click();
    await expect(page.getByRole('button', { name: '+ Новая доска', exact: true })).toBeEnabled();
    const guest = await session(context);
    expect(guest.kind).toBe('guest');
    owners.push(guest.workspaceId);
    const title = `E2E account drawing ${Date.now()}`;
    const boardId = await createBoard(page, title);
    await draw(page);
    await page.getByRole('button', { name: 'Фон доски', exact: true }).click();
    await page.getByRole('button', { name: 'Клетка', exact: true }).click();
    await page.getByRole('slider', { name: 'Размер клетки', exact: true }).fill('37');
    const png = await sharp({ create: { width: 100, height: 70, channels: 3, background: '#3b82f6' } }).png().toBuffer();
    await page.getByLabel('Загрузить изображения').setInputFiles({ name: 'guest.png', mimeType: 'image/png', buffer: png });
    await expect(page.getByText('2 объектов', { exact: true })).toBeVisible();
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    const document = (await (await context.request.get(`/api/boards/${boardId}`)).json()).document;
    await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Вход и регистрация' });
    await dialog.getByLabel('Имя', { exact: true }).fill('Новый художник');
    await dialog.getByLabel('Почта', { exact: true }).fill(email);
    await dialog.getByLabel('Пароль', { exact: true }).fill(password);
    await dialog.getByLabel('Файл аватара').setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: png });
    await dialog.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
    await expect(dialog.getByRole('heading', { name: 'Подтвердите почту' })).toBeVisible();
    expect((await session(context)).kind).toBe('guest');
    expect(await page.evaluate((secret) => Object.values(localStorage).some((value) => value.includes(secret)), password)).toBe(false);
    const code = await emailCode(email, seen);
    await page.reload();
    dialog = page.getByRole('dialog', { name: 'Вход и регистрация' });
    await expect(dialog.getByRole('heading', { name: 'Подтвердите почту' })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Отправить код ещё раз/ })).toBeDisabled();
    await dialog.getByLabel('Код из письма').fill(code === '000000' ? '000001' : '000000');
    await dialog.getByRole('button', { name: 'Подтвердить почту', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Неверный');
    await dialog.getByLabel('Код из письма').fill(code);
    await dialog.getByRole('button', { name: 'Подтвердить почту', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator('.account-details strong')).toHaveText('Новый художник');
    await expect(page.getByText('2 объектов', { exact: true })).toBeVisible();
    const registered = await session(context);
    expect(registered.kind).toBe('user');
    expect(registered.workspaceId).toBe(guest.workspaceId);
    expect(registered.user.avatarUrl).toBeTruthy();
    expect((await (await context.request.get(`/api/boards/${boardId}`)).json()).document).toEqual(document);
    expect((await context.request.get(registered.user.avatarUrl)).status()).toBe(200);
    await page.getByRole('button', { name: 'Открыть профиль', exact: true }).click();
    const profile = page.getByRole('dialog', { name: 'Профиль', exact: true });
    await profile.getByLabel('Имя', { exact: true }).fill('Обновлённое имя');
    const green = await sharp({ create: { width: 90, height: 90, channels: 3, background: '#22c55e' } }).png().toBuffer();
    await profile.getByLabel('Файл аватара').setInputFiles({ name: 'updated.png', mimeType: 'image/png', buffer: green });
    await profile.getByRole('button', { name: 'Сохранить профиль' }).click();
    await expect(profile).toHaveCount(0);
    await expect(page.locator('.account-details strong')).toHaveText('Обновлённое имя');
    const updated = await session(context);
    expect(updated.user.avatarUrl).not.toBe(registered.user.avatarUrl);
    await page.reload();
    await expect(page.locator('.account-details strong')).toHaveText('Обновлённое имя');
    await expect(page.getByText('2 объектов', { exact: true })).toBeVisible();

    outsider = await browser.newContext({ baseURL: 'http://localhost:5174' });
    expect((await outsider.request.get(`/api/boards/${boardId}`)).status()).toBe(401);
    const other = await (await outsider.request.post('/api/auth/guest')).json();
    owners.push(other.workspaceId);
    expect((await outsider.request.get('/api/boards')).ok()).toBeTruthy();
    expect(await (await outsider.request.get('/api/boards')).json()).toEqual([]);
    expect((await outsider.request.get(`/api/boards/${boardId}`)).status()).toBe(404);
    expect((await outsider.request.get(`/api/assets/${document.elements[1].assetId}`)).status()).toBe(404);
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'С возвращением' })).toBeVisible();
    await page.getByLabel('Почта', { exact: true }).fill(email);
    await page.getByLabel('Пароль', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page.locator('.account-details strong')).toHaveText('Обновлённое имя');
    await expect(page.getByRole('textbox', { name: 'Название доски' })).toHaveValue(title);
    await expect(page.getByText('2 объектов', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Открыть профиль', exact: true }).click();
    await page.screenshot({ path: 'test-results/profile.png', fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    await outsider?.close();
    await cleanupWorkspaces(owners, directory);
    await cleanupMail(email);
  }
});

test('forgot password on login sends a code, changes the password and revokes other sessions without losing boards', async ({ page, context, browser }) => {
  test.setTimeout(90000);
  const email = `browser-reset-${randomUUID()}@example.test`;
  const owners: string[] = [];
  const seen = new Set<string>();
  let other: BrowserContext | undefined;
  try {
    const guest = await (await context.request.post('/api/auth/guest')).json();
    owners.push(guest.workspaceId);
    const pending = await (await context.request.post('/api/auth/register', { data: { email, name: 'Восстановление', password } })).json();
    const verification = await context.request.post('/api/auth/verify-email', { data: { challengeId: pending.challengeId, code: await emailCode(email, seen) } });
    expect(verification.ok()).toBeTruthy();
    await page.goto('/');
    const title = `E2E password drawing ${Date.now()}`;
    await createBoard(page, title);
    await draw(page);
    await expect(page.getByText('Сохранено', { exact: true })).toBeVisible();
    other = await browser.newContext({ baseURL: 'http://localhost:5174' });
    expect((await other.request.post('/api/auth/login', { data: { email, password } })).ok()).toBeTruthy();
    await page.getByRole('button', { name: 'Выйти', exact: true }).click();
    await page.getByRole('button', { name: 'Забыли пароль?', exact: true }).click();
    await page.getByLabel('Почта', { exact: true }).fill(email);
    await page.getByRole('button', { name: 'Отправить код', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Новый пароль', exact: true })).toBeVisible();
    await page.getByLabel('Код из письма').fill(await emailCode(email, seen));
    const nextPassword = 'New-browser-password-456';
    await page.getByLabel('Новый пароль', { exact: true }).fill(nextPassword);
    await page.getByLabel('Повторите пароль', { exact: true }).fill('Does-not-match-123');
    await page.getByRole('button', { name: 'Сохранить новый пароль' }).click();
    await expect(page.getByRole('alert')).toContainText('Пароли не совпадают');
    await page.getByLabel('Повторите пароль', { exact: true }).fill(nextPassword);
    await page.getByRole('button', { name: 'Сохранить новый пароль' }).click();
    await expect(page.locator('.form-notice')).toContainText('Пароль изменён');
    expect((await other.request.get('/api/boards')).status()).toBe(401);
    await page.getByLabel('Пароль', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Неверная почта или пароль');
    await page.getByLabel('Пароль', { exact: true }).fill(nextPassword);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Название доски' })).toHaveValue(title);
    await expect(page.getByText('1 объектов', { exact: true })).toBeVisible();
    // The same recovery flow is also available from an authenticated profile.
    await page.getByRole('button', { name: 'Открыть профиль', exact: true }).click();
    await page.getByRole('dialog', { name: 'Профиль', exact: true }).getByRole('button', { name: 'Сбросить пароль' }).click();
    const recovery = page.getByRole('dialog', { name: 'Вход и регистрация' });
    await expect(recovery.getByLabel('Почта', { exact: true })).toHaveValue(email);
    await recovery.getByRole('button', { name: 'Отправить код', exact: true }).click();
    await recovery.getByLabel('Код из письма').fill(await emailCode(email, seen));
    const finalPassword = 'Profile-reset-password-789';
    await recovery.getByLabel('Новый пароль', { exact: true }).fill(finalPassword);
    await recovery.getByLabel('Повторите пароль', { exact: true }).fill(finalPassword);
    await recovery.getByRole('button', { name: 'Сохранить новый пароль' }).click();
    await expect(page.locator('.form-notice')).toContainText('Пароль изменён');
    await expect(recovery).toHaveCount(0);
    expect((await session(context)).kind).toBe('anonymous');
    await page.getByLabel('Пароль', { exact: true }).fill(finalPassword);
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Название доски' })).toHaveValue(title);
  } finally {
    await other?.close();
    await cleanupWorkspaces(owners, directory);
    await cleanupMail(email);
  }
});
