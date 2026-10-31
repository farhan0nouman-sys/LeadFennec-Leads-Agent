import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Shared config. ESLint uses the nearest eslint.config.* to each file, so apps/web
// extends this one with the Next.js rules; every other package uses it directly.
export default defineConfig([
  globalIgnores([
    '**/dist/**',
    '**/.next/**',
    '**/.turbo/**',
    '**/next-env.d.ts',
    '**/.vitest/**',
    '**/test-results/**',
    '**/playwright-report/**',
    '**/blob-report/**',
    'reference-repos/**',
  ]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // Nest modules are empty classes configured by decorators.
    files: ['apps/api/**/*.ts'],
    rules: {
      '@typescript-eslint/no-extraneous-class': [
        'error',
        { allowWithDecorator: true },
      ],
    },
  },
  prettier,
]);
