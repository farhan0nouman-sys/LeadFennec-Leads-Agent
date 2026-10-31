import { describe, expect, it } from 'vitest';
import { checkPostgres } from './postgres.js';
import { checkRedis } from './redis.js';

// Port 1 on loopback is closed: the probes must reject, and must not hang.
describe('readiness probes against a closed port', () => {
  it('checkPostgres rejects', async () => {
    await expect(
      checkPostgres('postgresql://u:pw@127.0.0.1:1/app_test', 1_000),
    ).rejects.toThrow();
  });

  it('checkRedis rejects', async () => {
    await expect(checkRedis('redis://127.0.0.1:1/15', 1_000)).rejects.toThrow();
  });
});
