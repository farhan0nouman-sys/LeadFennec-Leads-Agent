// Stale lead data (task 11B, docs/decisions.md D-11B-03): when a person's material data (name,
// title, address, country) or their company's evidence changes, what was written or decided for
// the old data must not survive silently. Inside the caller's transaction:
// - every live draft of the person (awaiting approval or approved) is INVALIDATED, so its approval
//   can never be used, and every send scheduled from it is CANCELLED (LEAD_DATA_CHANGED);
// - every campaign's newest qualification decision gets a successor: Review, explained, with the
//   eligibility decided again from the corrected facts (or kept, when only evidence changed).
// Drafts' content and approvals stay as they were (append-only); only statuses move. Every query
// filters by the tenant.
import {
  leadEligibilityStatus,
  qualificationReasonsSchema,
} from '@lead-fennec-ai/shared';
import type { Prisma } from '../generated/prisma/client.js';
import { evaluateEligibilityFacts } from './send-eligibility.js';

export interface StaleOutcome {
  /** Drafts invalidated. */
  readonly drafts: number;
  /** Scheduled sends cancelled. */
  readonly intents: number;
  /** Decisions sent back to Review. */
  readonly decisions: number;
}

/** Most people one change may make stale (a company's correction reaches its contacts). */
export const STALE_CONTACTS_LIMIT = 1000;

export async function markLeadsStale(
  tx: Prisma.TransactionClient,
  tenantId: string,
  contactIds: readonly string[],
  at: Date,
  options: {
    /** Decide eligibility again (the person's facts changed), else keep the last decision's. */
    readonly recomputeEligibility: boolean;
    /** Why, in the decision's reason. */
    readonly message: string;
  },
): Promise<StaleOutcome> {
  const ids = [...new Set(contactIds)].slice(0, STALE_CONTACTS_LIMIT);
  if (ids.length === 0) {
    return { drafts: 0, intents: 0, decisions: 0 };
  }
  const leads = await tx.campaignLead.findMany({
    where: { tenantId, contactId: { in: ids } },
    select: { id: true },
  });
  const drafts =
    leads.length === 0
      ? []
      : await tx.draft.findMany({
          where: {
            tenantId,
            campaignLeadId: { in: leads.map((lead) => lead.id) },
            status: { in: ['PENDING_APPROVAL', 'APPROVED'] },
          },
          select: { id: true },
        });
  const draftIds = drafts.map((draft) => draft.id);
  const intents =
    draftIds.length === 0
      ? { count: 0 }
      : await tx.outboundIntent.updateMany({
          where: { tenantId, draftId: { in: draftIds }, status: 'SCHEDULED' },
          data: {
            status: 'CANCELLED',
            cancelReason: 'LEAD_DATA_CHANGED',
            cancelledAt: at,
          },
        });
  if (draftIds.length > 0) {
    await tx.draft.updateMany({
      where: { tenantId, id: { in: draftIds } },
      data: { status: 'INVALIDATED' },
    });
  }

  // The newest decision of each campaign gets a successor.
  const newest = await tx.leadQualification.findMany({
    where: { tenantId, contactId: { in: ids } },
    orderBy: [{ version: 'desc' }],
    distinct: ['contactId', 'campaignId'],
    select: {
      campaignId: true,
      contactId: true,
      scoreId: true,
      eligibilityStatus: true,
    },
  });
  for (const decision of newest) {
    // The same lock as a decision of the lead (scope.qualification), so versions never race.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`qualification:${tenantId}:${decision.campaignId}:${decision.contactId}`}, 0))`;
    const last = await tx.leadQualification.findFirst({
      where: {
        tenantId,
        campaignId: decision.campaignId,
        contactId: decision.contactId,
      },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const eligibilityStatus = options.recomputeEligibility
      ? leadEligibilityStatus(
          await evaluateEligibilityFacts(
            tx,
            tenantId,
            decision.campaignId,
            decision.contactId,
            at,
          ),
        )
      : decision.eligibilityStatus;
    await tx.leadQualification.create({
      data: {
        tenantId,
        campaignId: decision.campaignId,
        contactId: decision.contactId,
        version: (last?.version ?? 0) + 1,
        state: 'REVIEW',
        origin: 'AUTOMATIC',
        scoreId: decision.scoreId,
        eligibilityStatus,
        reasons: qualificationReasonsSchema.parse([
          { code: 'lead_data_changed', message: options.message, details: [] },
        ]),
        decidedAt: at,
      },
    });
  }
  return {
    drafts: draftIds.length,
    intents: intents.count,
    decisions: newest.length,
  };
}
