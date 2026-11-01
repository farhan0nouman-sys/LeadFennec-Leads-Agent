// Token primitives (docs/decisions.md D-04A-04), all from Node's crypto module.
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** Shape of every token this module issues: 32 random bytes, base64url (43 characters). */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/** A new 256-bit token from the CSPRNG. Only its SHA-256 is ever stored. */
export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

/** SHA-256 in lower-case hex: the stored form of tokens (CHECK is_sha256_hex). */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Throttle key for an email address: never the address itself. */
export function emailKeyHash(normalizedEmail: string): string {
  return sha256Hex(`email:${normalizedEmail}`);
}

/**
 * The session's CSRF token: an HMAC keyed with the session token. Only the server (which
 * receives the HttpOnly cookie) can compute it; it is stable for the session's lifetime, so
 * several tabs share it, and it changes with every new session. Nothing is stored.
 */
export function csrfTokenFor(sessionToken: string): string {
  return createHmac('sha256', sessionToken)
    .update('lead-fennec-ai:csrf:v1', 'utf8')
    .digest('base64url');
}

/** Constant-time comparison for equal-length strings; false otherwise. */
export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}
