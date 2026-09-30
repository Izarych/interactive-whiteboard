const { test } = require('node:test');
const assert = require('node:assert/strict');
const { latestDesktopRelease, DesktopReleaseService } = require('../apps/server/dist/desktop-release.service');
const { DesktopReleaseController } = require('../apps/server/dist/desktop-release.controller');

function release(version, extra = {}) {
  const tag = `desktop-v${version}`;
  return { tag_name: tag, draft: false, prerelease: false, assets: [{ name: `BluviBoard-Setup-${version}-x64.exe`, state: 'uploaded', size: 1024, browser_download_url: `https://github.com/Izarych/interactive-whiteboard/releases/download/${tag}/BluviBoard-Setup-${version}-x64.exe` }], ...extra };
}

test('desktop releases are selected numerically, separately from website releases and prereleases', () => {
  const result = latestDesktopRelease([
    release('0.9.0'), release('0.10.0'), release('1.0.0', { draft: true }), release('2.0.0', { prerelease: true }),
    release('3.0.0', { tag_name: '3.0.0' }), release('0.11.0', { assets: [] }), release('0.20.0', { tag_name: 'desktop-v0.20.0-beta' }),
  ]);
  assert.equal(result.version, '0.10.0');
  assert.match(result.downloadUrl, /desktop-v0\.10\.0\/BluviBoard-Setup-0\.10\.0-x64\.exe$/);
});

test('only fully uploaded installers from this repository are advertised', () => {
  const bad = release('9.0.0');
  bad.assets[0].browser_download_url = 'https://other.example/installer.exe';
  assert.equal(latestDesktopRelease([bad, null, 'invalid']), null);
  const pending = release('0.2.0');
  pending.assets[0].state = 'new';
  assert.equal(latestDesktopRelease([pending]), null);
  assert.throws(() => latestDesktopRelease({ error: 'unavailable' }), /Invalid release response/);
});

test('an unpublished Windows release has an explicit JSON envelope', async () => {
  const controller = new DesktopReleaseController({ latest: async () => null });
  assert.deepEqual(await controller.latest(), { release: null });
});

test('concurrent update checks share one request and cached metadata is refreshed after expiry', async (t) => {
  let requests = 0, now = 1000000;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    requests += 1;
    assert.equal(options.headers.Authorization, undefined);
    return Response.json([release(requests === 1 ? '0.1.0' : '0.2.0')]);
  });
  const service = new DesktopReleaseService();
  const result = await Promise.all([service.latest(), service.latest(), service.latest()]);
  assert.equal(requests, 1);
  assert.ok(result.every((item) => item.version === '0.1.0'));
  assert.equal((await service.latest()).version, '0.1.0');
  assert.equal(requests, 1);
  now += 300001;
  assert.equal((await service.latest()).version, '0.2.0');
  assert.equal(requests, 2);
});

test('upstream errors are reported as failures and retries are rate-limited rather than declared up-to-date', async (t) => {
  let requests = 0, now = 1000000;
  t.mock.method(Date, 'now', () => now);
  t.mock.method(globalThis, 'fetch', async () => { requests += 1; return new Response('', { status: 403 }); });
  const service = new DesktopReleaseService();
  await assert.rejects(service.latest(), (error) => error.getStatus() === 503);
  await assert.rejects(service.latest(), (error) => error.getStatus() === 503);
  assert.equal(requests, 1);
  now += 30001;
  await assert.rejects(service.latest(), (error) => error.getStatus() === 503);
  assert.equal(requests, 2);
});
