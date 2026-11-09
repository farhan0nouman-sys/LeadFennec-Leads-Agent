// Role-based authorization (task 04B, docs/decisions.md D-04B-04). Repositories call these
// before every operation, so a route that forgets its own check still cannot bypass them.
import type { PermissionKey } from '@lead-fennec-ai/shared';
import {
  ActorNotAllowedError,
  type MemberActor,
  type TenantActor,
} from './actors.js';

/** The actor lacks a permission it needs (a member whose role does not grant it). */
export class PermissionDeniedError extends Error {
  constructor(readonly permission: PermissionKey) {
    super(`The "${permission}" permission is required`);
    this.name = 'PermissionDeniedError';
  }
}

/** A record id that does not exist in the scope's workspace (or does not exist at all). */
export class RecordNotFoundError extends Error {
  constructor(readonly entity: string) {
    super(`${entity} not found`);
    this.name = 'RecordNotFoundError';
  }
}

export function hasPermission(
  actor: TenantActor,
  permission: PermissionKey,
): boolean {
  return actor.kind === 'member' && actor.permissions.has(permission);
}

/** For changes: only a member whose role grants `permission`. */
export function requirePermission(
  actor: TenantActor,
  permission: PermissionKey,
): MemberActor {
  if (actor.kind !== 'member') {
    throw new ActorNotAllowedError(permission);
  }
  if (!actor.permissions.has(permission)) {
    throw new PermissionDeniedError(permission);
  }
  return actor;
}

/**
 * For reads: a member whose role grants `permission`, or a platform admin in an explicit,
 * audited (read-only) scope. Workers do not read through these repositories.
 */
export function requireReadPermission(
  actor: TenantActor,
  permission: PermissionKey,
): void {
  if (actor.kind === 'platform_admin') {
    return;
  }
  requirePermission(actor, permission);
}

/**
 * For reads that application code also needs without a member (billing state and usage, task
 * 04C, D-04C-04): the system actor, a platform admin's audited scope, or a member whose role
 * grants `permission`.
 */
export function requireReadPermissionOrSystem(
  actor: TenantActor,
  permission: PermissionKey,
): void {
  if (actor.kind === 'system') {
    return;
  }
  requireReadPermission(actor, permission);
}
