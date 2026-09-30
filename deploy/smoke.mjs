import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';

const origin = process.env.SMOKE_ORIGIN ?? 'https://bluviboard.ru';
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ baseURL: origin });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
try {
  const response = await page.goto('/admin');
  assert.equal(response.status(), 200);
  await page.getByRole('heading', { name: 'Вход в админ-панель', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: 'Регистрация', exact: true }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Продолжить как гость', exact: true }).count(), 0);
  assert.equal((await context.request.get('/api/admin/overview')).status(), 401);
  assert.equal((await context.request.get('/.env')).status(), 403);
  assert.equal((await context.request.get('/.git/config')).status(), 403);
  const csrf = await context.request.post('/api/auth/guest', { headers: { Origin: 'https://untrusted.example' } });
  assert.equal(csrf.status(), 403);
  await page.goto('/');
  await page.getByRole('button', { name: 'Продолжить как гость', exact: true }).click();
  await page.getByRole('button', { name: '+ Новая доска', exact: true }).waitFor();
  const session = await (await context.request.get('/api/auth/session')).json();
  const cookie = (await context.cookies()).find((item) => item.name === 'bb_session');
  assert.ok(cookie?.secure && cookie.httpOnly && cookie.sameSite === 'Lax');
  assert.equal((await context.request.get('/api/admin/users')).status(), 403);
  assert.equal((await context.request.post('/api/auth/logout')).status(), 403); // Cookie writes without Origin are denied in production.
  const health = await (await context.request.get('/api/health')).json();
  assert.equal(health.status, 'ok');
  assert.match(health.commit, /^[a-f0-9]{40}$/);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ origin, status: 'passed', commit: health.commit, guestWorkspaceForCleanup: session.workspaceId }));
} catch (error) {
  console.error({ errors, body: await page.locator('body').innerText() });
  await page.screenshot({ path: 'test-results/production-smoke.png', fullPage: true });
  throw error;
} finally { await browser.close(); }
