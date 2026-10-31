import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import baseConfig from '../../eslint.config.mjs';

// Next.js rules first so the shared typed TypeScript setup (parser, project service) wins.
export default defineConfig([
  ...nextVitals,
  ...baseConfig,
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
]);
