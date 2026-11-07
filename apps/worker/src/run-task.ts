// Development and test only (task 07C, docs/decisions.md D-07C-01): runs one queued task (a
// search, a website research since 09C, a lead qualification since 10C) directly, without Redis. `node dist/run-task.js <taskId>` prints the outcome. The browser
// tests use it to run the real job against their database. Elsewhere it refuses to run.
import { createPrismaClient, JobRejectedError } from '@lead-fennec-ai/database';
import {
  createModelProvider,
  createOrganizationSearchProvider,
  createWebsiteFetcher,
} from '@lead-fennec-ai/integrations';
import { describeStartupError } from '@lead-fennec-ai/shared';
import { z } from 'zod';
import { loadWorkerEnv, modelConfig } from './env.js';
import { runDiscoveryTask } from './jobs/lead-discovery.js';
import { runQualificationTask } from './jobs/lead-qualification.js';
import { runResearchTask } from './jobs/website-research.js';

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
  const message = { v: 1, taskId: taskId.data };
  try {
    let outcome: string;
    try {
      outcome = await runDiscoveryTask(prisma, message, {
        provider: () => createOrganizationSearchProvider(env.APP_ENV, {}),
      });
    } catch (error) {
      // Not a search: claimJob refuses it before claiming anything, so try research.
      if (
        !(error instanceof JobRejectedError) ||
        error.reason !== 'wrong_worker'
      ) {
        throw error;
      }
      const fetcher = createWebsiteFetcher(env.APP_ENV, {
        blockedHosts: env.WEBSITE_FETCH_BLOCKED_HOSTS,
        allowedHosts: env.WEBSITE_FETCH_ALLOWED_HOSTS,
      });
      const model = () => createModelProvider(env.APP_ENV, modelConfig(env));
      try {
        outcome = await runResearchTask(prisma, message, {
          fetcher: () => fetcher,
          model,
        });
      } catch (inner) {
        // Not a research either: a qualification, or refused for its own reason.
        if (
          !(inner instanceof JobRejectedError) ||
          inner.reason !== 'wrong_worker'
        ) {
          throw inner;
        }
        outcome = await runQualificationTask(prisma, message, { model });
      }
    }
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
