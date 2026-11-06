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
  /**
   * Apollo API key for organization search (task 07B, docs/decisions.md D-07B-05), scoped to
   * api/v1/mixed_companies/search. Read only in staging and production; development and test
   * always use the fake provider. Never logged. Empty counts as unset.
   */
  APOLLO_API_KEY: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z
      .string()
      .regex(/^[!-~]{8,200}$/, {
        error: 'must be 8-200 printable characters without spaces',
      })
      .optional(),
  ),
});

export type WorkerEnv = z.output<typeof workerEnvSchema>;

export function loadWorkerEnv(
  source: Readonly<Record<string, string | undefined>>,
): WorkerEnv {
  return parseEnv('worker', workerEnvSchema, source);
}
