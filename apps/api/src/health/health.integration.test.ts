import { Writable } from 'node:stream';
import type { ReadinessCheck } from '@lead-fennec-ai/shared';
import { createLogger } from '@lead-fennec-ai/shared/logger';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Logger } from 'nestjs-pino';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module.js';
import { apiEnvSchema } from '../env.js';
import { READINESS_CHECKS } from './health.tokens.js';

// Boots the real Nest application on a loopback port with fake readiness checks.
// No PostgreSQL or Redis is needed; the URLs below are never dialled.
const testEnv = apiEnvSchema.parse({
  APP_ENV: 'test',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/leadfennec_test',
  REDIS_URL: 'redis://127.0.0.1:1/15',
  HEALTH_CHECK_TIMEOUT_MS: '500',
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type LogLine = Record<string, unknown>;
let app: INestApplication | undefined;

// nestjs-pino keeps one pino-http instance per process (module state), as in production.
// Vitest gives each test file a fresh module registry, so this file uses one logger and
// clears the captured lines before each test.
const lines: LogLine[] = [];
const logger = createLogger({
  app: 'api',
  level: 'info',
  destination: new Writable({
    write(chunk: Buffer, _encoding, callback) {
      for (const line of chunk.toString().split('\n').filter(Boolean)) {
        lines.push(JSON.parse(line) as LogLine);
      }
      callback();
    },
  }),
});

beforeEach(() => {
  lines.length = 0;
});

async function startApi(checks: readonly ReadinessCheck[]) {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(testEnv, logger)],
  })
    .overrideProvider(READINESS_CHECKS)
    .useValue(checks)
    .compile();
  app = moduleRef.createNestApplication({ bufferLogs: true });
  app.useLogger(app.get(Logger));
  await app.listen(0, '127.0.0.1');
  const baseUrl = (await app.getUrl()).replace('[::1]', '127.0.0.1');
  return { baseUrl, lines };
}

afterEach(async () => {
  await app?.close();
  app = undefined;
});

/** pino-http logs a request when the response finishes, which can be after fetch resolves. */
function waitForLog(
  lines: readonly LogLine[],
  match: (line: LogLine) => boolean,
) {
  return vi.waitFor(() => {
    const line = lines.find(match);
    if (line === undefined) {
      throw new Error('log line not written yet');
    }
    return line;
  });
}

const up: ReadinessCheck = { name: 'postgres', check: () => Promise.resolve() };
const leakyDown: ReadinessCheck = {
  name: 'redis',
  check: () =>
    Promise.reject(
      new Error('connect redis://:PROBE-SECRET@10.0.0.9:6379 refused'),
    ),
};

describe('GET /health/live', () => {
  it('returns 200 with no-store and a generated request ID', async () => {
    const { baseUrl, lines } = await startApi([up]);
    const response = await fetch(`${baseUrl}/health/live`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    const requestId = response.headers.get('x-request-id');
    expect(requestId).toMatch(UUID);

    const requestLog = await waitForLog(
      lines,
      (line) => line['msg'] === 'request completed',
    );
    expect(requestLog).toMatchObject({
      app: 'api',
      level: 'info',
      req: { id: requestId },
    });
  });
});

describe('GET /health/ready', () => {
  it('returns 200 when every check passes', async () => {
    const { baseUrl } = await startApi([up, { ...up, name: 'redis' }]);
    const response = await fetch(`${baseUrl}/health/ready`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'ready',
      checks: { postgres: { status: 'up' }, redis: { status: 'up' } },
    });
  });

  it('returns 503 without error details and logs the redacted cause with the request ID', async () => {
    const { baseUrl, lines } = await startApi([up, leakyDown]);
    const response = await fetch(`${baseUrl}/health/ready`, {
      headers: { 'x-request-id': 'client-req-42' },
    });
    expect(response.status).toBe(503);
    expect(response.headers.get('x-request-id')).toBe('client-req-42');
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({
      status: 'not_ready',
      checks: {
        postgres: { status: 'up' },
        redis: { status: 'down', reason: 'unavailable' },
      },
    });
    expect(body).not.toMatch(/PROBE-SECRET|10\.0\.0\.9/);

    const warning = await waitForLog(lines, (line) =>
      String(line['msg']).includes('Readiness check "redis"'),
    );
    expect(warning).toMatchObject({
      level: 'warn',
      req: { id: 'client-req-42' },
    });
    expect(String(warning['msg'])).toContain('redis://:***@10.0.0.9:6379');
    const requestLog = await waitForLog(
      lines,
      (line) => line['res'] !== undefined,
    );
    expect(requestLog).toMatchObject({
      level: 'error',
      res: { statusCode: 503 },
    });
    expect(JSON.stringify(lines)).not.toContain('PROBE-SECRET');
  });
});

describe('request logging', () => {
  it('replaces a malformed incoming request ID', async () => {
    const { baseUrl } = await startApi([up]);
    const response = await fetch(`${baseUrl}/health/live`, {
      headers: { 'x-request-id': 'not a safe id' },
    });
    expect(response.headers.get('x-request-id')).toMatch(UUID);
  });

  it('never logs credentials from request headers', async () => {
    const { baseUrl, lines } = await startApi([up]);
    await fetch(`${baseUrl}/health/live`, {
      headers: {
        authorization: 'Bearer HEADER-SECRET',
        cookie: 'session=COOKIE-SECRET',
      },
    });
    await waitForLog(lines, (line) => line['msg'] === 'request completed');
    const output = JSON.stringify(lines);
    expect(output).not.toMatch(/HEADER-SECRET|COOKIE-SECRET/);
    expect(output).toContain('[REDACTED]');
  });

  it('gives unknown routes a 404 with a request ID', async () => {
    const { baseUrl } = await startApi([up]);
    const response = await fetch(`${baseUrl}/nope`);
    expect(response.status).toBe(404);
    expect(response.headers.get('x-request-id')).toMatch(UUID);
  });
});
