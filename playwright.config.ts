import { defineConfig } from '@playwright/test';
import path from 'node:path';

export default defineConfig({
  testDir: './tests',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 45000,
  use: { baseURL: 'http://localhost:5174', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: [
    {
      command: 'node dist/main.js',
      cwd: path.resolve('apps/server'),
      url: 'http://localhost:3102/api/health',
      env: { PORT: '3102', WEB_ORIGIN: 'http://localhost:5174', STORAGE_PROVIDER: 'local', STORAGE_LOCAL_PATH: path.resolve('.test-data/e2e-assets') },
      reuseExistingServer: false,
    },
    {
      command: 'npm run dev --workspace @whiteboard/web -- --port 5174 --strictPort',
      url: 'http://localhost:5174',
      env: { API_PROXY_TARGET: 'http://localhost:3102' },
      reuseExistingServer: false,
    },
  ],
});
