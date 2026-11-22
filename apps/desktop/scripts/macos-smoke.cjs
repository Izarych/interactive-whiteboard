const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { spawn, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bluviboard-wkwebview-'));
const storeId = randomUUID().replaceAll('-', '');
const executable = process.env.BLUVIBOARD_DESKTOP_EXECUTABLE;
assert(executable && fs.existsSync(executable), 'Pass the installed .app executable');
const source = fs.readFileSync(path.join(__dirname, 'macos-smoke-page.js'), 'utf8');
const script = path.join(profile, 'smoke.js');
const artifacts = path.join(root, 'apps/desktop/artifacts');
fs.mkdirSync(artifacts, { recursive: true });
async function phase(name, project) {
  fs.writeFileSync(script, `window.__BLUVIBOARD_SMOKE_VERSION__=${JSON.stringify(require('../package.json').version)};\nwindow.__BLUVIBOARD_SMOKE_PREVIEW__=${process.env.BLUVIBOARD_DESKTOP_PREVIEW === 'true'};\n${project ? `window.__BLUVIBOARD_SMOKE_IMPORT__=${JSON.stringify(project)};\n` : ''}${source}`);
  const child = spawn(executable, [], { env: { ...process.env, BLUVIBOARD_DESKTOP_SMOKE: '1', BLUVIBOARD_DESKTOP_TEST_DATA_DIR: profile, BLUVIBOARD_DESKTOP_TEST_STORE_ID: storeId, BLUVIBOARD_DESKTOP_SMOKE_SCRIPT: script, BLUVIBOARD_DESKTOP_SMOKE_PHASE: name }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      spawnSync('screencapture', ['-x', path.join(artifacts, `macos-${name}.png`)]);
      child.kill('SIGKILL'); reject(new Error(`Native macOS phase ${name} timed out`));
    }, 180000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); resolve(code); });
  });
  fs.writeFileSync(path.join(artifacts, `macos-${name}.log`), output);
  const file = path.join(profile, `${name}.json`);
  const result = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { status: 'missing report', output };
  result.downloads = fs.readdirSync(path.join(profile, 'downloads')).map(file => ({ name: file, size: fs.statSync(path.join(profile, 'downloads', file)).size }));
  fs.writeFileSync(path.join(artifacts, `macos-${name}.json`), JSON.stringify(result, null, 2));
  assert.equal(code, 0, JSON.stringify(result));
  assert.equal(result.status, 'passed', JSON.stringify(result));
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.network, []);
  assert.equal(result.cloudRequests, 0);
  console.log(`WKWebView ${name}: passed`);
}
(async () => {
  await phase('first');
  const downloads = path.join(profile, 'downloads'), names = fs.readdirSync(downloads);
  const project = fs.readFileSync(path.join(downloads, names.find(name => name.endsWith('.bluviboard'))), 'utf8');
  const data = JSON.parse(project);
  assert.equal(data.format, 'BluviBoard'); assert.equal(data.document.elements.length, 2); assert.equal(data.assets.length, 1);
  const png = fs.readFileSync(path.join(downloads, names.find(name => name.endsWith('.png'))));
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert(png.readUInt32BE(16) > 500 && png.readUInt32BE(20) > 500);
  await phase('restart');
  await phase('recovery', project);
  console.log('Native macOS smoke passed: real WKWebView, offline first start, drawings/images on disk, native exports/import, restart persistence, hotkeys, active-stroke close and failed-write recovery.');
})().catch(error => { console.error(error); process.exitCode = 1; });
