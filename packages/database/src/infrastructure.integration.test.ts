import { describe, expect, it } from 'vitest';
import { checkPostgres } from './postgres.js';
import { checkRedis } from './redis.js';
import { assertTestDatabaseUrl, assertTestRedisUrl } from './test-database.js';

// Runs against real services only when CI (or a developer) provides isolated test stores.
// Without these variables the suites are reported as skipped, never as passed.
const databaseUrl = process.env['TEST_DATABASE_URL'];
const redisUrl = process.env['TEST_REDIS_URL'];

describe.runIf(databaseUrl !== undefined)('PostgreSQL test database', () => {
  it('accepts connections', async () => {
    await expect(
      checkPostgres(assertTestDatabaseUrl(databaseUrl ?? ''), 5_000),
    ).resolves.toBeUndefined();
  });
});

describe.runIf(redisUrl !== undefined)('Redis test database', () => {
  it('answers PING', async () => {
    await expect(
      checkRedis(assertTestRedisUrl(redisUrl ?? ''), 5_000),
    ).resolves.toBeUndefined();
  });
});
