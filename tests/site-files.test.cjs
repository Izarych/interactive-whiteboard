const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, readdir, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { SiteFilesService } = require('../apps/server/dist/site-files.service');

test('server-owned files survive service recreation and concurrent stale writes cannot overwrite a newer file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bluviboard-site-files-'));
  const config = { get: () => directory };
  try {
    const service = new SiteFilesService(config);
    assert.deepEqual(await service.read('robots.txt'), { name: 'robots.txt', content: '', revision: null });
    await assert.rejects(service.read('robots.txt', true), (error) => error.getStatus() === 404);
    const initial = await service.update('robots.txt', { content: 'User-agent: *\nAllow: /\n', revision: null });
    assert.deepEqual(await new SiteFilesService(config).read('robots.txt', true), initial);
    const updates = await Promise.allSettled([
      service.update('robots.txt', { content: `${initial.content}# first\n`, revision: initial.revision }),
      service.update('robots.txt', { content: `${initial.content}# second\n`, revision: initial.revision }),
    ]);
    assert.equal(updates[0].status, 'fulfilled');
    assert.equal(updates[1].status, 'rejected');
    assert.equal(updates[1].reason.getStatus(), 409);
    assert.equal((await service.read('robots.txt')).content, `${initial.content}# first\n`);
    assert.deepEqual(await readdir(directory), ['robots.txt']);
    assert.throws(() => service.update('../outside.txt', { content: 'no', revision: null }), (error) => error.getStatus() === 404);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
