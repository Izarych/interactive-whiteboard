const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { chromium, expect } = require('@playwright/test');
const sharp = require('sharp');
const { version } = require('../package.json');

const root = path.resolve(__dirname, '../../..');
const executable = process.env.BLUVIBOARD_DESKTOP_EXECUTABLE || path.join(root, 'apps/desktop/src-tauri/target/release/bluviboard-desktop.exe');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bluviboard-native-offline-'));
const port = 9223;
let child, browser, page;
const errors = [], external = [];
function launch() {
  return spawn(executable, [], { env: { ...process.env, BLUVIBOARD_DESKTOP_TEST_DATA_DIR: profile, BLUVIBOARD_DESKTOP_DEBUG_PORT: String(port) }, stdio: 'inherit' });
}
async function connect() {
  const deadline = Date.now() + 90000;
  let last;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Application exited early: ${child.exitCode}`);
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`, { timeout: 15000 });
      const context = browser.contexts()[0];
      await expect.poll(() => context.pages().length).toBeGreaterThan(0);
      page = context.pages()[0];
      page.on('pageerror', error => errors.push(error.message));
      context.on('request', request => {
        const url = new URL(request.url());
        if (['http:', 'https:'].includes(url.protocol) && url.hostname !== 'tauri.localhost') external.push(request.url());
      });
      await context.setOffline(true);
      return context;
    } catch (error) {
      last = error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`Unable to connect to native WebView2: ${last?.message}`);
}
function closeWindow() {
  const script = `Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class NativeClose { [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l); }'; $h = [System.Diagnostics.Process]::GetProcessById(${child.pid}).MainWindowHandle; if ($h -eq [IntPtr]::Zero) { throw 'Window not found' }; if (-not [NativeClose]::PostMessage($h,16,[IntPtr]::Zero,[IntPtr]::Zero)) { throw 'Close failed' }`;
  assert.equal(spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'inherit' }).status, 0);
}
async function exited(process) {
  await expect.poll(() => process.exitCode, { timeout: 20000 }).not.toBeNull();
  assert.equal(process.exitCode, 0);
}
async function stroke(finish = true) {
  const box = await page.getByTestId('canvas').boundingBox();
  await page.mouse.move(box.x + 100, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 250, box.y + 260, { steps: 8 });
  if (finish) await page.mouse.up();
}
async function main() {
  assert(fs.existsSync(path.join(root, 'apps/desktop/ui/index.html')), 'Bundled editor must exist');
  child = launch();
  await connect();
  await expect(page.getByRole('button', { name: '+ Новая доска', exact: true })).toBeVisible();
  assert.match(page.url(), /^(https:\/\/tauri\.localhost|tauri:\/\/localhost)\//);
  assert.equal(await page.evaluate(() => window.__BLUVIBOARD_OFFLINE__), true);
  assert.equal(await page.evaluate(() => window.__BLUVIBOARD_DESKTOP_VERSION__), version);
  await page.getByRole('button', { name: '+ Новая доска', exact: true }).click();
  await expect(page.getByTestId('canvas')).toBeVisible();
  await page.getByRole('textbox', { name: 'Название доски', exact: true }).fill('Native offline persistence');
  await stroke();
  const image = await sharp({ create: { width: 80, height: 60, channels: 3, background: '#2563eb' } }).png().toBuffer();
  await page.getByLabel('Загрузить изображения').setInputFiles({ name: 'offline.png', mimeType: 'image/png', buffer: image });
  await expect(page.getByText('2 объектов', { exact: true })).toBeVisible();
  await expect(page.getByText('Сохранено на компьютере', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Действия доски', exact: true }).click();
  await page.getByRole('button', { name: 'Сохранить файл доски', exact: true }).click();
  const downloads = path.join(profile, 'downloads');
  await expect.poll(() => fs.readdirSync(downloads).filter(name => name.endsWith('.bluviboard')).length).toBe(1);
  const project = JSON.parse(fs.readFileSync(path.join(downloads, fs.readdirSync(downloads).find(name => name.endsWith('.bluviboard'))), 'utf8'));
  assert.equal(project.format, 'BluviBoard');
  assert.equal(project.document.elements.length, 2);
  assert.equal(project.assets[0].data, image.toString('base64'));
  await page.getByRole('button', { name: 'Действия доски', exact: true }).click();
  await page.getByRole('button', { name: 'Скачать PNG', exact: true }).click();
  await expect.poll(() => fs.readdirSync(downloads).filter(name => name.endsWith('.png')).length).toBe(1);
  const exported = await sharp(path.join(downloads, fs.readdirSync(downloads).find(name => name.endsWith('.png')))).metadata();
  assert(exported.width > 500 && exported.height > 500);
  await expect(page.getByRole('button', { name: 'Поделиться доской', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Ластик', exact: true }).click({ button: 'right' });
  await page.getByRole('textbox', { name: 'Хоткей: Ластик', exact: true }).focus();
  await page.keyboard.press('CapsLock');
  await page.getByRole('button', { name: 'Сохранить хоткей', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Хоткей сохранён' })).toBeVisible();
  await page.getByRole('button', { name: 'Карандаш', exact: true }).click();
  const second = launch();
  await exited(second);
  assert.equal(child.exitCode, null);
  // Closing during a gesture must finish it and commit to disk, not to a server.
  await stroke(false);
  closeWindow();
  await exited(child);

  child = launch();
  await connect();
  await expect(page.getByRole('textbox', { name: 'Название доски', exact: true })).toHaveValue('Native offline persistence');
  await expect(page.getByText('3 объектов', { exact: true })).toBeVisible();
  await expect(page.getByText('Сохранено на компьютере', { exact: true })).toBeVisible();
  const stored = await page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('bluviboard-desktop', 1);
    request.onsuccess = () => {
      const transaction = request.result.transaction(['assets', 'boards']);
      const assets = transaction.objectStore('assets').getAll();
      const boards = transaction.objectStore('boards').getAll();
      transaction.oncomplete = async () => resolve({ images: assets.result.map(asset => ({ type: asset.blob.type, size: asset.blob.size })), count: boards.result[0].board.document.elements.length });
      transaction.onerror = () => reject(transaction.error);
    };
    request.onerror = () => reject(request.error);
  }));
  assert.equal(stored.count, 3);
  assert.deepEqual(stored.images, [{ type: 'image/png', size: image.length }]);
  await page.keyboard.press('CapsLock');
  await expect(page.getByRole('button', { name: 'Ластик', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('CapsLock');
  await page.getByRole('button', { name: 'Карандаш', exact: true }).click();
  // Simulate a disk-write refusal: a saved-on-disk status and native close must not lie.
  await page.evaluate(() => {
    window.__nativeOriginalTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(names, mode, options) {
      if (mode === 'readwrite' && Array.from(typeof names === 'string' ? [names] : names).includes('boards')) throw new Error('Native smoke: disk write refused');
      return window.__nativeOriginalTransaction.call(this, names, mode, options);
    };
  });
  await stroke();
  closeWindow();
  const notice = page.getByRole('region', { name: 'Закрытие BluviBoard' });
  await expect(notice.getByRole('alert')).toContainText('disk write refused');
  assert.equal(child.exitCode, null);
  await page.evaluate(() => { IDBDatabase.prototype.transaction = window.__nativeOriginalTransaction; });
  await notice.getByRole('button', { name: 'Повторить', exact: true }).click();
  await exited(child);
  child = launch();
  await connect();
  await expect(page.getByText('4 объектов', { exact: true })).toBeVisible();
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log('Native Windows offline smoke passed: bundled first start, no website/API requests, drawing and images on disk, restart persistence, hotkeys, single instance, safe close, failed-write recovery.');
}
main().catch(async error => {
  console.error(error);
  const artifacts = path.join(root, 'apps/desktop/artifacts');
  fs.mkdirSync(artifacts, { recursive: true });
  if (page && !page.isClosed()) await page.screenshot({ path: path.join(artifacts, 'native-smoke.png') }).catch(() => {});
  process.exitCode = 1;
}).finally(async () => {
  if (child && child.exitCode === null && child.signalCode === null) {
    const stopped = new Promise(resolve => child.once('exit', resolve));
    child.kill();
    await stopped;
  }
  if (browser) await browser.close().catch(() => {});
});
