// Auth API contract (task 04A, docs/api/auth.md): routes, request and response shapes and
// error codes shared by the API and the web app. Pure zod, safe for browsers.
//
// Client rules: never log the CSRF token or a link token; read link tokens from the URL
// fragment (#token=…), then remove the fragment from the address bar before calling the API.
import { z } from 'zod';

export const AUTH_ROUTES = {
  register: '/auth/register',
  verifyEmail: '/auth/verify-email',
  resendVerification: '/auth/verify-email/resend',
  login: '/auth/login',
  logout: '/auth/logout',
  session: '/auth/session',
  passwordResetRequest: '/auth/password-reset/request',
  passwordResetConfirm: '/auth/password-reset/confirm',
} as const;

/** The session cookie: HttpOnly, Secure, SameSite=Lax, Path=/, no Domain, no Max-Age. */
export const SESSION_COOKIE_NAME = '__Host-lf_session';

/** Header that carries the session's CSRF token on authenticated mutations. */
export const CSRF_HEADER_NAME = 'x-csrf-token';

/** Pages of the web app that emailed links open; the token is in the URL fragment. */
export const AUTH_LINK_PATHS = {
  verifyEmail: '/verify-email',
  resetPassword: '/reset-password',
} as const;

/**
 * Passwords are counted in Unicode code points after NFKC normalization. 15 is the minimum
 * for passwords used without a second factor (OWASP Authentication Cheat Sheet).
 */
export const PASSWORD_MIN_LENGTH = 15;
export const PASSWORD_MAX_LENGTH = 128;

/** Length of a password as the server measures it. */
export function passwordLength(password: string): number {
  // Code points, as NIST SP 800-63B counts them (not UTF-16 units, not graphemes).
  return Array.from(password.normalize('NFKC')).length;
}

/** Shape check only; the server normalizes the address (normalizeEmail). */
export const emailInputSchema = z
  .string('Enter an email address.')
  .trim()
  .min(3, 'Enter an email address.')
  .max(254, 'Use at most 254 characters.')
  .regex(/^[^\s@]+@[^\s@]+$/, 'Enter an email address.');

/** A new password: length policy only, any characters allowed. */
export const newPasswordSchema = z
  .string('Enter a password.')
  .refine((p) => passwordLength(p) >= PASSWORD_MIN_LENGTH, {
    message: `Use at least ${String(PASSWORD_MIN_LENGTH)} characters.`,
  })
  .refine((p) => passwordLength(p) <= PASSWORD_MAX_LENGTH, {
    message: `Use at most ${String(PASSWORD_MAX_LENGTH)} characters.`,
  });

/** A password being checked at sign-in: no policy, only a size cap. */
export const currentPasswordSchema = z
  .string('Enter your password.')
  .min(1, 'Enter your password.')
  .max(PASSWORD_MAX_LENGTH * 4, 'The password is too long.');

/** A token from an emailed link: 32 random bytes, base64url. */
export const linkTokenSchema = z
  .string('The link is invalid.')
  .regex(/^[A-Za-z0-9_-]{43}$/, 'The link is invalid.');

export const registerRequestSchema = z
  .object({
    email: emailInputSchema,
    password: newPasswordSchema,
    displayName: z
      .string()
      .trim()
      .min(1, 'Enter a name, or leave it out.')
      .max(100, 'Use at most 100 characters.')
      .optional(),
  })
  .strict();

export const loginRequestSchema = z
  .object({ email: emailInputSchema, password: currentPasswordSchema })
  .strict();

export const verifyEmailRequestSchema = z
  .object({ token: linkTokenSchema })
  .strict();

/** Resending the verification email, and requesting a password reset. */
export const emailRequestSchema = z
  .object({ email: emailInputSchema })
  .strict();

export const passwordResetConfirmRequestSchema = z
  .object({ token: linkTokenSchema, newPassword: newPasswordSchema })
  .strict();

export type RegisterRequest = z.input<typeof registerRequestSchema>;
export type LoginRequest = z.input<typeof loginRequestSchema>;
export type VerifyEmailRequest = z.input<typeof verifyEmailRequestSchema>;
export type EmailRequest = z.input<typeof emailRequestSchema>;
export type PasswordResetConfirmRequest = z.input<
  typeof passwordResetConfirmRequestSchema
>;

/**
 * 202 for register, resend-verification and password-reset requests, whether or not an
 * account exists for the address (no account enumeration).
 */
export const acceptedResponseSchema = z
  .object({ status: z.literal('accepted') })
  .strict();

export const emailVerifiedResponseSchema = z
  .object({ status: z.literal('verified') })
  .strict();

export const passwordResetResponseSchema = z
  .object({ status: z.literal('password_reset') })
  .strict();

/** 200 for a successful login and for GET /auth/session. The session token is only in the cookie. */
export const sessionResponseSchema = z
  .object({
    user: z
      .object({
        id: z.uuid(),
        email: z.string(),
        displayName: z.string().nullable(),
        emailVerified: z.literal(true),
        /**
         * Platform admin (task 05A): shows the Admin area. Navigation only; every /platform
         * route checks it again.
         */
        platformAdmin: z.boolean(),
      })
      .strict(),
    session: z
      .object({
        idleExpiresAt: z.iso.datetime(),
        absoluteExpiresAt: z.iso.datetime(),
      })
      .strict(),
    /** Send it in the x-csrf-token header on authenticated mutations. Never log it. */
    csrfToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();

export type SessionResponse = z.output<typeof sessionResponseSchema>;

export const AUTH_ERROR_CODES = [
  /** 400: the request body does not match the contract. */
  'validation_failed',
  /** 401: wrong email or password, or no such account (indistinguishable). */
  'invalid_credentials',
  /** 403: correct password, but the email address is not verified yet. */
  'email_not_verified',
  /** 400: the emailed link is unknown, used or expired (indistinguishable). */
  'invalid_or_expired_token',
  /** 401: no valid session cookie. */
  'unauthenticated',
  /** 401: the session reached its idle or absolute timeout. */
  'session_expired',
  /** 403: missing or wrong CSRF token on an authenticated mutation. */
  'csrf_failed',
  /** 403: a mutation sent from another site. */
  'forbidden_origin',
  /** 429: too many attempts; see retryAfterSeconds and the Retry-After header. */
  'too_many_requests',
] as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[number];

export const authErrorResponseSchema = z
  .object({
    error: z
      .object({
        code: z.enum(AUTH_ERROR_CODES),
        message: z.string(),
        retryAfterSeconds: z.number().int().positive().optional(),
        /** validation_failed only: which field, and why. Never echoes the input. */
        issues: z
          .array(z.object({ path: z.string(), message: z.string() }).strict())
          .optional(),
      })
      .strict(),
  })
  .strict();

export type AuthErrorResponse = z.output<typeof authErrorResponseSchema>;
