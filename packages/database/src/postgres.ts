import { Client } from 'pg';

/** Opens a short-lived connection and runs `SELECT 1`. Rejects if PostgreSQL is not usable. */
export async function checkPostgres(
  connectionString: string,
  timeoutMs: number,
): Promise<void> {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: timeoutMs,
    query_timeout: timeoutMs,
  });
  // Connection errors also reject connect()/query(); this only prevents an unhandled event.
  client.on('error', () => undefined);
  try {
    await client.connect();
    await client.query('SELECT 1');
  } finally {
    await client.end().catch(() => undefined);
  }
}
