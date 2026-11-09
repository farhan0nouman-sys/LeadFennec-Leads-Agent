import { describe, expect, it } from 'vitest';
import {
  authErrorResponseSchema,
  linkTokenSchema,
  loginRequestSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordLength,
  passwordResetConfirmRequestSchema,
  registerRequestSchema,
  sessionResponseSchema,
} from './auth.js';

const TOKEN = 'A'.repeat(43);

describe('auth contract', () => {
  it('counts password length in code points after NFKC', () => {
    expect(passwordLength('abc')).toBe(3);
    // One emoji is two UTF-16 units but one code point.
    expect(passwordLength('😀'.repeat(15))).toBe(15);
    // NFKC folds the "ﬁ" ligature into "fi".
    expect(passwordLength('ﬁ')).toBe(2);
  });

  it('applies the length policy to new passwords only', () => {
    const short = 'x'.repeat(PASSWORD_MIN_LENGTH - 1);
    const ok = 'correct horse battery staple';
    expect(
      registerRequestSchema.safeParse({
        email: 'a@example.test',
        password: short,
      }).success,
    ).toBe(false);
    expect(
      registerRequestSchema.safeParse({ email: 'a@example.test', password: ok })
        .success,
    ).toBe(true);
    expect(
      registerRequestSchema.safeParse({
        email: 'a@example.test',
        password: 'y'.repeat(PASSWORD_MAX_LENGTH + 1),
      }).success,
    ).toBe(false);
    // Unicode and whitespace are allowed.
    expect(
      registerRequestSchema.safeParse({
        email: 'a@example.test',
        password: 'pässwört mit leerzeichen ✓',
      }).success,
    ).toBe(true);
    // Sign-in accepts any non-empty password up to the cap.
    expect(
      loginRequestSchema.safeParse({
        email: 'a@example.test',
        password: 'short',
      }).success,
    ).toBe(true);
    expect(
      passwordResetConfirmRequestSchema.safeParse({
        token: TOKEN,
        newPassword: short,
      }).success,
    ).toBe(false);
  });

  it('rejects unknown fields and malformed tokens', () => {
    expect(
      loginRequestSchema.safeParse({
        email: 'a@example.test',
        password: 'p',
        admin: true,
      }).success,
    ).toBe(false);
    expect(linkTokenSchema.safeParse(TOKEN).success).toBe(true);
    expect(linkTokenSchema.safeParse(`${TOKEN}=`).success).toBe(false);
    expect(linkTokenSchema.safeParse('A'.repeat(42)).success).toBe(false);
  });

  it('describes sessions and errors', () => {
    expect(
      sessionResponseSchema.safeParse({
        user: {
          id: '00000000-0000-4000-8000-000000000001',
          email: 'a@example.test',
          displayName: null,
          emailVerified: true,
          platformAdmin: false,
        },
        session: {
          idleExpiresAt: '2026-11-01T10:30:00.000Z',
          absoluteExpiresAt: '2026-11-01T18:00:00.000Z',
        },
        csrfToken: TOKEN,
      }).success,
    ).toBe(true);
    expect(
      authErrorResponseSchema.safeParse({
        error: {
          code: 'too_many_requests',
          message: 'Slow down.',
          retryAfterSeconds: 60,
        },
      }).success,
    ).toBe(true);
    expect(
      authErrorResponseSchema.safeParse({
        error: { code: 'teapot', message: 'x' },
      }).success,
    ).toBe(false);
  });
});
