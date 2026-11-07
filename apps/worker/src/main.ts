import { once } from 'node:events';
import {
  createPrismaClient,
  infrastructureReadinessChecks,
  JobRejectedError,
  type WorkerDefinition,
} from '@lead-fennec-ai/database';
import {
  createModelProvider,
  createOrganizationSearchProvider,
  createWebsiteFetcher,
  LiveProvidersUnavailableError,
} from '@lead-fennec-ai/integrations';
import { describeStartupError } from '@lead-fennec-ai/shared';
import { createLogger } from '@lead-fennec-ai/shared/logger';
import { loadWorkerEnv, modelConfig } from './env.js';
import { createHealthServer } from './health-server.js';
import {
  LEAD_DISCOVERY_WORKER,
  runDiscoveryTask,
} from './jobs/lead-discovery.js';
import {
  LEAD_QUALIFICATION_WORKER,
  runQualificationTask,
} from './jobs/lead-qualification.js';
import {
  runResearchTask,
  WEBSITE_RESEARCH_WORKER,
} from './jobs/website-research.js';
import {
  createJobQueue,
  createJobWorker,
  JOB_QUEUE_NAME,
  QUALIFICATION_QUEUE_NAME,
  relayDueTasks,
  RESEARCH_QUEUE_NAME,
} from './queue.js';

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
  // One website fetcher for the process (task 09A): its per-host limits and robots.txt cache
  // are shared by every research run; its access restrictions are checked here, at startup.
  const fetcher = createWebsiteFetcher(env.APP_ENV, {
    blockedHosts: env.WEBSITE_FETCH_BLOCKED_HOSTS,
    allowedHosts: env.WEBSITE_FETCH_ALLOWED_HOSTS,
  });
  // The model (task 09B) is made for each run: without OPENAI_API_KEY and OPENAI_MODEL in
  // staging or production, research runs fail with "model_unavailable" and nothing else stops.
  const model = () => createModelProvider(env.APP_ENV, modelConfig(env));

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

  // One queue per worker definition (task 09C): a message reaches only the worker of its type.
  const kinds: {
    readonly name: string;
    readonly queueName: string;
    readonly definition: WorkerDefinition;
    readonly run: (message: unknown) => Promise<string>;
  }[] = [
    {
      name: 'discovery',
      queueName: JOB_QUEUE_NAME,
      definition: LEAD_DISCOVERY_WORKER,
      run: (message) =>
        runDiscoveryTask(prisma, message, { provider: searchProvider }),
    },
    {
      name: 'research',
      queueName: RESEARCH_QUEUE_NAME,
      definition: WEBSITE_RESEARCH_WORKER,
      run: (message) =>
        runResearchTask(prisma, message, { fetcher: () => fetcher, model }),
    },
    {
      name: 'qualification',
      queueName: QUALIFICATION_QUEUE_NAME,
      definition: LEAD_QUALIFICATION_WORKER,
      run: (message) => runQualificationTask(prisma, message, { model }),
    },
  ];
  const queues = kinds.map((kind) => {
    const queue = createJobQueue(env.REDIS_URL, kind.queueName);
    const worker = createJobWorker(
      env.REDIS_URL,
      async (message) => {
        try {
          const outcome = await kind.run(message);
          logger.info({ outcome, kind: kind.name }, 'task handled');
        } catch (error) {
          if (error instanceof JobRejectedError) {
            // Logged by reason only, never the message.
            logger.warn(
              { reason: error.reason, kind: kind.name },
              'job dropped',
            );
            return;
          }
          // The run is already marked failed (internal_error).
          logger.error({ err: error, kind: kind.name }, 'task failed');
        }
      },
      kind.queueName,
    );
    worker.on('error', (error) => {
      logger.error({ err: error, kind: kind.name }, 'queue worker error');
    });
    return { kind, queue, worker };
  });

  let relaying = false;
  const relay = setInterval(() => {
    if (relaying) {
      return;
    }
    relaying = true;
    Promise.all(
      queues.map(({ kind, queue }) =>
        relayDueTasks(prisma, queue.publish, {
          worker: kind.definition,
          now: new Date(),
        }),
      ),
    )
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
    void Promise.allSettled(
      queues.flatMap(({ queue, worker }) => [worker.close(), queue.close()]),
    ).then(() => prisma.$disconnect());
    server.close();
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  logger.info(
    {
      healthPort: env.WORKER_HEALTH_PORT,
      taskTypes: kinds.flatMap((kind) => kind.definition.taskTypes),
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
