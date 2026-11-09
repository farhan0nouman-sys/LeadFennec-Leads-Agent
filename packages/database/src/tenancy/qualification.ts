// Lead qualification (task 10C, docs/decisions.md D-10C-*). Members ask for a qualification run
// (a job: the worker runs the LeadQualificationAgent, the scoring rules and the calculation) and
// make their own decisions; the worker records the automatic decision. Decisions are
// append-only and numbered per campaign and person; the current one is the highest version.
// Every decision keeps its reasons; a person's also keeps who decided, the note and the
// eligibility review reasons accepted. A blocked lead is never qualified, and eligibility is
// always decided again when asked (scope.eligibility). Every query filters by tenantId.
import { randomUUID } from 'node:crypto';
import {
  businessProfileSchema,
  classifyLead,
  contactDecision,
  LEAD_SCORE_FACTOR_INFO,
  leadEligibilityCodes,
  leadEligibilityStatus,
  offerSchema,
  QUALIFICATION_STATE_LABELS,
  qualificationDecisionRequestSchema,
  qualificationReasonsSchema,
  qualifyRequestSchema,
  researchFindingsSchema,
  SEND_ELIGIBILITY_REASON_CODES,
  summarizeQuality,
  type BusinessProfile,
  type LeadEvidenceView,
  type LeadFitView,
  type LeadPage,
  type LeadQualificationView,
  type LeadScoreAgentStatus,
  type LeadScoreEvidence,
  type Offer,
  type QualificationDecisionRequest,
  type QualificationDecisionView,
  type QualifyAccepted,
  type SendEligibilityReasonCode,
  type WebsiteResearchField,
} from '@lead-fennec-ai/shared';
import { z } from 'zod';
import type {
  LeadQualification,
  Prisma,
  PrismaClient,
} from '../generated/prisma/client.js';
import { paginate, type PageRequest } from '../pagination.js';
import {
  ActorNotAllowedError,
  uuidSchema,
  type TenantActor,
} from './actors.js';
import { writeAuditRecord } from './audit.js';
import { contactQualities } from './contact-quality.js';
import {
  RecordNotFoundError,
  requirePermission,
  requireReadPermissionOrSystem,
} from './authorization.js';
import {
  createLeadScoringRepository,
  type StoredLeadScore,
} from './lead-scoring.js';
import { effectiveFacts } from './research.js';
import { createSendEligibilityService } from './send-eligibility.js';

/** The job a qualification request queues. */
export const QUALIFICATION_TASK_TYPE = 'lead_qualification.run';

export const qualificationTaskPayloadSchema = z.strictObject({
  campaignId: z.uuid(),
  contactId: z.uuid(),
});

/** The person's own eligibility blocks them: they can't be qualified (`reasons`: codes). */
export class QualificationBlockedError extends Error {
  constructor(readonly reasons: readonly string[]) {
    super("This person may not be emailed, so they can't be qualified.");
    this.name = 'QualificationBlockedError';
  }
}

/** A decision named a qualification version that is no longer the current one. */
export class QualificationVersionConflictError extends Error {
  constructor() {
    super('The qualification changed since this version');
    this.name = 'QualificationVersionConflictError';
  }
}

/** What the worker gives the agent (facts of the current research version, after corrections). */
export interface QualificationContext {
  readonly campaign: {
    readonly businessProfile: BusinessProfile | null;
    readonly offer: Offer | null;
  };
  readonly company: {
    readonly name: string;
    readonly domain: string | null;
  } | null;
  readonly person: { readonly title: string | null };
  readonly research: { readonly id: string; readonly version: number } | null;
  readonly facts: readonly {
    readonly field: WebsiteResearchField;
    readonly value: string;
    readonly quotes: readonly string[];
    /** When the page was read; null for a person's correction. */
    readonly retrievedAt: Date | null;
    readonly evidenceIds: readonly string[];
  }[];
}

export interface QualificationRepository {
  /** Queues a qualification run, or answers with the one already queued (research.run). */
  request(
    campaignId: string,
    contactId: string,
    input?: z.input<typeof qualifyRequestSchema>,
  ): Promise<QualifyAccepted>;
  /** What the agent reads (the qualification worker only). */
  context(campaignId: string, contactId: string): Promise<QualificationContext>;
  /**
   * Decides the state by the rules from the current score, eligibility now and the agent's
   * outcome, and saves it as the next decision (the qualification worker only).
   */
  recordAutomatic(
    campaignId: string,
    contactId: string,
    input: { readonly agentStatus: LeadScoreAgentStatus | null },
  ): Promise<QualificationDecisionView>;
  /**
   * A person's decision, if `input.version` is the current one (campaigns.write; accepting the
   * eligibility review reasons also needs drafts.approve). A blocked person can't be qualified.
   */
  decide(
    campaignId: string,
    contactId: string,
    input: QualificationDecisionRequest,
  ): Promise<LeadQualificationView>;
  /** One lead: fit, eligibility and qualification, apart (campaigns.read, contacts.read, scores.read). */
  view(campaignId: string, contactId: string): Promise<LeadQualificationView>;
  /** The campaign's lead list, a page at a time (campaigns.read, contacts.read, scores.read). */
  list(campaignId: string, page: PageRequest): Promise<LeadPage>;
}

const HISTORY_LIMIT = 20;
const iso = (date: Date) => date.toISOString();

const FIELD_LABELS: Readonly<Record<string, string>> = {
  industry: 'industry',
  employeeCount: 'number of employees',
  countryCode: 'country',
  title: 'title',
};

const displayName = (contact: {
  readonly firstName: string | null;
  readonly lastName: string | null;
}) => {
  const name = [contact.firstName, contact.lastName]
    .filter((part): part is string => part !== null && part.trim() !== '')
    .join(' ');
  return name === '' ? null : name;
};

const isEligibilityCode = (code: string): code is SendEligibilityReasonCode =>
  (SEND_ELIGIBILITY_REASON_CODES as readonly string[]).includes(code);

type DecisionRow = LeadQualification & {
  readonly decidedBy: {
    readonly user: {
      readonly displayName: string | null;
      readonly email: string;
    };
  } | null;
};

const DECISION_INCLUDE = {
  decidedBy: {
    select: { user: { select: { displayName: true, email: true } } },
  },
} satisfies Prisma.LeadQualificationInclude;

function decisionView(row: DecisionRow): QualificationDecisionView {
  return {
    id: row.id,
    version: row.version,
    state: row.state,
    origin: row.origin,
    reasons: qualificationReasonsSchema.parse(row.reasons),
    acceptedReviewReasons: row.acceptedReviewReasons.filter(isEligibilityCode),
    note: row.note,
    decidedBy:
      row.decidedBy === null
        ? null
        : (row.decidedBy.user.displayName ?? row.decidedBy.user.email),
    decidedAt: iso(row.decidedAt),
    scoreId: row.scoreId,
    eligibilityStatus:
      row.eligibilityStatus === 'eligible' || row.eligibilityStatus === 'review'
        ? row.eligibilityStatus
        : 'blocked',
  };
}

export function createQualificationRepository(
  prisma: PrismaClient,
  tenantId: string,
  actor: TenantActor,
  now: () => Date,
): QualificationRepository {
  const scoring = createLeadScoringRepository(prisma, tenantId, actor, now);
  const eligibility = createSendEligibilityService(
    prisma,
    tenantId,
    actor,
    now,
  );

  const worker = (operation: string) => {
    if (actor.kind !== 'system') {
      throw new ActorNotAllowedError(operation);
    }
  };

  const idOrNotFound = (rawId: string, entity: string) => {
    const parsed = uuidSchema.safeParse(rawId);
    if (!parsed.success) {
      throw new RecordNotFoundError(entity);
    }
    return parsed.data;
  };

  const lead = (campaignId: string, contactId: string) =>
    ({ tenantId, campaignId, contactId }) as const;

  /** Both records of this workspace, or not found (another workspace's reads the same). */
  async function campaignAndContact(
    db: Prisma.TransactionClient | PrismaClient,
    campaignId: string,
    contactId: string,
  ) {
    const campaign = await db.campaign.findUnique({
      where: { tenantId_id: { tenantId, id: campaignId } },
      select: {
        id: true,
        name: true,
        status: true,
        leadListId: true,
        businessProfile: true,
        offer: true,
      },
    });
    if (campaign === null) {
      throw new RecordNotFoundError('campaign');
    }
    const contact = await db.contact.findUnique({
      where: { tenantId_id: { tenantId, id: contactId } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        title: true,
        email: true,
        organization: {
          select: { id: true, name: true, normalizedDomain: true },
        },
      },
    });
    if (contact === null) {
      throw new RecordNotFoundError('contact');
    }
    return { campaign, contact };
  }

  /** Serializes the decisions of one lead (their version numbers). */
  async function lockLead(
    tx: Prisma.TransactionClient,
    campaignId: string,
    contactId: string,
  ) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`qualification:${tenantId}:${campaignId}:${contactId}`}, 0))`;
  }

  async function nextVersion(
    tx: Prisma.TransactionClient,
    campaignId: string,
    contactId: string,
  ) {
    const last = await tx.leadQualification.findFirst({
      where: lead(campaignId, contactId),
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return (last?.version ?? 0) + 1;
  }

  function activeTask(
    db: Prisma.TransactionClient | PrismaClient,
    campaignId: string,
    contactId: string,
  ) {
    return db.jobTask.findFirst({
      where: {
        tenantId,
        taskType: QUALIFICATION_TASK_TYPE,
        status: { in: ['PENDING', 'RUNNING'] },
        AND: [
          { payload: { path: ['campaignId'], equals: campaignId } },
          { payload: { path: ['contactId'], equals: contactId } },
        ],
      },
      select: { id: true },
    });
  }

  /** Evidence ready to show: stored values as read, research facts and rows with their text. */
  async function evidenceViews(
    score: StoredLeadScore,
  ): Promise<Map<LeadScoreEvidence, LeadEvidenceView>> {
    const rows =
      score.evidenceIds.length === 0
        ? []
        : await prisma.evidence.findMany({
            where: { tenantId, id: { in: [...score.evidenceIds] } },
            select: {
              id: true,
              excerpt: true,
              sourceUrl: true,
              capturedAt: true,
            },
          });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const views = new Map<LeadScoreEvidence, LeadEvidenceView>();
    for (const assessment of score.inputs.assessments) {
      if (assessment.status !== 'assessed') {
        continue;
      }
      for (const evidence of assessment.evidence) {
        switch (evidence.kind) {
          case 'organization_field':
          case 'contact_field':
            views.set(evidence, {
              kind: evidence.kind,
              label: `${evidence.kind === 'organization_field' ? 'Company record' : 'Person record'}: ${FIELD_LABELS[evidence.field] ?? evidence.field}`,
              detail: String(evidence.value),
              excerpt: null,
              url: null,
              capturedAt: null,
            });
            break;
          case 'research_fact': {
            const row = evidence.evidenceIds
              .map((id) => byId.get(id))
              .find((item) => item !== undefined);
            views.set(evidence, {
              kind: evidence.kind,
              label: `Research version ${String(evidence.researchVersion)}: ${evidence.field.replace(/_/g, ' ')}`,
              detail: evidence.value,
              excerpt: row?.excerpt ?? null,
              url: row?.sourceUrl ?? null,
              capturedAt: row === undefined ? null : iso(row.capturedAt),
            });
            break;
          }
          case 'email_check':
            views.set(evidence, {
              kind: evidence.kind,
              label: 'Email check',
              detail: evidence.status,
              excerpt: null,
              url: null,
              capturedAt: evidence.checkedAt,
            });
            break;
          case 'evidence': {
            const row = byId.get(evidence.evidenceId);
            views.set(evidence, {
              kind: evidence.kind,
              label: 'Evidence',
              detail:
                row === undefined ? 'No longer stored.' : 'Stored evidence',
              excerpt: row?.excerpt ?? null,
              url: row?.sourceUrl ?? null,
              capturedAt: row === undefined ? null : iso(row.capturedAt),
            });
            break;
          }
        }
      }
    }
    return views;
  }

  async function fitView(score: StoredLeadScore): Promise<LeadFitView> {
    const views = await evidenceViews(score);
    return {
      scoreId: score.id,
      version: score.version,
      value: score.value,
      band: score.band,
      scoreBand: score.result.scoreBand,
      bandReasons: [...score.result.bandReasons],
      method: score.method,
      methodVersion: score.methodVersion,
      rulesVersion: score.inputs.rules,
      scoredAt: iso(score.scoredAt),
      agent:
        score.inputs.agent === undefined
          ? null
          : {
              status: score.inputs.agent.status,
              prompt: score.inputs.agent.prompt,
              provider: score.inputs.agent.provider,
              model: score.inputs.agent.model,
              reviewItems: [...score.inputs.agent.reviewItems],
            },
      factors: score.result.factors.map((factor) => {
        const assessment = score.inputs.assessments.find(
          (item) => item.factor === factor.factor,
        );
        const info = LEAD_SCORE_FACTOR_INFO[factor.factor];
        return {
          factor: factor.factor,
          label: info.label,
          description: info.description,
          weight: factor.weight,
          status: factor.status,
          level: factor.level,
          points: factor.points,
          assessedBy: assessment?.assessedBy ?? 'rules',
          explanation: assessment?.explanation ?? '',
          missingReason:
            assessment?.status === 'missing' ? assessment.reason : null,
          evidence:
            assessment?.status === 'assessed'
              ? assessment.evidence.flatMap((item) => {
                  const view = views.get(item);
                  return view === undefined ? [] : [view];
                })
              : [],
        };
      }),
    };
  }

  /** The contact's data quality, decided now (task 08C). */
  async function qualityOf(contactId: string) {
    const quality = (
      await contactQualities(prisma, tenantId, [contactId], now())
    ).get(contactId);
    if (quality === undefined) {
      throw new RecordNotFoundError('contact');
    }
    return quality;
  }

  async function view(
    campaignId: string,
    contactId: string,
  ): Promise<LeadQualificationView> {
    const { campaign, contact } = await campaignAndContact(
      prisma,
      campaignId,
      contactId,
    );
    const decision = await eligibility.evaluate(campaignId, contactId);
    const score = await scoring.current(campaignId, contactId);
    const rows = (await prisma.leadQualification.findMany({
      where: lead(campaignId, contactId),
      orderBy: { version: 'desc' },
      take: HISTORY_LIMIT,
      include: DECISION_INCLUDE,
    })) as DecisionRow[];
    const history = rows.map(decisionView);
    const current = history[0] ?? null;
    const { sendPermitted, readyToContact } = contactDecision(
      decision.eligibility,
      current,
    );
    return {
      campaign: {
        id: campaign.id,
        name: campaign.name,
        status: campaign.status,
      },
      contact: {
        id: contact.id,
        name: displayName(contact),
        title: contact.title,
        email: contact.email,
        company:
          contact.organization === null
            ? null
            : { id: contact.organization.id, name: contact.organization.name },
      },
      quality: await qualityOf(contact.id),
      fit: score === null ? null : await fitView(score),
      eligibility: decision.eligibility,
      qualification: current,
      history,
      sendPermitted,
      readyToContact,
      pending: (await activeTask(prisma, campaignId, contactId)) !== null,
    };
  }

  const readable = () => {
    requireReadPermissionOrSystem(actor, 'campaigns.read');
    requireReadPermissionOrSystem(actor, 'contacts.read');
    requireReadPermissionOrSystem(actor, 'scores.read');
  };

  return {
    async request(rawCampaignId, rawContactId, rawInput = {}) {
      const member = requirePermission(actor, 'research.run');
      qualifyRequestSchema.parse(rawInput);
      const campaignId = idOrNotFound(rawCampaignId, 'campaign');
      const contactId = idOrNotFound(rawContactId, 'contact');
      return prisma.$transaction(async (tx) => {
        await campaignAndContact(tx, campaignId, contactId);
        await lockLead(tx, campaignId, contactId);
        if ((await activeTask(tx, campaignId, contactId)) !== null) {
          return { state: 'running' } as const;
        }
        await tx.jobTask.create({
          data: {
            tenantId,
            taskType: QUALIFICATION_TASK_TYPE,
            idempotencyKey: `qualification:${campaignId}:${contactId}:${randomUUID()}`,
            payload: { campaignId, contactId },
            availableAt: now(),
          },
        });
        await writeAuditRecord(tx, tenantId, member, {
          action: 'lead.qualification_requested',
          targetType: 'contact',
          targetId: contactId,
          metadata: { campaignId },
        });
        return { state: 'queued' } as const;
      });
    },

    async context(rawCampaignId, rawContactId) {
      worker('lead_qualification.context');
      const campaignId = idOrNotFound(rawCampaignId, 'campaign');
      const contactId = idOrNotFound(rawContactId, 'contact');
      const { campaign, contact } = await campaignAndContact(
        prisma,
        campaignId,
        contactId,
      );
      // Stored configuration is checked again: anything out of shape is left out, not trusted.
      const profile = businessProfileSchema.safeParse(campaign.businessProfile);
      const offer = offerSchema.safeParse(campaign.offer);
      const organization = contact.organization;
      const row =
        organization === null
          ? null
          : await prisma.research.findFirst({
              where: {
                tenantId,
                organizationId: organization.id,
                contactId: null,
                status: 'COMPLETED',
                origin: { not: null },
                version: { not: null },
              },
              orderBy: [{ version: 'desc' }, { id: 'desc' }],
              select: { id: true, version: true, findings: true },
            });
      const findings =
        row === null ? null : researchFindingsSchema.safeParse(row.findings);
      const facts =
        findings?.success === true ? effectiveFacts(findings.data).facts : [];
      const evidenceIds = facts.flatMap((fact) =>
        fact.evidence.map((item) => item.evidenceId),
      );
      const captured =
        evidenceIds.length === 0
          ? []
          : await prisma.evidence.findMany({
              where: { tenantId, id: { in: evidenceIds } },
              select: { id: true, kind: true, capturedAt: true },
            });
      const capturedAt = new Map(captured.map((item) => [item.id, item]));
      return {
        campaign: {
          businessProfile: profile.success ? profile.data : null,
          offer: offer.success ? offer.data : null,
        },
        company:
          organization === null
            ? null
            : {
                name: organization.name,
                domain: organization.normalizedDomain,
              },
        person: { title: contact.title },
        research:
          row?.version == null ? null : { id: row.id, version: row.version },
        facts: facts.map((fact) => {
          const pages = fact.evidence
            .map((item) => capturedAt.get(item.evidenceId))
            .filter(
              (item): item is NonNullable<typeof item> =>
                item?.kind === 'WEBSITE_EXCERPT',
            );
          return {
            field: fact.field,
            value: fact.value,
            quotes: fact.evidence.flatMap((item) =>
              item.quote === null ? [] : [item.quote],
            ),
            retrievedAt: pages[0]?.capturedAt ?? null,
            evidenceIds: fact.evidence.map((item) => item.evidenceId),
          };
        }),
      };
    },

    async recordAutomatic(rawCampaignId, rawContactId, input) {
      worker('lead_qualification.record');
      const campaignId = idOrNotFound(rawCampaignId, 'campaign');
      const contactId = idOrNotFound(rawContactId, 'contact');
      // Read before the transaction: each opens its own.
      const decision = await eligibility.evaluate(campaignId, contactId);
      const score = await scoring.current(campaignId, contactId);
      const classified = classifyLead({
        fit:
          score === null
            ? null
            : {
                value: score.value,
                band: score.band,
                bandReasons: score.result.bandReasons,
              },
        eligibility: decision.eligibility,
        agentStatus: input.agentStatus,
      });
      return prisma.$transaction(async (tx) => {
        await lockLead(tx, campaignId, contactId);
        const version = await nextVersion(tx, campaignId, contactId);
        const row = await tx.leadQualification.create({
          data: {
            ...lead(campaignId, contactId),
            version,
            state: classified.state,
            origin: 'AUTOMATIC',
            scoreId: score?.id ?? null,
            eligibilityStatus: leadEligibilityStatus(decision.eligibility),
            reasons: qualificationReasonsSchema.parse(classified.reasons),
            decidedAt: now(),
          },
          include: DECISION_INCLUDE,
        });
        await writeAuditRecord(tx, tenantId, actor, {
          action: 'lead.qualification_decided',
          targetType: 'contact',
          targetId: contactId,
          metadata: {
            campaignId,
            version,
            state: classified.state,
            origin: 'AUTOMATIC',
          },
        });
        return decisionView(row);
      });
    },

    async decide(rawCampaignId, rawContactId, rawInput) {
      const member = requirePermission(actor, 'campaigns.write');
      const input = qualificationDecisionRequestSchema.parse(rawInput);
      if (input.acceptReview === true) {
        // Widening what may be sent is a decision for someone who may approve emails.
        requirePermission(actor, 'drafts.approve');
      }
      const campaignId = idOrNotFound(rawCampaignId, 'campaign');
      const contactId = idOrNotFound(rawContactId, 'contact');
      await campaignAndContact(prisma, campaignId, contactId);
      // Eligibility decided now, before the transaction (it reads in its own).
      const { eligibility: current } = await eligibility.evaluate(
        campaignId,
        contactId,
      );
      const score = await scoring.current(campaignId, contactId);
      const blocked = leadEligibilityCodes(current, 'blocked');
      if (input.state === 'QUALIFIED' && blocked.length > 0) {
        throw new QualificationBlockedError(blocked);
      }
      // Only review reasons, never a block, can be accepted.
      const accepted =
        input.acceptReview === true
          ? current.checks.flatMap((check) =>
              check.reasons
                .filter((reason) => reason.status === 'review')
                .map((reason) => reason.code),
            )
          : [];
      await prisma.$transaction(async (tx) => {
        await lockLead(tx, campaignId, contactId);
        const version = await nextVersion(tx, campaignId, contactId);
        if (version - 1 !== input.version) {
          throw new QualificationVersionConflictError();
        }
        await tx.leadQualification.create({
          data: {
            ...lead(campaignId, contactId),
            version,
            state: input.state,
            origin: 'PERSON',
            scoreId: score?.id ?? null,
            eligibilityStatus: leadEligibilityStatus(current),
            reasons: qualificationReasonsSchema.parse([
              {
                code: 'person_decision',
                message: `A person decided: ${QUALIFICATION_STATE_LABELS[input.state]}.`,
                details: accepted,
              },
            ]),
            acceptedReviewReasons: accepted,
            note: input.note,
            decidedByMembershipId: member.membershipId,
            decidedAt: now(),
          },
        });
        // The note isn't copied into the audit record: it may name people.
        await writeAuditRecord(tx, tenantId, member, {
          action: 'lead.qualification_decided',
          targetType: 'contact',
          targetId: contactId,
          metadata: {
            campaignId,
            version,
            state: input.state,
            origin: 'PERSON',
            acceptedReviewReasons: accepted,
          },
        });
      });
      return view(campaignId, contactId);
    },

    async view(rawCampaignId, rawContactId) {
      readable();
      return view(
        idOrNotFound(rawCampaignId, 'campaign'),
        idOrNotFound(rawContactId, 'contact'),
      );
    },

    async list(rawCampaignId, page) {
      readable();
      const campaignId = idOrNotFound(rawCampaignId, 'campaign');
      const campaign = await prisma.campaign.findUnique({
        where: { tenantId_id: { tenantId, id: campaignId } },
        select: { leadListId: true },
      });
      if (campaign === null) {
        throw new RecordNotFoundError('campaign');
      }
      const leadListId = campaign.leadListId;
      if (leadListId === null) {
        return { leadListId: null, items: [], nextCursor: null };
      }
      const contacts = await paginate(
        page,
        ({ take, orderBy, cursorWhere }) =>
          prisma.contact.findMany({
            where: {
              tenantId,
              leadListMembers: { some: { tenantId, leadListId } },
              ...cursorWhere,
            },
            orderBy,
            take,
            select: {
              id: true,
              firstName: true,
              lastName: true,
              title: true,
              organization: { select: { name: true } },
            },
          }),
        'oldest',
      );
      const ids = contacts.items.map((item) => item.id);
      const scores = await prisma.score.findMany({
        where: {
          tenantId,
          campaignId,
          contactId: { in: ids },
          version: { not: null },
        },
        orderBy: { version: 'desc' },
        select: { contactId: true, value: true, band: true },
      });
      const decisions = await prisma.leadQualification.findMany({
        where: { tenantId, campaignId, contactId: { in: ids } },
        orderBy: { version: 'desc' },
        select: { contactId: true, state: true },
      });
      const qualities = await contactQualities(prisma, tenantId, ids, now());
      return {
        leadListId,
        items: contacts.items.map((contact) => {
          const score = scores.find((item) => item.contactId === contact.id);
          return {
            id: contact.id,
            name: displayName(contact),
            title: contact.title,
            company: contact.organization?.name ?? null,
            score:
              score?.band == null
                ? null
                : { value: score.value, band: score.band },
            state:
              decisions.find((item) => item.contactId === contact.id)?.state ??
              null,
            quality: ((quality) =>
              quality === undefined
                ? { level: 'unusable' as const, emailState: null }
                : summarizeQuality(quality))(qualities.get(contact.id)),
          };
        }),
        nextCursor: contacts.nextCursor,
      };
    },
  };
}
