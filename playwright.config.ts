import { defineConfig } from '@playwright/test';
import { loadEnvironment } from './scripts/environment.js';

loadEnvironment();
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ??
  'postgres://hq_geap:hq_geap@127.0.0.1:5432/hq_geap_test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  globalSetup: './tests/support/test-db.ts',
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'on-first-retry'
  },
  webServer: [
    {
      command: 'corepack pnpm --filter @hq-geap/api dev',
      url: 'http://127.0.0.1:3000/health',
      env: {
        DATABASE_URL: testDatabaseUrl,
        CORS_ORIGIN: 'http://127.0.0.1:5173',
        HOST: '127.0.0.1',
        JWT_SECRET: 'test-only-secret-with-at-least-32-chars',
        INGESTION_API_KEY: 'test-ingestion-key-with-at-least-32-chars',
        PORT: '3000'
      },
      reuseExistingServer: false,
      timeout: 120_000
    },
    {
      command: 'corepack pnpm --filter @hq-geap/web dev',
      url: 'http://127.0.0.1:5173',
      env: {
        VITE_API_URL: 'http://127.0.0.1:3000'
      },
      reuseExistingServer: false,
      timeout: 120_000
    }
  ]
});
