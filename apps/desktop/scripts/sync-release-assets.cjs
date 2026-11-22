// Copy verified platform installers into the main product release. Existing
// assets are never overwritten; a different digest requires a new version.
const { spawnSync, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const repository = 'Izarych/interactive-whiteboard';
const target = process.argv[2] || require('../../../package.json').version;
const version = require('../package.json').version;
const source = process.argv[3] || `desktop-v${version}`;
if (!/^\d+\.\d+\.\d+$/.test(target) || !/^desktop-v\d+\.\d+\.\d+$/.test(source)) throw new Error('Invalid release tags');
function read(tag) {
  const result = spawnSync('gh', ['release', 'view', tag, '--repo', repository, '--json', 'assets,isDraft'], { encoding: 'utf8' });
  if (result.status === 0) return JSON.parse(result.stdout);
  if (/release not found|not found|HTTP 404/i.test(result.stderr)) return null;
  throw new Error(result.stderr);
}
const from = read(source), to = read(target);
if (!from || from.isDraft || !to || to.isDraft) {
  console.log('Installer mirroring is pending publication of both releases.');
  process.exit(0);
}
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bluviboard-release-assets-'));
try {
  for (const asset of from.assets) {
    if (!/^BluviBoard-(?:Setup-\d+\.\d+\.\d+-x64\.exe|\d+\.\d+\.\d+-macOS-(?:arm64|x64)\.dmg)(?:\.sha256)?$/.test(asset.name) || asset.state !== 'uploaded') continue;
    const existing = to.assets.find(item => item.name === asset.name);
    if (existing) {
      if (existing.size !== asset.size || (asset.digest && existing.digest !== asset.digest)) throw new Error(`Refusing to overwrite ${target}/${asset.name}`);
      continue;
    }
    execFileSync('gh', ['release', 'download', source, '--repo', repository, '--pattern', asset.name, '--dir', directory], { stdio: 'inherit' });
    const file = path.join(directory, asset.name), bytes = fs.readFileSync(file);
    if (bytes.length !== asset.size || (asset.digest && asset.digest !== `sha256:${createHash('sha256').update(bytes).digest('hex')}`)) throw new Error(`Digest mismatch: ${asset.name}`);
    execFileSync('gh', ['release', 'upload', target, '--repo', repository, file], { stdio: 'inherit' });
    console.log(`Attached ${asset.name} to ${target}`);
    fs.unlinkSync(file);
  }
} finally { fs.rmSync(directory, { recursive: true, force: true }); }
