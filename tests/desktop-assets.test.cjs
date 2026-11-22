const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { version } = require('../apps/desktop/package.json');

test('Mac packaging selects the current version and architecture and isolates preview artifacts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bluviboard-mac-package-'));
  try {
    fs.mkdirSync(path.join(root, 'scripts'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version }));
    fs.copyFileSync('apps/desktop/scripts/package-macos.cjs', path.join(root, 'scripts/package-macos.cjs'));
    for (const arch of ['arm64', 'x64']) {
      const target = arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
      const bundles = path.join(root, 'src-tauri/target', target, 'release/bundle/dmg');
      fs.mkdirSync(bundles, { recursive: true });
      fs.writeFileSync(path.join(bundles, 'BluviBoard_0.1.0_x64.dmg'), 'old installer');
      const bytes = Buffer.from(`current-${arch}`);
      fs.writeFileSync(path.join(bundles, `BluviBoard_${version}_${arch === 'arm64' ? 'aarch64' : 'x64'}.dmg`), bytes);
      for (const preview of [false, true]) {
        const result = spawnSync(process.execPath, [path.join(root, 'scripts/package-macos.cjs')], { encoding: 'utf8', env: { ...process.env, BLUVIBOARD_MACOS_ARCH: arch, BLUVIBOARD_DESKTOP_PREVIEW: String(preview) } });
        assert.equal(result.status, 0, result.stderr);
        const name = `BluviBoard-${preview ? 'Offline-Preview-' : ''}${version}-macOS-${arch}.dmg`;
        assert.deepEqual(fs.readFileSync(path.join(root, 'artifacts', name)), bytes);
        assert.equal(fs.readFileSync(path.join(root, 'artifacts', `${name}.sha256`), 'utf8'), `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`);
      }
    }
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

function mirror(existing, uploaded = true) {
  const script = path.resolve('apps/desktop/scripts/sync-release-assets.cjs');
  const name = `BluviBoard-${version}-macOS-arm64.dmg`, bytes = Buffer.from('verified-dmg');
  const asset = { name, state: 'uploaded', size: bytes.length, digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}` };
  const uploads = [];
  const fake = {
    spawnSync: (_command, args) => ({ status: 0, stdout: JSON.stringify(args[2].startsWith('desktop-v') ? { isDraft: !uploaded, assets: [asset] } : { isDraft: false, assets: existing ? [{ ...asset, ...existing }] : [] }) }),
    execFileSync: (_command, args) => {
      if (args[1] === 'download') fs.writeFileSync(path.join(args[args.indexOf('--dir') + 1], name), bytes);
      else if (args[1] === 'upload') uploads.push({ tag: args[2], bytes: fs.readFileSync(args.at(-1)) });
      else throw new Error(`Unexpected operation: ${args}`);
    },
  };
  const requireScript = createRequire(script);
  const stopped = new Error('Script completed without uploads');
  try {
    vm.runInNewContext(fs.readFileSync(script, 'utf8'), {
      require: name => name === 'node:child_process' ? fake : requireScript(name),
      process: { argv: ['node', script, '1.7.0', `desktop-v${version}`], exit: () => { throw stopped; } },
      console: { log: () => {} },
    });
  } catch (error) { if (error !== stopped) throw error; }
  return uploads;
}
test('main release receives the verified installer, not just source archives', () => {
  const result = mirror();
  assert.equal(result.length, 1);
  assert.equal(result[0].tag, '1.7.0');
  assert.equal(result[0].bytes.toString(), 'verified-dmg');
});
test('release mirroring is idempotent, ignores drafts and refuses different existing assets', () => {
  assert.equal(mirror({}).length, 0);
  assert.equal(mirror(undefined, false).length, 0);
  assert.throws(() => mirror({ digest: 'sha256:different' }), /Refusing to overwrite/);
});
