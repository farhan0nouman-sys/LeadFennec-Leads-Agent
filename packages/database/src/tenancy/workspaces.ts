// Workspaces (tenants) from a user's point of view (task 04B, docs/decisions.md D-04B-01).
import {
  PERMISSION_CATALOG,
  SYSTEM_ROLES,
  type PermissionKey,
} from '@lead-fennec-ai/shared';
import { z } from 'zod';
import {
  Prisma,
  type PrismaClient,
  type TenantStatus,
} from '../generated/prisma/client.js';
import {
  ActorNotAllowedError,
  uuidSchema,
  type MemberActor,
} from './actors.js';
import { writeAuditRecord, type DbClient } from './audit.js';

/** The slug is already used by another workspace (slugs are unique across the platform). */
export class SlugTakenError extends Error {
  constructor() {
    super('This workspace address is already taken');
    this.name = 'SlugTakenError';
  }
}

export const workspaceSlugSchema = z
  .string()
  .min(3)
  .max(63)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

const createWorkspaceSchema = z
  .object({
    userId: uuidSchema,
    name: z.string().trim().min(1).max(100),
    slug: workspaceSlugSchema,
  })
  .strict();

export interface WorkspaceRole {
  readonly id: string;
  readonly key: string;
  readonly name: string;
}

export interface UserWorkspace {
  readonly workspace: {
    readonly id: string;
    readonly slug: string;
    readonly name: string;
    readonly status: TenantStatus;
    readonly createdAt: Date;
  };
  readonly membership: {
    readonly id: string;
    readonly role: WorkspaceRole;
    readonly permissions: PermissionKey[];
  };
}

/**
 * Adds missing catalog permissions to the `permissions` table (idempotent). The catalog in
 * @lead-fennec-ai/shared is the source; this table only lets role_permissions reference it.
 */
export async function syncPermissionCatalog(db: DbClient): Promise<void> {
  await db.permission.createMany({
    data: PERMISSION_CATALOG.map(({ key, description }) => ({
      key,
      description,
    })),
    skipDuplicates: true,
  });
}

/**
 * Creates a workspace with its settings and system roles, and makes the creator its first
 * Client Admin; one transaction, audited in the new workspace. Only an active user with a
 * verified address can create one.
 */
export async function createWorkspace(
  prisma: PrismaClient,
  input: z.input<typeof createWorkspaceSchema>,
  now: Date = new Date(),
): Promise<UserWorkspace> {
  const { userId, name, slug } = createWorkspaceSchema.parse(input);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { status: true, emailVerifiedAt: true },
  });
  if (user?.status !== 'ACTIVE' || user.emailVerifiedAt === null) {
    throw new ActorNotAllowedError('workspaces.create');
  }
  try {
    return await prisma.$transaction(async (tx) => {
      await syncPermissionCatalog(tx);
      const tenant = await tx.tenant.create({
        data: { slug, name, createdAt: now },
      });
      const tenantId = tenant.id;
      await tx.tenantSettings.create({ data: { tenantId } });
      const roles: Partial<Record<string, WorkspaceRole>> = {};
      for (const role of Object.values(SYSTEM_ROLES)) {
        const created = await tx.role.create({
          data: { tenantId, key: role.key, name: role.name, isSystem: true },
          select: { id: true, key: true, name: true },
        });
        roles[role.key] = created;
        await tx.rolePermission.createMany({
          data: role.permissions.map((permissionKey) => ({
            tenantId,
            roleId: created.id,
            permissionKey,
          })),
        });
      }
      const adminRole = roles[SYSTEM_ROLES.client_admin.key];
      if (adminRole === undefined) {
        throw new Error('client_admin role missing');
      }
      const membership = await tx.membership.create({
        data: { tenantId, userId, roleId: adminRole.id, status: 'ACTIVE' },
        select: { id: true },
      });
      const actor: MemberActor = {
        kind: 'member',
        userId,
        membershipId: membership.id,
        roleId: adminRole.id,
        permissions: new Set(SYSTEM_ROLES.client_admin.permissions),
      };
      await writeAuditRecord(tx, tenantId, actor, {
        action: 'workspace.created',
        targetType: 'tenant',
        targetId: tenantId,
      });
      return {
        workspace: {
          id: tenant.id,
          slug: tenant.slug,
          name: tenant.name,
          status: tenant.status,
          createdAt: tenant.createdAt,
        },
        membership: {
          id: membership.id,
          role: adminRole,
          permissions: [...SYSTEM_ROLES.client_admin.permissions].sort(),
        },
      };
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new SlugTakenError();
    }
    throw error;
  }
}

/** The user's active memberships in active workspaces, oldest workspace first. */
export async function listUserWorkspaces(
  prisma: PrismaClient,
  userId: string,
): Promise<UserWorkspace[]> {
  const memberships = await prisma.membership.findMany({
    where: {
      userId: uuidSchema.parse(userId),
      status: 'ACTIVE',
      tenant: { status: 'ACTIVE' },
    },
    orderBy: { tenantId: 'asc' },
    select: {
      id: true,
      tenant: {
        select: {
          id: true,
          slug: true,
          name: true,
          status: true,
          createdAt: true,
        },
      },
      role: {
        select: {
          id: true,
          key: true,
          name: true,
          permissions: { select: { permissionKey: true } },
        },
      },
    },
  });
  return memberships.map(({ id, tenant, role }) => ({
    workspace: tenant,
    membership: {
      id,
      role: { id: role.id, key: role.key, name: role.name },
      permissions: role.permissions
        .map((p) => p.permissionKey)
        .sort() as PermissionKey[],
    },
  }));
}
