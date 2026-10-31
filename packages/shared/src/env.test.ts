import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  EnvValidationError,
  appEnvSchema,
  logLevelSchema,
  parseEnv,
  portSchema,
  postgresUrlSchema,
  redisUrlSchema,
} from './env.js';

const schema = z.object({
  APP_ENV: appEnvSchema,
  PORT: portSchema(3001),
  LOG_LEVEL: logLevelSchema,
  DATABASE_URL: postgresUrlSchema,
  REDIS_URL: redisUrlSchema,
});

const valid = {
  DATABASE_URL: 'postgresql://user:pw@127.0.0.1:5432/app',
  REDIS_URL: 'redis://:pw@127.0.0.1:6379/0',
};

describe('parseEnv', () => {
  it('applies defaults and coerces numbers', () => {
    expect(parseEnv('test-app', schema, valid)).toEqual({
      APP_ENV: 'development',
      PORT: 3001,
      LOG_LEVEL: 'info',
      ...valid,
    });
    expect(parseEnv('test-app', schema, { ...valid, PORT: '4000' }).PORT).toBe(
      4000,
    );
  });

  it('names every invalid variable and distinguishes missing from malformed', () => {
    const run = () =>
      parseEnv('test-app', schema, {
        REDIS_URL: 'http://example.test',
        PORT: 'abc',
        APP_ENV: 'prod',
      });
    expect(run).toThrow(EnvValidationError);
    expect(run).toThrow(/\[test-app\] Invalid environment configuration/);
    expect(run).toThrow(/DATABASE_URL: is required/);
    expect(run).toThrow(/REDIS_URL: must be a redis:\/\/ or rediss:\/\/ URL/);
    expect(run).toThrow(/PORT:/);
    expect(run).toThrow(/APP_ENV:/);
  });

  it('never echoes a value in the error message', () => {
    try {
      parseEnv('test-app', schema, {
        ...valid,
        DATABASE_URL: 'mysql://user:SECRET-VALUE-123@db/app',
      });
      expect.unreachable('parseEnv should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      expect((error as Error).message).not.toContain('SECRET-VALUE-123');
    }
  });

  it('rejects ports outside 1-65535', () => {
    expect(() =>
      parseEnv('test-app', schema, { ...valid, PORT: '70000' }),
    ).toThrow(/PORT/);
  });
});
