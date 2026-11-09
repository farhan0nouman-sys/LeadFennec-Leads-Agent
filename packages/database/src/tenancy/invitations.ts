// Team invitations (task 04B, docs/decisions.md D-04B-03). An invitation is bound to one
// workspace and one email address, expires and is used once. The emailed link holds a random
// token; only its SHA-256 is stored, and the caller (the API) creates the token.
import {
  ADMIN_ROLE_KEY,
  IdentityNormalizationError,
  normalizeEmail,
} from '@lead-fennec-ai/shared';
import { z } from 'zod';
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { paginate, type Page, type PageRequest } from '../pagination.js';
import { uuidSchema, type MemberActor, type TenantActor } from './actors.js';
import { writeAuditRecord } from './audit.js';
import {
  RecordNotFoundError,
  requirePermission,
  requireReadPermission,
} from './authorization.js';
import type { WorkspaceRole } from './workspaces.js';

/** The address already belongs to an active member of the workspace. */
export class AlreadyMemberError extends Error {
  constructor() {
    super('This person is already a member of the workspace');
    this.name = 'AlreadyMemberError';
  }
}

/**
 * Why an invitation cannot be shown or accepted. `invalid` covers unknown, used, revoked and
 * expired invitations and inactive workspaces alike, so a token reveals nothing more.
 */
export type InvitationFailure =
  'invalid' | 'identity_mismatch' | 'workspace_mismatch' | 'already_member';

export class InvitationError extends Error {
  constructor(readonly reason: InvitationFailure) {
    super(`Invitation cannot be used: ${reason}`);
    this.name = 'InvitationError';
  }
}

export interface InvitationView {
  readonly id: string;
  readonly email: string;
  readonly role: WorkspaceRole;
  readonly invitedBy: { readonly displayName: string | null };
  readonly expiresAt: Date;
  readonly createdAt: Date;
}

const INVITATION_SELECT = {
  id: true,
  email: true,
  expiresAt: true,
  createdAt: true,
  role: { select: { id: true, key: true, name: true } },
  invitedBy: { select: { user: { select: { displayName: true } } } },
} as const;

type SelectedInvitation = Prisma.InvitationGetPayload<{
  select: typeof INVITATION_SELECT;
}>;

function toView(row: SelectedInvitation): InvitationView {
  const { invitedBy, ...rest } = row;
  return { ...rest, invitedBy: { displayName: invitedBy.user.displayName } };
}

const tokenHashSchema = z.string().regex(/^[0-9a-f]{64}$/);

function normalizable(email: string): boolean {
  try {
    normalizeEmail(email);
    return true;
  } catch (error) {
    if (error instanceof IdentityNormalizationError) {
      return false;
    }
    throw error;
  }
}

const createSchema = z
  .object({
    email: z
      .string()
      .trim()
      .min(3)
      .max(254)
      .refine(normalizable, 'Enter a valid email address.'),
    roleId: uuidSchema,
    tokenHash: tokenHashSchema,
    expiresAt: z.date(),
  })
  .strict();

export interface InvitationRepository {
  /**
   * Invites an address with a role of this workspace (members.manage). An open invitation for
   * the same address is revoked first, so only the newest link works.
   */
  create(input: z.input<typeof createSchema>): Promise<InvitationView>;
  /** Open invitations (neither accepted nor revoked), newest first (members.read). */
  listOpen(page: PageRequest): Promise<Page<InvitationView>>;
  /** Revokes an open invitation of this workspace (members.manage). */
  revoke(invitationId: string): Promise<void>;
}

export function createInvitationRepository(
  prisma: PrismaClient,
  tenantId: string,
  actor: TenantActor,
  now: () => Date,
): InvitationRepository {
  return {
    async create(input) {
      const manager = requirePermission(actor, 'members.manage');
      const { email, roleId, tokenHash, expiresAt } = createSchema.parse(input);
      const normalized = normalizeEmail(email).email;
      const createdAt = now();
      return prisma.$transaction(async (tx) => {
        const role = await tx.role.findUnique({
          where: { tenantId_id: { tenantId, id: roleId } },
          select: { id: true },
        });
        if (role === null) {
          throw new RecordNotFoundError('role');
        }
        const activeMember = await tx.membership.count({
          where: {
            tenantId,
            status: 'ACTIVE',
            user: { normalizedEmail: normalized },
          },
        });
        if (activeMember > 0) {
          throw new AlreadyMemberError();
        }
        await tx.invitation.updateMany({
          where: {
            tenantId,
            normalizedEmail: normalized,
            acceptedAt: null,
            revokedAt: null,
          },
          data: { revokedAt: createdAt },
        });
        const invitation = await tx.invitation.create({
          data: {
            tenantId,
            email,
            normalizedEmail: normalized,
            roleId,
            invitedByMembershipId: manager.membershipId,
            tokenHash,
            expiresAt,
            createdAt,
          },
          select: INVITATION_SELECT,
        });
        await writeAuditRecord(tx, tenantId, manager, {
          action: 'invitation.created',
          targetType: 'invitation',
          targetId: invitation.id,
          metadata: { role: invitation.role.key },
        });
        return toView(invitation);
      });
    },

    async listOpen(page) {
      requireReadPermission(actor, 'members.read');
      return paginate(page, async (keyset) =>
        (
          await prisma.invitation.findMany({
            where: {
              tenantId,
              acceptedAt: null,
              revokedAt: null,
              ...keyset.cursorWhere,
            },
            orderBy: keyset.orderBy,
            take: keyset.take,
            select: INVITATION_SELECT,
          })
        ).map(toView),
      );
    },

    async revoke(rawInvitationId) {
      const manager = requirePermission(actor, 'members.manage');
      const id = uuidSchema.parse(rawInvitationId);
      await prisma.$transaction(async (tx) => {
        const { count } = await tx.invitation.updateMany({
          where: { tenantId, id, acceptedAt: null, revokedAt: null },
          data: { revokedAt: now() },
        });
        if (count !== 1) {
          throw new RecordNotFoundError('invitation');
        }
        await writeAuditRecord(tx, tenantId, manager, {
          action: 'invitation.revoked',
          targetType: 'invitation',
          targetId: id,
        });
      });
    },
  };
}

// ─── Used by the invitee, with only a token ──────────────────────────────────

export interface InvitationPreview {
  readonly workspace: { readonly id: string; readonly name: string };
  readonly role: { readonly key: string; readonly name: string };
  readonly invitedBy: { readonly displayName: string | null };
  readonly expiresAt: Date;
}

/** An open, unexpired invitation of an active workspace, or `invalid`. */
async function findUsable(
  db: Prisma.TransactionClient | PrismaClient,
  tokenHash: string,
  now: Date,
) {
  const invitation = await db.invitation.findUnique({
    where: { tokenHash: tokenHashSchema.parse(tokenHash) },
    select: {
      tenantId: true,
      id: true,
      normalizedEmail: true,
      roleId: true,
      expiresAt: true,
      acceptedAt: true,
      revokedAt: true,
      tenant: { select: { name: true, status: true } },
      role: { select: { key: true, name: true } },
      invitedBy: { select: { user: { select: { displayName: true } } } },
    },
  });
  if (
    // Unknown (null), or already accepted.
    invitation?.acceptedAt !== null ||
    invitation.revokedAt !== null ||
    invitation.expiresAt <= now ||
    invitation.tenant.status !== 'ACTIVE'
  ) {
    throw new InvitationError('invalid');
  }
  return invitation;
}

/** Throws identity_mismatch unless `userId` is an active, verified user with the invited address. */
async function requireInvitee(
  db: Prisma.TransactionClient | PrismaClient,
  userId: string,
  normalizedEmail: string,
): Promise<void> {
  const user = await db.user.findUnique({
    where: { id: uuidSchema.parse(userId) },
    select: { normalizedEmail: true, status: true, emailVerifiedAt: true },
  });
  if (
    user?.status !== 'ACTIVE' ||
    user.emailVerifiedAt === null ||
    user.normalizedEmail !== normalizedEmail
  ) {
    throw new InvitationError('identity_mismatch');
  }
}

/** What the invitee is about to accept. Only the invited (signed-in) user may see it. */
export async function previewInvitation(
  prisma: PrismaClient,
  input: { tokenHash: string; userId: string },
  now: Date = new Date(),
): Promise<InvitationPreview> {
  const invitation = await findUsable(prisma, input.tokenHash, now);
  await requireInvitee(prisma, input.userId, invitation.normalizedEmail);
  return {
    workspace: { id: invitation.tenantId, name: invitation.tenant.name },
    role: invitation.role,
    invitedBy: { displayName: invitation.invitedBy.user.displayName },
    expiresAt: invitation.expiresAt,
  };
}

/**
 * Accepts an invitation for the signed-in user: the token must be open and unexpired, the
 * workspace the one the user confirmed, and the user the invited address. Creates the
 * membership (or reactivates a suspended one) with the invited role, marks the invitation used
 * and audits it, in one transaction.
 */
export async function acceptInvitation(
  prisma: PrismaClient,
  input: { tokenHash: string; workspaceId: string; userId: string },
  now: Date = new Date(),
): Promise<{ readonly workspaceId: string; readonly membershipId: string }> {
  const workspaceId = uuidSchema.parse(input.workspaceId);
  try {
    return await prisma.$transaction(async (tx) => {
      const invitation = await findUsable(tx, input.tokenHash, now);
      if (invitation.tenantId !== workspaceId) {
        throw new InvitationError('workspace_mismatch');
      }
      await requireInvitee(tx, input.userId, invitation.normalizedEmail);
      const tenantId = invitation.tenantId;
      const existing = await tx.membership.findUnique({
        where: { tenantId_userId: { tenantId, userId: input.userId } },
        select: { id: true, status: true },
      });
      if (existing?.status === 'ACTIVE') {
        throw new InvitationError('already_member');
      }
      const membership =
        existing === null
          ? await tx.membership.create({
              data: {
                tenantId,
                userId: input.userId,
                roleId: invitation.roleId,
                status: 'ACTIVE',
              },
              select: { id: true },
            })
          : await tx.membership.update({
              where: { tenantId_id: { tenantId, id: existing.id } },
              data: { roleId: invitation.roleId, status: 'ACTIVE' },
              select: { id: true },
            });
      // Single use: only an invitation still open at this instant can be accepted.
      const { count } = await tx.invitation.updateMany({
        where: {
          tenantId,
          id: invitation.id,
          acceptedAt: null,
          revokedAt: null,
        },
        data: { acceptedAt: now, acceptedMembershipId: membership.id },
      });
      if (count !== 1) {
        throw new InvitationError('invalid');
      }
      const permissions = await tx.rolePermission.findMany({
        where: { tenantId, roleId: invitation.roleId },
        select: { permissionKey: true },
      });
      const actor: MemberActor = {
        kind: 'member',
        userId: input.userId,
        membershipId: membership.id,
        roleId: invitation.roleId,
        permissions: new Set(permissions.map((p) => p.permissionKey)),
      };
      await writeAuditRecord(tx, tenantId, actor, {
        action: 'invitation.accepted',
        targetType: 'invitation',
        targetId: invitation.id,
        metadata: {
          role: invitation.role.key,
          admin: invitation.role.key === ADMIN_ROLE_KEY,
        },
      });
      return { workspaceId: tenantId, membershipId: membership.id };
    });
  } catch (error) {
    // Accepted concurrently by another request of the same user.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new InvitationError('already_member');
    }
    throw error;
  }
}
