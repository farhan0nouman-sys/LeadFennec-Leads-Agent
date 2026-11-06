import { EnvValidationError } from '@lead-fennec-ai/shared';
import { describe, expect, it } from 'vitest';
import { loadWorkerEnv } from './env.js';

// The worker's environment (task 07B adds APOLLO_API_KEY, docs/decisions.md D-07B-05).
const BASE = {
  DATABASE_URL: 'postgresql://user:placeholder@127.0.0.1:5432/leadfennec',
  REDIS_URL: 'redis://127.0.0.1:6379/0',
};
const KEY = 'synthetic-worker-key-0000';

describe('worker environment', () => {
  it('takes APOLLO_API_KEY from the environment, and treats empty as unset', () => {
    expect(loadWorkerEnv(BASE).APOLLO_API_KEY).toBeUndefined();
    expect(loadWorkerEnv({ ...BASE, APOLLO_API_KEY: '' }).APOLLO_API_KEY).toBe(
      undefined,
    );
    expect(loadWorkerEnv({ ...BASE, APOLLO_API_KEY: KEY }).APOLLO_API_KEY).toBe(
      KEY,
    );
  });

  it('refuses a malformed key without echoing it', () => {
    for (const value of ['short', 'has a space in it', `${KEY}\r\nx-evil: 1`]) {
      try {
        loadWorkerEnv({ ...BASE, APOLLO_API_KEY: value });
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(EnvValidationError);
        const message = (error as Error).message;
        expect(message).toContain('APOLLO_API_KEY');
        expect(message).not.toContain(value);
      }
    }
  });
});
