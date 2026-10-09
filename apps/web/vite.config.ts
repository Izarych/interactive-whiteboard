import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

function releaseNotes(version: string, desktop = false) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version');
  const text = readFileSync(new URL(`../../docs/releases/${desktop ? 'desktop/' : ''}${version}.md`, import.meta.url), 'utf8').trim();
  const title = `BluviBoard${desktop ? ' для Windows' : ''} ${version}`;
  const [heading, ...lines] = text.split(/\r?\n/);
  const notes = lines.join('\n').trim();
  if (heading !== `# ${title}` || !notes) throw new Error(`Missing or mismatched release notes for ${title}`);
  return { version, title, notes, kind: desktop ? 'desktop' : 'web' };
}
const webVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;
function compareVersions(a: string, b: string) {
  const left = a.split('.').map(Number), right = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
}
const webHistory = readdirSync(new URL('../../docs/releases/', import.meta.url))
  .filter((name) => /^\d+\.\d+\.\d+\.md$/.test(name)).map((name) => name.slice(0, -3))
  .filter((version) => compareVersions(version, webVersion) <= 0).sort((a, b) => compareVersions(b, a)).slice(0, 3).map((version) => releaseNotes(version));
const desktopReleases = Object.fromEntries(readdirSync(new URL('../../docs/releases/desktop/', import.meta.url))
  .filter((name) => /^\d+\.\d+\.\d+\.md$/.test(name)).map((name) => { const version = name.slice(0, -3); return [version, releaseNotes(version, true)]; }));

// Both the running UI and its worker receive the same identity, without hashing
// the generated bundles back into a constant inside those bundles.
function applicationBuildId() {
  const hash = createHash('sha256');
  const add = (path: string, label: string) => {
    const content = readFileSync(path);
    hash.update(label).update('\0');
    hash.update(['.ts', '.tsx', '.js', '.css', '.svg', '.html', '.json', '.webmanifest', '.md', '.txt'].includes(extname(path)) ? content.toString('utf8').replace(/\r\n/g, '\n') : content);
    hash.update('\0');
  };
  const directory = (path: string, label: string) => {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = join(path, entry.name), name = `${label}/${entry.name}`;
      if (entry.isDirectory()) directory(file, name); else if (entry.isFile()) add(file, name);
    }
  };
  directory(fileURLToPath(new URL('./src/', import.meta.url)), 'src');
  directory(fileURLToPath(new URL('./public/', import.meta.url)), 'public');
  for (const name of ['index.html', 'package.json', 'vite.config.ts', '../../package-lock.json', '../../apps/desktop/package.json']) add(fileURLToPath(new URL(name, import.meta.url)), name);
  hash.update(JSON.stringify({ web: releaseNotes(webVersion), webHistory, desktop: desktopReleases }));
  return hash.digest('hex').slice(0, 20);
}
const buildId = applicationBuildId();

function pwaWorker(): Plugin {
  return {
    name: 'bluviboard-pwa-worker',
    apply: 'build',
    generateBundle() {
      const worker = readFileSync(new URL('./src/service-worker.js', import.meta.url), 'utf8');
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: worker.replace('__PWA_BUILD_ID__', buildId).replace('__PWA_APP_VERSION__', webVersion) });
    },
  };
}

export default defineConfig({
  plugins: [react(), pwaWorker()],
  define: { __BLUVIBOARD_RELEASES__: JSON.stringify({ web: releaseNotes(webVersion), webHistory, desktop: desktopReleases }), __BLUVIBOARD_BUILD_ID__: JSON.stringify(buildId) },
  server: {
    proxy: {
      '/api': process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
      '/robots.txt': process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
      '/sitemap.xml': process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
    },
  },
});
