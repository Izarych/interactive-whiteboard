const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { chromium, expect } = require('@playwright/test');
const { version } = require('../package.json');

const root = path.resolve(__dirname, '../../..');
const executable = process.env.BLUVIBOARD_DESKTOP_EXECUTABLE || path.join(root, 'apps/desktop/src-tauri/target/release/bluviboard-desktop.exe');
const assets = path.join(root, 'apps/web/dist');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bluviboard-native-'));
const port = 9223;
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ipc: https://ipc.localhost; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'; upgrade-insecure-requests";
let child;
let browser;
let page;
let releaseSave = () => {};

function launch() {
  return spawn(executable, [], {
    env: { ...process.env, BLUVIBOARD_DESKTOP_TEST_DATA_DIR: profile, BLUVIBOARD_DESKTOP_DEBUG_PORT: String(port) },
    stdio: 'inherit',
  });
}

async function connect() {
  const deadline = Date.now() + 90000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Application exited early: ${child.exitCode}`);
    try { return await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 15000 }); }
    catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`Unable to connect to WebView2: ${lastError?.message || 'endpoint unavailable'}`);
}

async function exited(process) {
  await expect.poll(() => process.exitCode, { timeout: 20000 }).not.toBeNull();
  assert.equal(process.exitCode, 0);
}

function closeWindow() {
  // Exercise the real native title-bar close event, rather than calling IPC directly.
  const script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class NativeClose { [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr handle, uint message, IntPtr wParam, IntPtr lParam); }'; $handle = [System.Diagnostics.Process]::GetProcessById(${child.pid}).MainWindowHandle; if ($handle -eq [IntPtr]::Zero) { throw 'Application window was not found' }; if (-not [NativeClose]::PostMessage($handle, 16, [IntPtr]::Zero, [IntPtr]::Zero)) { throw 'Unable to request window close' }`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'inherit' });
  assert.equal(result.status, 0);
}

async function main() {
  const now = new Date().toISOString();
  let board = { id: 'native-smoke', title: 'Native smoke', revision: 1, createdAt: now, updatedAt: now, document: { version: 1, elements: [] } };
  let shortcuts = {};
  let panelPinned = false;
  let saved = false;
  const saveGate = new Promise((resolve) => { releaseSave = resolve; });
  child = launch();
  browser = await connect();
  const context = browser.contexts()[0];
  await expect.poll(() => context.pages().length).toBeGreaterThan(0);
  page = context.pages()[0];
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.setBypassServiceWorker', { bypass: true });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await context.route('https://bluviboard.ru/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const json = (data) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    if (pathname === '/api/auth/session') return json({ kind: 'guest', workspaceId: 'native-smoke', user: null });
    if (pathname === '/api/preferences/tools') {
      if (route.request().method() === 'PUT') shortcuts = route.request().postDataJSON().shortcuts;
      return json({ shortcuts });
    }
    if (pathname === '/api/preferences/tools/panel') {
      if (route.request().method() === 'PUT') panelPinned = route.request().postDataJSON().pinned;
      return json({ pinned: panelPinned });
    }
    if (pathname === '/api/desktop/latest') return json({ release: { version, downloadUrl: `https://github.com/Izarych/interactive-whiteboard/releases/download/desktop-v${version}/BluviBoard-Setup-${version}-x64.exe`, releaseUrl: `https://github.com/Izarych/interactive-whiteboard/releases/tag/desktop-v${version}` } });
    if (pathname === '/api/boards') return json([board]);
    if (pathname === '/api/boards/native-smoke') {
      if (route.request().method() === 'PUT') {
        const update = route.request().postDataJSON();
        await saveGate;
        board = { ...board, ...update, revision: board.revision + 1 };
        saved = true;
      }
      return json(board);
    }
    if (pathname.startsWith('/api/')) throw new Error(`Unexpected API request: ${pathname}`);
    const file = path.resolve(assets, `.${pathname === '/' ? '/index.html' : pathname}`);
    assert.ok(file.startsWith(`${assets}${path.sep}`));
    await route.fulfill({ status: 200, contentType: mime[path.extname(file)] || 'application/octet-stream', headers: { 'Content-Security-Policy': csp }, body: fs.readFileSync(file) });
  });
  await page.goto('https://bluviboard.ru/');
  const releaseNotes = page.getByRole('dialog', { name: 'Что нового', exact: true });
  await expect(releaseNotes).toContainText(`BluviBoard ${require(path.join(root, 'apps/web/package.json')).version}`);
  await releaseNotes.getByRole('button', { name: 'Понятно', exact: true }).click();
  await expect(page.getByTestId('canvas')).toBeVisible();
  assert.equal(await page.evaluate(() => window.__BLUVIBOARD_DESKTOP__), true);
  assert.equal(await page.evaluate(() => window.__BLUVIBOARD_DESKTOP_VERSION__), version);
  await page.getByRole('button', { name: 'Проверить обновления', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Обновления Windows-клиента' })).toContainText('Установлена актуальная версия');
  await page.getByRole('region', { name: 'Обновления Windows-клиента' }).getByRole('button', { name: 'Закрыть', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Установить BluviBoard', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Скачать для Windows', exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Ластик', exact: true }).click({ button: 'right' });
  const shortcutInput = page.getByRole('textbox', { name: 'Хоткей: Ластик', exact: true });
  await expect(shortcutInput).toBeEnabled();
  await shortcutInput.focus();
  await page.keyboard.press('CapsLock');
  await page.getByRole('button', { name: 'Сохранить хоткей', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Хоткей сохранён' })).toBeVisible();
  await page.getByRole('button', { name: 'Карандаш', exact: true }).click();
  await page.keyboard.press('CapsLock');
  await expect(page.getByRole('button', { name: 'Ластик', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('CapsLock');
  await expect(page.getByRole('button', { name: 'Карандаш', exact: true })).toHaveAttribute('aria-pressed', 'true');

  const second = launch();
  await exited(second);
  assert.equal(child.exitCode, null);
  await context.addCookies([{ name: 'native-persistence-check', value: 'persisted', domain: 'bluviboard.ru', path: '/', secure: true, httpOnly: true, sameSite: 'Lax', expires: Math.floor(Date.now() / 1000) + 3600 }]);
  await page.evaluate(() => localStorage.setItem('native-persistence-check', 'persisted'));
  const box = await page.getByTestId('canvas').boundingBox();
  await page.mouse.move(box.x + 100, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 250, box.y + 260, { steps: 8 });
  closeWindow();
  await expect(page.getByRole('region', { name: 'Закрытие BluviBoard' })).toBeVisible();
  await expect(page.locator('.pwa-app')).toHaveAttribute('inert', '');
  await page.keyboard.press('Control+z');
  assert.equal(child.exitCode, null);
  assert.equal(saved, false);
  releaseSave();
  await exited(child);
  assert.equal(saved, true);
  assert.equal(board.document.elements.length, 1);
  assert.equal(board.document.elements[0].kind, 'stroke');

  child = launch();
  browser = await connect();
  const reopened = browser.contexts()[0];
  await expect.poll(() => reopened.pages().length).toBeGreaterThan(0);
  page = reopened.pages()[0];
  await expect.poll(() => page.url(), { timeout: 30000 }).toMatch(/^https:\/\/bluviboard\.ru\//);
  assert.ok((await reopened.cookies('https://bluviboard.ru/')).some((cookie) => cookie.name === 'native-persistence-check' && cookie.value === 'persisted'));
  assert.equal(await page.evaluate(() => localStorage.getItem('native-persistence-check')), 'persisted');
  assert.deepEqual(errors, []);
  console.log('Native Windows smoke passed: WebView2, desktop UI, release notes, tool shortcuts, single instance, cookies/storage persistence, and save-before-close.');
}

main().catch(async (error) => {
  console.error(error);
  console.log(`::error title=Native Windows smoke::${String(error.stack).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A')}`);
  const artifacts = path.join(root, 'apps/desktop/artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(artifacts, 'native-smoke.png') }).catch(() => {});
  process.exitCode = 1;
}).finally(async () => {
  releaseSave();
  if (child && child.exitCode === null && child.signalCode === null) {
    const stopped = new Promise((resolve) => child.once('exit', resolve));
    child.kill();
    await stopped;
  }
  if (browser) await browser.close().catch(() => {});
});
