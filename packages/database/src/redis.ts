import { Redis } from 'ioredis';

/** Opens a short-lived connection and sends PING. Rejects if Redis is not usable. */
export async function checkRedis(
  url: string,
  timeoutMs: number,
): Promise<void> {
  const client = new Redis(url, {
    lazyConnect: true,
    connectTimeout: timeoutMs,
    commandTimeout: timeoutMs,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  // Connection errors also reject connect()/ping(); this only prevents an unhandled event.
  client.on('error', () => undefined);
  try {
    await client.connect();
    // An error reply (e.g. NOAUTH) rejects; ioredis types a successful reply as 'PONG'.
    await client.ping();
  } finally {
    client.disconnect();
  }
}
