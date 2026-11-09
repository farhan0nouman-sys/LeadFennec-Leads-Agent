// Authorization for workspace routes (task 04B, docs/decisions.md D-04B-04). The acting user
// always comes from the session; the workspace id from the route is accepted only if that user
// has an active membership in it.
import {
  memberScope,
  TenantAccessDeniedError,
  type PrismaClient,
  type TenantScope,
} from '@lead-fennec-ai/database';
import type { PermissionKey } from '@lead-fennec-ai/shared';
import {
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ZodError } from 'zod';
import { requireSession, type ApiRequest } from '../auth/auth-guards.js';
import { AUTH_CLOCK, type AuthClock } from '../auth/auth.policy.js';
import { PRISMA_CLIENT } from '../database/database.module.js';
import { forbidden, notFound } from '../http/api-errors.js';

export interface WorkspaceRequest extends ApiRequest {
  params?: Record<string, string | undefined>;
  /** Set by WorkspaceGuard. */
  workspace?: TenantScope;
}

export function requireWorkspace(request: WorkspaceRequest): TenantScope {
  if (request.workspace === undefined) {
    throw new Error('WorkspaceGuard did not run for this route');
  }
  return request.workspace;
}

/**
 * Resolves `:workspaceId` to a member scope of the session's user. Unknown workspaces, ones
 * the user is not an active member of, and suspended ones all answer 404, so ids reveal nothing.
 */
@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(
    @Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Inject(AUTH_CLOCK) private readonly clock: AuthClock,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<WorkspaceRequest>();
    const session = requireSession(request);
    try {
      request.workspace = await memberScope(
        this.prisma,
        {
          tenantId: request.params?.['workspaceId'] ?? '',
          userId: session.user.id,
        },
        { now: this.clock },
      );
    } catch (error) {
      if (
        error instanceof TenantAccessDeniedError ||
        error instanceof ZodError
      ) {
        throw notFound();
      }
      throw error;
    }
    return true;
  }
}

/** Metadata key of @RequirePermissions (read by PermissionGuard and the route-guard test). */
export const REQUIRED_PERMISSIONS = 'lead-fennec-ai:required-permissions';

/** Permissions the route needs, all of them, from the member's role. */
export const RequirePermissions = (...permissions: PermissionKey[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);

/**
 * Checks @RequirePermissions against the member's role (after WorkspaceGuard). The
 * repositories check again, so a route without the decorator still cannot bypass them.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required =
      this.reflector.getAllAndOverride<PermissionKey[] | undefined>(
        REQUIRED_PERMISSIONS,
        [context.getHandler(), context.getClass()],
      ) ?? [];
    const { actor } = requireWorkspace(
      context.switchToHttp().getRequest<WorkspaceRequest>(),
    );
    if (
      actor.kind !== 'member' ||
      !required.every((permission) => actor.permissions.has(permission))
    ) {
      throw forbidden();
    }
    return true;
  }
}
