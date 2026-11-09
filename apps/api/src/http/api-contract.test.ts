// API contract (task 05B, docs/decisions.md D-05B-02): the routes the application registers
// match the endpoint list that generates docs/api/openapi.json and the web app's typed client —
// same methods and paths, guards for the declared access, the same permission, the same success
// status, and the very schemas the routes validate bodies and queries with.
import {
  ALL_ENDPOINTS,
  needsCsrfToken,
  type EndpointSpec,
} from '@lead-fennec-ai/shared';
import { beforeAll, describe, expect, it } from 'vitest';
import { CsrfGuard, SessionGuard } from '../auth/auth-guards.js';
import {
  registeredRoutes,
  type RegisteredRoute,
} from '../testing/registered-routes.js';
import {
  PermissionGuard,
  WorkspaceGuard,
} from '../workspaces/workspace-guards.js';
import { ZodPipe } from './api-errors.js';

const schemasOf = (pipes: readonly unknown[]) =>
  pipes
    .filter((pipe): pipe is ZodPipe<never> => pipe instanceof ZodPipe)
    .map((pipe) => pipe.schema as unknown);

describe('API contract: routes match the endpoint list (task 05B)', () => {
  let routes: Map<string, RegisteredRoute>;
  const endpointId = (spec: EndpointSpec) => `${spec.method} ${spec.path}`;

  beforeAll(async () => {
    routes = new Map((await registeredRoutes()).map((r) => [r.id, r]));
  });

  it('registers exactly the listed endpoints', () => {
    expect([...routes.keys()].sort()).toEqual(
      ALL_ENDPOINTS.map(endpointId).sort(),
    );
  });

  it('guards each route as its access says', () => {
    for (const spec of ALL_ENDPOINTS) {
      const route = routes.get(endpointId(spec));
      expect(route, spec.id).toBeDefined();
      if (route === undefined) {
        continue;
      }
      expect(route.guards.includes(SessionGuard), spec.id).toBe(
        spec.access !== 'public',
      );
      // CsrfGuard lets safe methods through, so a controller-wide one on a GET is harmless.
      if (spec.method !== 'GET') {
        expect(route.guards.includes(CsrfGuard), spec.id).toBe(
          needsCsrfToken(spec),
        );
      }
      expect(route.guards.includes(WorkspaceGuard), spec.id).toBe(
        spec.access === 'workspace',
      );
      expect(route.guards.includes(PermissionGuard), spec.id).toBe(
        spec.permission !== undefined,
      );
      expect(route.permissions, spec.id).toEqual(
        spec.permission === undefined ? [] : [spec.permission],
      );
    }
  });

  it('answers with the listed success status', () => {
    for (const spec of ALL_ENDPOINTS) {
      expect(routes.get(endpointId(spec))?.status, spec.id).toBe(spec.status);
    }
  });

  it('validates bodies and queries with the listed schemas', () => {
    for (const spec of ALL_ENDPOINTS) {
      const route = routes.get(endpointId(spec));
      expect(schemasOf(route?.bodyPipes ?? []), spec.id).toEqual(
        spec.body === undefined ? [] : [spec.body],
      );
      expect(schemasOf(route?.queryPipes ?? []), spec.id).toEqual(
        spec.query === undefined ? [] : [spec.query],
      );
      // Identity, not just equal shapes: the API validates with the contract's own object.
      if (spec.body !== undefined) {
        expect(
          schemasOf(route?.bodyPipes ?? [])[0] === spec.body,
          spec.id,
        ).toBe(true);
      }
    }
  });
});
