const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { version } = require('../apps/desktop/package.json');

test('desktop packaging selects the current x64 installer from a cache containing older versions', () => {
  const parent = path.resolve(__dirname, '../.test-data');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'desktop-package-'));
  try {
    const scripts = path.join(root, 'scripts');
    const bundles = path.join(root, 'src-tauri/target/release/bundle/nsis');
    fs.mkdirSync(scripts, { recursive: true });
    fs.mkdirSync(bundles, { recursive: true });
    fs.copyFileSync(path.resolve(__dirname, '../apps/desktop/scripts/package.cjs'), path.join(scripts, 'package.cjs'));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version }));
    fs.writeFileSync(path.join(root, 'src-tauri/tauri.conf.json'), JSON.stringify({ productName: 'BluviBoard' }));
    fs.writeFileSync(path.join(bundles, 'BluviBoard_0.1.0_x64-setup.exe'), 'old installer');
    const current = Buffer.from('MZ-current-Windows-installer');
    const currentFile = path.join(bundles, `BluviBoard_${version}_x64-setup.exe`);
    fs.writeFileSync(currentFile, current);
    fs.writeFileSync(path.join(bundles, `BluviBoard_${version}_arm64-setup.exe`), 'wrong architecture');
    const execute = () => spawnSync(process.execPath, [path.join(scripts, 'package.cjs')], { encoding: 'utf8' });
    const result = execute();
    assert.equal(result.status, 0, result.stderr);
    const name = `BluviBoard-Setup-${version}-x64.exe`;
    assert.deepEqual(fs.readFileSync(path.join(root, 'artifacts', name)), current);
    assert.equal(fs.readFileSync(path.join(root, 'artifacts', `${name}.sha256`), 'utf8'), `${createHash('sha256').update(current).digest('hex')}  ${name}\n`);
    fs.unlinkSync(currentFile);
    assert.notEqual(execute().status, 0, 'A missing current installer must not fall back to an older version');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
