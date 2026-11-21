import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const guidePages = ['dlya-ucheby', 'doska-v-kletku', 'dlya-repetitorov'];

function publicContent(): Plugin {
  return {
    name: 'bluviboard-public-content',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        // Use the same visible content before and after React starts.
        html = html.replace('<!-- public-learning -->', () => `<div class="public-learning">${readFileSync(new URL('./src/public-learning.html', import.meta.url), 'utf8')}</div>`);
        const url = html.match(/rel="canonical" href="([^"]+)"/)?.[1];
        const name = html.match(/<title>([^<]+)<\/title>/)?.[1];
        const description = html.match(/name="description" content="([^"]+)"/)?.[1];
        if (!url || !name || !description) return html;
        const home = 'https://bluviboard.ru/';
        const graph: Record<string, unknown>[] = [
          { '@type': 'WebPage', '@id': `${url}#page`, url, name, description, inLanguage: 'ru', isPartOf: { '@id': `${home}#website` } },
        ];
        if (url === home) {
          graph.push(
            { '@type': 'WebSite', '@id': `${home}#website`, url: home, name: 'BluviBoard', inLanguage: 'ru' },
            { '@type': 'WebApplication', '@id': `${home}#application`, name: 'BluviBoard', url: home, description, applicationCategory: 'EducationalApplication', operatingSystem: 'Web', inLanguage: 'ru', featureList: ['Совместное рисование по ссылке', 'Вход без регистрации', 'Клетчатый фон', 'Геометрические фигуры', 'Экспорт PNG'] },
          );
        } else {
          graph[0].breadcrumb = { '@id': `${url}#breadcrumbs` };
          graph.push({ '@type': 'BreadcrumbList', '@id': `${url}#breadcrumbs`, itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Главная BluviBoard', item: home },
            { '@type': 'ListItem', position: 2, name: name.replace(/ — BluviBoard$/, ''), item: url },
          ] });
        }
        // No fabricated ratings, prices or promises of rich search results.
        const data = JSON.stringify({ '@context': 'https://schema.org', '@graph': graph }).replace(/</g, '\\u003c');
        return { html, tags: [{ tag: 'script', attrs: { type: 'application/ld+json' }, children: data, injectTo: 'head' }] };
      },
    },
  };
}

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
  for (const name of guidePages) add(fileURLToPath(new URL(`./${name}/index.html`, import.meta.url)), `${name}/index.html`);
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
  optimizeDeps: { include: ['@whiteboard/shared/board-operations'] },
  plugins: [react(), publicContent(), pwaWorker()],
  define: { __BLUVIBOARD_RELEASES__: JSON.stringify({ web: releaseNotes(webVersion), webHistory, desktop: desktopReleases }), __BLUVIBOARD_BUILD_ID__: JSON.stringify(buildId) },
  build: {
    commonjsOptions: { include: [/node_modules/, /packages[\\/]shared/] },
    rollupOptions: {
      input: Object.fromEntries(['index', ...guidePages].map((name) => [name, fileURLToPath(new URL(name === 'index' ? './index.html' : `./${name}/index.html`, import.meta.url))])),
    },
  },
  server: {
    proxy: {
      '/api': { target: process.env.API_PROXY_TARGET ?? 'http://localhost:3000', ws: true },
      '/robots.txt': process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
      '/sitemap.xml': process.env.API_PROXY_TARGET ?? 'http://localhost:3000',
    },
  },
});
