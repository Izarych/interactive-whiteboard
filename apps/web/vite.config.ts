import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
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
const desktopReleases = Object.fromEntries(readdirSync(new URL('../../docs/releases/desktop/', import.meta.url))
  .filter((name) => /^\d+\.\d+\.\d+\.md$/.test(name)).map((name) => { const version = name.slice(0, -3); return [version, releaseNotes(version, true)]; }));

function pwaWorker(): Plugin {
  return {
    name: 'bluviboard-pwa-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const worker = readFileSync(new URL('./src/service-worker.js', import.meta.url), 'utf8');
      const hash = createHash('sha256').update(worker).update(readFileSync(new URL('./index.html', import.meta.url)));
      for (const name of Object.keys(bundle).sort()) {
        const entry = bundle[name];
        hash.update(name).update(entry.type === 'chunk' ? entry.code : entry.source);
      }
      for (const name of ['offline.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png']) {
        hash.update(readFileSync(new URL(`./public/${name}`, import.meta.url)));
      }
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: worker.replace('__PWA_BUILD_ID__', hash.digest('hex').slice(0, 20)) });
    },
  };
}

export default defineConfig({
  plugins: [react(), pwaWorker()],
  define: { __BLUVIBOARD_RELEASES__: JSON.stringify({ web: releaseNotes(webVersion), desktop: desktopReleases }) },
  server: {
    proxy: {
      '/api': process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
      '/robots.txt': process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
      '/sitemap.xml': process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
    },
  },
});
