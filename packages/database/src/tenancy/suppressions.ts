// The do-not-contact list and deletion requests (task 11C, docs/decisions.md D-11C-03 and
// D-11C-04, docs/security/data-retention.md).
// - Members with suppressions.manage list the workspace's entries, add an address or a whole
//   domain (and its subdomains), and remove only entries a member added by hand: a person's
//   request, a bounce or a complaint stays. A new entry reopens the leads it covers in the same
//   transaction (markLeadsStale: drafts invalidated, scheduled sends cancelled, decisions back to
//   Review with eligibility decided again, which blocks them).
// - A deletion request (suppressions.manage and contacts.write) erases a person: their contact
//   and everything about them (by the foreign keys' cascades: sources, evidence, checks, scores,
//   decisions, campaign leads with their drafts, sends and replies, list memberships, notes,
//   tags) and the import and search records that name their address. Only the address stays, on
//   the list (DELETION_REQUEST, without a note), so they are never imported or contacted again.
// Writes to the list take the workspace's contacts lock (saveContacts' own), so an import that
// runs at the same time sees the new entry. Audit records never hold an address or a note.
// Every query filters by tenantId.
import {
  SUPPRESSION_LIMITS,
  addSuppressionRequestSchema,
  deletionRequestSchema,
  leadDeletionRequestSchema,
  leadSuppressRequestSchema,
  normalizeSuppressionValue,
  suppressionListQuerySchema,
  type DeletionResult,
  type LeadDetail,
  type Suppression,
  type SuppressionKind,
} from '@lead-fennec-ai/shared';
import type { z } from 'zod';
import type {
  Prisma,
  PrismaClient,
  Suppression as SuppressionRow,
  SuppressionReason,
} from '../generated/prisma/client.js';
import { paginate, type Page } from '../pagination.js';
import { uuidSchema, type MemberActor, type TenantActor } from './actors.js';
import { writeAuditRecord } from './audit.js';
import {
  RecordNotFoundError,
  requirePermission,
  requireReadPermission,
} from './authorization.js';
import { LeadVersionConflictError } from './lead-changes.js';
import { markLeadsStale } from './lead-staleness.js';

/** The entry came from a person's request, a bounce or a complaint: it stays. */
export class SuppressionNotRemovableError extends Error {
  constructor() {
    super('This suppression cannot be removed');
    this.name = 'SuppressionNotRemovableError';
  }
}

/** The lead has no address to put on the list. */
export class LeadHasNoAddressError extends Error {
  constructor() {
    super('The lead has no email address');
    this.name = 'LeadHasNoAddressError';
  }
}

/** An entry as the contract describes it, with a Date timestamp. */
export type SuppressionView = Omit<Suppression, 'createdAt'> & {
  readonly createdAt: Date;
};

export interface SuppressionRepository {
  /** The list, newest first (suppressions.manage). */
  list(
    query: z.input<typeof suppressionListQuerySchema>,
  ): Promise<Page<SuppressionView>>;
  /** Adds an address or a domain; repeating it changes nothing (suppressions.manage). */
  add(input: z.input<typeof addSuppressionRequestSchema>): Promise<{
    readonly suppression: SuppressionView;
    readonly created: boolean;
    readonly reopenedLeads: number;
  }>;
  /** Removes an entry a member added by hand (suppressions.manage). */
  remove(suppressionId: string): Promise<void>;
  /** Puts a lead's own address on the list (suppressions.manage). */
  suppressLead(
    contactId: string,
    input: z.input<typeof leadSuppressRequestSchema>,
  ): Promise<LeadDetail>;
  /** Erases a lead at the version the member saw (suppressions.manage and contacts.write). */
  deleteLead(
    contactId: string,
    input: z.input<typeof leadDeletionRequestSchema>,
  ): Promise<DeletionResult>;
  /** Erases a person by their address (suppressions.manage and contacts.write). */
  deletePerson(
    input: z.input<typeof deletionRequestSchema>,
  ): Promise<DeletionResult>;
}

const REOPENED =
  'The address is now on the do-not-contact list. It can no longer be emailed.';

const kindOf = (row: SuppressionRow): SuppressionKind =>
  row.normalizedEmail === null ? 'domain' : 'email';

const toView = (row: SuppressionRow): SuppressionView => ({
  id: row.id,
  kind: kindOf(row),
  value: row.normalizedEmail ?? row.normalizedDomain ?? '',
  reason: row.reason,
  source: row.source,
  note: row.note,
  createdAt: row.createdAt,
  removable: row.reason === 'MANUAL' && row.source === 'MANUAL',
});

export function createSuppressionRepository(
  prisma: PrismaClient,
  tenantId: string,
  actor: TenantActor,
  now: () => Date,
  detail: (contactId: string) => Promise<LeadDetail>,
): SuppressionRepository {
  const contactIdOrNotFound = (rawId: string) => {
    const parsed = uuidSchema.safeParse(rawId);
    if (!parsed.success) {
      throw new RecordNotFoundError('contact');
    }
    return parsed.data;
  };

  /** The workspace's contacts lock (saveContacts takes it too). */
  const lockContacts = (tx: Prisma.TransactionClient) =>
    tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contacts:${tenantId}`}, 0))`;

  /**
   * The entry for an address or a domain, created when missing. Returns whether it was created
   * and the workspace's leads it covers (at most SUPPRESSION_LIMITS.staleLeads).
   */
  async function ensure(
    tx: Prisma.TransactionClient,
    kind: SuppressionKind,
    value: string,
    reason: SuppressionReason,
    note: string | null,
  ): Promise<{ row: SuppressionRow; created: boolean }> {
    const existing = await tx.suppression.findUnique({
      where:
        kind === 'email'
          ? { tenantId_normalizedEmail: { tenantId, normalizedEmail: value } }
          : {
              tenantId_normalizedDomain: {
                tenantId,
                normalizedDomain: value,
              },
            },
    });
    if (existing !== null) {
      return { row: existing, created: false };
    }
    const row = await tx.suppression.create({
      data: {
        tenantId,
        ...(kind === 'email'
          ? { normalizedEmail: value }
          : { normalizedDomain: value }),
        reason,
        source: 'MANUAL',
        note,
        createdAt: now(),
      },
    });
    return { row, created: true };
  }

  /** The leads an entry covers: the address, or every address at the domain or below it. */
  async function covered(
    tx: Prisma.TransactionClient,
    kind: SuppressionKind,
    value: string,
  ): Promise<string[]> {
    const rows = await tx.contact.findMany({
      where:
        kind === 'email'
          ? { tenantId, normalizedEmail: value }
          : {
              tenantId,
              OR: [
                { emailDomain: value },
                { emailDomain: { endsWith: `.${value}` } },
              ],
            },
      orderBy: { id: 'asc' },
      take: SUPPRESSION_LIMITS.staleLeads,
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  /** Erases a person and the records naming their address; keeps the address on the list. */
  async function erase(
    tx: Prisma.TransactionClient,
    member: MemberActor,
    contactId: string | null,
    email: string | null,
  ): Promise<DeletionResult> {
    await lockContacts(tx);
    let suppressionId: string | null = null;
    if (email !== null) {
      const { row } = await ensure(
        tx,
        'email',
        email,
        'DELETION_REQUEST',
        null,
      );
      // Only what honors the request stays: an earlier entry keeps its reason, not its note.
      if (row.note !== null) {
        await tx.suppression.update({
          where: { tenantId_id: { tenantId, id: row.id } },
          data: { note: null },
        });
      }
      suppressionId = row.id;
    }
    // Records that name the address without being the person's own (excluded or failed rows).
    const records =
      email === null
        ? { count: 0 }
        : await tx.sourceRecord.deleteMany({
            where: {
              tenantId,
              contactId: null,
              payload: { path: ['email'], equals: email },
            },
          });
    // The person, and everything about them (the foreign keys cascade).
    const contacts =
      contactId === null
        ? { count: 0 }
        : await tx.contact.deleteMany({ where: { tenantId, id: contactId } });
    const result: DeletionResult = {
      suppressionId,
      deleted: { contacts: contacts.count, sourceRecords: records.count },
    };
    // Counts only: never the address.
    await writeAuditRecord(tx, tenantId, member, {
      action: 'privacy.deletion_request_completed',
      targetType: 'suppression',
      ...(suppressionId === null ? {} : { targetId: suppressionId }),
      metadata: {
        contacts: result.deleted.contacts,
        sourceRecords: result.deleted.sourceRecords,
        addressKept: suppressionId !== null,
      },
    });
    return result;
  }

  return {
    async list(rawQuery) {
      requireReadPermission(actor, 'suppressions.manage');
      const query = suppressionListQuerySchema.parse(rawQuery);
      const text = query.q?.toLowerCase();
      const page = await paginate(
        {
          ...(query.limit === undefined
            ? { limit: SUPPRESSION_LIMITS.pageSize }
            : { limit: query.limit }),
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        },
        (keyset) =>
          prisma.suppression.findMany({
            where: {
              tenantId,
              ...(query.kind === 'email'
                ? { normalizedEmail: { not: null } }
                : query.kind === 'domain'
                  ? { normalizedDomain: { not: null } }
                  : {}),
              ...(text === undefined
                ? {}
                : {
                    OR: [
                      { normalizedEmail: { contains: text } },
                      { normalizedDomain: { contains: text } },
                    ],
                  }),
              ...keyset.cursorWhere,
            },
            orderBy: keyset.orderBy,
            take: keyset.take,
          }),
      );
      return { nextCursor: page.nextCursor, items: page.items.map(toView) };
    },

    async add(rawInput) {
      const member = requirePermission(actor, 'suppressions.manage');
      const input = addSuppressionRequestSchema.parse(rawInput);
      const value = normalizeSuppressionValue(input.kind, input.value);
      if (value === null) {
        throw new Error('The value was validated by the schema');
      }
      return prisma.$transaction(
        async (tx) => {
          await lockContacts(tx);
          const { row, created } = await ensure(
            tx,
            input.kind,
            value,
            input.reason ?? 'MANUAL',
            input.note ?? null,
          );
          if (!created) {
            return {
              suppression: toView(row),
              created: false,
              reopenedLeads: 0,
            };
          }
          const ids = await covered(tx, input.kind, value);
          const stale = await markLeadsStale(tx, tenantId, ids, now(), {
            recomputeEligibility: true,
            message: REOPENED,
          });
          await writeAuditRecord(tx, tenantId, member, {
            action: 'suppression.added',
            targetType: 'suppression',
            targetId: row.id,
            metadata: {
              kind: input.kind,
              reason: row.reason,
              leads: ids.length,
              decisionsReopened: stale.decisions,
              draftsInvalidated: stale.drafts,
              sendsCancelled: stale.intents,
            },
          });
          return {
            suppression: toView(row),
            created: true,
            reopenedLeads: ids.length,
          };
        },
        { timeout: 60_000, maxWait: 10_000 },
      );
    },

    async remove(rawId) {
      const member = requirePermission(actor, 'suppressions.manage');
      const parsed = uuidSchema.safeParse(rawId);
      if (!parsed.success) {
        throw new RecordNotFoundError('suppression');
      }
      const id = parsed.data;
      await prisma.$transaction(async (tx) => {
        await lockContacts(tx);
        const row = await tx.suppression.findUnique({
          where: { tenantId_id: { tenantId, id } },
        });
        if (row === null) {
          throw new RecordNotFoundError('suppression');
        }
        if (!toView(row).removable) {
          throw new SuppressionNotRemovableError();
        }
        await tx.suppression.delete({
          where: { tenantId_id: { tenantId, id } },
        });
        await writeAuditRecord(tx, tenantId, member, {
          action: 'suppression.removed',
          targetType: 'suppression',
          targetId: id,
          metadata: { kind: kindOf(row), reason: row.reason },
        });
      });
    },

    async suppressLead(rawId, rawInput) {
      const member = requirePermission(actor, 'suppressions.manage');
      const input = leadSuppressRequestSchema.parse(rawInput);
      const id = contactIdOrNotFound(rawId);
      await prisma.$transaction(
        async (tx) => {
          await lockContacts(tx);
          const contact = await tx.contact.findUnique({
            where: { tenantId_id: { tenantId, id } },
            select: { normalizedEmail: true },
          });
          if (contact === null) {
            throw new RecordNotFoundError('contact');
          }
          if (contact.normalizedEmail === null) {
            throw new LeadHasNoAddressError();
          }
          const { row, created } = await ensure(
            tx,
            'email',
            contact.normalizedEmail,
            input.reason,
            input.note ?? null,
          );
          if (!created) {
            return;
          }
          const ids = await covered(tx, 'email', contact.normalizedEmail);
          const stale = await markLeadsStale(tx, tenantId, ids, now(), {
            recomputeEligibility: true,
            message: REOPENED,
          });
          await writeAuditRecord(tx, tenantId, member, {
            action: 'suppression.added',
            targetType: 'suppression',
            targetId: row.id,
            metadata: {
              kind: 'email',
              reason: row.reason,
              contactId: id,
              leads: ids.length,
              decisionsReopened: stale.decisions,
              draftsInvalidated: stale.drafts,
              sendsCancelled: stale.intents,
            },
          });
        },
        { timeout: 60_000, maxWait: 10_000 },
      );
      return detail(id);
    },

    async deleteLead(rawId, rawInput) {
      const member = requirePermission(actor, 'suppressions.manage');
      requirePermission(actor, 'contacts.write');
      const input = leadDeletionRequestSchema.parse(rawInput);
      const id = contactIdOrNotFound(rawId);
      return prisma.$transaction(
        async (tx) => {
          // The contacts lock first, then the row: the order saveContacts uses.
          await lockContacts(tx);
          await tx.$queryRaw`SELECT id FROM contacts WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
          const contact = await tx.contact.findUnique({
            where: { tenantId_id: { tenantId, id } },
            select: { normalizedEmail: true, version: true },
          });
          if (contact === null) {
            throw new RecordNotFoundError('contact');
          }
          if (contact.version !== input.version) {
            throw new LeadVersionConflictError();
          }
          return erase(tx, member, id, contact.normalizedEmail);
        },
        { timeout: 60_000, maxWait: 10_000 },
      );
    },

    async deletePerson(rawInput) {
      const member = requirePermission(actor, 'suppressions.manage');
      requirePermission(actor, 'contacts.write');
      const input = deletionRequestSchema.parse(rawInput);
      const email = normalizeSuppressionValue('email', input.email);
      if (email === null) {
        throw new Error('The address was validated by the schema');
      }
      return prisma.$transaction(
        async (tx) => {
          const contact = await tx.contact.findUnique({
            where: {
              tenantId_normalizedEmail: { tenantId, normalizedEmail: email },
            },
            select: { id: true },
          });
          return erase(tx, member, contact?.id ?? null, email);
        },
        { timeout: 60_000, maxWait: 10_000 },
      );
    },
  };
}
