import {
  ALL_ENDPOINTS,
  API,
  CSRF_HEADER_NAME,
  pathParamNames,
} from '@lead-fennec-ai/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiPathFor } from './api-proxy';
import { ApiError, callApi } from './api';

const WS = '0b7f4e2a-3c1d-4e5f-8a9b-1c2d3e4f5a6b';
const TOKEN = 'A'.repeat(43);

function stubFetch(response: Response) {
  const fetchMock = vi.fn<
    (url: string, init?: RequestInit) => Promise<Response>
  >(() => Promise.resolve(response));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('typed API client (task 05B)', () => {
  it('builds the path from validated parameters and validates the answer', async () => {
    const fetchMock = stubFetch(json({ items: [], nextCursor: null }));
    await expect(
      callApi(API.members.list, {
        params: { workspaceId: WS },
        query: { limit: 25 },
      }),
    ).resolves.toEqual({ items: [], nextCursor: null });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(`/api/workspaces/${WS}/members?limit=25`);
    expect(init).toMatchObject({
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    });
    expect(new Headers(init?.headers).has(CSRF_HEADER_NAME)).toBe(false);
  });

  it('refuses invalid input before anything is sent', async () => {
    const fetchMock = stubFetch(json({}));
    await expect(
      callApi(API.members.list, { params: { workspaceId: '../../auth' } }),
    ).rejects.toMatchObject({ code: 'validation_failed', status: 0 });
    await expect(
      callApi(
        API.workspaces.create,
        { body: { name: '' } },
        {
          csrfToken: TOKEN,
        },
      ),
    ).rejects.toMatchObject({
      code: 'validation_failed',
      issues: [{ path: 'name', message: 'Enter a name.' }],
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the CSRF token on authenticated mutations, and never without one', async () => {
    const fetchMock = stubFetch(new Response(null, { status: 204 }));
    await expect(callApi(API.auth.logout)).rejects.toMatchObject({
      code: 'csrf_failed',
    });
    expect(fetchMock).not.toHaveBeenCalled();
    await expect(
      callApi(API.auth.logout, {}, { csrfToken: TOKEN }),
    ).resolves.toBeUndefined();
    const [, init] = fetchMock.mock.calls[0] ?? [];
    expect(new Headers(init?.headers).get(CSRF_HEADER_NAME)).toBe(TOKEN);
  });

  it('turns error envelopes, off-contract answers and network failures into ApiError', async () => {
    stubFetch(
      json(
        {
          error: { code: 'forbidden', message: 'You do not have permission.' },
        },
        403,
      ),
    );
    await expect(
      callApi(API.roles.list, { params: { workspaceId: WS } }),
    ).rejects.toMatchObject({ status: 403, code: 'forbidden' });

    stubFetch(json({ items: 'not a list' }));
    await expect(
      callApi(API.roles.list, { params: { workspaceId: WS } }),
    ).rejects.toMatchObject({ code: 'unexpected_response' });

    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('offline')));
    const error: unknown = await callApi(API.auth.session).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ code: 'network_error', status: 0 });
  });
});

describe('same-origin proxy and the endpoint list (task 05B)', () => {
  it('forwards every endpoint the browser uses, and not the health probes', () => {
    for (const spec of ALL_ENDPOINTS) {
      let path = spec.path;
      for (const name of pathParamNames(path)) {
        path = path.replace(`:${name}`, WS);
      }
      const forwarded = apiPathFor(path.split('/').filter(Boolean));
      if (spec.tag === 'health') {
        expect(forwarded, spec.id).toBeNull();
      } else {
        expect(forwarded, spec.id).toBe(path);
      }
    }
  });
});
