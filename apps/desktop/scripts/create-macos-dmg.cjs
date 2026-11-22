const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { version } = require('../package.json');
const arch = process.env.BLUVIBOARD_MACOS_ARCH;
if (!['arm64', 'x64'].includes(arch)) throw new Error('Select arm64 or x64');
const preview = process.env.BLUVIBOARD_DESKTOP_PREVIEW === 'true';
const { productName } = require(preview ? '../src-tauri/tauri.preview.conf.json' : '../src-tauri/tauri.conf.json');
const target = arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin';
const root = path.resolve(__dirname, '..', 'src-tauri/target', target, 'release/bundle');
const application = path.join(root, 'macos', `${productName}.app`);
const actualVersion = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', path.join(application, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
if (actualVersion !== version) throw new Error(`Unexpected app version: ${actualVersion}`);
execFileSync('codesign', ['--verify', '--deep', '--strict', application], { stdio: 'inherit' });
const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'bluviboard-dmg-'));
try {
  execFileSync('ditto', [application, path.join(staging, path.basename(application))], { stdio: 'inherit' });
  fs.symlinkSync('/Applications', path.join(staging, 'Applications'));
  const output = path.join(root, 'dmg');
  fs.mkdirSync(output, { recursive: true });
  const name = `${productName}_${version}_${arch === 'arm64' ? 'aarch64' : 'x64'}.dmg`;
  // No Finder/AppleScript automation is needed to create a drag-to-Applications
  // installer. hdiutil produces a compressed, read-only image of the signed app.
  execFileSync('hdiutil', ['create', '-volname', productName, '-srcfolder', staging, '-fs', 'HFS+', '-format', 'UDZO', '-ov', path.join(output, name)], { stdio: 'inherit' });
} finally { fs.rmSync(staging, { recursive: true, force: true }); }
