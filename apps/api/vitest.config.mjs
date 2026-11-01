import { defineProjectConfig } from '../../vitest.shared.mjs';

export default defineProjectConfig({
  test: {
    testTimeout: 15_000,
    // The database-backed suites (auth, workspaces) share one test database, each in its own
    // schema; one file at a time, as in packages/database.
    fileParallelism: false,
  },
});
