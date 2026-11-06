// Development and test only (task 07C, docs/decisions.md D-07C-01): runs one queued search task
// directly, without Redis. `node dist/run-task.js <taskId>` prints the outcome. The browser
// tests use it to run the real job against their database. Elsewhere it refuses to run.
import { createPrismaClient } from '@lead-fennec-ai/database';
import { createOrganizationSearchProvider } from '@lead-fennec-ai/integrations';
import { describeStartupError } from '@lead-fennec-ai/shared';
import { z } from 'zod';
import { loadWorkerEnv } from './env.js';
import { runDiscoveryTask } from './jobs/lead-discovery.js';

async function run(): Promise<void> {
  const env = loadWorkerEnv(process.env);
  if (env.APP_ENV !== 'development' && env.APP_ENV !== 'test') {
    console.error('[worker] run-task is for development and test only.');
    process.exitCode = 1;
    return;
  }
  const taskId = z.uuid().safeParse(process.argv[2]);
  if (!taskId.success) {
    console.error('[worker] Usage: run-task <task id>');
    process.exitCode = 1;
    return;
  }
  const prisma = createPrismaClient({
    databaseUrl: env.DATABASE_URL,
    maxConnections: 1,
  });
  try {
    const outcome = await runDiscoveryTask(
      prisma,
      { v: 1, taskId: taskId.data },
      { provider: () => createOrganizationSearchProvider(env.APP_ENV, {}) },
    );
    console.log(outcome);
  } finally {
    await prisma.$disconnect();
  }
}

try {
  await run();
} catch (error) {
  const message = describeStartupError('worker', error);
  if (message === undefined) {
    throw error;
  }
  console.error(message);
  process.exitCode = 1;
}
