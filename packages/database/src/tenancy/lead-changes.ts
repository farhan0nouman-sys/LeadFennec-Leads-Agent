// Lead profile changes (task 11B, docs/decisions.md D-11B-*): a member's corrections, tags, notes
// and assignment of a lead to a campaign.
// - Every change but a note names the lead's version (compare-and-set under a row lock): a stale
//   one is refused (LeadVersionConflictError, 409), and a successful one raises it.
// - A correction is validated (shapes by the shared schema; the address unique in the workspace;
//   the person still identifiable), kept with its reason as a note, and audited without the
//   values. A material one (name, title, address, country) makes the person's drafts, scheduled
//   sends and decisions stale in the same transaction (markLeadsStale).
// - An assignment needs campaigns.write and a campaign of this workspace that hasn't ended and has
//   a lead list. It is refused for a person who is archived, on the do-not-contact list or
//   excluded by the campaign (the eligibility rules' own reasons, decided from the facts now).
// Every query filters by tenantId.
import {
  leadAssignmentRequestSchema,
  leadCorrectionRequestSchema,
  leadNoteRequestSchema,
  leadTagsRequestSchema,
  LEAD_CORRECTION_FIELDS,
  MATERIAL_LEAD_FIELDS,
  normalizeContactIdentity,
  normalizeEmail,
  normalizeLinkedinUrl,
  type LeadCorrectionField,
  type LeadDetail,
  type PlanIssue,
  type SendEligibilityReasonCode,
} from '@lead-fennec-ai/shared';
import type { z } from 'zod';
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { uuidSchema, type TenantActor } from './actors.js';
import { writeAuditRecord } from './audit.js';
import { RecordNotFoundError, requirePermission } from './authorization.js';
import { markLeadsStale } from './lead-staleness.js';
import { evaluateEligibilityFacts } from './send-eligibility.js';

/** The lead changed since the version the change started from. */
export class LeadVersionConflictError extends Error {
  constructor() {
    super('The lead changed since this version');
    this.name = 'LeadVersionConflictError';
  }
}

/** Another lead of the workspace has this address. */
export class EmailTakenError extends Error {
  constructor() {
    super('Another lead has this address');
    this.name = 'EmailTakenError';
  }
}

/** The correction would leave the person unidentifiable; `issues` say why. */
export class LeadCorrectionError extends Error {
  constructor(readonly issues: readonly PlanIssue[]) {
    super('The correction is not valid');
    this.name = 'LeadCorrectionError';
  }
}

/** The lead can't be added to this campaign; `issues` say why. */
export class AssignmentNotPossibleError extends Error {
  constructor(readonly issues: readonly PlanIssue[]) {
    super('The lead cannot be added to this campaign');
    this.name = 'AssignmentNotPossibleError';
  }
}

export interface LeadChangeRepository {
  /** Corrects the lead's data (contacts.write, members only). Audited without the values. */
  correct(
    contactId: string,
    input: z.input<typeof leadCorrectionRequestSchema>,
  ): Promise<LeadDetail>;
  /** Replaces the lead's tags (contacts.write, members only). Audited. */
  setTags(
    contactId: string,
    input: z.input<typeof leadTagsRequestSchema>,
  ): Promise<LeadDetail>;
  /** Adds a note (contacts.write, members only). Audited without the text. */
  addNote(
    contactId: string,
    input: z.input<typeof leadNoteRequestSchema>,
  ): Promise<LeadDetail>;
  /** Adds the lead to a campaign's lead list (campaigns.write, members only). Audited. */
  assign(
    contactId: string,
    input: z.input<typeof leadAssignmentRequestSchema>,
  ): Promise<LeadDetail>;
}

const NOT_FOUND = 'Not found in this workspace.';

/** Eligibility reasons that keep a person off a campaign's list (the rest are for sending). */
const ASSIGNMENT_BLOCKS: readonly SendEligibilityReasonCode[] = [
  'contact_archived',
  'suppressed_email',
  'suppressed_domain',
  'excluded_email',
  'excluded_domain',
  'excluded_lead_list',
];

const FIELD_LABELS: Readonly<Record<LeadCorrectionField, string>> = {
  firstName: 'first name',
  lastName: 'last name',
  title: 'title',
  email: 'email address',
  countryCode: 'country',
  linkedinUrl: 'LinkedIn profile',
};

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError &&
  error.code === 'P2002';

export function createLeadChangeRepository(
  prisma: PrismaClient,
  tenantId: string,
  actor: TenantActor,
  now: () => Date,
  detail: (contactId: string) => Promise<LeadDetail>,
): LeadChangeRepository {
  const idOrNotFound = (rawId: string) => {
    const parsed = uuidSchema.safeParse(rawId);
    if (!parsed.success) {
      throw new RecordNotFoundError('contact');
    }
    return parsed.data;
  };

  /** The contact, locked for this transaction, at the version the change started from. */
  async function lockedAt(
    tx: Prisma.TransactionClient,
    id: string,
    version: number,
  ) {
    await tx.$queryRaw`SELECT id FROM contacts WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    const contact = await tx.contact.findUnique({
      where: { tenantId_id: { tenantId, id } },
      select: {
        id: true,
        version: true,
        firstName: true,
        lastName: true,
        title: true,
        email: true,
        normalizedEmail: true,
        countryCode: true,
        linkedinUrl: true,
        nameKey: true,
        organization: { select: { normalizedDomain: true } },
      },
    });
    if (contact === null) {
      throw new RecordNotFoundError('contact');
    }
    if (contact.version !== version) {
      throw new LeadVersionConflictError();
    }
    return contact;
  }

  return {
    async correct(rawId, rawInput) {
      const member = requirePermission(actor, 'contacts.write');
      const input = leadCorrectionRequestSchema.parse(rawInput);
      const id = idOrNotFound(rawId);
      try {
        await prisma.$transaction(async (tx) => {
          const contact = await lockedAt(tx, id, input.version);
          const { changes } = input;
          const email =
            changes.email === undefined
              ? {
                  display: contact.email,
                  normalized: contact.normalizedEmail,
                }
              : changes.email === null
                ? { display: null, normalized: null }
                : {
                    display: changes.email,
                    normalized: normalizeEmail(changes.email).email,
                  };
          const next = {
            firstName: changes.firstName ?? contact.firstName,
            lastName: changes.lastName ?? contact.lastName,
            title: changes.title === undefined ? contact.title : changes.title,
            email: email.normalized,
            countryCode:
              changes.countryCode === undefined
                ? contact.countryCode
                : changes.countryCode,
            linkedinUrl:
              changes.linkedinUrl === undefined
                ? contact.linkedinUrl
                : changes.linkedinUrl === null
                  ? null
                  : normalizeLinkedinUrl(changes.linkedinUrl),
          };
          const before: Record<LeadCorrectionField, string | null> = {
            firstName: contact.firstName,
            lastName: contact.lastName,
            title: contact.title,
            email: contact.normalizedEmail,
            countryCode: contact.countryCode,
            linkedinUrl: contact.linkedinUrl,
          };
          const changed = LEAD_CORRECTION_FIELDS.filter(
            (field) => before[field] !== next[field],
          );
          if (changed.length === 0) {
            return;
          }
          const domain = contact.organization?.normalizedDomain ?? null;
          if (
            next.email === null &&
            next.linkedinUrl === null &&
            domain === null
          ) {
            throw new LeadCorrectionError([
              {
                path: 'changes.email',
                message:
                  'A lead needs an email address, a LinkedIn profile or a company with a domain.',
              },
            ]);
          }
          let nameKey = contact.nameKey;
          if (next.firstName !== null && next.lastName !== null) {
            try {
              nameKey = normalizeContactIdentity({
                firstName: next.firstName,
                lastName: next.lastName,
                email: next.email,
                linkedinUrl: next.linkedinUrl,
                organizationDomain: domain,
              }).nameKey;
            } catch {
              // A name that can't be keyed keeps the old key.
            }
          }
          if (next.email !== null && next.email !== contact.normalizedEmail) {
            const holder = await tx.contact.findUnique({
              where: {
                tenantId_normalizedEmail: {
                  tenantId,
                  normalizedEmail: next.email,
                },
              },
              select: { id: true },
            });
            if (holder !== null && holder.id !== id) {
              throw new EmailTakenError();
            }
          }
          const at = now();
          await tx.contact.update({
            where: { tenantId_id: { tenantId, id } },
            data: {
              firstName: next.firstName,
              lastName: next.lastName,
              title: next.title,
              email: email.display,
              normalizedEmail: email.normalized,
              emailDomain:
                email.normalized === null
                  ? null
                  : email.normalized.slice(email.normalized.indexOf('@') + 1),
              countryCode: next.countryCode,
              linkedinUrl: next.linkedinUrl,
              nameKey,
              version: { increment: 1 },
            },
          });
          // The reason is the person's own words: a note, never in the audit record.
          await tx.contactNote.create({
            data: {
              tenantId,
              contactId: id,
              body: `Corrected ${changed.map((field) => FIELD_LABELS[field]).join(', ')}: ${input.reason}`,
              createdByMembershipId: member.membershipId,
              createdAt: at,
            },
          });
          const material = changed.some((field) =>
            (MATERIAL_LEAD_FIELDS as readonly string[]).includes(field),
          );
          const stale = material
            ? await markLeadsStale(tx, tenantId, [id], at, {
                recomputeEligibility: true,
                message:
                  "The lead's data was corrected after this decision. Decide again.",
              })
            : { drafts: 0, intents: 0, decisions: 0 };
          await writeAuditRecord(tx, tenantId, member, {
            action: 'lead.corrected',
            targetType: 'contact',
            targetId: id,
            metadata: {
              fields: [...changed],
              version: contact.version + 1,
              material,
              draftsInvalidated: stale.drafts,
              sendsCancelled: stale.intents,
              decisionsReopened: stale.decisions,
            },
          });
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new EmailTakenError();
        }
        throw error;
      }
      return detail(id);
    },

    async setTags(rawId, rawInput) {
      const member = requirePermission(actor, 'contacts.write');
      const input = leadTagsRequestSchema.parse(rawInput);
      const id = idOrNotFound(rawId);
      await prisma.$transaction(async (tx) => {
        const contact = await lockedAt(tx, id, input.version);
        const current = await tx.contactTag.findMany({
          where: { tenantId, contactId: id },
          select: { id: true, tag: true },
        });
        const wanted = new Set(input.tags);
        const removed = current.filter((row) => !wanted.has(row.tag));
        const have = new Set(current.map((row) => row.tag));
        const added = input.tags.filter((tag) => !have.has(tag));
        if (removed.length === 0 && added.length === 0) {
          return;
        }
        const at = now();
        if (removed.length > 0) {
          await tx.contactTag.deleteMany({
            where: { tenantId, id: { in: removed.map((row) => row.id) } },
          });
        }
        if (added.length > 0) {
          await tx.contactTag.createMany({
            data: added.map((tag) => ({
              tenantId,
              contactId: id,
              tag,
              createdAt: at,
            })),
          });
        }
        await tx.contact.update({
          where: { tenantId_id: { tenantId, id } },
          data: { version: { increment: 1 } },
        });
        await writeAuditRecord(tx, tenantId, member, {
          action: 'lead.tags_changed',
          targetType: 'contact',
          targetId: id,
          metadata: {
            added: added.length,
            removed: removed.length,
            version: contact.version + 1,
          },
        });
      });
      return detail(id);
    },

    async addNote(rawId, rawInput) {
      const member = requirePermission(actor, 'contacts.write');
      const input = leadNoteRequestSchema.parse(rawInput);
      const id = idOrNotFound(rawId);
      await prisma.$transaction(async (tx) => {
        const contact = await tx.contact.findUnique({
          where: { tenantId_id: { tenantId, id } },
          select: { id: true },
        });
        if (contact === null) {
          throw new RecordNotFoundError('contact');
        }
        const note = await tx.contactNote.create({
          data: {
            tenantId,
            contactId: id,
            body: input.body,
            createdByMembershipId: member.membershipId,
            createdAt: now(),
          },
          select: { id: true },
        });
        await writeAuditRecord(tx, tenantId, member, {
          action: 'lead.note_added',
          targetType: 'contact',
          targetId: id,
          metadata: { noteId: note.id },
        });
      });
      return detail(id);
    },

    async assign(rawId, rawInput) {
      const member = requirePermission(actor, 'campaigns.write');
      const input = leadAssignmentRequestSchema.parse(rawInput);
      const id = idOrNotFound(rawId);
      await prisma.$transaction(async (tx) => {
        const contact = await lockedAt(tx, id, input.version);
        const campaign = await tx.campaign.findUnique({
          where: { tenantId_id: { tenantId, id: input.campaignId } },
          select: { id: true, status: true, leadListId: true },
        });
        // Another workspace's campaign reads exactly like a missing one.
        if (campaign === null) {
          throw new AssignmentNotPossibleError([
            { path: 'campaignId', message: NOT_FOUND },
          ]);
        }
        const issues: PlanIssue[] = [];
        if (
          campaign.status === 'COMPLETED' ||
          campaign.status === 'CANCELLED'
        ) {
          issues.push({
            path: 'campaignId',
            message: 'This campaign has ended.',
          });
        }
        if (campaign.leadListId === null) {
          issues.push({
            path: 'campaignId',
            message:
              'This campaign has no lead list yet. Choose one in its setup first.',
          });
        }
        const at = now();
        const eligibility = await evaluateEligibilityFacts(
          tx,
          tenantId,
          campaign.id,
          id,
          at,
        );
        for (const check of eligibility.checks) {
          for (const reason of check.reasons) {
            if (ASSIGNMENT_BLOCKS.includes(reason.code)) {
              issues.push({ path: 'contactId', message: reason.message });
            }
          }
        }
        if (issues.length > 0) {
          throw new AssignmentNotPossibleError(issues);
        }
        const leadListId = campaign.leadListId ?? '';
        const already = await tx.leadListMember.findUnique({
          where: {
            tenantId_leadListId_contactId: {
              tenantId,
              leadListId,
              contactId: id,
            },
          },
          select: { contactId: true },
        });
        if (already !== null) {
          return;
        }
        await tx.leadListMember.create({
          data: { tenantId, leadListId, contactId: id, addedAt: at },
        });
        await tx.contact.update({
          where: { tenantId_id: { tenantId, id } },
          data: { version: { increment: 1 } },
        });
        await writeAuditRecord(tx, tenantId, member, {
          action: 'lead.assigned',
          targetType: 'contact',
          targetId: id,
          metadata: {
            campaignId: campaign.id,
            leadListId,
            version: contact.version + 1,
          },
        });
      });
      return detail(id);
    },
  };
}
