// Same-origin proxy from the browser to the Lead Fennec API (task 04C, docs/decisions.md
// D-04C-05). Server-only: the browser only ever talks to the web origin, so the session cookie
// (__Host-, HttpOnly) stays first-party and API_BASE_URL never reaches the client. Import it
// only from route handlers.
import {
  ACCESS_REASON_HEADER,
  CSRF_HEADER_NAME,
  SESSION_COOKIE_NAME,
} from '@lead-fennec-ai/shared';
import { apiBase } from './server/config';

/** First path segments the proxy forwards; everything else is 404 without reaching the API. */
const API_ROOTS = new Set(['auth', 'workspaces', 'invitations', 'platform']);
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/;
const METHODS = new Set(['GET', 'POST', 'PATCH', 'DELETE']);
const MAX_BODY_BYTES = 64 * 1024;
/**
 * CSV imports carry their file (up to 256 KB of text, a little more as JSON): the API's own
 * body limit, 1 MB, applies to them (task 11C). Every other request stays at 64 KB.
 */
const IMPORT_BODY_BYTES = 1024 * 1024;
const IMPORT_PATH = /^\/workspaces\/[^/]+\/imports\/(csv|contacts)$/;

/** The most bytes the proxy forwards for a request to `path`. */
export function maxBodyBytes(path: string): number {
  return IMPORT_PATH.test(path) ? IMPORT_BODY_BYTES : MAX_BODY_BYTES;
}
const TIMEOUT_MS = 15_000;

/** Request headers the API needs: content type, the session cookie, CSRF and origin checks. */
const REQUEST_HEADERS = [
  'content-type',
  'origin',
  'sec-fetch-site',
  'user-agent',
  'x-forwarded-for',
  'x-request-id',
  CSRF_HEADER_NAME,
  ACCESS_REASON_HEADER,
];
const RESPONSE_HEADERS = [
  'content-type',
  'cache-control',
  // A downloaded file (lead exports, task 11C) is an attachment with the API's file name.
  'content-disposition',
  'x-content-type-options',
  'retry-after',
  'x-request-id',
];

function errorResponse(
  status: number,
  code: string,
  message: string,
): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { 'cache-control': 'no-store' } },
  );
}

/** The session cookie only: other cookies of the web origin are not the API's business. */
function sessionCookie(header: string | null): string | undefined {
  for (const part of (header ?? '').split(';')) {
    const cookie = part.trim();
    if (cookie.startsWith(`${SESSION_COOKIE_NAME}=`)) {
      return cookie;
    }
  }
  return undefined;
}

/** The API path for the proxied segments, or null when the proxy must not forward it. */
export function apiPathFor(segments: readonly string[]): string | null {
  const [root] = segments;
  if (
    root === undefined ||
    !API_ROOTS.has(root) ||
    !segments.every((segment) => SEGMENT.test(segment))
  ) {
    return null;
  }
  return `/${segments.join('/')}`;
}

export async function proxyToApi(
  request: Request,
  segments: readonly string[],
): Promise<Response> {
  const path = apiPathFor(segments);
  if (path === null || !METHODS.has(request.method)) {
    return errorResponse(404, 'not_found', 'Not found.');
  }
  const headers = new Headers();
  for (const name of REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value !== null) {
      headers.set(name, value);
    }
  }
  const cookie = sessionCookie(request.headers.get('cookie'));
  if (cookie !== undefined) {
    headers.set('cookie', cookie);
  }
  let body: ArrayBuffer | undefined;
  if (request.method !== 'GET') {
    body = await request.arrayBuffer();
    if (body.byteLength > maxBodyBytes(path)) {
      return errorResponse(
        413,
        'validation_failed',
        'The request is too large.',
      );
    }
  }
  const target = `${apiBase()}${path}${new URL(request.url).search}`;
  let response: Response;
  try {
    response = await fetch(target, {
      method: request.method,
      headers,
      ...(body === undefined || body.byteLength === 0 ? {} : { body }),
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // No detail: the cause may name internal hosts.
    return errorResponse(
      502,
      'unavailable',
      'The service is unavailable. Try again in a moment.',
    );
  }
  const out = new Headers();
  for (const name of RESPONSE_HEADERS) {
    const value = response.headers.get(name);
    if (value !== null) {
      out.set(name, value);
    }
  }
  for (const setCookie of response.headers.getSetCookie()) {
    out.append('set-cookie', setCookie);
  }
  const noBody = response.status === 204 || response.status === 304;
  return new Response(noBody ? null : await response.arrayBuffer(), {
    status: response.status,
    headers: out,
  });
}
