import { once } from 'node:events';
import type { Server } from 'node:http';
import { Writable } from 'node:stream';
import type { ReadinessCheck } from '@lead-fennec-ai/shared';
import { createLogger } from '@lead-fennec-ai/shared/logger';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHealthServer } from './health-server.js';

type LogLine = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let server: Server | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
});

async function startServer(checks: readonly ReadinessCheck[]) {
  const lines: LogLine[] = [];
  const logger = createLogger({
    app: 'worker',
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
  server = createHealthServer(checks, 500, logger);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('expected a TCP address');
  }
  return { baseUrl: `http://127.0.0.1:${String(address.port)}`, lines };
}

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

describe('worker health server', () => {
  it('serves liveness with a request ID and a JSON request log', async () => {
    const { baseUrl, lines } = await startServer([up]);
    const response = await fetch(`${baseUrl}/health/live`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
    expect(response.headers.get('cache-control')).toBe('no-store');
    const requestId = response.headers.get('x-request-id');
    expect(requestId).toMatch(UUID);
    const log = await waitForLog(
      lines,
      (line) => line['msg'] === 'request completed',
    );
    expect(log).toMatchObject({
      app: 'worker',
      level: 'info',
      req: { id: requestId },
    });
  });

  it('reports ready when every check passes', async () => {
    const { baseUrl } = await startServer([up]);
    const response = await fetch(`${baseUrl}/health/ready`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ready' });
  });

  it('reports 503 and logs the redacted cause with the request ID', async () => {
    const { baseUrl, lines } = await startServer([up, leakyDown]);
    const response = await fetch(`${baseUrl}/health/ready`, {
      headers: { 'x-request-id': 'worker-req-7' },
    });
    expect(response.status).toBe(503);
    expect(response.headers.get('x-request-id')).toBe('worker-req-7');
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({
      status: 'not_ready',
      checks: { redis: { status: 'down', reason: 'unavailable' } },
    });
    expect(body).not.toMatch(/PROBE-SECRET|10\.0\.0\.9/);

    const warning = await waitForLog(
      lines,
      (line) => line['msg'] === 'readiness check failed',
    );
    expect(warning).toMatchObject({
      level: 'warn',
      check: 'redis',
      req: { id: 'worker-req-7' },
    });
    expect(JSON.stringify(warning)).toContain('redis://:***@10.0.0.9:6379');
    await waitForLog(lines, (line) => line['res'] !== undefined);
    expect(JSON.stringify(lines)).not.toContain('PROBE-SECRET');
  });

  it('answers unknown paths with 404 and other methods with 405', async () => {
    const { baseUrl } = await startServer([up]);
    expect((await fetch(`${baseUrl}/nope`)).status).toBe(404);
    const post = await fetch(`${baseUrl}/health/live`, { method: 'POST' });
    expect(post.status).toBe(405);
    expect(post.headers.get('allow')).toBe('GET, HEAD');
  });
});
