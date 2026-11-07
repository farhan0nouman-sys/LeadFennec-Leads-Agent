// Lead scores (task 10A, docs/decisions.md D-10A-*): a person scored for a campaign by
// application code, from what is stored now. The scoring worker (a system actor) reads the
// campaign's targets and scoring configuration, the person, their company, the company's current
// research version and the newest check of the person's address; the rules assess each factor
// and the calculation turns the assessments into a score. Everything read is kept with the score
// (inputs, validated by leadScoreInputsSchema, and their hash), together with the campaign
// version, the research version, the email check and every evidence row it cites, so a stored
// score can be recalculated and checked. A score never changes (database trigger): scoring again
// adds a version. Every query filters by tenantId; reads need scores.read.
import {
  assessLeadFactors,
  audienceFiltersSchema,
  calculateLeadScore,
  DEFAULT_LEAD_SCORING_CONFIG,
  describeLeadScore,
  icpCriteriaSchema,
  LEAD_SCORE_METHOD,
  LEAD_SCORE_RULES_VERSION,
  LEAD_SCORE_VALUE_CHARS,
  leadScoreEvidenceIds,
  leadScoreInputsSchema,
  leadScoringConfigSchema,
  LeadScoreInputError,
  QUALIFICATION_MODEL_FACTORS,
  reproduceLeadScore,
  researchFindingsSchema,
  scoringTargets,
  type LeadFactorAssessment,
  type LeadScoreAgentRun,
  type LeadScoreBand,
  type LeadScoreFacts,
  type LeadScoreInputs,
  type LeadScoreReproduction,
  type LeadScoreResult,
} from '@lead-fennec-ai/shared';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { payloadSha256 } from '../payload-hash.js';
import {
  ActorNotAllowedError,
  uuidSchema,
  type TenantActor,
} from './actors.js';
import {
  RecordNotFoundError,
  requireReadPermissionOrSystem,
} from './authorization.js';
import { effectiveFacts } from './research.js';

/** A lead score as stored, with the calculation redone from its stored inputs. */
export interface StoredLeadScore {
  readonly id: string;
  readonly campaignId: string;
  readonly contactId: string;
  /** 1, 2, 3 ... per campaign and person: the current score is the highest. */
  readonly version: number;
  readonly value: number;
  readonly band: LeadScoreBand;
  readonly reason: string;
  readonly method: 'RULES' | 'AI' | 'MANUAL';
  /** The calculation's version (lead-score/1); the rules' version is in inputs.rules. */
  readonly methodVersion: string;
  readonly inputSha256: string;
  readonly campaignVersion: number;
  readonly researchId: string | null;
  readonly verificationId: string | null;
  /** The stored evidence rows it cites (score_evidence), sorted. */
  readonly evidenceIds: readonly string[];
  readonly scoredAt: Date;
  readonly inputs: LeadScoreInputs;
  /** The factor breakdown and band reasons, from the stored inputs. */
  readonly result: LeadScoreResult;
}

/** What a recalculation of a stored score found. */
export interface LeadScoreCheck extends LeadScoreReproduction {
  /** The stored hash is the hash of the stored inputs. */
  readonly hashMatches: boolean;
  /** The cited evidence rows are exactly the ones the assessments name. */
  readonly evidenceMatches: boolean;
}

/**
 * The qualification agent's checked proposals for supported need and timing (task 10C), and
 * its run. Every research fact they cite is checked again against the current research version
 * before anything is saved; the rules still assess every other factor.
 */
export interface LeadScoreProposals {
  readonly assessments: readonly LeadFactorAssessment[];
  readonly agent: LeadScoreAgentRun;
}

/** A fact of the current research version, after corrections. */
interface CurrentFact {
  readonly field: string;
  readonly value: string;
  readonly evidenceIds: readonly string[];
}

export interface LeadScoringRepository {
  /**
   * Scores one person for one campaign from what is stored now and saves it as the lead's next
   * version (the scoring worker only). Another workspace's campaign or person is not found.
   */
  scoreLead(
    campaignId: string,
    contactId: string,
    proposals?: LeadScoreProposals,
  ): Promise<StoredLeadScore>;
  /** The lead's current score, or null (scores.read). */
  current(
    campaignId: string,
    contactId: string,
  ): Promise<StoredLeadScore | null>;
  /** One lead score (scores.read). */
  get(scoreId: string): Promise<StoredLeadScore>;
  /** Recalculates a stored score from its stored inputs and compares (scores.read). */
  reproduce(scoreId: string): Promise<LeadScoreCheck>;
}

const LEAD_SCORE_INCLUDE = {
  evidence: {
    select: { evidenceId: true },
    orderBy: { evidenceId: 'asc' as const },
  },
} satisfies Prisma.ScoreInclude;

type LeadScoreRow = Prisma.ScoreGetPayload<{
  include: typeof LEAD_SCORE_INCLUDE;
}>;

const text = (value: string | null) =>
  value === null ? null : value.slice(0, LEAD_SCORE_VALUE_CHARS);

/** Stored rows are validated again when read; a score without inputs isn't a lead score. */
function toStored(row: LeadScoreRow): StoredLeadScore {
  if (
    row.inputs === null ||
    row.campaignId === null ||
    row.contactId === null ||
    row.version === null ||
    row.band === null ||
    row.inputSha256 === null ||
    row.methodVersion === null ||
    row.campaignVersion === null
  ) {
    throw new RecordNotFoundError('lead score');
  }
  const inputs = leadScoreInputsSchema.parse(row.inputs);
  return {
    id: row.id,
    campaignId: row.campaignId,
    contactId: row.contactId,
    version: row.version,
    value: row.value,
    band: row.band,
    reason: row.reason,
    method: row.method,
    methodVersion: row.methodVersion,
    inputSha256: row.inputSha256,
    campaignVersion: row.campaignVersion,
    researchId: row.researchId,
    verificationId: row.verificationId,
    evidenceIds: row.evidence.map((item) => item.evidenceId),
    scoredAt: row.scoredAt,
    inputs,
    result: calculateLeadScore(inputs.config, inputs.assessments),
  };
}

export function createLeadScoringRepository(
  prisma: PrismaClient,
  tenantId: string,
  actor: TenantActor,
  now: () => Date,
): LeadScoringRepository {
  const worker = (operation: string) => {
    if (actor.kind !== 'system') {
      throw new ActorNotAllowedError(operation);
    }
  };

  /** A malformed id is simply not a record of this workspace. */
  const idOrNotFound = (rawId: string, entity: string) => {
    const parsed = uuidSchema.safeParse(rawId);
    if (!parsed.success) {
      throw new RecordNotFoundError(entity);
    }
    return parsed.data;
  };

  /** The company's current research version (task 09C) and its industry fact, if any. */
  async function currentResearch(
    tx: Prisma.TransactionClient,
    organizationId: string,
  ): Promise<{
    readonly snapshot: LeadScoreFacts['research'];
    readonly facts: readonly CurrentFact[];
  }> {
    const row = await tx.research.findFirst({
      where: {
        tenantId,
        organizationId,
        contactId: null,
        status: 'COMPLETED',
        origin: { not: null },
        version: { not: null },
      },
      orderBy: [{ version: 'desc' }, { id: 'desc' }],
      select: { id: true, version: true, completedAt: true, findings: true },
    });
    if (row?.version == null || row.completedAt === null) {
      return { snapshot: null, facts: [] };
    }
    // A version whose findings are out of shape gives no facts, rather than unchecked ones.
    const findings = researchFindingsSchema.safeParse(row.findings);
    const all = findings.success ? effectiveFacts(findings.data).facts : [];
    const fact = all.find((item) => item.field === 'industry');
    const snapshot = {
      id: row.id,
      version: row.version,
      completedAt: row.completedAt.toISOString(),
      industry:
        fact === undefined || fact.evidence.length === 0
          ? null
          : {
              value: fact.value.slice(0, LEAD_SCORE_VALUE_CHARS),
              evidenceIds: fact.evidence
                .map((item) => item.evidenceId)
                .slice(0, 3),
            },
    };
    return {
      snapshot,
      facts: all.map((item) => ({
        field: item.field,
        value: item.value,
        evidenceIds: item.evidence.map((ref) => ref.evidenceId),
      })),
    };
  }

  /**
   * The agent's proposals, checked again: only supported need and timing, proposed by the model,
   * citing research facts of the current version (field, value and evidence rows as stored).
   */
  function checkedProposals(
    proposals: LeadScoreProposals,
    research: LeadScoreFacts['research'],
    facts: readonly CurrentFact[],
  ): LeadFactorAssessment[] {
    const issues: { path: string; message: string }[] = [];
    proposals.assessments.forEach((assessment, index) => {
      const path = `proposals.${String(index)}`;
      if (
        !(QUALIFICATION_MODEL_FACTORS as readonly string[]).includes(
          assessment.factor,
        ) ||
        assessment.assessedBy !== 'model'
      ) {
        issues.push({
          path,
          message:
            'Only the model proposes, and only supported need and timing.',
        });
        return;
      }
      if (assessment.status !== 'assessed') {
        return;
      }
      for (const evidence of assessment.evidence) {
        const fact =
          evidence.kind === 'research_fact' &&
          research !== null &&
          evidence.researchId === research.id &&
          evidence.researchVersion === research.version
            ? facts.find(
                (item) =>
                  item.field === evidence.field &&
                  item.value.slice(0, LEAD_SCORE_VALUE_CHARS) ===
                    evidence.value,
              )
            : undefined;
        if (
          fact === undefined ||
          evidence.kind !== 'research_fact' ||
          !evidence.evidenceIds.every((id) => fact.evidenceIds.includes(id))
        ) {
          issues.push({
            path,
            message:
              'A proposal cites something that is not a fact of the current research.',
          });
        }
      }
    });
    if (issues.length > 0) {
      throw new LeadScoreInputError(issues);
    }
    return [...proposals.assessments];
  }

  async function load(
    db: Prisma.TransactionClient | PrismaClient,
    scoreId: string,
  ): Promise<LeadScoreRow> {
    const row = await db.score.findUnique({
      where: { tenantId_id: { tenantId, id: scoreId } },
      include: LEAD_SCORE_INCLUDE,
    });
    if (row === null) {
      throw new RecordNotFoundError('lead score');
    }
    return row;
  }

  return {
    async scoreLead(rawCampaignId, rawContactId, proposals) {
      worker('lead_score.calculate');
      const campaignId = idOrNotFound(rawCampaignId, 'campaign');
      const contactId = idOrNotFound(rawContactId, 'contact');
      return prisma.$transaction(async (tx) => {
        // Versions of one lead are numbered under a lock, so no clock decides which is current.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`lead-score:${tenantId}:${campaignId}:${contactId}`}, 0))`;
        const campaign = await tx.campaign.findUnique({
          where: { tenantId_id: { tenantId, id: campaignId } },
          select: {
            id: true,
            version: true,
            icpId: true,
            audienceFilters: true,
            scoring: true,
          },
        });
        if (campaign === null) {
          throw new RecordNotFoundError('campaign');
        }
        const contact = await tx.contact.findUnique({
          where: { tenantId_id: { tenantId, id: contactId } },
          select: {
            id: true,
            title: true,
            countryCode: true,
            normalizedEmail: true,
            organizationId: true,
          },
        });
        if (contact === null) {
          throw new RecordNotFoundError('contact');
        }
        const icp =
          campaign.icpId === null
            ? null
            : await tx.icp.findUnique({
                where: { tenantId_id: { tenantId, id: campaign.icpId } },
                select: { criteria: true },
              });
        // Criteria out of shape target nothing (their factors are missing), never guesses.
        const criteria = icpCriteriaSchema.safeParse(icp?.criteria);
        // The campaign's own sections were validated when saved; out of shape here is a fault.
        const filters = audienceFiltersSchema.parse(
          campaign.audienceFilters ?? {},
        );
        const config =
          campaign.scoring === null
            ? structuredClone(DEFAULT_LEAD_SCORING_CONFIG)
            : leadScoringConfigSchema.parse(campaign.scoring);
        const organization =
          contact.organizationId === null
            ? null
            : await tx.organization.findUnique({
                where: {
                  tenantId_id: { tenantId, id: contact.organizationId },
                },
                select: {
                  id: true,
                  industry: true,
                  employeeCount: true,
                  countryCode: true,
                },
              });
        const current =
          organization === null
            ? { snapshot: null, facts: [] }
            : await currentResearch(tx, organization.id);
        const research = current.snapshot;
        const check =
          contact.normalizedEmail === null
            ? null
            : await tx.verification.findFirst({
                where: {
                  tenantId,
                  contactId,
                  normalizedEmail: contact.normalizedEmail,
                },
                orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
                select: { id: true, status: true, checkedAt: true },
              });
        const asOf = now();
        const facts: LeadScoreFacts = {
          asOf: asOf.toISOString(),
          targets: scoringTargets(
            filters,
            criteria.success ? criteria.data : null,
          ),
          contact: {
            id: contact.id,
            title: text(contact.title),
            countryCode: contact.countryCode,
            hasEmail: contact.normalizedEmail !== null,
          },
          organization:
            organization === null
              ? null
              : {
                  id: organization.id,
                  industry: text(organization.industry),
                  employeeCount: organization.employeeCount,
                  countryCode: organization.countryCode,
                },
          research,
          emailCheck:
            check === null
              ? null
              : {
                  verificationId: check.id,
                  status: check.status,
                  checkedAt: check.checkedAt.toISOString(),
                },
        };
        const proposed =
          proposals === undefined
            ? []
            : checkedProposals(proposals, research, current.facts);
        // The rules assess every factor; the checked proposals replace theirs.
        const assessments = assessLeadFactors(facts).map(
          (assessment) =>
            proposed.find((item) => item.factor === assessment.factor) ??
            assessment,
        );
        const result = calculateLeadScore(config, assessments);
        // Validated before it's written, like every stored JSON.
        const inputs = leadScoreInputsSchema.parse({
          v: 1,
          method: LEAD_SCORE_METHOD,
          rules: LEAD_SCORE_RULES_VERSION,
          config,
          configSource: campaign.scoring === null ? 'default' : 'campaign',
          campaign: {
            id: campaign.id,
            version: campaign.version,
            icpId: campaign.icpId,
          },
          facts,
          assessments,
          ...(proposals === undefined ? {} : { agent: proposals.agent }),
        });
        const evidenceIds = leadScoreEvidenceIds(inputs.assessments);
        if (evidenceIds.length > 0) {
          // Every cited row is this company's evidence in this workspace.
          const found = await tx.evidence.count({
            where: {
              tenantId,
              id: { in: evidenceIds },
              organizationId: organization?.id ?? null,
            },
          });
          if (found !== evidenceIds.length) {
            throw new RecordNotFoundError('evidence');
          }
        }
        const previous = await tx.score.findFirst({
          where: { tenantId, campaignId, contactId, version: { not: null } },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        const created = await tx.score.create({
          data: {
            tenantId,
            icpId: campaign.icpId,
            campaignId,
            campaignVersion: campaign.version,
            contactId,
            researchId: research?.id ?? null,
            verificationId: check?.id ?? null,
            value: result.value,
            band: result.band,
            reason: describeLeadScore(result),
            // AI when an accepted model proposal counts (task 10C), else the rules alone.
            method: assessments.some(
              (item) =>
                item.assessedBy === 'model' && item.status === 'assessed',
            )
              ? 'AI'
              : 'RULES',
            methodVersion: LEAD_SCORE_METHOD,
            inputs,
            inputSha256: payloadSha256(inputs),
            version: (previous?.version ?? 0) + 1,
            scoredAt: asOf,
            createdAt: asOf,
          },
          select: { id: true },
        });
        if (evidenceIds.length > 0) {
          await tx.scoreEvidence.createMany({
            data: evidenceIds.map((evidenceId) => ({
              tenantId,
              scoreId: created.id,
              evidenceId,
              createdAt: asOf,
            })),
          });
        }
        return toStored(await load(tx, created.id));
      });
    },

    async current(rawCampaignId, rawContactId) {
      requireReadPermissionOrSystem(actor, 'scores.read');
      const campaignId = idOrNotFound(rawCampaignId, 'campaign');
      const contactId = idOrNotFound(rawContactId, 'contact');
      const row = await prisma.score.findFirst({
        where: { tenantId, campaignId, contactId, version: { not: null } },
        orderBy: { version: 'desc' },
        include: LEAD_SCORE_INCLUDE,
      });
      return row === null ? null : toStored(row);
    },

    async get(rawScoreId) {
      requireReadPermissionOrSystem(actor, 'scores.read');
      return toStored(
        await load(prisma, idOrNotFound(rawScoreId, 'lead score')),
      );
    },

    async reproduce(rawScoreId) {
      requireReadPermissionOrSystem(actor, 'scores.read');
      const row = await load(prisma, idOrNotFound(rawScoreId, 'lead score'));
      if (row.inputs === null || row.band === null) {
        throw new RecordNotFoundError('lead score');
      }
      const check = reproduceLeadScore(row.inputs, {
        value: row.value,
        band: row.band,
      });
      const parsed = leadScoreInputsSchema.safeParse(row.inputs);
      const cited = row.evidence.map((item) => item.evidenceId);
      const named = parsed.success
        ? leadScoreEvidenceIds(parsed.data.assessments)
        : [];
      return {
        ...check,
        // The stored JSON itself, not its parsed form, so no normalization hides a change.
        hashMatches: payloadSha256(row.inputs) === row.inputSha256,
        evidenceMatches:
          parsed.success && named.join(',') === [...cited].sort().join(','),
      };
    },
  };
}
