import { defineProjectConfig } from '../../vitest.shared.mjs';

export default defineProjectConfig({
  test: {
    // Refused loopback connections take about 2 s on Windows; real services may be slower.
    testTimeout: 15_000,
    // The integration suites share one test database (each in its own schema); running the
    // files one at a time keeps database-wide work such as ANALYZE from overlapping.
    fileParallelism: false,
  },
});
