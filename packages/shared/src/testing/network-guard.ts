import { isIP, Socket } from 'node:net';

/**
 * Test-only network guard. Every Node.js TCP/TLS connection (http, https, fetch/undici,
 * pg, ioredis, provider SDKs) goes through `net.Socket.prototype.connect`; wrapping it
 * makes any connection to a non-loopback host fail before DNS or connect. Tests therefore
 * cannot send real email or call real providers, whatever the code under test does.
 *
 * Installed for every Vitest project by vitest.shared.mjs. Not part of any runtime build.
 */

export class NetworkAccessDeniedError extends Error {
  override readonly name = 'NetworkAccessDeniedError';
  readonly code = 'E_TEST_NETWORK_DENIED';
}

const GUARD_MARK = Symbol.for('lead-fennec-ai.network-guard');

export function isLoopbackHost(host: string): boolean {
  const bare = host.replace(/^\[|\]$/g, '').toLowerCase();
  if (bare === 'localhost' || bare.endsWith('.localhost')) {
    return true;
  }
  if (bare === '::1' || bare === '0:0:0:0:0:0:0:1') {
    return true;
  }
  const ipv4 = bare.startsWith('::ffff:') ? bare.slice('::ffff:'.length) : bare;
  return isIP(ipv4) === 4 && ipv4.startsWith('127.');
}

interface ConnectTarget {
  readonly host: string | undefined;
  readonly port: unknown;
  /** Set only for IPC (Unix socket / named pipe) connections. */
  readonly ipcPath: string | undefined;
}

// Like Node itself, only a non-empty string `path` means IPC. http.request passes
// `path: null` (the URL path) in its options, which must not bypass the guard.
const asIpcPath = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

function targetOf(args: unknown[]): ConnectTarget {
  // Internal calls pass one pre-normalized array: [options, callback].
  const first: unknown = Array.isArray(args[0])
    ? (args[0] as unknown[])[0]
    : args[0];
  if (typeof first === 'object' && first !== null) {
    const options = first as Record<string, unknown>;
    return {
      host: typeof options['host'] === 'string' ? options['host'] : undefined,
      port: options['port'],
      ipcPath: asIpcPath(options['path']),
    };
  }
  if (typeof first === 'string' && Number.isNaN(Number(first))) {
    return { host: undefined, port: undefined, ipcPath: asIpcPath(first) };
  }
  return {
    host: typeof args[1] === 'string' ? args[1] : undefined,
    port: first,
    ipcPath: undefined,
  };
}

type ConnectFn = (this: Socket, ...args: unknown[]) => Socket;

/** Installs the guard once per process. Loopback and IPC connections stay allowed. */
export function installNetworkGuard(): void {
  const proto = Socket.prototype as unknown as Record<PropertyKey, unknown>;
  const original = proto['connect'] as ConnectFn & { [GUARD_MARK]?: true };
  if (original[GUARD_MARK]) {
    return;
  }
  const guarded = function (this: Socket, ...args: unknown[]): Socket {
    const { host, port, ipcPath } = targetOf(args);
    // No host means Node's default, localhost.
    if (ipcPath !== undefined || host === undefined || isLoopbackHost(host)) {
      return original.apply(this, args);
    }
    const error = new NetworkAccessDeniedError(
      `Network access to ${host}:${String(port)} is blocked in tests; only loopback is allowed.`,
    );
    // Fail like a refused connection: the error arrives asynchronously on the socket,
    // so http/fetch callers see it on their normal error path.
    process.nextTick(() => this.destroy(error));
    return this;
  } as ConnectFn & { [GUARD_MARK]?: true };
  guarded[GUARD_MARK] = true;
  proto['connect'] = guarded;
}
