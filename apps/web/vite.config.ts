import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Plugin } from 'vite';

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
  server: {
    proxy: {
      '/api': process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
      '/robots.txt': process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
      '/sitemap.xml': process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
    },
  },
});
