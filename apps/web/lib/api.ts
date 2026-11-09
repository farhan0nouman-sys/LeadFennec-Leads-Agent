// Typed browser client for the API (tasks 04C, 05B), through the same-origin /api proxy. Every
// call names an endpoint of the shared list (@lead-fennec-ai/shared API, the source of
// docs/api/openapi.json): its path parameters, query, headers and body are validated before
// sending, the CSRF token is attached to authenticated mutations, and the response is validated
// before the UI uses it. Nothing here logs request or response bodies, tokens or the CSRF token.
import {
  apiErrorResponseSchema,
  buildEndpointRequest,
  CSRF_HEADER_NAME,
  EndpointInputError,
  needsCsrfToken,
  type ApiErrorCode,
  type EndpointInput,
  type EndpointResponse,
  type EndpointSpec,
} from '@lead-fennec-ai/shared';

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

export interface CallOptions {
  /** The session's CSRF token; required by endpoints that change something while signed in. */
  readonly csrfToken?: string | undefined;
  readonly signal?: AbortSignal;
}

/** The arguments of `callApi(endpoint, …)`: the input may be left out when nothing is needed. */
export type CallArgs<E extends EndpointSpec> =
  object extends EndpointInput<E>
    ? [input?: EndpointInput<E>, options?: CallOptions]
    : [input: EndpointInput<E>, options?: CallOptions];

const GENERIC = 'Something went wrong. Try again.';

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

/** The validated request for `endpoint`; invalid input becomes a validation_failed ApiError. */
export function endpointRequest(
  endpoint: EndpointSpec,
  input: Parameters<typeof buildEndpointRequest>[1],
): ReturnType<typeof buildEndpointRequest> {
  try {
    return buildEndpointRequest(endpoint, input);
  } catch (error) {
    if (error instanceof EndpointInputError) {
      throw new ApiError(
        0,
        'validation_failed',
        'Check the highlighted fields.',
        error.issues,
      );
    }
    throw error;
  }
}

/**
 * Calls `endpoint` and resolves to its validated response (undefined for 204). Throws ApiError:
 * the API's own error, `network_error`, or `unexpected_response` for anything off-contract.
 */
export async function callApi<E extends EndpointSpec>(
  endpoint: E,
  ...[input, options = {}]: CallArgs<E>
): Promise<EndpointResponse<E>> {
  return sendRequest(endpoint, endpointRequest(endpoint, input ?? {}), options);
}

/** Sends a request already validated by `endpointRequest`. Throws ApiError. */
export async function sendRequest<E extends EndpointSpec>(
  endpoint: E,
  request: {
    readonly path: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: unknown;
  },
  options: CallOptions = {},
): Promise<EndpointResponse<E>> {
  const headers: Record<string, string> = { ...request.headers };
  if (request.body !== undefined) {
    headers['content-type'] = 'application/json';
  }
  if (needsCsrfToken(endpoint)) {
    if (options.csrfToken === undefined) {
      // The session (and its token) is still loading; the API would refuse the request.
      throw new ApiError(
        0,
        'csrf_failed',
        'Your session is still loading. Try again in a moment.',
      );
    }
    headers[CSRF_HEADER_NAME] = options.csrfToken;
  }
  let response: Response;
  try {
    response = await fetch(`/api${request.path}`, {
      method: endpoint.method,
      headers,
      credentials: 'same-origin',
      cache: 'no-store',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(request.body === undefined
        ? {}
        : { body: JSON.stringify(request.body) }),
    });
  } catch {
    throw new ApiError(
      0,
      'network_error',
      'We could not reach Lead Fennec. Check your connection and try again.',
    );
  }
  if (!response.ok) {
    throw await failure(response);
  }
  if (endpoint.response === null) {
    return undefined as EndpointResponse<E>;
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new ApiError(response.status, 'unexpected_response', GENERIC);
  }
  const result = endpoint.response.safeParse(json);
  if (!result.success) {
    throw new ApiError(response.status, 'unexpected_response', GENERIC);
  }
  return result.data as EndpointResponse<E>;
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
