const { Pool } = require('pg');
const path = require('node:path');
const { mkdir, writeFile } = require('node:fs/promises');

async function start() {
  const schema = process.env.BB_E2E_SCHEMA;
  if (!/^bb_e2e_test_[a-f0-9]{32}$/.test(schema ?? '')) throw new Error('Invalid browser test schema');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try { await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`); }
  finally { await pool.end(); }
  const directory = process.env.SITE_FILES_PATH;
  if (!directory || path.resolve(directory) !== path.resolve(__dirname, '../.test-data', schema, 'site-files')) throw new Error('Invalid site-file test directory');
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, 'robots.txt'), 'User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nAllow: /api/auth/session$\n\nSitemap: https://bluviboard.ru/sitemap.xml\n');
  await writeFile(path.join(directory, 'sitemap.xml'), '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://bluviboard.ru/</loc></url></urlset>\n');
  require(path.resolve(__dirname, '../apps/server/dist/main.js'));
}

start().catch((error) => { console.error(error.message); process.exitCode = 1; });
