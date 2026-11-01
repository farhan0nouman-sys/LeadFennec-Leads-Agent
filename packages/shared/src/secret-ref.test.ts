import { describe, expect, it } from 'vitest';
import {
  isSecretRef,
  parseSecretRef,
  SecretReferenceError,
} from './secret-ref.js';

// Token-shaped test values, assembled at runtime from obviously fake parts.
const jwtShaped = [
  'eyJhbGciOiJub25lIn0',
  'eyJzdWIiOiJmaXh0dXJlIn0',
  'ZmFrZS1zaWduYXR1cmU'.repeat(3),
].join('.');
const accessTokenShaped = `ya29.${'FakeAccessToken0'.repeat(8)}`;
const refreshTokenShaped = `1//0g${'FakeRefreshToken'.repeat(4)}`;

describe('parseSecretRef', () => {
  it.each([
    [
      'fake://email-accounts/fixture-alpha/outreach',
      'fake',
      'email-accounts/fixture-alpha/outreach',
    ],
    [
      'vault://kv/lead-fennec/tenants/0193a9c8-1234-7abc-8def-0123456789ab/gmail',
      'vault',
      'kv/lead-fennec/tenants/0193a9c8-1234-7abc-8def-0123456789ab/gmail',
    ],
    [
      'aws-sm://lead-fennec/prod/mailbox_1.json',
      'aws-sm',
      'lead-fennec/prod/mailbox_1.json',
    ],
  ])('parses %j', (ref, store, path) => {
    expect(parseSecretRef(ref)).toEqual({ ref, store, path });
    expect(isSecretRef(ref)).toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['email-accounts/alpha', 'no store'],
    ['FAKE://x', 'upper-case store'],
    ['f://x', 'one-letter store'],
    ['fake://', 'no path'],
    ['fake:///x', 'empty segment'],
    ['fake://x//y', 'empty segment'],
    ['fake://x/', 'trailing slash'],
    ['fake://.hidden', 'segment starting with a dot'],
    ['fake://x?version=2', 'query string'],
    [' fake://x', 'surrounding space'],
    ['Bearer abc.def', 'authorization header'],
    [accessTokenShaped, 'OAuth access token'],
    [refreshTokenShaped, 'OAuth refresh token'],
    [jwtShaped, 'JWT'],
    [`fake://${jwtShaped}`, 'JWT as the path'],
    [`fake://x/${accessTokenShaped}`, 'access token as a segment'],
    [`fake://${'a'.repeat(65)}`, 'segment longer than 64'],
    [`fake://${Array(60).fill('abcd').join('/')}`, 'longer than 255'],
  ])('rejects %j (%s)', (value) => {
    expect(() => parseSecretRef(value)).toThrow(SecretReferenceError);
    expect(isSecretRef(value)).toBe(false);
  });

  it('never repeats the rejected value in the error', () => {
    expect(() => parseSecretRef(accessTokenShaped)).toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining('FakeAccessToken') as unknown,
      }),
    );
  });
});
