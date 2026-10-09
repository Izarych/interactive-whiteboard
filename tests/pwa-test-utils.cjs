const { randomUUID } = require('node:crypto');
const { readFile, writeFile, rm } = require('node:fs/promises');
const path = require('node:path');

const files = new Set();
async function registerDifferentBuild(page) {
  const id = randomUUID().replaceAll('-', '').slice(0, 20);
  const name = `pwa-test-worker-${id}.js`;
  const file = path.resolve(__dirname, '../apps/web/dist', name);
  const original = await readFile(path.resolve(__dirname, '../apps/web/dist/sw.js'), 'utf8');
  const source = original.replace(/^const buildId = '[a-f0-9]{20}';/m, `const buildId = '${id}';`);
  if (source === original) throw new Error('Worker fixture did not change the build identity');
  await writeFile(file, source, { flag: 'wx' });
  files.add(file);
  await page.evaluate((name) => navigator.serviceWorker.register(`/${name}`, { scope: '/', updateViaCache: 'none' }).then(() => {}), name);
}
async function cleanupWorkerFixtures() {
  await Promise.all([...files].map((file) => rm(file, { force: true })));
  files.clear();
}
module.exports = { registerDifferentBuild, cleanupWorkerFixtures };
