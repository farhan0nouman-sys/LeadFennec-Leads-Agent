import {
  appEnvSchema,
  healthCheckTimeoutSchema,
  logLevelSchema,
  parseEnv,
  portSchema,
  postgresUrlSchema,
  redisUrlSchema,
} from '@lead-fennec-ai/shared';
import { z } from 'zod';

export const workerEnvSchema = z.object({
  APP_ENV: appEnvSchema,
  LOG_LEVEL: logLevelSchema,
  WORKER_HEALTH_PORT: portSchema(3002),
  DATABASE_URL: postgresUrlSchema,
  REDIS_URL: redisUrlSchema,
  HEALTH_CHECK_TIMEOUT_MS: healthCheckTimeoutSchema,
});

export type WorkerEnv = z.output<typeof workerEnvSchema>;

export function loadWorkerEnv(
  source: Readonly<Record<string, string | undefined>>,
): WorkerEnv {
  return parseEnv('worker', workerEnvSchema, source);
}
