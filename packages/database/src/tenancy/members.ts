// The team of a workspace: members and roles (task 04B, docs/decisions.md D-04B-04).
import { ADMIN_ROLE_KEY, type PermissionKey } from '@lead-fennec-ai/shared';
import type {
  MembershipStatus,
  PrismaClient,
} from '../generated/prisma/client.js';
import { paginate, type Page, type PageRequest } from '../pagination.js';
import { uuidSchema, type TenantActor } from './actors.js';
import { writeAuditRecord } from './audit.js';
import {
  RecordNotFoundError,
  requirePermission,
  requireReadPermission,
} from './authorization.js';
import type { WorkspaceRole } from './workspaces.js';

/** The change would leave the workspace without an active Client Admin. */
export class LastAdminError extends Error {
  constructor() {
    super('A workspace needs at least one active Client Admin');
    this.name = 'LastAdminError';
  }
}

export interface Member {
  readonly id: string;
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly displayName: string | null;
  };
  readonly role: WorkspaceRole;
  readonly status: MembershipStatus;
  readonly createdAt: Date;
}

export interface RoleWithPermissions extends WorkspaceRole {
  readonly isSystem: boolean;
  readonly permissions: PermissionKey[];
}

const MEMBER_SELECT = {
  id: true,
  status: true,
  createdAt: true,
  user: { select: { id: true, email: true, displayName: true } },
  role: { select: { id: true, key: true, name: true } },
} as const;

export interface MemberRepository {
  /** Members of the workspace, newest first (members.read). */
  list(page: PageRequest): Promise<Page<Member>>;
  /** The workspace's roles and their permissions (members.read). */
  roles(): Promise<RoleWithPermissions[]>;
  /**
   * Gives a member another role of this workspace (members.manage). Both ids must belong to
   * the workspace. The last active Client Admin cannot lose that role.
   */
  changeRole(membershipId: string, roleId: string): Promise<Member>;
}

export function createMemberRepository(
  prisma: PrismaClient,
  tenantId: string,
  actor: TenantActor,
): MemberRepository {
  return {
    async list(page) {
      requireReadPermission(actor, 'members.read');
      return paginate(page, (keyset) =>
        prisma.membership.findMany({
          where: { tenantId, ...keyset.cursorWhere },
          orderBy: keyset.orderBy,
          take: keyset.take,
          select: MEMBER_SELECT,
        }),
      );
    },

    async roles() {
      requireReadPermission(actor, 'members.read');
      const roles = await prisma.role.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          key: true,
          name: true,
          isSystem: true,
          permissions: { select: { permissionKey: true } },
        },
      });
      return roles.map(({ permissions, ...role }) => ({
        ...role,
        permissions: permissions
          .map((p) => p.permissionKey)
          .sort() as PermissionKey[],
      }));
    },

    async changeRole(rawMembershipId, rawRoleId) {
      const manager = requirePermission(actor, 'members.manage');
      const membershipId = uuidSchema.parse(rawMembershipId);
      const roleId = uuidSchema.parse(rawRoleId);
      return prisma.$transaction(async (tx) => {
        // Serializes role changes per workspace, so two admins cannot demote each other at
        // the same moment and leave no admin.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`members:${tenantId}`}, 0))`;
        const member = await tx.membership.findUnique({
          where: { tenantId_id: { tenantId, id: membershipId } },
          select: MEMBER_SELECT,
        });
        if (member === null) {
          throw new RecordNotFoundError('membership');
        }
        const role = await tx.role.findUnique({
          where: { tenantId_id: { tenantId, id: roleId } },
          select: { id: true, key: true, name: true },
        });
        if (role === null) {
          throw new RecordNotFoundError('role');
        }
        if (member.role.id === role.id) {
          return member;
        }
        if (
          member.role.key === ADMIN_ROLE_KEY &&
          member.status === 'ACTIVE' &&
          role.key !== ADMIN_ROLE_KEY
        ) {
          const otherAdmins = await tx.membership.count({
            where: {
              tenantId,
              status: 'ACTIVE',
              role: { key: ADMIN_ROLE_KEY },
              id: { not: membershipId },
            },
          });
          if (otherAdmins === 0) {
            throw new LastAdminError();
          }
        }
        const updated = await tx.membership.update({
          where: { tenantId_id: { tenantId, id: membershipId } },
          data: { roleId: role.id },
          select: MEMBER_SELECT,
        });
        await writeAuditRecord(tx, tenantId, manager, {
          action: 'membership.role_changed',
          targetType: 'membership',
          targetId: membershipId,
          metadata: { from: member.role.key, to: role.key },
        });
        return updated;
      });
    },
  };
}
