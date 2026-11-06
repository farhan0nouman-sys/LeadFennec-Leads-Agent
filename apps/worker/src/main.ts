import { once } from 'node:events';
import {
  createPrismaClient,
  infrastructureReadinessChecks,
  JobRejectedError,
} from '@lead-fennec-ai/database';
import {
  createOrganizationSearchProvider,
  LiveProvidersUnavailableError,
} from '@lead-fennec-ai/integrations';
import { describeStartupError } from '@lead-fennec-ai/shared';
import { createLogger } from '@lead-fennec-ai/shared/logger';
import { loadWorkerEnv } from './env.js';
import { createHealthServer } from './health-server.js';
import {
  LEAD_DISCOVERY_WORKER,
  runDiscoveryTask,
} from './jobs/lead-discovery.js';
import { createJobQueue, createJobWorker, relayDueTasks } from './queue.js';

/** How often due tasks are published (docs/decisions.md D-07C-01). */
const RELAY_INTERVAL_MS = 5_000;

async function main(): Promise<void> {
  const env = loadWorkerEnv(process.env);
  const logger = createLogger({ app: 'worker', level: env.LOG_LEVEL });
  // The environment's search provider must exist before any job runs (staging and production
  // need APOLLO_API_KEY); it is made again for every run.
  const searchProvider = () =>
    createOrganizationSearchProvider(env.APP_ENV, {
      apolloApiKey: env.APOLLO_API_KEY,
    });
  searchProvider();

  const prisma = createPrismaClient({ databaseUrl: env.DATABASE_URL });
  const checks = infrastructureReadinessChecks({
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
  });
  const server = createHealthServer(
    checks,
    env.HEALTH_CHECK_TIMEOUT_MS,
    logger,
  );
  server.listen(env.WORKER_HEALTH_PORT);
  await once(server, 'listening');

  const queue = createJobQueue(env.REDIS_URL);
  const worker = createJobWorker(env.REDIS_URL, async (message) => {
    try {
      const outcome = await runDiscoveryTask(prisma, message, {
        provider: searchProvider,
      });
      logger.info({ outcome }, 'discovery task handled');
    } catch (error) {
      if (error instanceof JobRejectedError) {
        // Logged by reason only, never the message.
        logger.warn({ reason: error.reason }, 'job dropped');
        return;
      }
      // The run is already marked failed (internal_error).
      logger.error({ err: error }, 'discovery task failed');
    }
  });
  worker.on('error', (error) => {
    logger.error({ err: error }, 'queue worker error');
  });

  let relaying = false;
  const relay = setInterval(() => {
    if (relaying) {
      return;
    }
    relaying = true;
    relayDueTasks(prisma, queue.publish, {
      worker: LEAD_DISCOVERY_WORKER,
      now: new Date(),
    })
      .catch((error: unknown) => {
        logger.error({ err: error }, 'relay failed');
      })
      .finally(() => {
        relaying = false;
      });
  }, RELAY_INTERVAL_MS);

  function shutdown(signal: NodeJS.Signals): void {
    logger.info({ signal }, 'shutting down');
    clearInterval(relay);
    void Promise.allSettled([worker.close(), queue.close()]).then(() =>
      prisma.$disconnect(),
    );
    server.close();
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  logger.info(
    {
      healthPort: env.WORKER_HEALTH_PORT,
      taskTypes: LEAD_DISCOVERY_WORKER.taskTypes,
    },
    'worker started',
  );
}

try {
  await main();
} catch (error) {
  // Startup errors stay plain text: the logger may not exist yet.
  const message =
    error instanceof LiveProvidersUnavailableError
      ? `[worker] ${error.message} Set it for the worker (docs/local-development.md).`
      : describeStartupError('worker', error);
  if (message === undefined) {
    throw error;
  }
  console.error(message);
  process.exitCode = 1;
}
