import { defineConfig, devices } from '@playwright/test';

// Browser smoke tests against the production build (`next build` runs first via turbo).
const port = 3100;
const baseURL = `http://127.0.0.1:${String(port)}`;
const inCi = process.env['CI'] !== undefined;

export default defineConfig({
  testDir: './e2e',
  forbidOnly: inCi,
  retries: inCi ? 1 : 0,
  reporter: inCi ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm exec next start --port ${String(port)} --hostname 127.0.0.1`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
    // Fake values: the smoke test never calls the API.
    env: { APP_ENV: 'test', API_BASE_URL: 'http://127.0.0.1:3101' },
  },
});
