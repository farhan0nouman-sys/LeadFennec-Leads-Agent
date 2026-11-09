import {
  appEnvSchema,
  healthCheckTimeoutSchema,
  logLevelSchema,
  parseEnv,
  portSchema,
  postgresUrlSchema,
  redisUrlSchema,
} from '@lead-fennec-ai/shared';
import {
  OPENAI_REASONING_EFFORTS,
  openAiModelIdSchema,
  websiteHostPatternSchema,
  type ModelConfig,
} from '@lead-fennec-ai/integrations';
import { z } from 'zod';

/** A comma-separated list of domains (task 09A); empty counts as unset. */
const hostListSchema = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z
    .string()
    .max(20_000)
    .transform((value) =>
      value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== ''),
    )
    .pipe(z.array(websiteHostPatternSchema).max(1000))
    .optional(),
);

const unsetWhenEmpty = (value: unknown) => (value === '' ? undefined : value);

/** US dollars per million tokens, e.g. 0.1 (task 09B). */
const pricePerMTokSchema = z.preprocess(
  unsetWhenEmpty,
  z
    .string()
    .regex(/^[0-9]{1,4}([.][0-9]{1,6})?$/, {
      error: 'must be a price in US dollars per million tokens, such as 0.1',
    })
    .transform(Number)
    .optional(),
);

export const workerEnvSchema = z
  .object({
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
    /**
     * Website fetching (task 09A, docs/decisions.md D-09A-04): domains never fetched, with their
     * subdomains. Applies in every environment (the fake honours it too).
     */
    WEBSITE_FETCH_BLOCKED_HOSTS: hostListSchema,
    /** When set, the only domains (and their subdomains) that are fetched. */
    WEBSITE_FETCH_ALLOWED_HOSTS: hostListSchema,
    /**
     * OpenAI (task 09B, docs/decisions.md D-09B-02): read only in staging and production;
     * development and test always use the fake model. Never logged. Empty counts as unset.
     */
    OPENAI_API_KEY: z.preprocess(
      unsetWhenEmpty,
      z
        .string()
        .regex(/^[!-~]{20,512}$/, {
          error: 'must be 20-512 printable characters without spaces',
        })
        .optional(),
    ),
    /** The model id, e.g. gpt-6-luna. Required with OPENAI_API_KEY. */
    OPENAI_MODEL: z.preprocess(unsetWhenEmpty, openAiModelIdSchema.optional()),
    /** Sent only when set; the model's default otherwise. */
    OPENAI_REASONING_EFFORT: z.preprocess(
      unsetWhenEmpty,
      z.enum(OPENAI_REASONING_EFFORTS).optional(),
    ),
    /** Both prices or neither; without them cost events carry tokens but no cost. */
    OPENAI_INPUT_USD_PER_MTOK: pricePerMTokSchema,
    OPENAI_OUTPUT_USD_PER_MTOK: pricePerMTokSchema,
  })
  .refine(
    (env) =>
      (env.OPENAI_INPUT_USD_PER_MTOK === undefined) ===
      (env.OPENAI_OUTPUT_USD_PER_MTOK === undefined),
    {
      error: 'set both OpenAI prices or neither',
      path: ['OPENAI_OUTPUT_USD_PER_MTOK'],
    },
  );

export type WorkerEnv = z.output<typeof workerEnvSchema>;

/** The model configuration for createModelProvider (task 09B). */
export function modelConfig(env: WorkerEnv): ModelConfig {
  return {
    openAiApiKey: env.OPENAI_API_KEY,
    openAiModel: env.OPENAI_MODEL,
    openAiReasoningEffort: env.OPENAI_REASONING_EFFORT,
    prices:
      env.OPENAI_INPUT_USD_PER_MTOK === undefined ||
      env.OPENAI_OUTPUT_USD_PER_MTOK === undefined
        ? null
        : {
            inputUsdPerMTok: env.OPENAI_INPUT_USD_PER_MTOK,
            outputUsdPerMTok: env.OPENAI_OUTPUT_USD_PER_MTOK,
          },
  };
}

export function loadWorkerEnv(
  source: Readonly<Record<string, string | undefined>>,
): WorkerEnv {
  return parseEnv('worker', workerEnvSchema, source);
}
