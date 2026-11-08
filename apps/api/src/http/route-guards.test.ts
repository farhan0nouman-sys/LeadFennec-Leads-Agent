// Authorization review (task 04C, docs/security/authorization-review.md): every route the
// application registers is checked for the guards its shape requires, so a new route that
// forgets one fails here rather than in production.
import { isPermissionKey, WORKSPACE_SECTIONS } from '@lead-fennec-ai/shared';
import { type CanActivate, type Type } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { beforeAll, describe, expect, it } from 'vitest';
import { CsrfGuard, OriginGuard, SessionGuard } from '../auth/auth-guards.js';
import {
  registeredRoutes,
  type RegisteredRoute as Route,
} from '../testing/registered-routes.js';
import {
  PermissionGuard,
  WorkspaceGuard,
} from '../workspaces/workspace-guards.js';

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
        'GET /workspaces/:workspaceId/leads/summary',
        'GET /workspaces/:workspaceId/campaigns/summary',
        'GET /workspaces/:workspaceId/activity',
        'GET /workspaces/:workspaceId/integrations/health',
        'GET /workspaces/:workspaceId/campaigns',
        'GET /workspaces/:workspaceId/campaigns/options',
        'POST /workspaces/:workspaceId/campaigns',
        'GET /workspaces/:workspaceId/campaigns/:campaignId',
        'PATCH /workspaces/:workspaceId/campaigns/:campaignId',
        'POST /workspaces/:workspaceId/campaigns/:campaignId/duplicate',
        'GET /workspaces/:workspaceId/campaigns/:campaignId/readiness',
        'POST /workspaces/:workspaceId/campaigns/:campaignId/activate',
        'POST /workspaces/:workspaceId/imports/discovery',
        'GET /workspaces/:workspaceId/imports/:importId',
        'POST /workspaces/:workspaceId/imports/csv',
        'GET /workspaces/:workspaceId/imports',
        'GET /workspaces/:workspaceId/imports/options',
        'GET /workspaces/:workspaceId/imports/:importId/results',
        'POST /workspaces/:workspaceId/imports/:importId/cancel',
        'POST /workspaces/:workspaceId/imports/:importId/enrichment',
        'GET /workspaces/:workspaceId/imports/:importId/contacts',
        'POST /workspaces/:workspaceId/contacts/:contactId/recheck',
        'GET /workspaces/:workspaceId/organizations/:organizationId/research',
        'POST /workspaces/:workspaceId/organizations/:organizationId/research',
        'POST /workspaces/:workspaceId/organizations/:organizationId/research/corrections',
        'GET /workspaces/:workspaceId/organizations/:organizationId/research/:researchId',
        'GET /workspaces/:workspaceId/settings/send-policy',
        'GET /workspaces/:workspaceId/campaigns/:campaignId/leads',
        'GET /workspaces/:workspaceId/campaigns/:campaignId/leads/:contactId',
        'POST /workspaces/:workspaceId/campaigns/:campaignId/leads/:contactId/qualify',
        'POST /workspaces/:workspaceId/campaigns/:campaignId/leads/:contactId/decisions',
        'PATCH /workspaces/:workspaceId/settings/send-policy',
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
      if (
        /:(membershipId|invitationId|roleId|campaignId|importId)\b/.test(
          route.path,
        )
      ) {
        expect(workspaceRoutes, route.id).toContain(route);
      }
    }
  });

  it('requires the permission of the section that shows the data (task 05A)', () => {
    // packages/shared/src/navigation.ts: the web app shows a section only with its permission;
    // the API routes behind it must ask for the same one, so hiding and refusing agree.
    const nested = routes.filter((route) =>
      route.path.startsWith('/workspaces/:workspaceId/'),
    );
    expect(nested.length).toBeGreaterThan(0);
    for (const route of nested) {
      const resource = route.path.split('/')[3] ?? '';
      const section = WORKSPACE_SECTIONS.find((s) =>
        (s.apiResources as readonly string[]).includes(resource),
      );
      expect(
        section,
        `${route.id}: add "${resource}" to a section's apiResources`,
      ).toBeDefined();
      if (route.method === 'GET' && section?.permission != null) {
        expect(route.permissions, route.id).toContain(section.permission);
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
