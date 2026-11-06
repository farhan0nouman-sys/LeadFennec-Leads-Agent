import { defineProjectConfig } from '../../vitest.shared.mjs';

export default defineProjectConfig({
  test: {
    testTimeout: 30_000,
    // The search job suite uses a real test database (its own schema); one file at a time,
    // as in packages/database and apps/api.
    fileParallelism: false,
  },
});
