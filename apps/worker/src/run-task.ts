// Development and test only (task 07C, docs/decisions.md D-07C-01): runs one queued task (a
// search, a website research since 09C, a lead qualification since 10C, a contact enrichment or
// an address recheck since 08C, a people import since 11C) directly, without Redis. `node dist/run-task.js <taskId>` prints
// the outcome. The browser tests use it to run the real job against their database. Elsewhere it
// refuses to run.
import { createPrismaClient, JobRejectedError } from '@lead-fennec-ai/database';
import {
  createContactDataProviders,
  createEmailVerificationProvider,
  createModelProvider,
  createOrganizationSearchProvider,
  createWebsiteFetcher,
} from '@lead-fennec-ai/integrations';
import { describeStartupError } from '@lead-fennec-ai/shared';
import { z } from 'zod';
import { loadWorkerEnv, modelConfig } from './env.js';
import { runEnrichmentTask } from './jobs/contact-enrichment.js';
import { runContactImportTask } from './jobs/contact-import.js';
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
  const fetcher = createWebsiteFetcher(env.APP_ENV, {
    blockedHosts: env.WEBSITE_FETCH_BLOCKED_HOSTS,
    allowedHosts: env.WEBSITE_FETCH_ALLOWED_HOSTS,
  });
  const model = () => createModelProvider(env.APP_ENV, modelConfig(env));
  // Each runner refuses a task of another worker before claiming anything ("wrong_worker"),
  // so the next one is tried.
  const runners: (() => Promise<string>)[] = [
    () =>
      runDiscoveryTask(prisma, message, {
        provider: () => createOrganizationSearchProvider(env.APP_ENV, {}),
      }),
    () => runResearchTask(prisma, message, { fetcher: () => fetcher, model }),
    () => runQualificationTask(prisma, message, { model }),
    () =>
      runEnrichmentTask(prisma, message, {
        providers: () => createContactDataProviders(env.APP_ENV, {}),
        verifier: () => createEmailVerificationProvider(env.APP_ENV),
      }),
    () => runContactImportTask(prisma, message),
  ];
  try {
    let outcome: string | null = null;
    for (const runner of runners) {
      try {
        outcome = await runner();
        break;
      } catch (error) {
        if (
          !(error instanceof JobRejectedError) ||
          error.reason !== 'wrong_worker'
        ) {
          throw error;
        }
      }
    }
    if (outcome === null) {
      throw new JobRejectedError('wrong_worker');
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
