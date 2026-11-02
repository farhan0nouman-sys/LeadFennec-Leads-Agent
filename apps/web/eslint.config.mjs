import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import baseConfig from '../../eslint.config.mjs';

// Fixture demonstrations stay apart from production data paths (task 05B, docs/decisions.md
// D-05B-05): only the demo pages may import fixtures, and they may not call the API or use its
// cache.
const FIXTURES_ONLY_IN_DEMOS = {
  group: ['@/fixtures/*', '**/fixtures/*', '@/app/dev/*', '**/app/dev/*'],
  message:
    'Fixture data is for the demo pages (app/dev) only; production code never imports it (docs/decisions.md D-05B-05).',
};
const NO_API_IN_DEMOS =
  'Demos use fixture data only: no API calls, no API cache, no server-side API access (docs/decisions.md D-05B-05).';

// Next.js rules first so the shared typed TypeScript setup (parser, project service) wins.
export default defineConfig([
  ...nextVitals,
  ...baseConfig,
  {
    files: ['**/*.{ts,tsx}'],
    ignores: ['fixtures/**', 'app/dev/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [FIXTURES_ONLY_IN_DEMOS] },
      ],
    },
  },
  {
    files: ['fixtures/**/*.{ts,tsx}', 'app/dev/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@/lib/api',
              importNames: ['callApi', 'sendRequest', 'endpointRequest'],
              message: NO_API_IN_DEMOS,
            },
            { name: '@/lib/query', message: NO_API_IN_DEMOS },
            { name: '@/lib/query-cache', message: NO_API_IN_DEMOS },
            { name: '@/lib/session', message: NO_API_IN_DEMOS },
          ],
          patterns: [{ group: ['@/lib/server/*'], message: NO_API_IN_DEMOS }],
        },
      ],
    },
  },
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts']),
]);
