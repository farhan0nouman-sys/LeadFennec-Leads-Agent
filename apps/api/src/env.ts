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

export const apiEnvSchema = z.object({
  APP_ENV: appEnvSchema,
  LOG_LEVEL: logLevelSchema,
  API_PORT: portSchema(3001),
  DATABASE_URL: postgresUrlSchema,
  REDIS_URL: redisUrlSchema,
  HEALTH_CHECK_TIMEOUT_MS: healthCheckTimeoutSchema,
});

export type ApiEnv = z.output<typeof apiEnvSchema>;

/** Injection token for the validated environment. */
export const API_ENV = Symbol('API_ENV');

export function loadApiEnv(
  source: Readonly<Record<string, string | undefined>>,
): ApiEnv {
  return parseEnv('api', apiEnvSchema, source);
}
