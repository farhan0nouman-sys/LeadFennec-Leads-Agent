// Website research of a company (task 09C, docs/decisions.md D-09C-*). Members request a run,
// read the current version with its history and dated evidence, and correct a field; the
// research worker reads the pages, stores each page it read as a source record and each extract
// it used as evidence, and saves the outcome as a new version. A completed version never
// changes (database trigger): a refresh, a reuse of unchanged inputs and a correction each add
// a version that points to the one it continues. Everything a page or a model wrote is
// untrusted text; findings are validated against researchFindingsSchema before every write.
import { randomUUID } from 'node:crypto';
import {
  RESEARCH_FRESHNESS,
  WEBSITE_RESEARCH_FIELDS,
  businessProfileSchema,
  icpCriteriaSchema,
  offerSchema,
  researchCorrectionRequestSchema,
  researchFindingsSchema,
  researchRequestSchema,
  type OrganizationResearch,
  type ResearchAccepted,
  type ResearchCampaignContext,
  type ResearchCorrection,
  type ResearchCorrectionRequest,
  type ResearchEvidence,
  type ResearchFact,
  type ResearchFindings,
  type ResearchHistoryItem,
  type ResearchPage,
  type ResearchVersion,
  type WebsiteResearchField,
} from '@lead-fennec-ai/shared';
import { z } from 'zod';
import type {
  Prisma,
  PrismaClient,
  Research,
} from '../generated/prisma/client.js';
import { payloadSha256 } from '../payload-hash.js';
import {
  ActorNotAllowedError,
  uuidSchema,
  type TenantActor,
} from './actors.js';
import { writeAuditRecord } from './audit.js';
import {
  RecordNotFoundError,
  requirePermission,
  requireReadPermission,
} from './authorization.js';

/** The job a request queues; its payload is the research id and the campaign, if any. */
export const RESEARCH_TASK_TYPE = 'website_research.run';

export const researchTaskPayloadSchema = z.strictObject({
  researchId: z.uuid(),
  campaignId: z.uuid().nullable(),
});

/** The company has no website or domain to read. */
export class ResearchNotPossibleError extends Error {
  constructor() {
    super('This company has no website or domain to research.');
    this.name = 'ResearchNotPossibleError';
  }
}

/** A correction named a version that is no longer the current one. */
export class ResearchVersionConflictError extends Error {
  constructor() {
    super('The research changed since you opened it. Reload it and try again.');
    this.name = 'ResearchVersionConflictError';
  }
}

/** A correction that can't apply (e.g. restoring a field nobody corrected). */
export class ResearchCorrectionError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = 'ResearchCorrectionError';
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;
const HISTORY_LIMIT = 20;
/** Page text kept with a stored page: more than any extract uses (6000 characters). */
const STORED_TEXT_CHARS = 20_000;

/** What the worker needs to run a version. */
export interface ResearchRunPlan {
  readonly researchId: string;
  readonly organization: {
    readonly id: string;
    readonly name: string;
    readonly domain: string | null;
    readonly websiteUrl: string | null;
  };
  /** The first page to read: the website, else https://<domain>/. */
  readonly startUrl: string;
  readonly refresh: boolean;
  readonly fields: readonly WebsiteResearchField[];
  readonly context: {
    readonly campaignId: string | null;
    readonly campaign: ResearchCampaignContext;
  };
}

/** A page fetched by the website fetcher (task 09A), as the worker hands it over. */
export interface FetchedPage {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly status: number;
  readonly contentType: string;
  readonly retrievedAt: Date;
  readonly contentSha256: string;
  readonly textSha256: string;
  readonly title: string | null;
  readonly text: string;
  readonly textTruncated: boolean;
  readonly links: readonly {
    readonly url: string;
    readonly text: string;
    readonly sameSite: boolean;
  }[];
}

/** A page as stored (a WEBSITE source record). */
export interface StoredPage {
  readonly sourceRecordId: string;
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly title: string | null;
  readonly retrievedAt: Date;
  readonly contentSha256: string;
  readonly text: string;
  readonly links: FetchedPage['links'];
}

/** One extract the agent read (built by the worker with pageExtracts). */
export interface RunExtract {
  readonly label: string;
  readonly sourceRecordId: string;
  readonly url: string;
  readonly retrievedAt: Date;
  readonly contentSha256: string;
  readonly text: string;
}

type DraftFindings = Omit<
  ResearchFindings,
  'v' | 'fields' | 'context' | 'pages' | 'extracts' | 'corrections' | 'facts'
> & {
  readonly facts: readonly {
    readonly field: WebsiteResearchField;
    readonly value: string;
    readonly confidence: ResearchFindings['confidence'];
    readonly evidence: readonly {
      readonly label: string;
      readonly quote: string;
    }[];
  }[];
};

/** What the run looked for, and in which context (from its plan). */
export interface RunContext {
  readonly fields: WebsiteResearchField[];
  readonly context: ResearchFindings['context'];
}

export type CompleteRunInput = { readonly run: RunContext } & (
  | {
      /** The model read the extracts. */
      readonly kind: 'model';
      readonly resultStatus: 'COMPLETED' | 'REVIEW_REQUIRED';
      readonly inputSha256: string;
      readonly pages: readonly ResearchPage[];
      readonly extracts: readonly RunExtract[];
      readonly findings: DraftFindings;
    }
  | {
      /** The extracts equal those of `reuseOf`: its findings are reused, no model call. */
      readonly kind: 'reuse';
      readonly reuseOf: string;
      readonly inputSha256: string;
      readonly pages: readonly ResearchPage[];
      readonly extracts: readonly RunExtract[];
    }
  | {
      /** No page had text. */
      readonly kind: 'no_content';
      readonly pages: readonly ResearchPage[];
    }
);

export interface ResearchRepository {
  /** Queues a run, or answers with a running or fresh one. Needs research.run. */
  request(
    organizationId: string,
    input: z.input<typeof researchRequestSchema>,
  ): Promise<ResearchAccepted>;
  /** The company, its current version, an active run and the history. Needs contacts.read. */
  organizationResearch(organizationId: string): Promise<OrganizationResearch>;
  /** One version with its evidence. Needs contacts.read. */
  version(organizationId: string, researchId: string): Promise<ResearchVersion>;
  /** A person's correction of one field: a new version, audited. Needs research.run. */
  correct(
    organizationId: string,
    input: ResearchCorrectionRequest,
  ): Promise<ResearchVersion>;

  // The research worker only (system actor).
  beginRun(
    researchId: string,
    campaignId: string | null,
  ): Promise<
    | { readonly state: 'stopped' }
    | { readonly state: 'run'; readonly plan: ResearchRunPlan }
  >;
  /** The newest stored copy of a page read within `maxAgeMs`, if any. */
  freshPage(
    organizationId: string,
    url: string,
    maxAgeMs: number,
  ): Promise<StoredPage | null>;
  savePage(organizationId: string, page: FetchedPage): Promise<StoredPage>;
  /** The newest completed version with these inputs, if any (reused instead of the model). */
  reusable(
    organizationId: string,
    inputSha256: string,
  ): Promise<{ readonly id: string } | null>;
  completeRun(researchId: string, input: CompleteRunInput): Promise<void>;
  /** Back to PENDING, to be tried again (the job retries). */
  retryRun(researchId: string, errorCode: string): Promise<void>;
  failRun(researchId: string, errorCode: string): Promise<void>;
}

const iso = (date: Date) => date.toISOString();
const errorCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

/** The start page: the website as stored, else the domain's home page over https. */
export function researchStartUrl(organization: {
  readonly domain: string | null;
  readonly websiteUrl: string | null;
}): string | null {
  if (organization.websiteUrl !== null) {
    try {
      const url = new URL(organization.websiteUrl);
      if (url.protocol === 'http:' || url.protocol === 'https:') {
        url.hash = '';
        return url.href;
      }
    } catch {
      // Fall back to the domain.
    }
  }
  return organization.domain === null
    ? null
    : `https://${organization.domain}/`;
}

/** The facts of a version after its corrections (D-09C-04). */
export function effectiveFacts(findings: ResearchFindings): {
  readonly facts: ResearchFact[];
  readonly unknownFields: WebsiteResearchField[];
  readonly rejectedFields: WebsiteResearchField[];
} {
  const corrections = new Map(
    findings.corrections.map((correction) => [correction.field, correction]),
  );
  const facts: ResearchFact[] = [];
  const rejectedFields: WebsiteResearchField[] = [];
  for (const field of findings.fields) {
    const correction = corrections.get(field);
    if (correction?.action === 'reject') {
      rejectedFields.push(field);
      continue;
    }
    if (correction?.action === 'set' && correction.value !== null) {
      facts.push({
        field,
        value: correction.value,
        source: 'person',
        confidence: null,
        evidence: [
          { evidenceId: correction.evidenceId, label: null, quote: null },
        ],
        note: correction.note,
      });
      continue;
    }
    for (const fact of findings.facts.filter((item) => item.field === field)) {
      facts.push({
        field,
        value: fact.value,
        source: 'page',
        confidence: fact.confidence,
        evidence: fact.evidence.map((item) => ({
          evidenceId: item.evidenceId,
          label: item.label,
          quote: item.quote,
        })),
        note: null,
      });
    }
  }
  const known = new Set(facts.map((fact) => fact.field));
  return {
    facts,
    unknownFields: findings.fields.filter((field) => !known.has(field)),
    rejectedFields,
  };
}

function historyItem(row: Research): ResearchHistoryItem {
  return {
    id: row.id,
    version: row.version,
    origin: row.origin,
    status: row.status,
    resultStatus: row.resultStatus,
    basedOnId: row.basedOnId,
    refresh: row.refresh,
    requestedAt: iso(row.createdAt),
    completedAt: row.completedAt === null ? null : iso(row.completedAt),
    errorCode: row.errorCode,
    model: row.model,
    promptVersion: row.promptVersion,
  };
}

/** The campaign context a run gives the agent: a snapshot, so later edits don't change it. */
async function campaignContext(
  db: Prisma.TransactionClient | PrismaClient,
  tenantId: string,
  campaignId: string | null,
): Promise<ResearchCampaignContext> {
  if (campaignId === null) {
    return { businessProfile: null, offer: null, icp: null };
  }
  const campaign = await db.campaign.findUnique({
    where: { tenantId_id: { tenantId, id: campaignId } },
    select: { businessProfile: true, offer: true, icpId: true },
  });
  if (campaign === null) {
    throw new RecordNotFoundError('campaign');
  }
  const icp =
    campaign.icpId === null
      ? null
      : await db.icp.findUnique({
          where: { tenantId_id: { tenantId, id: campaign.icpId } },
          select: { criteria: true },
        });
  // Stored configuration is checked again: anything out of shape is left out, not trusted.
  const profile = businessProfileSchema.safeParse(campaign.businessProfile);
  const offer = offerSchema.safeParse(campaign.offer);
  const criteria = icpCriteriaSchema.safeParse(icp?.criteria);
  return {
    businessProfile: profile.success ? profile.data : null,
    offer: offer.success ? offer.data : null,
    icp: criteria.success ? criteria.data : null,
  };
}

export function createResearchRepository(
  prisma: PrismaClient,
  tenantId: string,
  actor: TenantActor,
  now: () => Date,
): ResearchRepository {
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

  async function organizationOrNotFound(
    db: Prisma.TransactionClient | PrismaClient,
    organizationId: string,
  ) {
    const organization = await db.organization.findUnique({
      where: { tenantId_id: { tenantId, id: organizationId } },
      select: {
        id: true,
        name: true,
        normalizedDomain: true,
        websiteUrl: true,
      },
    });
    // Another workspace's company reads exactly like a missing one.
    if (organization === null) {
      throw new RecordNotFoundError('organization');
    }
    return {
      id: organization.id,
      name: organization.name,
      domain: organization.normalizedDomain,
      websiteUrl: organization.websiteUrl,
    };
  }

  /** Serializes versions of one company (completions and corrections). */
  async function lockOrganization(
    tx: Prisma.TransactionClient,
    organizationId: string,
  ) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`research:${tenantId}:${organizationId}`}, 0))`;
  }

  const companyResearch = (organizationId: string) =>
    ({ tenantId, organizationId, contactId: null }) as const;

  async function latestCompleted(
    db: Prisma.TransactionClient | PrismaClient,
    organizationId: string,
  ) {
    return db.research.findFirst({
      where: {
        ...companyResearch(organizationId),
        status: 'COMPLETED',
        origin: { not: null },
      },
      orderBy: [{ version: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
    });
  }

  async function evidenceRows(
    db: Prisma.TransactionClient | PrismaClient,
    ids: readonly string[],
  ): Promise<ResearchEvidence[]> {
    if (ids.length === 0) {
      return [];
    }
    const rows = await db.evidence.findMany({
      where: { tenantId, id: { in: [...new Set(ids)] } },
      orderBy: [{ extractLabel: 'asc' }, { capturedAt: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      kind: row.kind === 'MANUAL_NOTE' ? 'MANUAL_NOTE' : 'WEBSITE_EXCERPT',
      label: row.extractLabel,
      url: row.sourceUrl,
      capturedAt: iso(row.capturedAt),
      contentSha256: row.contentSha256,
      excerpt: row.excerpt,
    }));
  }

  async function view(
    db: Prisma.TransactionClient | PrismaClient,
    row: Research,
  ): Promise<ResearchVersion> {
    const parsed =
      row.findings === null
        ? null
        : (researchFindingsSchema.safeParse(row.findings).data ?? null);
    const effective = parsed === null ? null : effectiveFacts(parsed);
    const ids =
      parsed === null
        ? []
        : [
            ...parsed.extracts.map((extract) => extract.evidenceId),
            ...parsed.facts.flatMap((fact) =>
              fact.evidence.map((item) => item.evidenceId),
            ),
            ...parsed.corrections.map((correction) => correction.evidenceId),
          ];
    return {
      id: row.id,
      version: row.version,
      organizationId: row.organizationId ?? '',
      origin: row.origin,
      status: row.status,
      resultStatus: row.resultStatus,
      basedOnId: row.basedOnId,
      refresh: row.refresh,
      requestedAt: iso(row.createdAt),
      completedAt: row.completedAt === null ? null : iso(row.completedAt),
      errorCode: row.errorCode,
      confidence: parsed?.confidence ?? null,
      facts: effective?.facts ?? [],
      hypotheses: parsed?.hypotheses ?? [],
      unknownFields: effective?.unknownFields ?? [],
      rejectedFields: effective?.rejectedFields ?? [],
      reviewItems: parsed?.reviewItems ?? [],
      warnings: parsed?.warnings ?? [],
      ignoredInstructions: parsed?.ignoredInstructions ?? [],
      corrections: parsed?.corrections ?? [],
      pages: parsed?.pages ?? [],
      evidence: await evidenceRows(db, ids),
      usage: parsed?.usage ?? null,
      model: parsed?.model ?? null,
    };
  }

  /** Locks a version row for the worker's state changes. */
  async function lockedResearch(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw`SELECT 1 FROM "research" WHERE "tenant_id" = ${tenantId}::uuid AND "id" = ${id}::uuid FOR UPDATE`;
    const row = await tx.research.findUnique({
      where: { tenantId_id: { tenantId, id } },
    });
    if (row === null) {
      throw new RecordNotFoundError('research');
    }
    return row;
  }

  return {
    async request(organizationId, rawInput) {
      const member = requirePermission(actor, 'research.run');
      const input = researchRequestSchema.parse(rawInput);
      const orgId = idOrNotFound(organizationId, 'organization');
      const campaignId = input.campaignId ?? null;
      return prisma.$transaction(async (tx) => {
        const organization = await organizationOrNotFound(tx, orgId);
        if (researchStartUrl(organization) === null) {
          throw new ResearchNotPossibleError();
        }
        // Every referenced id is checked against the workspace first, whatever happens next.
        const context = await campaignContext(tx, tenantId, campaignId);
        const contextSha256 = payloadSha256(context);
        await lockOrganization(tx, orgId);
        const active = await tx.research.findFirst({
          where: {
            ...companyResearch(orgId),
            status: { in: ['PENDING', 'RUNNING'] },
          },
          select: { id: true },
        });
        if (active !== null) {
          return { researchId: active.id, state: 'running' } as const;
        }
        if (input.refresh !== true) {
          const fresh = await tx.research.findFirst({
            where: {
              ...companyResearch(orgId),
              status: 'COMPLETED',
              origin: { not: null },
              contextSha256,
              completedAt: {
                gte: new Date(
                  now().getTime() -
                    RESEARCH_FRESHNESS.researchFreshDays * DAY_MS,
                ),
              },
            },
            orderBy: [
              { version: { sort: 'desc', nulls: 'last' } },
              { id: 'desc' },
            ],
            select: { id: true },
          });
          if (fresh !== null) {
            return { researchId: fresh.id, state: 'fresh' } as const;
          }
        }
        const at = now();
        const row = await tx.research.create({
          data: {
            tenantId,
            organizationId: orgId,
            status: 'PENDING',
            refresh: input.refresh === true,
            contextSha256,
            createdAt: at,
          },
        });
        await tx.jobTask.create({
          data: {
            tenantId,
            taskType: RESEARCH_TASK_TYPE,
            idempotencyKey: `research:${row.id}`,
            payload: { researchId: row.id, campaignId },
            availableAt: at,
          },
        });
        await writeAuditRecord(tx, tenantId, member, {
          action: 'research.requested',
          targetType: 'research',
          targetId: row.id,
          metadata: {
            organizationId: orgId,
            refresh: input.refresh === true,
            campaignId,
          },
        });
        return { researchId: row.id, state: 'queued' } as const;
      });
    },

    async organizationResearch(organizationId) {
      requireReadPermission(actor, 'contacts.read');
      const orgId = idOrNotFound(organizationId, 'organization');
      const organization = await organizationOrNotFound(prisma, orgId);
      const rows = await prisma.research.findMany({
        where: companyResearch(orgId),
        // A timeline of requests (the API's clock); "current" is decided by version number.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: HISTORY_LIMIT,
      });
      const active =
        rows.find(
          (row) => row.status === 'PENDING' || row.status === 'RUNNING',
        ) ?? null;
      const latest = await latestCompleted(prisma, orgId);
      const fresh =
        latest?.completedAt !== null &&
        latest?.completedAt !== undefined &&
        latest.completedAt.getTime() >=
          now().getTime() - RESEARCH_FRESHNESS.researchFreshDays * DAY_MS;
      return {
        organization,
        active: active === null ? null : historyItem(active),
        current: latest === null ? null : await view(prisma, latest),
        history: rows.map(historyItem),
        fresh,
      };
    },

    async version(organizationId, researchId) {
      requireReadPermission(actor, 'contacts.read');
      const orgId = idOrNotFound(organizationId, 'organization');
      const id = idOrNotFound(researchId, 'research');
      const row = await prisma.research.findUnique({
        where: { tenantId_id: { tenantId, id } },
      });
      if (row?.organizationId !== orgId || row.contactId !== null) {
        throw new RecordNotFoundError('research');
      }
      return view(prisma, row);
    },

    async correct(organizationId, rawInput) {
      const member = requirePermission(actor, 'research.run');
      const input = researchCorrectionRequestSchema.parse(rawInput);
      const orgId = idOrNotFound(organizationId, 'organization');
      return prisma.$transaction(async (tx) => {
        await organizationOrNotFound(tx, orgId);
        await lockOrganization(tx, orgId);
        const base = await latestCompleted(tx, orgId);
        if (base?.id !== input.baseResearchId) {
          throw new ResearchVersionConflictError();
        }
        const findings = researchFindingsSchema.parse(base.findings);
        if (!findings.fields.includes(input.field)) {
          throw new ResearchCorrectionError(
            'field',
            'This research did not look for that field.',
          );
        }
        const kept = findings.corrections.filter(
          (correction) => correction.field !== input.field,
        );
        if (
          input.action === 'restore' &&
          kept.length === findings.corrections.length
        ) {
          throw new ResearchCorrectionError(
            'action',
            'This field has no correction to remove.',
          );
        }
        const at = now();
        const id = randomUUID();
        const noteId = randomUUID();
        const corrections: ResearchCorrection[] =
          input.action === 'restore'
            ? kept
            : [
                ...kept,
                {
                  field: input.field,
                  action: input.action,
                  value: input.action === 'set' ? (input.value ?? null) : null,
                  note: input.note,
                  evidenceId: noteId,
                  researchId: id,
                  membershipId: member.membershipId,
                  correctedAt: iso(at),
                },
              ];
        const next = researchFindingsSchema.parse({ ...findings, corrections });
        const row = await tx.research.create({
          data: {
            tenantId,
            id,
            organizationId: orgId,
            status: 'COMPLETED',
            origin: 'CORRECTION',
            version: (base.version ?? 0) + 1,
            resultStatus: base.resultStatus,
            basedOnId: base.id,
            refresh: false,
            inputSha256: base.inputSha256,
            contextSha256: base.contextSha256,
            promptSha256: base.promptSha256,
            schemaVersion: base.schemaVersion,
            modelProvider: base.modelProvider,
            model: base.model,
            promptVersion: base.promptVersion,
            summary: base.summary,
            findings: next,
            inputTokens: 0,
            outputTokens: 0,
            costMicroUsd: 0,
            startedAt: at,
            completedAt: at,
            createdAt: at,
          },
        });
        // The note is the correction's evidence (the person's own words, escaped when shown).
        await tx.evidence.create({
          data: {
            tenantId,
            id: noteId,
            kind: 'MANUAL_NOTE',
            organizationId: orgId,
            researchId: id,
            excerpt: input.note,
            capturedAt: at,
            createdAt: at,
          },
        });
        await writeAuditRecord(tx, tenantId, member, {
          action: 'research.corrected',
          targetType: 'research',
          targetId: id,
          metadata: {
            organizationId: orgId,
            basedOnId: base.id,
            field: input.field,
            correction: input.action,
          },
        });
        return view(tx, row);
      });
    },

    async beginRun(researchId, campaignId) {
      worker('website_research.begin');
      const id = idOrNotFound(researchId, 'research');
      return prisma.$transaction(async (tx) => {
        const row = await lockedResearch(tx, id);
        if (
          (row.status !== 'PENDING' && row.status !== 'RUNNING') ||
          row.organizationId === null ||
          row.contactId !== null
        ) {
          return { state: 'stopped' } as const;
        }
        const organization = await organizationOrNotFound(
          tx,
          row.organizationId,
        );
        const startUrl = researchStartUrl(organization);
        if (startUrl === null) {
          return { state: 'stopped' } as const;
        }
        const campaign = await campaignContext(tx, tenantId, campaignId);
        if (row.status === 'PENDING') {
          await tx.research.update({
            where: { tenantId_id: { tenantId, id } },
            data: {
              status: 'RUNNING',
              startedAt: now(),
              contextSha256: payloadSha256(campaign),
              errorCode: null,
            },
          });
        }
        return {
          state: 'run',
          plan: {
            researchId: id,
            organization,
            startUrl,
            refresh: row.refresh,
            fields: [...WEBSITE_RESEARCH_FIELDS],
            context: { campaignId, campaign },
          },
        } as const;
      });
    },

    async freshPage(organizationId, url, maxAgeMs) {
      worker('website_research.page');
      const orgId = idOrNotFound(organizationId, 'organization');
      const row = await prisma.sourceRecord.findFirst({
        where: {
          tenantId,
          provider: 'WEBSITE',
          organizationId: orgId,
          externalId: url,
          fetchedAt: { gte: new Date(now().getTime() - maxAgeMs) },
        },
        orderBy: [{ fetchedAt: 'desc' }, { id: 'desc' }],
      });
      if (row === null) {
        return null;
      }
      const payload = storedPagePayloadSchema.safeParse(row.payload);
      if (!payload.success) {
        return null;
      }
      return {
        sourceRecordId: row.id,
        requestedUrl: payload.data.requestedUrl,
        finalUrl: payload.data.finalUrl,
        title: payload.data.title,
        retrievedAt: row.fetchedAt,
        contentSha256: payload.data.contentSha256,
        text: payload.data.text,
        links: payload.data.links,
      };
    },

    async savePage(organizationId, page) {
      worker('website_research.page');
      const orgId = idOrNotFound(organizationId, 'organization');
      const payload = storedPagePayloadSchema.parse({
        requestedUrl: page.requestedUrl,
        finalUrl: page.finalUrl,
        status: page.status,
        contentType: page.contentType,
        retrievedAt: iso(page.retrievedAt),
        contentSha256: page.contentSha256,
        textSha256: page.textSha256,
        title: page.title,
        text: page.text.slice(0, STORED_TEXT_CHARS),
        textTruncated:
          page.textTruncated || page.text.length > STORED_TEXT_CHARS,
        links: page.links.slice(0, 100),
      });
      const row = await prisma.sourceRecord.create({
        data: {
          tenantId,
          provider: 'WEBSITE',
          externalId: page.requestedUrl,
          organizationId: orgId,
          payload,
          payloadSha256: payloadSha256(payload),
          fetchedAt: page.retrievedAt,
          createdAt: page.retrievedAt,
        },
      });
      return {
        sourceRecordId: row.id,
        requestedUrl: payload.requestedUrl,
        finalUrl: payload.finalUrl,
        title: payload.title,
        retrievedAt: page.retrievedAt,
        contentSha256: payload.contentSha256,
        text: payload.text,
        links: payload.links,
      };
    },

    async reusable(organizationId, inputSha256) {
      worker('website_research.reuse');
      const orgId = idOrNotFound(organizationId, 'organization');
      const row = await prisma.research.findFirst({
        where: {
          ...companyResearch(orgId),
          status: 'COMPLETED',
          origin: { not: null },
          inputSha256,
        },
        orderBy: [{ version: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
        select: { id: true },
      });
      return row;
    },

    async completeRun(researchId, input) {
      worker('website_research.complete');
      const id = idOrNotFound(researchId, 'research');
      await prisma.$transaction(async (tx) => {
        const row = await lockedResearch(tx, id);
        if (row.status !== 'RUNNING' || row.organizationId === null) {
          throw new Error('Only a running company research can be completed.');
        }
        const orgId = row.organizationId;
        await lockOrganization(tx, orgId);
        // Corrections stay with the company: they are carried into every later version.
        const previous = await latestCompleted(tx, orgId);
        const previousFindings =
          previous === null
            ? null
            : (researchFindingsSchema.safeParse(previous.findings).data ??
              null);
        const corrections = previousFindings?.corrections ?? [];
        const at = now();
        const runContext = input.run;

        // One evidence row per extract read now, dated when its page was read.
        const extracts = input.kind === 'no_content' ? [] : input.extracts;
        const evidenceIds = new Map<string, string>();
        for (const extract of extracts) {
          const evidenceId = randomUUID();
          evidenceIds.set(extract.label, evidenceId);
          await tx.evidence.create({
            data: {
              tenantId,
              id: evidenceId,
              kind: 'WEBSITE_EXCERPT',
              organizationId: orgId,
              researchId: id,
              sourceRecordId: extract.sourceRecordId,
              sourceUrl: extract.url,
              excerpt: extract.text,
              capturedAt: extract.retrievedAt,
              extractLabel: extract.label,
              contentSha256: extract.contentSha256,
              createdAt: at,
            },
          });
        }
        const evidenceFor = (label: string) => {
          const evidenceId = evidenceIds.get(label);
          if (evidenceId === undefined) {
            throw new Error(`No evidence for extract ${label}.`);
          }
          return evidenceId;
        };
        const storedExtracts = extracts.map((extract) => ({
          label: extract.label,
          evidenceId: evidenceFor(extract.label),
          url: extract.url,
          retrievedAt: iso(extract.retrievedAt),
          contentSha256: extract.contentSha256,
          textSha256: payloadSha256(extract.text),
        }));

        let findings: ResearchFindings;
        let resultStatus: 'COMPLETED' | 'REVIEW_REQUIRED' | 'NO_CONTENT';
        let origin: 'MODEL' | 'REUSED';
        let basedOnId: string | null = previous?.id ?? null;
        let model: ResearchFindings['model'] = null;
        if (input.kind === 'reuse') {
          const base = await tx.research.findUnique({
            where: { tenantId_id: { tenantId, id: input.reuseOf } },
          });
          const baseFindings =
            base === null
              ? null
              : researchFindingsSchema.safeParse(base.findings).data;
          if (
            base?.organizationId !== orgId ||
            baseFindings === undefined ||
            baseFindings === null
          ) {
            throw new Error('The version to reuse is not usable.');
          }
          origin = 'REUSED';
          basedOnId = base.id;
          resultStatus = base.resultStatus ?? 'COMPLETED';
          model = baseFindings.model;
          findings = {
            ...baseFindings,
            pages: [...input.pages],
            extracts: storedExtracts,
            facts: baseFindings.facts.map((fact) => ({
              ...fact,
              evidence: fact.evidence.map((item) => ({
                ...item,
                evidenceId: evidenceFor(item.label),
              })),
            })),
            corrections,
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              costMicroUsd: 0,
              modelCalls: 0,
            },
          };
        } else if (input.kind === 'model') {
          origin = 'MODEL';
          resultStatus = input.resultStatus;
          model = input.findings.model;
          findings = {
            v: 1,
            fields: runContext.fields,
            context: runContext.context,
            pages: [...input.pages],
            extracts: storedExtracts,
            facts: input.findings.facts.map((fact) => ({
              field: fact.field,
              value: fact.value,
              confidence: fact.confidence,
              evidence: fact.evidence.map((item) => ({
                label: item.label,
                evidenceId: evidenceFor(item.label),
                quote: item.quote,
              })),
            })),
            hypotheses: input.findings.hypotheses,
            unknownFields: input.findings.unknownFields,
            reviewItems: input.findings.reviewItems,
            warnings: input.findings.warnings,
            ignoredInstructions: input.findings.ignoredInstructions,
            confidence: input.findings.confidence,
            corrections,
            usage: input.findings.usage,
            model: input.findings.model,
          };
        } else {
          origin = 'MODEL';
          resultStatus = 'NO_CONTENT';
          findings = {
            v: 1,
            fields: runContext.fields,
            context: runContext.context,
            pages: [...input.pages],
            extracts: [],
            facts: [],
            hypotheses: [],
            unknownFields: runContext.fields,
            reviewItems: [],
            warnings: [],
            ignoredInstructions: [],
            confidence: 'low',
            corrections,
            usage: {
              inputTokens: 0,
              outputTokens: 0,
              costMicroUsd: 0,
              modelCalls: 0,
            },
            model: null,
          };
        }
        const valid = researchFindingsSchema.parse(findings);
        const summary =
          valid.facts.find((fact) => fact.field === 'company_summary')?.value ??
          null;
        await tx.research.update({
          where: { tenantId_id: { tenantId, id } },
          data: {
            status: 'COMPLETED',
            origin,
            version: (previous?.version ?? 0) + 1,
            resultStatus,
            basedOnId,
            inputSha256: input.kind === 'no_content' ? null : input.inputSha256,
            promptSha256: model?.promptSha256 ?? null,
            schemaVersion: model?.schema ?? null,
            modelProvider: model?.provider ?? null,
            model: model?.model ?? null,
            promptVersion: model?.prompt ?? null,
            summary,
            findings: valid,
            inputTokens: valid.usage.inputTokens,
            outputTokens: valid.usage.outputTokens,
            costMicroUsd:
              valid.usage.costMicroUsd === null
                ? null
                : BigInt(valid.usage.costMicroUsd),
            errorCode: null,
            completedAt: at,
          },
        });
        await writeAuditRecord(tx, tenantId, actor, {
          action: 'research.completed',
          targetType: 'research',
          targetId: id,
          metadata: {
            organizationId: orgId,
            origin,
            resultStatus,
            pages: valid.pages.length,
            modelCalls: valid.usage.modelCalls,
          },
        });
      });
    },

    async retryRun(researchId, errorCode) {
      worker('website_research.retry');
      const id = idOrNotFound(researchId, 'research');
      const code = errorCodeSchema.parse(errorCode);
      await prisma.$transaction(async (tx) => {
        const row = await lockedResearch(tx, id);
        if (row.status === 'RUNNING' || row.status === 'PENDING') {
          await tx.research.update({
            where: { tenantId_id: { tenantId, id } },
            data: { status: 'PENDING', errorCode: code },
          });
        }
      });
    },

    async failRun(researchId, errorCode) {
      worker('website_research.fail');
      const id = idOrNotFound(researchId, 'research');
      const code = errorCodeSchema.parse(errorCode);
      await prisma.$transaction(async (tx) => {
        const row = await lockedResearch(tx, id);
        if (row.status !== 'RUNNING' && row.status !== 'PENDING') {
          return;
        }
        await tx.research.update({
          where: { tenantId_id: { tenantId, id } },
          data: { status: 'FAILED', errorCode: code, completedAt: now() },
        });
        await writeAuditRecord(tx, tenantId, actor, {
          action: 'research.failed',
          targetType: 'research',
          targetId: id,
          metadata: { organizationId: row.organizationId, errorCode: code },
        });
      });
    },
  };
}

const storedPagePayloadSchema = z.strictObject({
  requestedUrl: z.string().max(2048),
  finalUrl: z.string().max(2048),
  status: z.int(),
  contentType: z.string().max(100),
  retrievedAt: z.iso.datetime(),
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  textSha256: z.string().regex(/^[0-9a-f]{64}$/),
  title: z.string().max(300).nullable(),
  text: z.string().max(STORED_TEXT_CHARS),
  textTruncated: z.boolean(),
  links: z
    .array(
      z.strictObject({
        url: z.string().max(2048),
        text: z.string().max(200),
        sameSite: z.boolean(),
      }),
    )
    .max(100),
});
