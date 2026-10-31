import type { ReadinessCheck } from '@lead-fennec-ai/shared';
import { checkPostgres } from './postgres.js';
import { checkRedis } from './redis.js';

export interface InfrastructureUrls {
  readonly databaseUrl: string;
  readonly redisUrl: string;
}

/** Readiness checks for the stateful services every server process depends on. */
export function infrastructureReadinessChecks(
  urls: InfrastructureUrls,
): ReadinessCheck[] {
  return [
    {
      name: 'postgres',
      check: (timeoutMs) => checkPostgres(urls.databaseUrl, timeoutMs),
    },
    {
      name: 'redis',
      check: (timeoutMs) => checkRedis(urls.redisUrl, timeoutMs),
    },
  ];
}
