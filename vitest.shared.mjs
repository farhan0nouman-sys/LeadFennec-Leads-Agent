// Shared Vitest settings. Each package's vitest.config.mjs merges its own options into this.
import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';

const setupFile = fileURLToPath(
  new URL('./packages/shared/src/testing/setup.ts', import.meta.url),
);

const base = defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Blocks all non-loopback network access: no real sending or provider calls in tests.
    setupFiles: [setupFile],
    // Tests never read .env; they get a fixed, fake environment.
    env: { APP_ENV: 'test', LOG_LEVEL: 'silent' },
    restoreMocks: true,
    unstubEnvs: true,
  },
});

/** @param {import('vitest/config').ViteUserConfig} overrides */
export function defineProjectConfig(overrides = {}) {
  return mergeConfig(base, overrides);
}
