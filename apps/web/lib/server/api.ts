// The web server's own calls to the API (tasks 05A, 05B), for server-rendered pages. They carry
// the signed-in user's session cookie, nothing else, so the API applies the same checks as for
// the browser. Each call names a GET endpoint of the shared list; its input and response are
// validated with that endpoint's schemas. Nothing is cached across requests (no-store).
import 'server-only';
import {
  apiErrorResponseSchema,
  buildEndpointRequest,
  EndpointInputError,
  SESSION_COOKIE_NAME,
  type ApiErrorCode,
  type EndpointInput,
  type EndpointResponse,
  type EndpointSpec,
} from '@lead-fennec-ai/shared';
import { cookies } from 'next/headers';
import { apiBase } from './config';

export type ServerApiResult<T> =
  | { readonly ok: true; readonly data: T }
  | {
      readonly ok: false;
      /** 0 when the API could not be reached or answered something unexpected. */
      readonly status: number;
      readonly code: ApiErrorCode | null;
    };

const TIMEOUT_MS = 10_000;

/** Calls a GET `endpoint` as the signed-in user. Invalid input: 404, as the API answers. */
export async function serverApiGet<
  E extends EndpointSpec & { readonly method: 'GET' },
>(
  endpoint: E,
  input: EndpointInput<E>,
): Promise<ServerApiResult<EndpointResponse<E>>> {
  const session = (await cookies()).get(SESSION_COOKIE_NAME);
  if (session === undefined || session.value === '') {
    return { ok: false, status: 401, code: 'unauthenticated' };
  }
  let path: string;
  try {
    path = buildEndpointRequest(endpoint, input).path;
  } catch (error) {
    if (error instanceof EndpointInputError) {
      return { ok: false, status: 404, code: 'not_found' };
    }
    throw error;
  }
  let response: Response;
  try {
    response = await fetch(`${apiBase()}${path}`, {
      headers: { cookie: `${SESSION_COOKIE_NAME}=${session.value}` },
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, status: 0, code: null };
  }
  let json: unknown;
  try {
    json = await response.json();
  } catch {
    return { ok: false, status: response.ok ? 0 : response.status, code: null };
  }
  if (!response.ok) {
    const error = apiErrorResponseSchema.safeParse(json);
    return {
      ok: false,
      status: response.status,
      code: error.success ? error.data.error.code : null,
    };
  }
  if (endpoint.response === null) {
    return { ok: true, data: undefined as EndpointResponse<E> };
  }
  const parsed = endpoint.response.safeParse(json);
  return parsed.success
    ? { ok: true, data: parsed.data as EndpointResponse<E> }
    : { ok: false, status: 0, code: null };
}
