import {
  appEnvSchema,
  healthCheckTimeoutSchema,
  httpUrlSchema,
  logLevelSchema,
  parseEnv,
  portSchema,
  postgresUrlSchema,
  redisUrlSchema,
} from '@lead-fennec-ai/shared';
import { z } from 'zod';

export const apiEnvSchema = z
  .object({
    APP_ENV: appEnvSchema,
    LOG_LEVEL: logLevelSchema,
    API_PORT: portSchema(3001),
    DATABASE_URL: postgresUrlSchema,
    REDIS_URL: redisUrlSchema,
    HEALTH_CHECK_TIMEOUT_MS: healthCheckTimeoutSchema,
    /**
     * Public URL of the web app (no path): emailed links point here, and mutations whose
     * Origin is anything else are refused. Defaults to http://localhost:3000 in development
     * and test; required (https) in staging and production.
     */
    WEB_APP_URL: httpUrlSchema.optional(),
  })
  .transform((env, ctx) => {
    const local = env.APP_ENV === 'development' || env.APP_ENV === 'test';
    const raw =
      env.WEB_APP_URL ?? (local ? 'http://localhost:3000' : undefined);
    if (raw === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['WEB_APP_URL'],
        message: 'is required outside development and test',
      });
      return z.NEVER;
    }
    const url = new URL(raw);
    if (!local && url.protocol !== 'https:') {
      ctx.addIssue({
        code: 'custom',
        path: ['WEB_APP_URL'],
        message: 'must be an https:// URL outside development and test',
      });
      return z.NEVER;
    }
    if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
      ctx.addIssue({
        code: 'custom',
        path: ['WEB_APP_URL'],
        message: 'must be an origin without a path, query or fragment',
      });
      return z.NEVER;
    }
    return { ...env, WEB_APP_URL: url.origin };
  });

export type ApiEnv = z.output<typeof apiEnvSchema>;

/** Injection token for the validated environment. */
export const API_ENV = Symbol('API_ENV');

export function loadApiEnv(
  source: Readonly<Record<string, string | undefined>>,
): ApiEnv {
  return parseEnv('api', apiEnvSchema, source);
}
