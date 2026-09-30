const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const icon = path.resolve(root, '../web/public/favicon.svg');
fs.copyFileSync(icon, path.join(root, 'launcher/favicon.svg'));
execFileSync(process.execPath, [
  require.resolve('@tauri-apps/cli/tauri.js'), 'icon', icon,
  '--output', path.join(root, 'src-tauri/icons'),
], { stdio: 'inherit', cwd: root });
