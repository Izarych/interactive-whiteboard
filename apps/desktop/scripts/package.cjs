const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { version } = require('../package.json');

const root = path.resolve(__dirname, '..');
const bundles = path.join(root, 'src-tauri/target/release/bundle/nsis');
const installers = fs.readdirSync(bundles).filter((name) => name.endsWith('-setup.exe') && name.includes('x64'));
if (installers.length !== 1) throw new Error(`Expected one Windows x64 installer, found ${installers.length}`);
const data = fs.readFileSync(path.join(bundles, installers[0]));
const output = path.join(root, 'artifacts');
fs.mkdirSync(output, { recursive: true });
const name = `BluviBoard-Setup-${version}-x64.exe`;
fs.writeFileSync(path.join(output, name), data);
fs.writeFileSync(path.join(output, `${name}.sha256`), `${createHash('sha256').update(data).digest('hex')}  ${name}\n`);
console.log(`Packaged ${name} (${(data.length / 1024 / 1024).toFixed(1)} MB)`);
