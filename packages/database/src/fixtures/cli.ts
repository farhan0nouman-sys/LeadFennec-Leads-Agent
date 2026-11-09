// `pnpm db:fixtures [--reset]`: loads the two fixture tenants into DATABASE_URL.
// Development and test databases only. `--reset` first deletes the fixture tenants, users and
// plans (and nothing else), then loads them again.
import {
  appEnvSchema,
  describeStartupError,
  parseEnv,
  postgresUrlSchema,
} from '@lead-fennec-ai/shared';
import { z } from 'zod';
import { createPrismaClient } from '../client.js';
import { deleteFixtureTenants, loadFixtureTenants } from './load.js';

async function main(): Promise<void> {
  const env = parseEnv(
    'fixtures',
    z.object({ APP_ENV: appEnvSchema, DATABASE_URL: postgresUrlSchema }),
    process.env,
  );
  if (env.APP_ENV === 'staging' || env.APP_ENV === 'production') {
    throw new Error(
      `Fixture tenants are for development and test databases only (APP_ENV=${env.APP_ENV}).`,
    );
  }
  const prisma = createPrismaClient({
    databaseUrl: env.DATABASE_URL,
    maxConnections: 1,
  });
  try {
    if (process.argv.includes('--reset')) {
      await deleteFixtureTenants(prisma);
      console.info(
        '[fixtures] deleted the fixture tenants, fixture users and fixture plans',
      );
    }
    const summary = await loadFixtureTenants(prisma);
    // One row per table, one column per tenant.
    const rows: Record<string, Record<string, number>> = {};
    for (const { slug, ...counts } of summary) {
      for (const [table, count] of Object.entries(counts)) {
        (rows[table] ??= {})[slug] = count;
      }
    }
    console.info('[fixtures] loaded (rows per tenant):');
    console.table(rows);
  } finally {
    await prisma.$disconnect();
  }
}

try {
  await main();
} catch (error) {
  console.error(
    describeStartupError('fixtures', error) ??
      (error instanceof Error ? `[fixtures] ${error.message}` : String(error)),
  );
  process.exitCode = 1;
}
