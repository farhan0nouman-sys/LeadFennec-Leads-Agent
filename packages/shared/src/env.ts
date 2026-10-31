import { z } from 'zod';

/** Thrown when an app's environment fails validation. The message never contains values. */
export class EnvValidationError extends Error {
  override readonly name = 'EnvValidationError';
}

export const APP_ENVS = [
  'development',
  'test',
  'staging',
  'production',
] as const;
export type AppEnv = (typeof APP_ENVS)[number];

export const appEnvSchema = z.enum(APP_ENVS).default('development');

export const LOG_LEVELS = [
  'fatal',
  'error',
  'warn',
  'info',
  'debug',
  'trace',
  'silent',
] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const logLevelSchema = z.enum(LOG_LEVELS).default('info');

export function portSchema(defaultPort: number) {
  return z.coerce.number().int().min(1).max(65_535).default(defaultPort);
}

/** A required URL variable restricted to `protocol`; the error never echoes the value. */
function urlSchema(protocol: RegExp, expected: string) {
  return z.url({
    protocol,
    error: (issue) =>
      issue.input === undefined ? 'is required' : `must be ${expected}`,
  });
}

export const httpUrlSchema = urlSchema(
  /^https?$/,
  'an http:// or https:// URL',
);

export const postgresUrlSchema = urlSchema(
  /^postgres(ql)?$/,
  'a postgres:// or postgresql:// URL',
);

export const redisUrlSchema = urlSchema(
  /^rediss?$/,
  'a redis:// or rediss:// URL',
);

export const healthCheckTimeoutSchema = z.coerce
  .number()
  .int()
  .min(100)
  .max(30_000)
  .default(2_000);

/**
 * Validates `source` against `schema`. On failure, throws an EnvValidationError naming
 * each invalid variable and the rule it broke, without echoing any value.
 */
export function parseEnv<TSchema extends z.ZodType>(
  appName: string,
  schema: TSchema,
  source: Readonly<Record<string, string | undefined>>,
): z.output<TSchema> {
  const result = schema.safeParse(source);
  if (result.success) {
    return result.data;
  }
  const problems = result.error.issues.map((issue) => {
    const key = issue.path.map(String).join('.') || '(environment)';
    return `  - ${key}: ${issue.message}`;
  });
  throw new EnvValidationError(
    [
      `[${appName}] Invalid environment configuration:`,
      ...problems,
      'Set these in .env (see .env.example and docs/local-development.md).',
    ].join('\n'),
  );
}
