import { describe, expect, it } from 'vitest';
import { isPermissionKey } from '../authorization.js';
import { LIVENESS_OK } from '../health.js';
import { WORKSPACE_SECTIONS } from '../navigation.js';
import {
  ALL_ENDPOINTS,
  API,
  API_ERROR_STATUS,
  buildEndpointRequest,
  CACHE_RESOURCES,
  EndpointInputError,
  endpointErrorCodes,
  livenessResponseSchema,
  needsCsrfToken,
  pathParamNames,
} from './endpoints.js';
import { API_ERROR_CODES } from './workspaces.js';

const WS = '0b7f4e2a-3c1d-4e5f-8a9b-1c2d3e4f5a6b';
const INV = '1c2d3e4f-5a6b-4c7d-9e8f-0a1b2c3d4e5f';
const keysOf = (schema: { shape: object } | undefined) =>
  Object.keys(schema?.shape ?? {}).sort();

describe('endpoint list (task 05B)', () => {
  it('has unique ids and unique method-path pairs', () => {
    const ids = ALL_ENDPOINTS.map((e) => e.id);
    const routes = ALL_ENDPOINTS.map((e) => `${e.method} ${e.path}`);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(routes).size).toBe(routes.length);
    expect(ALL_ENDPOINTS).toHaveLength(63);
  });

  it('declares a schema key for every path parameter', () => {
    for (const spec of ALL_ENDPOINTS) {
      expect(spec.path.startsWith('/'), spec.id).toBe(true);
      expect(keysOf(spec.params), spec.id).toEqual(
        pathParamNames(spec.path).sort(),
      );
    }
  });

  it('ties access to the path: workspaces, platform and public routes', () => {
    for (const spec of ALL_ENDPOINTS) {
      expect(spec.access === 'workspace', spec.id).toBe(
        spec.path.startsWith('/workspaces/:workspaceId'),
      );
      expect(spec.access === 'platform_admin', spec.id).toBe(
        spec.path.startsWith('/platform/'),
      );
      if (spec.permission !== undefined) {
        expect(spec.access, spec.id).toBe('workspace');
        expect(isPermissionKey(spec.permission), spec.id).toBe(true);
      }
    }
    // Only a workspace's own record is open to any member.
    const membershipOnly = ALL_ENDPOINTS.filter(
      (e) => e.access === 'workspace' && e.permission === undefined,
    ).map((e) => e.id);
    expect(membershipOnly).toEqual(['workspaces.get']);
  });

  it('asks for the permission of the page that shows the data (05A sections)', () => {
    for (const spec of ALL_ENDPOINTS.filter(
      (e) =>
        e.method === 'GET' && e.path.startsWith('/workspaces/:workspaceId/'),
    )) {
      const resource = spec.path.split('/')[3] ?? '';
      const section = WORKSPACE_SECTIONS.find((s) =>
        (s.apiResources as readonly string[]).includes(resource),
      );
      expect(section?.permission, spec.id).toBe(spec.permission);
    }
  });

  it('answers 204 exactly when there is no body', () => {
    for (const spec of ALL_ENDPOINTS) {
      expect(spec.response === null, spec.id).toBe(spec.status === 204);
    }
  });

  it('caches only reads the client may keep, scoped as their resource says', () => {
    for (const spec of ALL_ENDPOINTS) {
      if (spec.cache === undefined) {
        continue;
      }
      expect(spec.method, spec.id).toBe('GET');
      expect(['session', 'workspace'], spec.id).toContain(spec.access);
      if (CACHE_RESOURCES[spec.cache] === 'workspace') {
        expect(keysOf(spec.params), spec.id).toContain('workspaceId');
      } else {
        expect(spec.params, spec.id).toBeUndefined();
      }
    }
    // Never cached: the CSRF token, and audited platform access.
    expect(API.auth.session).not.toHaveProperty('cache');
    for (const spec of Object.values(API.platform)) {
      expect(spec, spec.id).not.toHaveProperty('cache');
    }
    // Each resource is cached by exactly one endpoint.
    const cached = ALL_ENDPOINTS.flatMap((e) =>
      e.cache === undefined ? [] : [e.cache],
    );
    expect(cached.sort()).toEqual(Object.keys(CACHE_RESOURCES).sort());
  });

  it('invalidates only from mutations, and workspace data only with a workspace id', () => {
    for (const spec of ALL_ENDPOINTS) {
      for (const resource of spec.invalidates ?? []) {
        expect(spec.method, spec.id).not.toBe('GET');
        if (CACHE_RESOURCES[resource] === 'workspace') {
          expect(keysOf(spec.params), spec.id).toContain('workspaceId');
        }
      }
    }
    // Every mutation of cached workspace data says what it makes stale.
    for (const spec of ALL_ENDPOINTS.filter(
      (e) => e.method !== 'GET' && e.access === 'workspace',
    )) {
      expect(spec.invalidates?.length ?? 0, spec.id).toBeGreaterThan(0);
    }
  });

  it('needs the CSRF token on every authenticated mutation', () => {
    expect(needsCsrfToken(API.auth.login)).toBe(false);
    expect(needsCsrfToken(API.auth.logout)).toBe(true);
    expect(needsCsrfToken(API.members.list)).toBe(false);
    expect(needsCsrfToken(API.invitations.revoke)).toBe(true);
    expect(needsCsrfToken(API.platform.openAccess)).toBe(true);
  });

  it('derives the error codes of each endpoint', () => {
    expect(endpointErrorCodes(API.health.live)).toEqual([]);
    expect(endpointErrorCodes(API.members.list).sort()).toEqual(
      [
        'validation_failed',
        'unauthenticated',
        'session_expired',
        'not_found',
        'forbidden',
      ].sort(),
    );
    expect(endpointErrorCodes(API.members.changeRole)).toEqual(
      expect.arrayContaining(['csrf_failed', 'forbidden_origin', 'last_admin']),
    );
    expect(endpointErrorCodes(API.auth.login)).toEqual(
      expect.arrayContaining(['invalid_credentials', 'too_many_requests']),
    );
    expect(endpointErrorCodes(API.auth.login)).not.toContain('csrf_failed');
    // Every code has a 4xx status.
    for (const code of API_ERROR_CODES) {
      expect(API_ERROR_STATUS[code]).toBeGreaterThanOrEqual(400);
      expect(API_ERROR_STATUS[code]).toBeLessThan(500);
    }
  });

  it('describes the health responses', () => {
    expect(livenessResponseSchema.parse(LIVENESS_OK)).toEqual({ status: 'ok' });
  });
});

describe('buildEndpointRequest', () => {
  it('validates and encodes path parameters', () => {
    expect(
      buildEndpointRequest(API.invitations.revoke, {
        params: { workspaceId: WS, invitationId: INV },
      }).path,
    ).toBe(`/workspaces/${WS}/invitations/${INV}`);
    expect(() =>
      buildEndpointRequest(API.members.list, {
        params: { workspaceId: '../platform' },
      }),
    ).toThrow(EndpointInputError);
    expect(() => buildEndpointRequest(API.members.list, {})).toThrow(
      EndpointInputError,
    );
  });

  it('writes the query with sorted keys and without empty values', () => {
    expect(
      buildEndpointRequest(API.members.list, {
        params: { workspaceId: WS },
        query: { limit: 25, cursor: 'abc/=' },
      }).path,
    ).toBe(`/workspaces/${WS}/members?cursor=abc%2F%3D&limit=25`);
    expect(
      buildEndpointRequest(API.members.list, {
        params: { workspaceId: WS },
        query: {},
      }).path,
    ).toBe(`/workspaces/${WS}/members`);
    expect(() =>
      buildEndpointRequest(API.members.list, {
        params: { workspaceId: WS },
        query: { limit: 1000 },
      }),
    ).toThrow(EndpointInputError);
  });

  it('validates bodies and headers, and reports issues without the input', () => {
    const request = buildEndpointRequest(API.workspaces.create, {
      body: { name: '  Acme  ' },
    });
    expect(request.body).toEqual({ name: 'Acme' });
    try {
      buildEndpointRequest(API.auth.login, {
        body: { email: 'not-an-address', password: 'secret-value' },
      });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(EndpointInputError);
      const text = JSON.stringify((error as EndpointInputError).issues);
      expect(text).toContain('email');
      expect(text).not.toContain('not-an-address');
      expect(text).not.toContain('secret-value');
    }
    expect(
      buildEndpointRequest(API.platform.listWorkspaces, {
        headers: { 'x-access-reason': 'Support ticket 1234: check status' },
      }).headers,
    ).toEqual({ 'x-access-reason': 'Support ticket 1234: check status' });
    expect(() =>
      buildEndpointRequest(API.platform.listWorkspaces, {
        headers: { 'x-access-reason': 'short' },
      }),
    ).toThrow(EndpointInputError);
  });
});
