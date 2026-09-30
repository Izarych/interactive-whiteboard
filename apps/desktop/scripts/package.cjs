const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { version } = require('../package.json');
const { productName } = require('../src-tauri/tauri.conf.json');

const root = path.resolve(__dirname, '..');
const bundles = path.join(root, 'src-tauri/target/release/bundle/nsis');
const installer = `${productName}_${version}_x64-setup.exe`;
const data = fs.readFileSync(path.join(bundles, installer));
const output = path.join(root, 'artifacts');
fs.mkdirSync(output, { recursive: true });
const name = `BluviBoard-Setup-${version}-x64.exe`;
fs.writeFileSync(path.join(output, name), data);
fs.writeFileSync(path.join(output, `${name}.sha256`), `${createHash('sha256').update(data).digest('hex')}  ${name}\n`);
console.log(`Packaged ${name} (${(data.length / 1024 / 1024).toFixed(1)} MB)`);
