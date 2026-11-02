// Entry points to tenant data (docs/decisions.md D-03C-04, D-03C-05). Server code obtains a
// TenantScope only through these functions; each one decides who may act in which tenant:
// - memberScope: a user with an ACTIVE membership in an ACTIVE tenant;
// - platformAdminScope: an ACTIVE platform admin with a stated reason. Explicit and audited:
//   opening it writes an audit record in the tenant, a refusal writes a platform audit record,
//   and the scope's client is read-only (changes go through audited repository methods);
// - systemScope: a named worker that iterates tenants (D-03B-02).
// platformConsole is the only cross-tenant entry point, for platform admins, and is audited.
import { z } from 'zod';
import type { PrismaClient, Tenant } from '../generated/prisma/client.js';
import { paginate, type Page, type PageRequest } from '../pagination.js';
import {
  accessReasonSchema,
  requestIdSchema,
  systemActorNameSchema,
  TenantAccessDeniedError,
  uuidSchema,
  type MemberActor,
  type PlatformAdminActor,
  type SystemActor,
  type TenantActor,
} from './actors.js';
import {
  createAuditRepository,
  writeAuditRecord,
  type AuditRepository,
} from './audit.js';
import { RecordNotFoundError } from './authorization.js';
import { createBillingRepository, type BillingRepository } from './billing.js';
import {
  createDashboardRepository,
  type DashboardRepository,
} from './dashboard.js';
import {
  createInvitationRepository,
  type InvitationRepository,
} from './invitations.js';
import { createMemberRepository, type MemberRepository } from './members.js';
import {
  createNotificationRepository,
  type NotificationRepository,
} from './notifications.js';
import { createTenantDb, type TenantDb } from './tenant-db.js';
import { createUsageRepository, type UsageRepository } from './usage.js';

export interface TenantScope {
  readonly tenantId: string;
  readonly actor: TenantActor;
  /** Read-only for platform admins. */
  readonly db: TenantDb;
  readonly audit: AuditRepository;
  readonly billing: BillingRepository;
  readonly dashboard: DashboardRepository;
  readonly invitations: InvitationRepository;
  readonly members: MemberRepository;
  readonly notifications: NotificationRepository;
  readonly usage: UsageRepository;
}

export interface ScopeOptions {
  /** Clock for timestamps the repositories write (tests pass a fixed one). */
  readonly now?: () => Date;
}

function buildScope(
  prisma: PrismaClient,
  tenantId: string,
  actor: TenantActor,
  options: ScopeOptions,
): TenantScope {
  const now = options.now ?? (() => new Date());
  return {
    tenantId,
    actor,
    db: createTenantDb(prisma, tenantId, {
      readOnly: actor.kind === 'platform_admin',
    }),
    audit: createAuditRepository(prisma, tenantId, actor),
    billing: createBillingRepository(prisma, tenantId, actor),
    dashboard: createDashboardRepository(prisma, tenantId, actor, now),
    invitations: createInvitationRepository(prisma, tenantId, actor, now),
    members: createMemberRepository(prisma, tenantId, actor),
    notifications: createNotificationRepository(prisma, tenantId, actor, now),
    usage: createUsageRepository(prisma, tenantId, actor, now),
  };
}

const memberInputSchema = z
  .object({ tenantId: uuidSchema, userId: uuidSchema })
  .strict();

/** A signed-in user acting in one of their tenants. */
export async function memberScope(
  prisma: PrismaClient,
  input: z.input<typeof memberInputSchema>,
  options: ScopeOptions = {},
): Promise<TenantScope> {
  const { tenantId, userId } = memberInputSchema.parse(input);
  const membership = await prisma.membership.findUnique({
    where: { tenantId_userId: { tenantId, userId } },
    select: {
      id: true,
      roleId: true,
      status: true,
      tenant: { select: { status: true } },
      user: { select: { status: true } },
      role: { select: { permissions: { select: { permissionKey: true } } } },
    },
  });
  if (
    membership?.status !== 'ACTIVE' ||
    membership.user.status !== 'ACTIVE' ||
    membership.tenant.status !== 'ACTIVE'
  ) {
    throw new TenantAccessDeniedError();
  }
  const actor: MemberActor = {
    kind: 'member',
    userId,
    membershipId: membership.id,
    roleId: membership.roleId,
    permissions: new Set(
      membership.role.permissions.map((p) => p.permissionKey),
    ),
  };
  return buildScope(prisma, tenantId, actor, options);
}

const adminInputSchema = z
  .object({
    userId: uuidSchema,
    reason: accessReasonSchema,
    requestId: requestIdSchema,
  })
  .strict();

const adminTenantInputSchema = adminInputSchema
  .extend({ tenantId: uuidSchema })
  .strict();

/** Loads an ACTIVE platform admin, or records the refusal and throws. */
async function requirePlatformAdmin(
  prisma: PrismaClient,
  input: z.output<typeof adminInputSchema>,
  subjectTenantId: string | undefined,
): Promise<PlatformAdminActor> {
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { isPlatformAdmin: true, status: true },
  });
  if (user?.isPlatformAdmin !== true || user.status !== 'ACTIVE') {
    // The refusal is decided by the access layer (a system actor) about the requesting user.
    await prisma.platformAuditRecord.create({
      data: {
        actorType: 'SYSTEM',
        actorName: 'access_control',
        action: 'platform_admin.access_denied',
        targetType: 'user',
        targetId: input.userId,
        reason: input.reason,
        ...(subjectTenantId === undefined ? {} : { subjectTenantId }),
        ...(input.requestId === undefined
          ? {}
          : { requestId: input.requestId }),
      },
    });
    throw new TenantAccessDeniedError();
  }
  return {
    kind: 'platform_admin',
    userId: input.userId,
    reason: input.reason,
    requestId: input.requestId,
  };
}

/**
 * A platform admin looking into one tenant, e.g. for support. Writes
 * "platform_admin.access_opened" in the tenant's audit records before returning.
 */
export async function platformAdminScope(
  prisma: PrismaClient,
  input: z.input<typeof adminTenantInputSchema>,
  options: ScopeOptions = {},
): Promise<TenantScope> {
  const { tenantId, ...admin } = adminTenantInputSchema.parse(input);
  const actor = await requirePlatformAdmin(prisma, admin, tenantId);
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true },
  });
  if (tenant === null) {
    throw new TenantAccessDeniedError();
  }
  await writeAuditRecord(prisma, tenantId, actor, {
    action: 'platform_admin.access_opened',
  });
  return buildScope(prisma, tenantId, actor, options);
}

const systemInputSchema = z
  .object({ tenantId: uuidSchema, name: systemActorNameSchema })
  .strict();

/** A background worker acting in one tenant (after iterating `tenants`). */
export function systemScope(
  prisma: PrismaClient,
  input: z.input<typeof systemInputSchema>,
  options: ScopeOptions = {},
): TenantScope {
  const { tenantId, name } = systemInputSchema.parse(input);
  const actor: SystemActor = { kind: 'system', name };
  return buildScope(prisma, tenantId, actor, options);
}

export interface PlatformConsole {
  readonly actor: PlatformAdminActor;
  /** Every tenant, newest first. */
  listTenants(page: PageRequest): Promise<Page<Tenant>>;
  /**
   * Suspends or reactivates a workspace (members of a suspended workspace are refused).
   * Explicit and audited: one platform audit record per change, with its own reason.
   */
  setTenantStatus(input: {
    tenantId: string;
    status: 'ACTIVE' | 'SUSPENDED';
    reason: string;
  }): Promise<Tenant>;
}

const tenantStatusInputSchema = z
  .object({
    tenantId: uuidSchema,
    status: z.enum(['ACTIVE', 'SUSPENDED']),
    reason: accessReasonSchema,
  })
  .strict();

/**
 * The cross-tenant view for platform admins. Opening it writes
 * "platform_admin.console_opened" to the platform audit records.
 */
export async function platformConsole(
  prisma: PrismaClient,
  input: z.input<typeof adminInputSchema>,
): Promise<PlatformConsole> {
  const admin = adminInputSchema.parse(input);
  const actor = await requirePlatformAdmin(prisma, admin, undefined);
  await prisma.platformAuditRecord.create({
    data: {
      actorType: 'PLATFORM_ADMIN',
      actorUserId: actor.userId,
      action: 'platform_admin.console_opened',
      reason: actor.reason,
      ...(actor.requestId === undefined ? {} : { requestId: actor.requestId }),
    },
  });
  return {
    actor,
    listTenants: (page) =>
      paginate(page, (keyset) =>
        prisma.tenant.findMany({
          where: keyset.cursorWhere,
          orderBy: keyset.orderBy,
          take: keyset.take,
        }),
      ),
    async setTenantStatus(input) {
      const { tenantId, status, reason } = tenantStatusInputSchema.parse(input);
      return prisma.$transaction(async (tx) => {
        const before = await tx.tenant.findUnique({
          where: { id: tenantId },
          select: { status: true },
        });
        if (before === null) {
          throw new RecordNotFoundError('workspace');
        }
        const tenant = await tx.tenant.update({
          where: { id: tenantId },
          data: { status },
        });
        await tx.platformAuditRecord.create({
          data: {
            actorType: 'PLATFORM_ADMIN',
            actorUserId: actor.userId,
            action: 'tenant.status_changed',
            subjectTenantId: tenantId,
            targetType: 'tenant',
            targetId: tenantId,
            reason,
            metadata: { from: before.status, to: status },
            ...(actor.requestId === undefined
              ? {}
              : { requestId: actor.requestId }),
          },
        });
        return tenant;
      });
    },
  };
}
