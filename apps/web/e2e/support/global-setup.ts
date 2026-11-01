// Applies the migrations to the e2e database before the scenarios run (prisma migrate deploy:
// applies pending migrations only, never resets data).
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { assertTestDatabaseUrl } from '@lead-fennec-ai/database';
import { e2eDatabaseUrl, e2eEnabled } from './env';

const databaseDir = fileURLToPath(
  new URL('../../../../packages/database', import.meta.url),
);

export default function globalSetup(): void {
  if (!e2eEnabled || e2eDatabaseUrl === undefined) {
    return;
  }
  const url = assertTestDatabaseUrl(e2eDatabaseUrl, 'E2E_DATABASE_URL');
  const prismaCli = createRequire(`${databaseDir}/package.json`).resolve(
    'prisma/build/index.js',
  );
  execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
    cwd: databaseDir,
    env: { ...process.env, DATABASE_URL: url, PRISMA_HIDE_UPDATE_MESSAGE: '1' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
}
