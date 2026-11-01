// Authorization review (task 04C, docs/security/authorization-review.md): every route the
// application registers is checked for the guards its shape requires, so a new route that
// forgets one fails here rather than in production.
import { Writable } from 'node:stream';
import { isPermissionKey } from '@lead-fennec-ai/shared';
import { createLogger } from '@lead-fennec-ai/shared/logger';
import { RequestMethod, type CanActivate, type Type } from '@nestjs/common';
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants.js';
import {
  DiscoveryModule,
  DiscoveryService,
  MetadataScanner,
} from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module.js';
import { CsrfGuard, OriginGuard, SessionGuard } from '../auth/auth-guards.js';
import { apiEnvSchema } from '../env.js';
import { READINESS_CHECKS } from '../health/health.tokens.js';
import {
  PermissionGuard,
  REQUIRED_PERMISSIONS,
  WorkspaceGuard,
} from '../workspaces/workspace-guards.js';

interface Route {
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly guards: readonly Type<CanActivate>[];
  readonly permissions: readonly string[];
}

/** Routes anyone may call: health probes and the signed-out account flows. */
const PUBLIC_ROUTES = new Set([
  'GET /health/live',
  'GET /health/ready',
  'POST /auth/register',
  'POST /auth/verify-email',
  'POST /auth/verify-email/resend',
  'POST /auth/login',
  'POST /auth/password-reset/request',
  'POST /auth/password-reset/confirm',
]);

/** Workspace routes that need membership only (no permission). */
const MEMBERSHIP_ONLY_ROUTES = new Set(['GET /workspaces/:workspaceId']);

const joinPath = (...parts: unknown[]) =>
  '/' +
  parts
    .flatMap((part): unknown[] => (Array.isArray(part) ? part : [part]))
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .map((part) => part.replace(/^\/+|\/+$/g, ''))
    .filter((part) => part !== '')
    .join('/');

const guardsOf = (target: object): Type<CanActivate>[] =>
  (Reflect.getMetadata(GUARDS_METADATA, target) as
    Type<CanActivate>[] | undefined) ?? [];

async function registeredRoutes(): Promise<Route[]> {
  const env = apiEnvSchema.parse({
    APP_ENV: 'test',
    DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/leadfennec_test',
    REDIS_URL: 'redis://127.0.0.1:1/15',
  });
  const logger = createLogger({
    app: 'api',
    level: 'silent',
    destination: new Writable({
      write: (_chunk, _encoding, done) => {
        done();
      },
    }),
  });
  // Compiled, never started: nothing is dialled.
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(env, logger), DiscoveryModule],
  })
    .overrideProvider(READINESS_CHECKS)
    .useValue([])
    .compile();
  try {
    const scanner = new MetadataScanner();
    const routes: Route[] = [];
    for (const wrapper of moduleRef.get(DiscoveryService).getControllers()) {
      const controller = wrapper.metatype as Type | null;
      if (controller === null) {
        continue;
      }
      const prototype = controller.prototype as Record<string, unknown>;
      for (const name of scanner.getAllMethodNames(prototype)) {
        const handler = prototype[name];
        if (typeof handler !== 'function') {
          continue;
        }
        const methodPath: unknown = Reflect.getMetadata(PATH_METADATA, handler);
        if (methodPath === undefined) {
          continue;
        }
        const method =
          RequestMethod[
            Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod
          ];
        const path = joinPath(
          Reflect.getMetadata(PATH_METADATA, controller),
          methodPath,
        );
        routes.push({
          id: `${method} ${path}`,
          method,
          path,
          guards: [...guardsOf(controller), ...guardsOf(handler)],
          permissions:
            (Reflect.getMetadata(REQUIRED_PERMISSIONS, handler) as
              string[] | undefined) ?? [],
        });
      }
    }
    return routes;
  } finally {
    await moduleRef.close();
  }
}

describe('route guards (authorization review, task 04C)', () => {
  let routes: Route[];

  beforeAll(async () => {
    routes = await registeredRoutes();
  });

  const before = (
    route: Route,
    first: Type<CanActivate>,
    second: Type<CanActivate>,
  ) => route.guards.indexOf(first) < route.guards.indexOf(second);

  it('finds every route, and only the reviewed ones', () => {
    // A new route is added here deliberately, after reviewing its authorization
    // (docs/security/authorization-review.md).
    expect(routes.map((route) => route.id).sort()).toEqual(
      [
        ...PUBLIC_ROUTES,
        'POST /auth/logout',
        'GET /auth/session',
        'POST /workspaces',
        'GET /workspaces',
        ...MEMBERSHIP_ONLY_ROUTES,
        'GET /workspaces/:workspaceId/members',
        'PATCH /workspaces/:workspaceId/members/:membershipId',
        'GET /workspaces/:workspaceId/roles',
        'GET /workspaces/:workspaceId/invitations',
        'POST /workspaces/:workspaceId/invitations',
        'DELETE /workspaces/:workspaceId/invitations/:invitationId',
        'POST /invitations/preview',
        'POST /invitations/accept',
        'GET /platform/workspaces',
        'POST /platform/workspaces/:workspaceId/access',
        'POST /platform/workspaces/:workspaceId/status',
      ].sort(),
    );
  });

  it('requires a session on every route except the public ones', () => {
    for (const route of routes) {
      expect(route.guards.includes(SessionGuard), route.id).toBe(
        !PUBLIC_ROUTES.has(route.id),
      );
    }
  });

  it('protects every state-changing route against cross-site requests', () => {
    for (const route of routes.filter((r) => r.method !== 'GET')) {
      expect(route.guards, route.id).toContain(OriginGuard);
      if (route.guards.includes(SessionGuard)) {
        expect(route.guards, route.id).toContain(CsrfGuard);
        expect(before(route, SessionGuard, CsrfGuard), route.id).toBe(true);
      }
    }
  });

  it('limits request rates on every route outside the health probes', () => {
    for (const route of routes.filter((r) => !r.path.startsWith('/health/'))) {
      expect(route.guards, route.id).toContain(ThrottlerGuard);
    }
  });

  it('checks membership and permissions on every workspace route', () => {
    const workspaceRoutes = routes.filter((route) =>
      route.path.startsWith('/workspaces/:workspaceId'),
    );
    expect(workspaceRoutes.length).toBeGreaterThanOrEqual(7);
    for (const route of workspaceRoutes) {
      expect(route.guards, route.id).toContain(WorkspaceGuard);
      expect(before(route, SessionGuard, WorkspaceGuard), route.id).toBe(true);
      if (MEMBERSHIP_ONLY_ROUTES.has(route.id)) {
        expect(route.guards, route.id).not.toContain(PermissionGuard);
        continue;
      }
      expect(route.guards, route.id).toContain(PermissionGuard);
      expect(before(route, WorkspaceGuard, PermissionGuard), route.id).toBe(
        true,
      );
      expect(route.permissions.length, route.id).toBeGreaterThan(0);
      expect(route.permissions.every(isPermissionKey), route.id).toBe(true);
    }
    // Other record ids only ever appear under a workspace.
    for (const route of routes) {
      if (/:(membershipId|invitationId|roleId)\b/.test(route.path)) {
        expect(workspaceRoutes, route.id).toContain(route);
      }
    }
  });

  it('keeps platform routes apart from membership', () => {
    for (const route of routes.filter((r) => r.path.startsWith('/platform/'))) {
      expect(route.guards, route.id).toContain(SessionGuard);
      expect(route.guards, route.id).not.toContain(WorkspaceGuard);
      expect(route.guards, route.id).not.toContain(PermissionGuard);
    }
  });
});
