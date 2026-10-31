import { describe, expect, it } from 'vitest';
import { assertTestDatabaseUrl, assertTestRedisUrl } from './test-database.js';

describe('assertTestDatabaseUrl', () => {
  it('accepts a database whose name ends in _test', () => {
    const url = 'postgresql://u:pw@127.0.0.1:5432/leadfennec_test';
    expect(assertTestDatabaseUrl(url)).toBe(url);
  });

  it.each([
    'postgresql://u:pw@127.0.0.1:5432/leadfennec',
    'postgresql://u:pw@127.0.0.1:5432/test_leadfennec',
    'postgresql://u:pw@127.0.0.1:5432/',
  ])('refuses %s', (url) => {
    expect(() => assertTestDatabaseUrl(url)).toThrow(
      /must name a database ending in "_test"/,
    );
  });

  it('refuses other schemes and invalid URLs without echoing credentials', () => {
    expect(() => assertTestDatabaseUrl('mysql://u:SECRET@h/app_test')).toThrow(
      /postgres/,
    );
    expect(() => assertTestDatabaseUrl('not a url')).toThrow(/not a valid URL/);
    try {
      assertTestDatabaseUrl('postgresql://u:SECRET@h/app');
    } catch (error) {
      expect((error as Error).message).not.toContain('SECRET');
    }
  });
});

describe('assertTestRedisUrl', () => {
  it('accepts a non-zero database index', () => {
    expect(assertTestRedisUrl('redis://127.0.0.1:6379/15')).toBe(
      'redis://127.0.0.1:6379/15',
    );
  });

  it.each(['redis://127.0.0.1:6379', 'redis://127.0.0.1:6379/0'])(
    'refuses %s',
    (url) => {
      expect(() => assertTestRedisUrl(url)).toThrow(/other than 0/);
    },
  );
});
