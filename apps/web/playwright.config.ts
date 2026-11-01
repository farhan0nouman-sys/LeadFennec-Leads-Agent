import { defineConfig, devices } from '@playwright/test';
import {
  API_PORT,
  API_URL,
  WEB_PORT,
  WEB_URL,
  e2eDatabaseUrl,
  e2eEnabled,
} from './e2e/support/env';

// Browser tests against the production builds (`turbo run test:e2e` builds the web app and the
// API first). The smoke test always runs. The account and team scenarios also start the API
// on E2E_DATABASE_URL and are skipped without it.
const inCi = process.env['CI'] !== undefined;

const webServer = {
  command: `pnpm exec next start --port ${String(WEB_PORT)} --hostname 127.0.0.1`,
  url: WEB_URL,
  reuseExistingServer: false,
  timeout: 60_000,
  env: { APP_ENV: 'test', API_BASE_URL: API_URL },
};

// The real API, test mode: fake mail provider, nothing sent. One database connection, so the
// scenarios also run on single-session PostgreSQL stand-ins (PGlite).
const apiServer = {
  command: 'node ../api/dist/main.js',
  url: `${API_URL}/health/live`,
  reuseExistingServer: false,
  timeout: 60_000,
  env: {
    APP_ENV: 'test',
    LOG_LEVEL: 'warn',
    API_PORT: String(API_PORT),
    DATABASE_URL: e2eDatabaseUrl ?? '',
    DATABASE_POOL_MAX: '1',
    // Never dialled: only the readiness probe uses Redis.
    REDIS_URL: 'redis://127.0.0.1:1/15',
    WEB_APP_URL: WEB_URL,
    // Browser requests reach the API through the web app's /api proxy.
    TRUST_PROXY_HOPS: '1',
  },
};

export default defineConfig({
  testDir: './e2e',
  forbidOnly: inCi,
  retries: inCi ? 1 : 0,
  // The scenarios share one API and database and build on each other.
  workers: 1,
  fullyParallel: false,
  reporter: inCi ? [['list'], ['html', { open: 'never' }]] : 'list',
  globalSetup: './e2e/support/global-setup.ts',
  use: { baseURL: WEB_URL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: e2eEnabled ? [apiServer, webServer] : [webServer],
});
