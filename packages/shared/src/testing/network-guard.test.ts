import { once } from 'node:events';
import { createServer, request, type Server } from 'node:http';
import { connect } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { isLoopbackHost, NetworkAccessDeniedError } from './network-guard.js';

// The guard is installed by the shared Vitest setup file; these tests prove it is active.

let server: Server | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
});

describe('network guard', () => {
  it('blocks fetch to an external host', async () => {
    const error = await fetch('https://example.com/').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TypeError);
    expect((error as TypeError).cause).toBeInstanceOf(NetworkAccessDeniedError);
  });

  it('blocks http.request and raw sockets to external hosts', async () => {
    const httpError = await new Promise<unknown>((resolve) => {
      request('http://203.0.113.10:80/').on('error', resolve).end();
    });
    expect(httpError).toBeInstanceOf(NetworkAccessDeniedError);

    const socketError = await new Promise<unknown>((resolve) => {
      connect({ host: 'smtp.gmail.com', port: 587 }).on('error', resolve);
    });
    expect(socketError).toBeInstanceOf(NetworkAccessDeniedError);
  });

  it('allows loopback connections', async () => {
    server = createServer((_req, res) => res.end('ok'));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('expected a TCP address');
    }
    const response = await fetch(`http://127.0.0.1:${String(address.port)}/`);
    expect(await response.text()).toBe('ok');
  });

  it.each([
    ['localhost', true],
    ['127.0.0.1', true],
    ['127.10.0.1', true],
    ['::1', true],
    ['[::1]', true],
    ['::ffff:127.0.0.1', true],
    ['api.localhost', true],
    ['example.com', false],
    ['10.0.0.1', false],
    ['0.0.0.0', false],
    ['::', false],
  ])('isLoopbackHost(%s) is %s', (host, expected) => {
    expect(isLoopbackHost(host)).toBe(expected);
  });
});
