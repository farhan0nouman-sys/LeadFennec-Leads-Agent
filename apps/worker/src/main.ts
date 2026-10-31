import { once } from 'node:events';
import { infrastructureReadinessChecks } from '@lead-fennec-ai/database';
import { describeStartupError } from '@lead-fennec-ai/shared';
import { createLogger } from '@lead-fennec-ai/shared/logger';
import { loadWorkerEnv } from './env.js';
import { createHealthServer } from './health-server.js';

async function main(): Promise<void> {
  const env = loadWorkerEnv(process.env);
  const logger = createLogger({ app: 'worker', level: env.LOG_LEVEL });
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

  function shutdown(signal: NodeJS.Signals): void {
    logger.info({ signal }, 'shutting down');
    server.close();
  }
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  logger.info(
    { healthPort: env.WORKER_HEALTH_PORT },
    'worker started; no job processors registered',
  );
}

try {
  await main();
} catch (error) {
  // Startup errors stay plain text: the logger may not exist yet.
  const message = describeStartupError('worker', error);
  if (message === undefined) {
    throw error;
  }
  console.error(message);
  process.exitCode = 1;
}
