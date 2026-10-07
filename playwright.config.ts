import { defineConfig } from '@playwright/test';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

if (!process.env.DATABASE_URL) process.loadEnvFile(path.resolve('apps/server/.env'));
const schema = process.env.BB_E2E_SCHEMA ?? `bb_e2e_test_${randomUUID().replaceAll('-', '')}`;
if (!/^bb_e2e_test_[a-f0-9]{32}$/.test(schema)) throw new Error('Invalid browser test schema');
process.env.BB_E2E_SCHEMA = schema;
const databaseUrl = new URL(process.env.DATABASE_URL!);
databaseUrl.searchParams.set('options', `-c search_path=${schema}`);
process.env.DATABASE_URL = databaseUrl.toString();
const imageDirectory = path.resolve(`.test-data/${schema}`);
process.env.BB_E2E_IMAGE_DIRECTORY = imageDirectory;

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  globalTeardown: './tests/e2e-teardown.cjs',
  timeout: 45000,
  use: { baseURL: 'http://localhost:5174', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'node ../../tests/e2e-server.cjs',
      cwd: path.resolve('apps/server'),
      url: 'http://localhost:3102/api/health',
      env: { DATABASE_URL: databaseUrl.toString(), PORT: '3102', WEB_ORIGIN: 'http://localhost:5174', STORAGE_PROVIDER: 'local', STORAGE_LOCAL_PATH: imageDirectory,
        SITE_FILES_PATH: path.join(imageDirectory, 'site-files'),
        AUTH_SECRET: 'browser-test-only-code-hashing-secret-at-least-32-characters', LEGACY_OWNER_EMAIL: '', COOKIE_SECURE: 'false',
        SMTP_HOST: '127.0.0.1', SMTP_PORT: '1025', SMTP_SECURE: 'false', SMTP_USER: '', SMTP_PASSWORD: '' },
      reuseExistingServer: false,
    },
    {
      command: 'npm run preview --workspace @whiteboard/web -- --port 5174 --strictPort',
      url: 'http://localhost:5174',
      env: { API_PROXY_TARGET: 'http://localhost:3102' },
      reuseExistingServer: false,
    },
  ],
});
