// Who is acting in a tenant scope, and the errors the access layer raises.
import { z } from 'zod';

export interface MemberActor {
  readonly kind: 'member';
  readonly userId: string;
  readonly membershipId: string;
  readonly roleId: string;
  /** Permission keys of the member's role, for the API's authorization checks. */
  readonly permissions: ReadonlySet<string>;
}

export interface PlatformAdminActor {
  readonly kind: 'platform_admin';
  readonly userId: string;
  readonly reason: string;
  readonly requestId: string | undefined;
}

export interface SystemActor {
  readonly kind: 'system';
  /** Snake-case worker name, e.g. "outbox_relay". */
  readonly name: string;
}

export type TenantActor = MemberActor | PlatformAdminActor | SystemActor;

/**
 * Access was refused. The message is the same whether the tenant is missing, suspended or the
 * user has no active membership, so callers learn nothing about other tenants.
 */
export class TenantAccessDeniedError extends Error {
  constructor() {
    super('Access to this tenant is denied');
    this.name = 'TenantAccessDeniedError';
  }
}

/** The actor's kind may not perform this operation (e.g. a member changing limits). */
export class ActorNotAllowedError extends Error {
  constructor(operation: string) {
    super(`${operation} is not allowed for this actor`);
    this.name = 'ActorNotAllowedError';
  }
}

// ─── Input validation (untrusted: request parameters, job payloads) ──────────

export const uuidSchema = z.uuid();
/** Why a platform admin needs access, e.g. a support ticket reference. Stored in audit. */
export const accessReasonSchema = z.string().trim().min(10).max(500);
export const requestIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9._:-]{1,128}$/)
  .optional();
export const systemActorNameSchema = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);
export const dottedKeySchema = z
  .string()
  .max(100)
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/);
export const snakeKeySchema = z.string().regex(/^[a-z][a-z0-9_]{0,62}$/);
