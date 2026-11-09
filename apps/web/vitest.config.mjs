import { fileURLToPath } from 'node:url';
import { defineProjectConfig } from '../../vitest.shared.mjs';

// Unit tests of the web app's pure modules (task 05B): lib/**/*.test.ts. Screens are tested in
// the browser (e2e/). `server-only` is a Next.js build-time marker; outside Next it resolves to
// an empty module.
export default defineProjectConfig({
  resolve: {
    alias: [
      {
        find: /^@\//,
        replacement: fileURLToPath(new URL('./', import.meta.url)),
      },
      {
        find: 'server-only',
        replacement: fileURLToPath(
          new URL('./vitest.server-only.mjs', import.meta.url),
        ),
      },
    ],
  },
  test: { include: ['lib/**/*.test.ts'] },
});
