// `pnpm openapi`: writes docs/api/openapi.json from the endpoint list in
// packages/shared/src/contracts/endpoints.ts (task 05B). The shared package's tests fail while
// the checked-in file is out of date. `pnpm openapi --check` only compares.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openApiJson } from '../packages/shared/dist/index.js';

const target = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'docs',
  'api',
  'openapi.json',
);
const next = openApiJson();

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(target, 'utf8').replace(/\r\n/g, '\n');
  } catch {
    // Missing counts as out of date.
  }
  if (current !== next) {
    console.error(
      '[openapi] docs/api/openapi.json is out of date: run pnpm openapi',
    );
    process.exit(1);
  }
  console.log('[openapi] docs/api/openapi.json is up to date');
} else {
  writeFileSync(target, next);
  console.log('[openapi] wrote docs/api/openapi.json');
}
