import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { SiteFile } from '@whiteboard/shared';
import { cleanupWorkspaces } from './asset-test-utils.cjs';

test('administrators edit persistent site files, public responses use disk contents, and invalid or stale writes preserve published files', async ({ page, context, browser }) => {
  const email = `site-files-${randomUUID()}@example.test`;
  const password = 'Site-files-admin-password-123';
  const workspaces: string[] = [];
  let originals: SiteFile[] = [];
  const guest = await browser.newContext({ baseURL: 'http://localhost:5174' });
  try {
    expect((await guest.request.get('/api/admin/site-files')).status()).toBe(401);
    expect((await guest.request.put('/api/admin/site-files/robots.txt', { data: { content: '', revision: null } })).status()).toBe(401);
    workspaces.push((await (await guest.request.post('/api/auth/guest')).json()).workspaceId);
    expect((await guest.request.get('/api/admin/site-files')).status()).toBe(403);
    await promisify(execFile)(process.execPath, ['--env-file=.env', 'scripts/create-admin.cjs', '--email', email, '--name', 'Администратор файлов'], {
      cwd: path.resolve('apps/server'), env: { ...process.env, ADMIN_PASSWORD: password },
    });
    const login = await context.request.post('/api/auth/admin/login', { data: { email, password } });
    expect(login.ok()).toBe(true);
    workspaces.push((await login.json()).workspaceId);
    originals = await (await context.request.get('/api/admin/site-files')).json();
    const originalRobots = originals.find((file) => file.name === 'robots.txt')!;
    const originalSitemap = originals.find((file) => file.name === 'sitemap.xml')!;
    await page.goto('/admin/site-files');
    await expect(page.getByRole('heading', { name: 'Файлы сайта', level: 1, exact: true })).toBeVisible();
    const robotsEditor = page.getByRole('textbox', { name: 'Содержимое robots.txt', exact: true });
    await expect(robotsEditor).toHaveValue(originalRobots.content);
    const updatedRobots = `${originalRobots.content}# admin edit ${randomUUID()}\n`;
    await robotsEditor.fill(updatedRobots);
    await page.getByRole('button', { name: 'sitemap.xml', exact: true }).click();
    const sitemapEditor = page.getByRole('textbox', { name: 'Содержимое sitemap.xml', exact: true });
    const updatedSitemap = originalSitemap.content.replace('</url>', '<lastmod>2026-10-07</lastmod></url>');
    await sitemapEditor.fill(updatedSitemap);
    await page.getByRole('button', { name: 'robots.txt', exact: true }).click();
    await expect(robotsEditor).toHaveValue(updatedRobots);
    await page.getByRole('button', { name: 'Сохранить файл', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('robots.txt сохранён');
    const publishedRobots = await guest.request.get('/robots.txt');
    expect(publishedRobots.status()).toBe(200);
    expect(publishedRobots.headers()['content-type']).toContain('text/plain');
    expect(await publishedRobots.text()).toBe(updatedRobots);
    expect(await readFile(path.join(process.env.BB_E2E_IMAGE_DIRECTORY!, 'site-files/robots.txt'), 'utf8')).toBe(updatedRobots);
    await page.getByRole('button', { name: 'sitemap.xml', exact: true }).click();
    await expect(sitemapEditor).toHaveValue(updatedSitemap);
    await page.getByRole('button', { name: 'Сохранить файл', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('sitemap.xml сохранён');
    const publishedSitemap = await guest.request.get('/sitemap.xml');
    expect(publishedSitemap.status()).toBe(200);
    expect(publishedSitemap.headers()['content-type']).toContain('application/xml');
    expect(await publishedSitemap.text()).toBe(updatedSitemap);
    expect(await readFile(path.join(process.env.BB_E2E_IMAGE_DIRECTORY!, 'site-files/sitemap.xml'), 'utf8')).toBe(updatedSitemap);
    await page.reload();
    await expect(robotsEditor).toHaveValue(updatedRobots);
    const files: SiteFile[] = await (await context.request.get('/api/admin/site-files')).json();
    const currentSitemap = files.find((file) => file.name === 'sitemap.xml')!;
    for (const content of ['<urlset>', '<urlset xmlns="wrong"/>']) {
      expect((await context.request.put('/api/admin/site-files/sitemap.xml', { data: { content, revision: currentSitemap.revision } })).status()).toBe(400);
    }
    expect((await context.request.put('/api/admin/site-files/sitemap.xml', { data: { content: originalSitemap.content, revision: originalSitemap.revision } })).status()).toBe(409);
    expect((await context.request.put('/api/admin/site-files/other.txt', { data: { content: '', revision: null } })).status()).toBe(404);
    expect((await context.request.put('/api/admin/site-files/robots.txt', { data: { content: 'missing revision' } })).status()).toBe(400);
    expect(await (await guest.request.get('/sitemap.xml')).text()).toBe(updatedSitemap);
    await page.getByRole('button', { name: 'sitemap.xml', exact: true }).click();
    await sitemapEditor.fill('<urlset>');
    await page.getByRole('button', { name: 'Сохранить файл', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Некорректный XML');
    await page.getByRole('button', { name: 'Загрузить с сервера', exact: true }).click();
    await expect(sitemapEditor).toHaveValue(updatedSitemap);
    const audit = await (await context.request.get('/api/admin/audit?search=site_file_updated')).json();
    expect(audit.items.filter((item: { actorName: string }) => item.actorName === 'Администратор файлов')).toHaveLength(2);
    await page.screenshot({ path: 'test-results/admin-site-files.png', fullPage: true });
  } finally {
    if (originals.length) {
      const latest: SiteFile[] = await (await context.request.get('/api/admin/site-files')).json();
      for (const file of originals) {
        const response = await context.request.put(`/api/admin/site-files/${file.name}`, { data: { content: file.content, revision: latest.find((item) => item.name === file.name)!.revision } });
        expect(response.ok()).toBe(true);
      }
    }
    await guest.close();
    await cleanupWorkspaces(workspaces, process.env.BB_E2E_IMAGE_DIRECTORY);
  }
});
