import type { IncomingMessage } from 'node:http';
import { SESSION_COOKIE_NAME } from '@lead-fennec-ai/shared';
import { parseSetCookie } from 'cookie';
import { describe, expect, it } from 'vitest';
import { apiEnvSchema } from '../env.js';
import {
  constantTimeEqual,
  csrfTokenFor,
  emailKeyHash,
  newToken,
  sha256Hex,
  TOKEN_PATTERN,
} from './auth-crypto.js';
import { DEFAULT_AUTH_POLICY } from './auth.policy.js';
import { PasswordHasher } from './password-hasher.js';
import {
  clearedSessionCookie,
  readSessionToken,
  sessionCookie,
} from './session-cookie.js';

// Pure pieces of the auth module. The flows run end to end in auth.integration.test.ts.

describe('tokens', () => {
  it('issues 256-bit base64url tokens, all different', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) {
      expect(token).toMatch(TOKEN_PATTERN);
      expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    }
  });

  it('stores SHA-256 in lower-case hex, never the token', () => {
    const token = newToken();
    const stored = sha256Hex(token);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toContain(token);
    expect(emailKeyHash('a@example.test')).not.toBe(
      sha256Hex('a@example.test'),
    );
  });

  it('derives a stable CSRF token per session that reveals nothing about it', () => {
    const session = newToken();
    const csrf = csrfTokenFor(session);
    expect(csrf).toMatch(TOKEN_PATTERN);
    expect(csrfTokenFor(session)).toBe(csrf);
    expect(csrfTokenFor(newToken())).not.toBe(csrf);
    expect(csrf).not.toBe(session);
  });

  it('compares in constant time and rejects different lengths', () => {
    expect(constantTimeEqual('abc', 'abc')).toBe(true);
    expect(constantTimeEqual('abc', 'abd')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('', 'a')).toBe(false);
  });
});

describe('PasswordHasher (Argon2id)', () => {
  const hasher = new PasswordHasher(DEFAULT_AUTH_POLICY.argon2);
  const password = 'correct horse battery staple';

  it('hashes with the OWASP minimum and verifies', async () => {
    const hash = await hasher.hash(password);
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(hash).not.toContain(password);
    expect(await hasher.hash(password)).not.toBe(hash); // salted
    expect(await hasher.verify(hash, password)).toBe(true);
    expect(await hasher.verify(hash, `${password}!`)).toBe(false);
    expect(hasher.needsRehash(hash)).toBe(false);
  });

  it('compares Unicode passwords after NFKC normalization', async () => {
    const hash = await hasher.hash('ﬁsh and chips forever'); // "ﬁ" ligature
    expect(await hasher.verify(hash, 'fish and chips forever')).toBe(true);
  });

  it('returns false without a hash, malformed hashes, and flags weaker settings', async () => {
    expect(await hasher.verify(null, password)).toBe(false);
    expect(await hasher.verify('not a hash', password)).toBe(false);
    const weak = new PasswordHasher({
      memoryCost: 8192,
      timeCost: 1,
      parallelism: 1,
    });
    expect(hasher.needsRehash(await weak.hash(password))).toBe(true);
    expect(hasher.needsRehash('garbage')).toBe(true);
  });
});

describe('session cookie', () => {
  const request = (cookie?: string) =>
    ({ headers: cookie === undefined ? {} : { cookie } }) as IncomingMessage;

  it('is HttpOnly, Secure, SameSite=Lax, host-only with Path=/, and has no lifetime', () => {
    const token = newToken();
    const header = sessionCookie(token);
    expect(header.startsWith(`${SESSION_COOKIE_NAME}=${token}`)).toBe(true);
    const parsed = parseSetCookie(header);
    expect(parsed).toMatchObject({
      name: '__Host-lf_session',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
    expect(parsed.domain).toBeUndefined();
    expect(parsed.maxAge).toBeUndefined();
    expect(parsed.expires).toBeUndefined();
  });

  it('clears with the same attributes', () => {
    const parsed = parseSetCookie(clearedSessionCookie());
    expect(parsed).toMatchObject({
      value: '',
      maxAge: 0,
      secure: true,
      path: '/',
    });
  });

  it('reads only well-formed tokens', () => {
    const token = newToken();
    expect(
      readSessionToken(request(`a=b; ${SESSION_COOKIE_NAME}=${token}`)),
    ).toBe(token);
    expect(readSessionToken(request())).toBeNull();
    expect(
      readSessionToken(request(`${SESSION_COOKIE_NAME}=short`)),
    ).toBeNull();
    expect(readSessionToken(request(`lf_session=${token}`))).toBeNull();
  });
});

describe('WEB_APP_URL', () => {
  const base = {
    DATABASE_URL: 'postgresql://u:p@127.0.0.1:5432/db',
    REDIS_URL: 'redis://127.0.0.1:6379/0',
  };

  it('defaults to localhost in development and test', () => {
    expect(apiEnvSchema.parse({ ...base, APP_ENV: 'test' }).WEB_APP_URL).toBe(
      'http://localhost:3000',
    );
  });

  it('is required and https in staging and production, without a path', () => {
    expect(
      apiEnvSchema.safeParse({ ...base, APP_ENV: 'production' }).success,
    ).toBe(false);
    expect(
      apiEnvSchema.safeParse({
        ...base,
        APP_ENV: 'production',
        WEB_APP_URL: 'http://app.example.test',
      }).success,
    ).toBe(false);
    expect(
      apiEnvSchema.safeParse({
        ...base,
        APP_ENV: 'staging',
        WEB_APP_URL: 'https://app.example.test/path',
      }).success,
    ).toBe(false);
    expect(
      apiEnvSchema.parse({
        ...base,
        APP_ENV: 'production',
        WEB_APP_URL: 'https://app.example.test',
      }).WEB_APP_URL,
    ).toBe('https://app.example.test');
  });
});
