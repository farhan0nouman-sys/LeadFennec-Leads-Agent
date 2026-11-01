// The session cookie (docs/decisions.md D-04A-05): __Host- prefix (Secure, Path=/, no
// Domain), HttpOnly, SameSite=Lax, and no Max-Age, so it ends with the browser session.
// Timeouts are enforced on the server.
import type { IncomingMessage } from 'node:http';
import { SESSION_COOKIE_NAME } from '@lead-fennec-ai/shared';
import { parseCookie, stringifySetCookie } from 'cookie';
import { TOKEN_PATTERN } from './auth-crypto.js';

/** The session token from the request's cookie, or null when absent or malformed. */
export function readSessionToken(request: IncomingMessage): string | null {
  const header = request.headers.cookie;
  if (header === undefined) {
    return null;
  }
  const value = parseCookie(header)[SESSION_COOKIE_NAME];
  return value !== undefined && TOKEN_PATTERN.test(value) ? value : null;
}

const ATTRIBUTES = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
} as const;

export function sessionCookie(token: string): string {
  return stringifySetCookie({
    name: SESSION_COOKIE_NAME,
    value: token,
    ...ATTRIBUTES,
  });
}

/** Deletes the cookie in the browser (same attributes, expired). */
export function clearedSessionCookie(): string {
  return stringifySetCookie({
    name: SESSION_COOKIE_NAME,
    value: '',
    ...ATTRIBUTES,
    maxAge: 0,
    expires: new Date(0),
  });
}
