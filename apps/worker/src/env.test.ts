import { EnvValidationError } from '@lead-fennec-ai/shared';
import { describe, expect, it } from 'vitest';
import { loadWorkerEnv, modelConfig } from './env.js';

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

  it('reads the website fetch restrictions as domain lists (task 09A)', () => {
    const env = loadWorkerEnv({
      ...BASE,
      WEBSITE_FETCH_BLOCKED_HOSTS: ' WWW.Blocked.com, other.org ,, ',
      WEBSITE_FETCH_ALLOWED_HOSTS: '',
    });
    expect(env.WEBSITE_FETCH_BLOCKED_HOSTS).toEqual([
      'blocked.com',
      'other.org',
    ]);
    expect(env.WEBSITE_FETCH_ALLOWED_HOSTS).toBeUndefined();
    expect(loadWorkerEnv(BASE).WEBSITE_FETCH_BLOCKED_HOSTS).toBeUndefined();
    for (const value of ['not a domain', 'http://', '127.0.0.1']) {
      expect(() =>
        loadWorkerEnv({ ...BASE, WEBSITE_FETCH_ALLOWED_HOSTS: value }),
      ).toThrow(EnvValidationError);
    }
  });

  it('reads the OpenAI settings (task 09B)', () => {
    const env = loadWorkerEnv({
      ...BASE,
      OPENAI_API_KEY: 'sk-synthetic-test-key-0000000000',
      OPENAI_MODEL: 'gpt-6-luna',
      OPENAI_REASONING_EFFORT: 'low',
      OPENAI_INPUT_USD_PER_MTOK: '0.1',
      OPENAI_OUTPUT_USD_PER_MTOK: '0.5',
    });
    expect(modelConfig(env)).toEqual({
      openAiApiKey: 'sk-synthetic-test-key-0000000000',
      openAiModel: 'gpt-6-luna',
      openAiReasoningEffort: 'low',
      prices: { inputUsdPerMTok: 0.1, outputUsdPerMTok: 0.5 },
    });
    expect(
      modelConfig(
        loadWorkerEnv({ ...BASE, OPENAI_API_KEY: '', OPENAI_MODEL: '' }),
      ),
    ).toEqual({
      openAiApiKey: undefined,
      openAiModel: undefined,
      openAiReasoningEffort: undefined,
      prices: null,
    });
  });

  it('refuses malformed OpenAI settings without echoing the key', () => {
    const key = 'sk-synthetic-bad key-00000000000';
    for (const extra of [
      { OPENAI_API_KEY: key },
      { OPENAI_MODEL: 'gpt 6' },
      { OPENAI_REASONING_EFFORT: 'extreme' },
      { OPENAI_INPUT_USD_PER_MTOK: 'free', OPENAI_OUTPUT_USD_PER_MTOK: '1' },
      { OPENAI_INPUT_USD_PER_MTOK: '0.1' },
    ]) {
      try {
        loadWorkerEnv({ ...BASE, ...extra });
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(EnvValidationError);
        expect((error as Error).message).not.toContain(key);
      }
    }
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
