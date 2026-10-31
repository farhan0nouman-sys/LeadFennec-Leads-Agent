import { defineProjectConfig } from '../../vitest.shared.mjs';

export default defineProjectConfig({
  test: { testTimeout: 15_000 },
});
