// Audit records: who did what in a tenant (docs/decisions.md D-03C-05). Rows are immutable and
// written in the same transaction as the change they describe.
import { z } from 'zod';
import type {
  AuditRecord,
  Prisma,
  PrismaClient,
} from '../generated/prisma/client.js';
import { paginate, type Page, type PageRequest } from '../pagination.js';
import {
  dottedKeySchema,
  snakeKeySchema,
  uuidSchema,
  type TenantActor,
} from './actors.js';

/** A client or an interactive-transaction client. */
export type DbClient = PrismaClient | Prisma.TransactionClient;

const auditEntrySchema = z
  .object({
    action: dottedKeySchema,
    targetType: snakeKeySchema.optional(),
    targetId: uuidSchema.optional(),
    /** Members may give a reason; platform admins always have one (their access reason). */
    reason: z.string().trim().min(1).max(1000).optional(),
  })
  .strict()
  .refine((e) => e.targetId === undefined || e.targetType !== undefined, {
    message: 'targetId needs targetType',
  });

export interface AuditEntry {
  /** Dotted key, e.g. "limit_override.set". */
  readonly action: string;
  readonly targetType?: string;
  readonly targetId?: string;
  readonly reason?: string;
  /** Must not contain secrets, personal data or message content. */
  readonly metadata?: Prisma.InputJsonObject;
}

function actorColumns(actor: TenantActor) {
  switch (actor.kind) {
    case 'member':
      return {
        actorType: 'MEMBER' as const,
        actorUserId: actor.userId,
        actorMembershipId: actor.membershipId,
      };
    case 'platform_admin':
      return {
        actorType: 'PLATFORM_ADMIN' as const,
        actorUserId: actor.userId,
        ...(actor.requestId === undefined
          ? {}
          : { requestId: actor.requestId }),
      };
    case 'system':
      return { actorType: 'SYSTEM' as const, actorName: actor.name };
  }
}

/** Writes one audit record for `actor` in `tenantId`, using `db` (pass a transaction client). */
export async function writeAuditRecord(
  db: DbClient,
  tenantId: string,
  actor: TenantActor,
  entry: AuditEntry,
): Promise<AuditRecord> {
  const { metadata, ...fields } = entry;
  const valid = auditEntrySchema.parse(fields);
  // A platform admin's record always carries a reason: the action's own, else the access reason.
  const reason =
    valid.reason ?? (actor.kind === 'platform_admin' ? actor.reason : null);
  return db.auditRecord.create({
    data: {
      tenantId,
      action: valid.action,
      targetType: valid.targetType ?? null,
      targetId: valid.targetId ?? null,
      reason,
      ...actorColumns(actor),
      ...(metadata === undefined ? {} : { metadata }),
    },
  });
}

export interface AuditRepository {
  record(entry: AuditEntry): Promise<AuditRecord>;
  /** Newest first; optionally only the records about one row. */
  list(
    page: PageRequest,
    filter?: { readonly targetType: string; readonly targetId: string },
  ): Promise<Page<AuditRecord>>;
}

export function createAuditRepository(
  prisma: PrismaClient,
  tenantId: string,
  actor: TenantActor,
): AuditRepository {
  return {
    record: (entry) => writeAuditRecord(prisma, tenantId, actor, entry),
    list: async (page, filter) => {
      const target =
        filter === undefined
          ? {}
          : {
              targetType: snakeKeySchema.parse(filter.targetType),
              targetId: uuidSchema.parse(filter.targetId),
            };
      return paginate(page, (keyset) =>
        prisma.auditRecord.findMany({
          where: { tenantId, ...target, ...keyset.cursorWhere },
          orderBy: keyset.orderBy,
          take: keyset.take,
        }),
      );
    },
  };
}
