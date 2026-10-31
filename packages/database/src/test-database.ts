/**
 * Guards for test infrastructure: tests may only touch an isolated PostgreSQL database
 * whose name ends in "_test" and a Redis database other than 0 (used by development).
 * They throw before any connection is made. Messages contain no credentials.
 */

function parse(url: string, variable: string): URL {
  try {
    return new URL(url);
  } catch {
    throw new Error(`${variable} is not a valid URL.`);
  }
}

export function assertTestDatabaseUrl(
  url: string,
  variable = 'TEST_DATABASE_URL',
): string {
  const parsed = parse(url, variable);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    throw new Error(`${variable} must be a postgres:// or postgresql:// URL.`);
  }
  if (!database.endsWith('_test')) {
    throw new Error(
      `Refusing to run tests against database "${database}": ${variable} must name a database ending in "_test".`,
    );
  }
  return url;
}

export function assertTestRedisUrl(
  url: string,
  variable = 'TEST_REDIS_URL',
): string {
  const parsed = parse(url, variable);
  if (!/^rediss?:$/.test(parsed.protocol)) {
    throw new Error(`${variable} must be a redis:// or rediss:// URL.`);
  }
  const index = Number(parsed.pathname.replace(/^\//, '') || '0');
  if (!Number.isInteger(index) || index === 0) {
    throw new Error(
      `Refusing to run tests against Redis database ${String(index)}: ${variable} must select a database other than 0 (for example /15).`,
    );
  }
  return url;
}
