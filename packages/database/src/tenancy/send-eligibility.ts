// SendEligibilityService (task 10B, docs/decisions.md D-10B-*): whether a campaign may email a
// person now, next to how well they fit, as two separate results. The service gathers the facts
// of one workspace at one moment (the campaign, its mailbox, the workspace's sending switch, plan
// and send policy, the person, their company, their newest email check, the do-not-contact list,
// their lead lists, other enrollments and data sources) and the shared rules decide
// (evaluateSendEligibility). The fit is the person's current lead score (task 10A); the rules
// never see it. Nothing is cached: every call reads the facts again. The send policy changes
// only through updatePolicy (compare-and-set, audited). Every query filters by tenantId.
import {
  DEFAULT_EXCLUSIONS,
  evaluateSendEligibility,
  exclusionsSchema,
  leadSendDecision,
  SEND_POLICY_SOURCES,
  sendPolicySchema,
  updateSendPolicyRequestSchema,
  type LeadFit,
  type LeadSendDecision,
  type SendPolicy,
  type SendPolicySource,
  type SendPolicyState,
} from '@lead-fennec-ai/shared';
import type { z } from 'zod';
import { Prisma, type PrismaClient } from '../generated/prisma/client.js';
import { uuidSchema, type TenantActor } from './actors.js';
import { writeAuditRecord } from './audit.js';
import {
  RecordNotFoundError,
  requirePermission,
  requireReadPermissionOrSystem,
} from './authorization.js';
import {
  ENTITLED_SUBSCRIPTION_STATUSES,
  findCurrentSubscription,
  findEffectiveLimit,
} from './billing.js';
import { createLeadScoringRepository } from './lead-scoring.js';

/** A policy save started from an older version than the stored one. */
export class SendPolicyVersionConflictError extends Error {
  constructor() {
    super('The send policy changed since this version');
    this.name = 'SendPolicyVersionConflictError';
  }
}

export interface SendEligibilityService {
  /**
   * The person's fit and whether the campaign may email them now, decided apart
   * (campaigns.read and contacts.read, scores.read for the fit; or the system actor).
   */
  evaluate(campaignId: string, contactId: string): Promise<LeadSendDecision>;
  /** The workspace's send policy and its version (settings.manage, or the system actor). */
  policy(): Promise<SendPolicyState>;
  /**
   * Replaces the policy if `input.version` is the stored one; null clears it (settings.manage,
   * members only). Audited.
   */
  updatePolicy(
    input: z.input<typeof updateSendPolicyRequestSchema>,
  ): Promise<SendPolicyState>;
}

/** Stored statuses in the words of an email check (D-08A-04). */
const CHECK_STATUS = {
  VALID: 'verified',
  RISKY: 'risky',
  UNKNOWN: 'unknown',
  INVALID: 'invalid',
} as const;

/** A stored policy out of shape is no policy: nothing is allowed. */
function storedPolicy(
  value: Prisma.JsonValue | null | undefined,
): SendPolicy | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = sendPolicySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const isSource = (value: string): value is SendPolicySource =>
  (SEND_POLICY_SOURCES as readonly string[]).includes(value);

export function createSendEligibilityService(
  prisma: PrismaClient,
  tenantId: string,
  actor: TenantActor,
  now: () => Date,
): SendEligibilityService {
  const scoring = createLeadScoringRepository(prisma, tenantId, actor, now);

  const idOrNotFound = (rawId: string, entity: string) => {
    const parsed = uuidSchema.safeParse(rawId);
    if (!parsed.success) {
      throw new RecordNotFoundError(entity);
    }
    return parsed.data;
  };

  async function readPolicy(
    db: Prisma.TransactionClient | PrismaClient,
  ): Promise<SendPolicyState> {
    const settings = await db.tenantSettings.findUnique({
      where: { tenantId },
      select: { sendPolicy: true, sendPolicyVersion: true },
    });
    return {
      version: settings?.sendPolicyVersion ?? 0,
      policy: storedPolicy(settings?.sendPolicy),
    };
  }

  return {
    async evaluate(rawCampaignId, rawContactId) {
      requireReadPermissionOrSystem(actor, 'campaigns.read');
      requireReadPermissionOrSystem(actor, 'contacts.read');
      const campaignId = idOrNotFound(rawCampaignId, 'campaign');
      const contactId = idOrNotFound(rawContactId, 'contact');
      const eligibility = await prisma.$transaction(async (tx) => {
        const campaign = await tx.campaign.findUnique({
          where: { tenantId_id: { tenantId, id: campaignId } },
          select: {
            id: true,
            status: true,
            exclusions: true,
            emailAccountId: true,
          },
        });
        if (campaign === null) {
          throw new RecordNotFoundError('campaign');
        }
        const contact = await tx.contact.findUnique({
          where: { tenantId_id: { tenantId, id: contactId } },
          select: {
            id: true,
            status: true,
            normalizedEmail: true,
            countryCode: true,
            organizationId: true,
          },
        });
        if (contact === null) {
          throw new RecordNotFoundError('contact');
        }
        const mailbox =
          campaign.emailAccountId === null
            ? null
            : await tx.emailAccount.findUnique({
                where: {
                  tenantId_id: { tenantId, id: campaign.emailAccountId },
                },
                select: { status: true, secretRef: true },
              });
        const settings = await tx.tenantSettings.findUnique({
          where: { tenantId },
          select: { outboundSendingEnabled: true, sendPolicy: true },
        });
        const subscription = await findCurrentSubscription(tx, tenantId);
        const planEntitled =
          subscription !== null &&
          (ENTITLED_SUBSCRIPTION_STATUSES as readonly string[]).includes(
            subscription.status,
          );
        const emailsPerPeriod = planEntitled
          ? await findEffectiveLimit(
              tx,
              tenantId,
              subscription.planId,
              'EMAILS_SENT',
            )
          : 0n;
        const organization =
          contact.organizationId === null
            ? null
            : await tx.organization.findUnique({
                where: {
                  tenantId_id: { tenantId, id: contact.organizationId },
                },
                select: { normalizedDomain: true, countryCode: true },
              });
        const email = contact.normalizedEmail;
        const check =
          email === null
            ? null
            : await tx.verification.findFirst({
                where: { tenantId, contactId, normalizedEmail: email },
                orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
                select: {
                  normalizedEmail: true,
                  provider: true,
                  status: true,
                  checkedAt: true,
                },
              });
        const domains = [
          email === null ? null : email.slice(email.lastIndexOf('@') + 1),
          organization?.normalizedDomain ?? null,
        ].filter((value): value is string => value !== null);
        const suppressions =
          email === null && domains.length === 0
            ? []
            : await tx.suppression.findMany({
                where: {
                  tenantId,
                  OR: [
                    ...(email === null ? [] : [{ normalizedEmail: email }]),
                    { normalizedDomain: { in: domains } },
                  ],
                },
                select: { normalizedEmail: true, normalizedDomain: true },
                take: 10,
              });
        const lists = await tx.leadListMember.findMany({
          where: { tenantId, contactId },
          select: { leadListId: true },
          take: 1000,
        });
        // "Already in another campaign": pending or active there; finished ones don't count.
        const otherCampaignEnrollments = await tx.campaignLead.count({
          where: {
            tenantId,
            contactId,
            campaignId: { not: campaignId },
            status: { in: ['PENDING', 'ACTIVE'] },
          },
        });
        const sources = await tx.sourceRecord.findMany({
          where: { tenantId, contactId },
          distinct: ['provider'],
          select: { provider: true },
        });
        return evaluateSendEligibility({
          asOf: now().toISOString(),
          workspace: {
            outboundSendingEnabled: settings?.outboundSendingEnabled ?? false,
            planEntitled,
            emailsPerPeriod: Number(emailsPerPeriod),
            policy: storedPolicy(settings?.sendPolicy),
          },
          campaign: {
            id: campaign.id,
            status: campaign.status,
            exclusions: exclusionsSchema.parse(
              campaign.exclusions ?? DEFAULT_EXCLUSIONS,
            ),
            sender:
              mailbox === null
                ? null
                : {
                    status: mailbox.status,
                    hasCredentials: mailbox.secretRef !== null,
                  },
          },
          contact: {
            id: contact.id,
            status: contact.status,
            email,
            countryCode: contact.countryCode,
            organization:
              organization === null
                ? null
                : {
                    domain: organization.normalizedDomain,
                    countryCode: organization.countryCode,
                  },
          },
          // As an email check; a provider the check's schema doesn't know isn't a check.
          emailCheck:
            check === null
              ? null
              : {
                  address: check.normalizedEmail,
                  status: CHECK_STATUS[check.status],
                  reason: null,
                  provider: check.provider.toUpperCase(),
                  checkedAt: check.checkedAt.toISOString(),
                },
          suppressions: {
            emails: suppressions.flatMap((row) =>
              row.normalizedEmail === null ? [] : [row.normalizedEmail],
            ),
            domains: suppressions.flatMap((row) =>
              row.normalizedDomain === null ? [] : [row.normalizedDomain],
            ),
          },
          leadListIds: lists.map((row) => row.leadListId),
          otherCampaignEnrollments,
          sources: sources.map((row) => row.provider).filter(isSource),
        });
      });
      // The fit is read apart and never given to the rules.
      const score = await scoring.current(campaignId, contactId);
      const fit: LeadFit | null =
        score === null
          ? null
          : {
              scoreId: score.id,
              version: score.version,
              value: score.value,
              band: score.band,
              scoredAt: score.scoredAt.toISOString(),
            };
      return leadSendDecision(fit, eligibility);
    },

    async policy() {
      requireReadPermissionOrSystem(actor, 'settings.manage');
      return readPolicy(prisma);
    },

    async updatePolicy(rawInput) {
      const member = requirePermission(actor, 'settings.manage');
      const input = updateSendPolicyRequestSchema.parse(rawInput);
      const policy = input.policy;
      return prisma.$transaction(async (tx) => {
        const current = await tx.tenantSettings.findUnique({
          where: { tenantId },
          select: { sendPolicyVersion: true },
        });
        if ((current?.sendPolicyVersion ?? 0) !== input.version) {
          throw new SendPolicyVersionConflictError();
        }
        const value = policy ?? Prisma.DbNull;
        if (current === null) {
          // A workspace without a settings row gets one, with the safe defaults.
          await tx.tenantSettings.create({
            data: { tenantId, sendPolicy: value, sendPolicyVersion: 1 },
          });
        } else {
          // Compare-and-set: a concurrent save of the same version matches nothing.
          const saved = await tx.tenantSettings.updateMany({
            where: { tenantId, sendPolicyVersion: input.version },
            data: {
              sendPolicy: value,
              sendPolicyVersion: { increment: 1 },
            },
          });
          if (saved.count === 0) {
            throw new SendPolicyVersionConflictError();
          }
        }
        await writeAuditRecord(tx, tenantId, member, {
          action: 'send_policy.updated',
          targetType: 'workspace',
          targetId: tenantId,
          metadata: {
            version: input.version + 1,
            configured: policy !== null,
            countries:
              policy === null
                ? 0
                : Object.keys(policy.regions.countries).length,
            sources: policy === null ? [] : Object.keys(policy.sources).sort(),
          },
        });
        return readPolicy(tx);
      });
    },
  };
}
