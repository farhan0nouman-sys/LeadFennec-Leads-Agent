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
    '**/src/generated/**',
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
    rules: {
      // Prisma Client offers partial unique constraints (schema names ending in "_partial")
      // as findUnique/upsert keys but drops their WHERE clause, so a lookup can return a row
      // the constraint does not cover. docs/decisions.md D-03B-01.
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Property[key.name=/_partial$/]',
          message:
            'Partial unique keys are constraints, not lookup keys: Prisma ignores their WHERE clause (docs/decisions.md D-03B-01). Filter with findFirst instead.',
        },
      ],
    },
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
