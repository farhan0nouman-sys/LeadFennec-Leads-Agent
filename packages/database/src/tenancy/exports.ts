// Lead exports (task 11C, docs/decisions.md D-11C-02, docs/security/data-retention.md). A member
// with contacts.export makes a CSV file of a lead search:
// - the leads are read through scope.leads.search, page by page, so the search's own permission
//   checks (contacts.read, and scores.read or campaigns.read for those filters) apply;
// - at most EXPORT_LIMITS.maxRows leads and maxBytes bytes: more are cut, and the export says so;
// - every cell goes through toCsv (leadExportCsv), so nothing can run as a spreadsheet formula;
// - only the member who made it can list or download it, while they keep the permission, until
//   it expires (EXPORT_LIMITS.ttlHours); then its content is deleted (purgeExpired, run by the
//   worker's retention sweep and before every new export).
// Exports and downloads are audited without the search text or any lead's data. Every query
// filters by tenantId.
import {
  EXPORT_LIMITS,
  leadExportCsv,
  leadExportRequestSchema,
  type LeadSearchItem,
} from '@lead-fennec-ai/shared';
import type { z } from 'zod';
import type {
  Export,
  Prisma,
  PrismaClient,
} from '../generated/prisma/client.js';
import { paginate, type Page, type PageRequest } from '../pagination.js';
import { payloadSha256 } from '../payload-hash.js';
import {
  ActorNotAllowedError,
  uuidSchema,
  type TenantActor,
} from './actors.js';
import { writeAuditRecord } from './audit.js';
import { RecordNotFoundError, requirePermission } from './authorization.js';
import type { LeadSearchRepository } from './lead-search.js';

/** The member already has the most files waiting; one must expire first. */
export class ExportLimitError extends Error {
  constructor() {
    super('Too many exports are waiting');
    this.name = 'ExportLimitError';
  }
}

/** The file expired: its content is deleted. */
export class ExportExpiredError extends Error {
  constructor() {
    super('The export expired');
    this.name = 'ExportExpiredError';
  }
}

/** An export as the contract describes it, with Date timestamps. */
export interface ExportView {
  readonly id: string;
  readonly kind: 'LEADS';
  readonly status: 'READY' | 'EXPIRED';
  readonly fileName: string;
  readonly rowCount: number;
  readonly truncated: boolean;
  readonly byteSize: number;
  readonly filters: Readonly<Record<string, string>>;
  readonly createdAt: Date;
  readonly expiresAt: Date;
  readonly downloadedAt: Date | null;
  readonly downloadCount: number;
}

export interface ExportFile {
  readonly fileName: string;
  readonly content: string;
}

export interface ExportRepository {
  /** Makes a file of the leads a search finds (contacts.export, members only). Audited. */
  createLeadExport(
    input: z.input<typeof leadExportRequestSchema>,
  ): Promise<ExportView>;
  /** The member's own files, newest first (contacts.export, members only). */
  list(page: PageRequest): Promise<Page<ExportView>>;
  /** The member's own file while it hasn't expired (contacts.export, members only). Audited. */
  download(exportId: string): Promise<ExportFile>;
  /** Deletes the content of every file past its time (members and workers). */
  purgeExpired(): Promise<number>;
}

const HOUR_MS = 3_600_000;

const VIEW_SELECT = {
  id: true,
  kind: true,
  status: true,
  fileName: true,
  rowCount: true,
  truncated: true,
  byteSize: true,
  filters: true,
  createdAt: true,
  expiresAt: true,
  downloadedAt: true,
  downloadCount: true,
} as const satisfies Prisma.ExportSelect;

type ViewRow = Prisma.ExportGetPayload<{ select: typeof VIEW_SELECT }>;

const stringRecord = (value: unknown): Record<string, string> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
};

export function createExportRepository(
  prisma: PrismaClient,
  tenantId: string,
  actor: TenantActor,
  now: () => Date,
  leads: Pick<LeadSearchRepository, 'search'>,
): ExportRepository {
  /** A file past its time reads as expired, even before the sweep deleted its content. */
  const view = (row: ViewRow, at: Date): ExportView => ({
    id: row.id,
    kind: row.kind,
    status: row.status === 'READY' && row.expiresAt > at ? 'READY' : 'EXPIRED',
    fileName: row.fileName,
    rowCount: row.rowCount,
    truncated: row.truncated,
    byteSize: row.byteSize,
    filters: stringRecord(row.filters),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    downloadedAt: row.downloadedAt,
    downloadCount: row.downloadCount,
  });

  async function purge(
    db: Prisma.TransactionClient | PrismaClient,
  ): Promise<number> {
    const at = now();
    const { count } = await db.export.updateMany({
      where: { tenantId, status: 'READY', expiresAt: { lte: at } },
      data: { status: 'EXPIRED', content: null, purgedAt: at },
    });
    return count;
  }

  return {
    async createLeadExport(rawInput) {
      const member = requirePermission(actor, 'contacts.export');
      const input = leadExportRequestSchema.parse(rawInput);
      await purge(prisma);
      const waiting = await prisma.export.count({
        where: {
          tenantId,
          requestedByMembershipId: member.membershipId,
          status: 'READY',
        },
      });
      if (waiting >= EXPORT_LIMITS.maxLivePerMember) {
        throw new ExportLimitError();
      }

      // The leads, page by page through the search (its permissions apply), up to the limit.
      const items: LeadSearchItem[] = [];
      let cursor: string | undefined;
      let more: boolean;
      do {
        const page = await leads.search({
          ...input.filters,
          limit: EXPORT_LIMITS.pageSize,
          ...(cursor === undefined ? {} : { cursor }),
        });
        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
        more = cursor !== undefined;
      } while (more && items.length < EXPORT_LIMITS.maxRows);
      let kept = items.slice(0, EXPORT_LIMITS.maxRows);
      let truncated = items.length > EXPORT_LIMITS.maxRows || more;
      let content = leadExportCsv(kept);
      // Within the size limit too: the last leads are cut until it fits.
      while (
        Buffer.byteLength(content, 'utf8') > EXPORT_LIMITS.maxBytes &&
        kept.length > 0
      ) {
        kept = kept.slice(0, Math.floor(kept.length * 0.9));
        truncated = true;
        content = leadExportCsv(kept);
      }

      const at = now();
      const stamp = at
        .toISOString()
        .slice(0, 16)
        .replace(/[^0-9]/g, '');
      const filters = Object.fromEntries(
        Object.entries(input.filters)
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => [key, String(value)]),
      );
      return prisma.$transaction(async (tx) => {
        const row = await tx.export.create({
          data: {
            tenantId,
            kind: 'LEADS',
            requestedByMembershipId: member.membershipId,
            fileName: `leads-${stamp}.csv`,
            filters,
            rowCount: kept.length,
            truncated,
            byteSize: Buffer.byteLength(content, 'utf8'),
            contentSha256: payloadSha256({ content }),
            content,
            createdAt: at,
            expiresAt: new Date(
              at.getTime() + EXPORT_LIMITS.ttlHours * HOUR_MS,
            ),
          },
          select: VIEW_SELECT,
        });
        // Counts only: never the search text or a lead's data.
        await writeAuditRecord(tx, tenantId, member, {
          action: 'leads.exported',
          targetType: 'export',
          targetId: row.id,
          metadata: { rows: kept.length, truncated },
        });
        return view(row, at);
      });
    },

    async list(page) {
      const member = requirePermission(actor, 'contacts.export');
      const at = now();
      const result = await paginate(page, (keyset) =>
        prisma.export.findMany({
          where: {
            tenantId,
            requestedByMembershipId: member.membershipId,
            ...keyset.cursorWhere,
          },
          orderBy: keyset.orderBy,
          take: keyset.take,
          select: VIEW_SELECT,
        }),
      );
      return {
        nextCursor: result.nextCursor,
        items: result.items.map((row) => view(row, at)),
      };
    },

    async download(rawId) {
      const member = requirePermission(actor, 'contacts.export');
      const parsed = uuidSchema.safeParse(rawId);
      if (!parsed.success) {
        throw new RecordNotFoundError('export');
      }
      const id = parsed.data;
      const file = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM exports WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
        const row: Export | null = await tx.export.findUnique({
          where: { tenantId_id: { tenantId, id } },
        });
        // Another member's file reads exactly like a missing one.
        if (row?.requestedByMembershipId !== member.membershipId) {
          throw new RecordNotFoundError('export');
        }
        const at = now();
        if (
          row.status !== 'READY' ||
          row.content === null ||
          row.expiresAt <= at
        ) {
          if (row.status === 'READY') {
            await tx.export.update({
              where: { tenantId_id: { tenantId, id } },
              data: { status: 'EXPIRED', content: null, purgedAt: at },
            });
          }
          // Committed: an expired file's content is deleted even though the answer is 410.
          return null;
        }
        await tx.export.update({
          where: { tenantId_id: { tenantId, id } },
          data: { downloadCount: { increment: 1 }, downloadedAt: at },
        });
        await writeAuditRecord(tx, tenantId, member, {
          action: 'leads.export_downloaded',
          targetType: 'export',
          targetId: id,
        });
        return { fileName: row.fileName, content: row.content };
      });
      if (file === null) {
        throw new ExportExpiredError();
      }
      return file;
    },

    async purgeExpired() {
      if (actor.kind !== 'member' && actor.kind !== 'system') {
        throw new ActorNotAllowedError('exports.purge');
      }
      return prisma.$transaction(async (tx) => {
        const count = await purge(tx);
        if (count > 0 && actor.kind === 'system') {
          await writeAuditRecord(tx, tenantId, actor, {
            action: 'exports.purged',
            targetType: 'tenant',
            targetId: tenantId,
            metadata: { files: count },
          });
        }
        return count;
      });
    },
  };
}
