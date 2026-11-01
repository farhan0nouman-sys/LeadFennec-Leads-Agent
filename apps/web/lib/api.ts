// Browser client for the API, through the same-origin /api proxy (task 04C). Every response is
// validated against the shared contract before the UI uses it; nothing here logs request or
// response bodies, tokens or the CSRF token.
import {
  apiErrorResponseSchema,
  CSRF_HEADER_NAME,
  type ApiErrorCode,
} from '@lead-fennec-ai/shared';
import type { z } from 'zod';

export type ClientErrorCode =
  ApiErrorCode | 'network_error' | 'unexpected_response';

export interface FieldIssue {
  readonly path: string;
  readonly message: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ClientErrorCode,
    message: string,
    readonly issues: readonly FieldIssue[] = [],
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** No session, or the session ended: the user must sign in again. */
  get unauthenticated(): boolean {
    return (
      this.status === 401 &&
      (this.code === 'unauthenticated' || this.code === 'session_expired')
    );
  }
}

export interface RequestOptions {
  readonly method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  readonly body?: unknown;
  /** The session's CSRF token, for authenticated mutations. */
  readonly csrfToken?: string | undefined;
  readonly headers?: Readonly<Record<string, string>>;
}

const GENERIC = 'Something went wrong. Try again.';

async function send(path: string, options: RequestOptions): Promise<Response> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (options.csrfToken !== undefined) {
    headers[CSRF_HEADER_NAME] = options.csrfToken;
  }
  try {
    return await fetch(`/api${path}`, {
      method: options.method ?? 'GET',
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    });
  } catch {
    throw new ApiError(
      0,
      'network_error',
      'We could not reach Lead Fennec. Check your connection and try again.',
    );
  }
}

async function failure(response: Response): Promise<ApiError> {
  let parsed: unknown;
  try {
    parsed = await response.json();
  } catch {
    parsed = undefined;
  }
  const envelope = apiErrorResponseSchema.safeParse(parsed);
  if (!envelope.success) {
    return new ApiError(response.status, 'unexpected_response', GENERIC);
  }
  const { code, message, issues, retryAfterSeconds } = envelope.data.error;
  return new ApiError(
    response.status,
    code,
    message,
    issues ?? [],
    retryAfterSeconds,
  );
}

/** Calls the API and validates the JSON response with `schema`. Throws ApiError. */
export async function apiRequest<S extends z.ZodType>(
  path: string,
  schema: S,
  options: RequestOptions = {},
): Promise<z.output<S>> {
  const response = await send(path, options);
  if (!response.ok) {
    throw await failure(response);
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new ApiError(response.status, 'unexpected_response', GENERIC);
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    throw new ApiError(response.status, 'unexpected_response', GENERIC);
  }
  return result.data;
}

/** For routes that answer 204 No Content. Throws ApiError. */
export async function apiCommand(
  path: string,
  options: RequestOptions,
): Promise<void> {
  const response = await send(path, options);
  if (!response.ok) {
    throw await failure(response);
  }
}

/** A user-facing message for any error thrown while calling the API. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (
      error.code === 'too_many_requests' &&
      error.retryAfterSeconds !== undefined
    ) {
      const minutes = Math.ceil(error.retryAfterSeconds / 60);
      return `Too many attempts. Try again in ${String(minutes)} minute${minutes === 1 ? '' : 's'}.`;
    }
    return error.message;
  }
  return GENERIC;
}
