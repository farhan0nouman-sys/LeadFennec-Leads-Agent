import { defineProjectConfig } from '../../vitest.shared.mjs';

export default defineProjectConfig({
  // Refused loopback connections take about 2 s on Windows; real services may be slower.
  test: { testTimeout: 15_000 },
});
