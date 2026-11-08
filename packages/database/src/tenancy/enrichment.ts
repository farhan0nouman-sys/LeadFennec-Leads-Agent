// Contact enrichment (task 08C, docs/decisions.md D-08C-*). A member asks for people at the
// companies a finished run saved; the request is an `imports` row (CONTACT_ENRICHMENT) with its
// inputs copied in: the companies (at most 25), the ICP's titles, seniorities and countries, the
// campaign's exclusions and lead list. The enrichment worker handles one company at a time, and
// each company is saved in one transaction (its people, their records, the checks of their
// addresses, the lead list, the run's counts and progress, and the usage it paid for), so an
// interrupted run resumes at the next company with nothing saved or charged twice.
//
// - People are saved through saveContacts (do-not-contact list, the campaign's exclusions, the
//   identity match): a person already in the workspace is matched, never duplicated.
// - A person looked up within ENRICHMENT_LIMITS.reuseDays is reused (knownPeople): the provider
//   isn't asked about them again, so they are never paid for twice.
// - Every person gets a source record with its outcome and reasons. People who can't be emailed
//   (no address, an address that doesn't accept email, excluded) are kept with the reasons and
//   never added to the campaign's lead list; send eligibility (10B) blocks them anyway.
// - A manual recheck of an address is limited (once a contact in 24 hours, 50 a workspace in
//   24 hours) and fails closed without a verification service.
// Every query filters by tenantId.
import {
  DEFAULT_EXCLUSIONS,
  ENRICHMENT_LIMITS,
  VERIFICATION_MAX_AGE_DAYS,
  enrichmentRequestSchema,
  enrichmentResultsQuerySchema,
  exclusionsSchema,
  icpCriteriaSchema,
  normalizeDomain,
  normalizeEmail,
  recheckRequestSchema,
  type AcceptedContact,
  type ContactDataProvider,
  type ContactIssue,
  type ContactQuality,
  type EmailCheck,
  type EmailVerificationStatus,
  type EnrichmentIssue,
  type EnrichmentResult,
  type EnrichmentTargeting,
  type PlanIssue,
  type RecheckAccepted,
  type RoleRelevance,
} from '@lead-fennec-ai/shared';
import { z } from 'zod';
import type {
  Import,
  ImportStatus,
  Prisma,
  PrismaClient,
  VerificationStatus,
} from '../generated/prisma/client.js';
import { paginate, type Page } from '../pagination.js';
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
  requireReadPermissionOrSystem,
} from './authorization.js';
import {
  CHECK_STATUS,
  contactQualities,
  RECHECK_TASK_TYPE,
  recheckKeyPrefix,
} from './contact-quality.js';
import {
  saveContacts,
  type ContactSaveOutcome,
  type IncomingContact,
  type ReusedContact,
} from './contact-store.js';
import { runView, type DiscoveryRun } from './discovery.js';
import {
  enrichmentMetadataSchema,
  type EnrichmentMetadata,
} from './enrichment-metadata.js';
import { domainAndParents } from './organization-store.js';
import { settleReservation } from './usage.js';

/** The job a request queues; its payload is only the import id. */
export const ENRICHMENT_TASK_TYPE = 'contact_enrichment.run';

/** The request can't become a run; `issues` say why, per field. */
export class EnrichmentRequestError extends Error {
  constructor(readonly issues: readonly PlanIssue[]) {
    super('The enrichment request is not valid');
    this.name = 'EnrichmentRequestError';
  }
}

/** No email verification service is set up, so addresses can't be checked (O-35). */
export class VerificationUnavailableError extends Error {
  constructor() {
    super('No email verification service is available');
    this.name = 'VerificationUnavailableError';
  }
}

/** The contact has no address to check. */
export class NoEmailAddressError extends Error {
  constructor() {
    super('The contact has no email address');
    this.name = 'NoEmailAddressError';
  }
}

/** A recheck limit is reached; it may be asked for again after `retryAfterSeconds`. */
export class RecheckLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super('Recheck limit reached');
    this.name = 'RecheckLimitError';
  }
}

/** The people provider a request is recorded with (its declaration, never its credentials). */
export interface ContactProviderInfo {
  readonly source: ContactDataProvider;
  readonly attribution: string;
}

/** Where a run stands when the worker picks it up. */
export type EnrichmentStart =
  | {
      readonly state: 'run';
      readonly provider: ContactDataProvider;
      readonly targeting: EnrichmentTargeting;
      readonly maxContactsPerCompany: number;
    }
  /** Every company is done; only finishing is left. */
  | { readonly state: 'finish' }
  /** Not to be run: cancelled, finished, or not an enrichment run. */
  | { readonly state: 'stopped'; readonly status: ImportStatus };

/** A company skipped before the provider is asked, and why. */
export interface CompanySkip {
  readonly outcome: 'EXCLUDED' | 'FAILED';
  readonly issues: readonly EnrichmentIssue[];
}

export type EnrichmentStep =
  | {
      readonly state: 'company';
      /** Position of the company in the run (0-based): saveCompany names it. */
      readonly index: number;
      readonly organization: {
        readonly id: string;
        readonly name: string;
        readonly domain: string | null;
        readonly countryCode: string | null;
      } | null;
      /** Set when the company is skipped: nothing to ask the provider. */
      readonly skip: CompanySkip | null;
    }
  | { readonly state: 'done' }
  | { readonly state: 'stopped' };

/** What happened to the check of an accepted person's address during the run. */
export type CheckInput =
  | { readonly kind: 'checked'; readonly check: EmailCheck }
  /** Checked within VERIFICATION_MAX_AGE_DAYS: not checked (or paid for) again. */
  | { readonly kind: 'fresh' }
  | {
      readonly kind: 'failed';
      readonly code: string;
      readonly retryable: boolean;
    }
  /** No verification service in this environment: the address stays unverified. */
  | { readonly kind: 'unavailable' }
  /** No address to check. */
  | { readonly kind: 'none' };

/** What the providers sent about one person (kept as provenance, never executed). */
export interface ReceivedRecord {
  readonly search: Readonly<Record<string, unknown>>;
  readonly enrichment: Readonly<Record<string, unknown>> | null;
  readonly providerClaim: 'provider_verified' | 'provider_unverified' | null;
  readonly emailDropped: 'guessed' | 'malformed' | null;
}

export type PersonInput =
  | {
      readonly kind: 'accepted';
      readonly contact: AcceptedContact;
      readonly received: ReceivedRecord;
      readonly check: CheckInput;
    }
  | {
      readonly kind: 'reused';
      readonly contactId: string;
      readonly externalId: string;
      readonly name: string;
      readonly title: string | null;
      readonly relevance: RoleRelevance;
      readonly retrievedAt: Date;
      readonly search: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: 'rejected';
      readonly externalId: string | null;
      readonly name: string | null;
      readonly title: string | null;
      readonly retrievedAt: Date;
      readonly issues: readonly ContactIssue[];
      readonly received: ReceivedRecord;
    };

/** A paid hold to settle with the company's save: what was held, and what was used. */
export interface HoldInput {
  readonly reservationId: string;
  readonly used: number;
}

export type CompanyResult =
  | { readonly kind: 'skipped'; readonly skip: CompanySkip }
  | {
      readonly kind: 'enriched';
      readonly people: readonly PersonInput[];
      readonly holds: readonly HoldInput[];
    };

export interface EnrichmentRepository {
  /**
   * Queues people search for the companies a finished run saved (imports.create and
   * contacts.write, members only). Audited.
   */
  request(
    sourceImportId: string,
    input: z.input<typeof enrichmentRequestSchema>,
    provider: ContactProviderInfo,
  ): Promise<DiscoveryRun>;
  /** What each person (or skipped company) of an enrichment run became, in order (imports.create). */
  results(
    runId: string,
    query: z.input<typeof enrichmentResultsQuerySchema>,
  ): Promise<Page<EnrichmentResult>>;
  /** The quality of contacts' data, decided now (contacts.read, or the system actor). */
  quality(contactIds: readonly string[]): Promise<Map<string, ContactQuality>>;
  /**
   * Queues a recheck of a contact's address (verifications.run, members only), within the
   * limits; `verificationAvailable` says whether this environment can check at all. Audited.
   */
  requestRecheck(
    contactId: string,
    input: z.input<typeof recheckRequestSchema>,
    verificationAvailable: boolean,
  ): Promise<RecheckAccepted>;
  /** Workers: marks the run PROCESSING (or resumes it) and says how to run it. */
  begin(runId: string): Promise<EnrichmentStart>;
  /** Workers: the next company to handle, or whether the run is done or stopped. */
  nextCompany(runId: string): Promise<EnrichmentStep>;
  /** Workers: of these people-search ids, the people looked up recently (id → contact). */
  knownPeople(
    provider: ContactDataProvider,
    externalIds: readonly string[],
  ): Promise<Map<string, string>>;
  /** Workers: of these addresses, the ones checked within VERIFICATION_MAX_AGE_DAYS. */
  freshChecks(addresses: readonly string[]): Promise<Set<string>>;
  /** Workers: saves one company's result, all or nothing; a repeated save changes nothing. */
  saveCompany(
    runId: string,
    index: number,
    result: CompanyResult,
  ): Promise<{ readonly state: 'continue' | 'done' | 'stopped' }>;
  /** Workers: marks a running run COMPLETED. */
  finish(runId: string): Promise<DiscoveryRun>;
  /** Workers: records why a run stopped; `final` marks it FAILED, else it will be retried. */
  fail(runId: string, errorCode: string, final: boolean): Promise<void>;
  /** Workers: the address a recheck checks, or null when there is none any more. */
  beginRecheck(contactId: string): Promise<string | null>;
  /** Workers: saves a recheck's result (when the contact still has the address). */
  saveRecheck(
    contactId: string,
    check: EmailCheck,
    hold: HoldInput | null,
  ): Promise<void>;
}

const NOT_FOUND = 'Not found in this workspace.';
const errorCodeSchema = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

/** Stored statuses for an email check's (D-08A-04). */
const STORED_STATUS: Readonly<
  Record<EmailVerificationStatus, VerificationStatus>
> = {
  verified: 'VALID',
  risky: 'RISKY',
  unknown: 'UNKNOWN',
  invalid: 'INVALID',
};

/** A provider record as plain JSON (a round trip drops anything that isn't data). */
const asJson = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;

/** What every result's payload carries for display; read back through this. */
const resultPayloadSchema = z.looseObject({
  kind: z.enum(['person', 'company']),
  name: z.string().nullish(),
  title: z.string().nullish(),
  company: z.string().nullish(),
  domain: z.string().nullish(),
  email: z.string().nullish(),
  reused: z.boolean().optional(),
  check: z
    .looseObject({
      status: z.enum(['verified', 'risky', 'unknown', 'invalid']),
    })
    .nullish(),
});

const resultIssuesSchema = z.array(
  z.strictObject({
    field: z
      .string()
      .transform((field) =>
        field === 'company' ||
        field === 'country' ||
        field === 'person' ||
        field === 'email'
          ? field
          : 'person',
      ),
    message: z.string(),
  }),
);

const MESSAGES = {
  noDomain: {
    field: 'company',
    message:
      "The company has no domain, so its people can't be matched or emailed at work.",
  },
  gone: { field: 'company', message: 'The company no longer exists.' },
  domainSuppressed: {
    field: 'company',
    message: "The company's domain is on the do-not-contact list.",
  },
  domainExcluded: {
    field: 'company',
    message: "The campaign excludes the company's domain.",
  },
  noEmail: {
    field: 'email',
    message: "No work address was found, so this person can't be emailed.",
  },
  invalid: {
    field: 'email',
    message:
      "The address doesn't accept email, so this person can't be emailed.",
  },
  review: {
    field: 'email',
    message:
      "The check couldn't confirm the address: a person must decide before it is emailed.",
  },
  checkFailed: {
    field: 'email',
    message:
      "The address couldn't be checked, so it stays unverified (check it again later).",
  },
  unavailable: {
    field: 'email',
    message:
      'No email verification service is set up, so the address stays unverified.',
  },
} as const satisfies Record<string, EnrichmentIssue>;

type SavedOutcome = Extract<ContactSaveOutcome, { readonly contactId: string }>;
const isSaved = (outcome: ContactSaveOutcome): outcome is SavedOutcome =>
  outcome.outcome === 'CREATED' || outcome.outcome === 'MATCHED';

const clip = (text: string, max = 300) =>
  text.length <= max ? text : `${text.slice(0, max - 1)}…`;

const personIssues = (issues: readonly ContactIssue[]): EnrichmentIssue[] =>
  issues.slice(0, 20).map((issue) => ({
    field:
      issue.path.endsWith('email') || issue.path.includes('.email.')
        ? 'email'
        : 'person',
    message: clip(issue.message),
  }));

/** The campaign's exclusions, normalized; entries that don't normalize are left out. */
function normalizedExclusions(
  value: unknown,
): NonNullable<EnrichmentMetadata['exclusions']> {
  const parsed = exclusionsSchema.safeParse(value ?? DEFAULT_EXCLUSIONS);
  const exclusions = parsed.success ? parsed.data : DEFAULT_EXCLUSIONS;
  const emails = exclusions.emails.flatMap((email) => {
    try {
      return [normalizeEmail(email).email];
    } catch {
      return [];
    }
  });
  const domains = exclusions.domains.flatMap((domain) => {
    try {
      return [normalizeDomain(domain)];
    } catch {
      return [];
    }
  });
  return {
    emails: [...new Set(emails)],
    domains: [...new Set(domains)],
    leadListIds: [...new Set(exclusions.leadListIds)],
  };
}

export function createEnrichmentRepository(
  prisma: PrismaClient,
  tenantId: string,
  actor: TenantActor,
  now: () => Date,
): EnrichmentRepository {
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

  /** The run row, locked for this transaction; not found otherwise. */
  async function locked(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<Import> {
    await tx.$queryRaw`SELECT id FROM imports WHERE tenant_id = ${tenantId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    const row = await tx.import.findUnique({
      where: { tenantId_id: { tenantId, id } },
    });
    if (row === null) {
      throw new RecordNotFoundError('import');
    }
    return row;
  }

  const metadataOf = (row: Import): EnrichmentMetadata =>
    enrichmentMetadataSchema.parse(row.sourceMetadata);

  /** The companies of a finished run, in its order, each once. */
  async function savedCompanies(
    tx: Prisma.TransactionClient,
    importId: string,
  ): Promise<string[]> {
    const records = await tx.sourceRecord.findMany({
      where: {
        tenantId,
        importId,
        outcome: { in: ['CREATED', 'MATCHED'] },
        organizationId: { not: null },
        contactId: null,
      },
      orderBy: [{ importRowNumber: 'asc' }, { id: 'asc' }],
      select: { organizationId: true },
      take: 5000,
    });
    return [
      ...new Set(
        records.flatMap((r) =>
          r.organizationId === null ? [] : [r.organizationId],
        ),
      ),
    ];
  }

  /** Settles the holds a company's work used, in the transaction that saves it. */
  async function settleHolds(
    tx: Prisma.TransactionClient,
    holds: readonly HoldInput[],
    keep: boolean,
  ) {
    for (const hold of holds) {
      const reservation = await tx.usageReservation.findUnique({
        where: { tenantId_id: { tenantId, id: hold.reservationId } },
        select: { quantity: true },
      });
      if (reservation === null) {
        continue;
      }
      const used = BigInt(Math.max(0, Math.ceil(hold.used)));
      const capped = used > reservation.quantity ? reservation.quantity : used;
      await settleReservation(
        tx,
        tenantId,
        hold.reservationId,
        keep && capped > 0n ? 'COMMITTED' : 'RELEASED',
        keep && capped > 0n ? capped : null,
        now(),
      );
    }
  }

  return {
    async request(rawSourceId, rawInput, provider) {
      const member = requirePermission(actor, 'imports.create');
      requirePermission(actor, 'contacts.write');
      const sourceId = idOrNotFound(rawSourceId, 'import');
      const input = enrichmentRequestSchema.parse(rawInput);
      const maxContacts =
        input.maxContactsPerCompany ??
        ENRICHMENT_LIMITS.defaultContactsPerCompany;
      return prisma.$transaction(
        async (tx) => {
          const source = await tx.import.findUnique({
            where: { tenantId_id: { tenantId, id: sourceId } },
          });
          if (source === null) {
            throw new RecordNotFoundError('import');
          }
          const issues: PlanIssue[] = [];
          if (source.source === 'CONTACT_ENRICHMENT') {
            issues.push({
              path: 'importId',
              message:
                'Choose a run that found companies, not a contact enrichment run.',
            });
          } else if (
            source.status === 'PENDING' ||
            source.status === 'PROCESSING'
          ) {
            issues.push({
              path: 'importId',
              message:
                'The run is still going. Find people when it has finished.',
            });
          }
          const campaignId = input.campaignId ?? null;
          const campaign =
            campaignId === null
              ? null
              : await tx.campaign.findUnique({
                  where: { tenantId_id: { tenantId, id: campaignId } },
                  select: {
                    id: true,
                    status: true,
                    icpId: true,
                    leadListId: true,
                    exclusions: true,
                  },
                });
          if (campaignId !== null && campaign === null) {
            issues.push({ path: 'campaignId', message: NOT_FOUND });
          }
          if (
            campaign !== null &&
            (campaign.status === 'COMPLETED' || campaign.status === 'CANCELLED')
          ) {
            issues.push({
              path: 'campaignId',
              message: 'This campaign has ended.',
            });
          }
          const icpId = source.icpId ?? campaign?.icpId ?? null;
          const icp =
            icpId === null
              ? null
              : await tx.icp.findUnique({
                  where: { tenantId_id: { tenantId, id: icpId } },
                  select: { id: true, status: true, criteria: true },
                });
          if (icp === null) {
            issues.push({
              path: campaignId === null ? 'importId' : 'campaignId',
              message:
                'Finding people needs an ideal customer profile for their roles: choose a campaign that has one.',
            });
          } else if (icp.status === 'ARCHIVED') {
            issues.push({
              path: 'icpId',
              message: 'This ideal customer profile is archived.',
            });
          }
          const companies =
            source.source === 'CONTACT_ENRICHMENT'
              ? []
              : await savedCompanies(tx, source.id);
          if (
            source.source !== 'CONTACT_ENRICHMENT' &&
            companies.length === 0
          ) {
            issues.push({
              path: 'importId',
              message: 'The run saved no companies.',
            });
          }
          const criteria =
            icp === null ? null : icpCriteriaSchema.safeParse(icp.criteria);
          if (criteria?.success === false) {
            issues.push({
              path: 'icpId',
              message:
                "The ideal customer profile's criteria can't be read. Save the profile again.",
            });
          }
          if (issues.length > 0 || icp === null || criteria?.success !== true) {
            throw new EnrichmentRequestError(issues);
          }
          const targeting: EnrichmentTargeting = {
            titles: [...(criteria.data.titles ?? [])],
            seniorities: [...(criteria.data.seniorities ?? [])],
            countries: [...(criteria.data.countries ?? [])],
          };
          const organizationIds = companies.slice(
            0,
            ENRICHMENT_LIMITS.maxCompanies,
          );
          const metadata: EnrichmentMetadata = {
            kind: 'contact_enrichment',
            sourceImportId: source.id,
            campaignId: campaign?.id ?? null,
            attribution: provider.attribution,
            maxContactsPerCompany: maxContacts,
            organizationIds,
            beyondLimit: companies.length - organizationIds.length,
            exclusions:
              campaign === null
                ? null
                : normalizedExclusions(campaign.exclusions),
          };
          const row = await tx.import.create({
            data: {
              tenantId,
              source: 'CONTACT_ENRICHMENT',
              icpId: icp.id,
              leadListId: campaign?.leadListId ?? null,
              searchProvider: provider.source,
              searchFilters: targeting,
              resultLimit: organizationIds.length,
              querySha256: payloadSha256({
                provider: provider.source,
                sourceImportId: source.id,
                campaignId: metadata.campaignId,
                targeting,
                maxContacts,
                organizationIds,
              }),
              sourceMetadata: metadata,
            },
          });
          // The durable task; the worker's relay publishes { v: 1, taskId } (D-07C-01).
          await tx.jobTask.create({
            data: {
              tenantId,
              taskType: ENRICHMENT_TASK_TYPE,
              idempotencyKey: `import:${row.id}`,
              payload: { importId: row.id },
            },
          });
          await writeAuditRecord(tx, tenantId, member, {
            action: 'contact_enrichment.requested',
            targetType: 'import',
            targetId: row.id,
            metadata: {
              sourceImportId: source.id,
              campaignId: metadata.campaignId,
              provider: provider.source,
              companies: organizationIds.length,
              maxContactsPerCompany: maxContacts,
            },
          });
          return runView(tx, tenantId, row);
        },
        { timeout: 30_000, maxWait: 10_000 },
      );
    },

    async results(rawId, rawQuery) {
      requireReadPermission(actor, 'imports.create');
      const id = idOrNotFound(rawId, 'import');
      const query = enrichmentResultsQuerySchema.parse(rawQuery);
      const run = await prisma.import.findUnique({
        where: { tenantId_id: { tenantId, id } },
        select: { source: true },
      });
      if (run?.source !== 'CONTACT_ENRICHMENT') {
        throw new RecordNotFoundError('import');
      }
      const page = await paginate(
        {
          ...(query.limit === undefined ? {} : { limit: query.limit }),
          ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
        },
        (keyset) =>
          prisma.sourceRecord.findMany({
            where: {
              tenantId,
              importId: id,
              ...(query.outcome === undefined
                ? { outcome: { not: null } }
                : { outcome: query.outcome }),
              ...keyset.cursorWhere,
            },
            orderBy: keyset.orderBy,
            take: keyset.take,
            select: {
              id: true,
              importRowNumber: true,
              outcome: true,
              payload: true,
              organizationId: true,
              contactId: true,
              confidence: true,
              issues: true,
              fetchedAt: true,
            },
          }),
        'oldest',
      );
      return {
        nextCursor: page.nextCursor,
        items: page.items.map((row): EnrichmentResult => {
          const parsed = resultPayloadSchema.safeParse(row.payload);
          const display = parsed.success ? parsed.data : null;
          const kind = display?.kind ?? 'person';
          return {
            id: row.id,
            position: row.importRowNumber ?? 1,
            kind,
            outcome: z
              .enum(['CREATED', 'MATCHED', 'EXCLUDED', 'FAILED'])
              .parse(row.outcome),
            company: {
              id: row.organizationId,
              name:
                (kind === 'company' ? display?.name : display?.company) ?? null,
              domain: display?.domain ?? null,
            },
            person:
              kind === 'company'
                ? null
                : {
                    name: display?.name ?? null,
                    title: display?.title ?? null,
                    email: display?.email ?? null,
                    contactId: row.contactId,
                    confidence: row.confidence,
                    reused: display?.reused ?? false,
                    check: display?.check?.status ?? null,
                  },
            issues:
              row.issues === null ? [] : resultIssuesSchema.parse(row.issues),
            retrievedAt: row.fetchedAt.toISOString(),
          };
        }),
      };
    },

    async quality(contactIds) {
      requireReadPermissionOrSystem(actor, 'contacts.read');
      const ids = contactIds.flatMap((id) => {
        const parsed = uuidSchema.safeParse(id);
        return parsed.success ? [parsed.data] : [];
      });
      return contactQualities(prisma, tenantId, ids, now());
    },

    async requestRecheck(rawContactId, rawInput, verificationAvailable) {
      const member = requirePermission(actor, 'verifications.run');
      recheckRequestSchema.parse(rawInput);
      const contactId = idOrNotFound(rawContactId, 'contact');
      const contact = await prisma.contact.findUnique({
        where: { tenantId_id: { tenantId, id: contactId } },
        select: { id: true, normalizedEmail: true },
      });
      if (contact === null) {
        throw new RecordNotFoundError('contact');
      }
      if (contact.normalizedEmail === null) {
        throw new NoEmailAddressError();
      }
      if (!verificationAvailable) {
        throw new VerificationUnavailableError();
      }
      return prisma.$transaction(async (tx) => {
        // Rechecks of one workspace are serialized, so concurrent requests can't pass a limit together.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`contact_recheck:${tenantId}`}, 0))`;
        const at = now();
        const own = await tx.jobTask.findFirst({
          where: {
            tenantId,
            taskType: RECHECK_TASK_TYPE,
            idempotencyKey: { startsWith: recheckKeyPrefix(contactId) },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { status: true, createdAt: true },
        });
        if (
          own !== null &&
          (own.status === 'PENDING' || own.status === 'RUNNING')
        ) {
          return { contactId, status: 'already_queued' } as const;
        }
        const cooldown = ENRICHMENT_LIMITS.recheckCooldownHours * HOUR_MS;
        if (own !== null && at.getTime() - own.createdAt.getTime() < cooldown) {
          throw new RecheckLimitError(
            Math.max(
              1,
              Math.ceil(
                (own.createdAt.getTime() + cooldown - at.getTime()) / 1000,
              ),
            ),
          );
        }
        const windowStart = new Date(at.getTime() - DAY_MS);
        const recent = await tx.jobTask.findMany({
          where: {
            tenantId,
            taskType: RECHECK_TASK_TYPE,
            createdAt: { gt: windowStart },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { createdAt: true },
          take: ENRICHMENT_LIMITS.rechecksPerDay,
        });
        const oldest = recent[0];
        if (
          recent.length >= ENRICHMENT_LIMITS.rechecksPerDay &&
          oldest !== undefined
        ) {
          throw new RecheckLimitError(
            Math.max(
              1,
              Math.ceil(
                (oldest.createdAt.getTime() + DAY_MS - at.getTime()) / 1000,
              ),
            ),
          );
        }
        await tx.jobTask.create({
          data: {
            tenantId,
            taskType: RECHECK_TASK_TYPE,
            idempotencyKey: `${recheckKeyPrefix(contactId)}${at.toISOString()}`,
            payload: { contactId },
            availableAt: at,
            createdAt: at,
          },
        });
        await writeAuditRecord(tx, tenantId, member, {
          action: 'contact.recheck_requested',
          targetType: 'contact',
          targetId: contactId,
        });
        return { contactId, status: 'queued' } as const;
      });
    },

    async begin(rawId) {
      worker('contact_enrichment.run');
      const id = idOrNotFound(rawId, 'import');
      return prisma.$transaction(async (tx) => {
        const row = await locked(tx, id);
        if (
          row.source !== 'CONTACT_ENRICHMENT' ||
          (row.status !== 'PENDING' && row.status !== 'PROCESSING')
        ) {
          return { state: 'stopped', status: row.status } as const;
        }
        if (row.status === 'PENDING') {
          await tx.import.update({
            where: { tenantId_id: { tenantId, id } },
            data: { status: 'PROCESSING', startedAt: now(), errorCode: null },
          });
        }
        const metadata = metadataOf(row);
        if (row.pagesFetched >= metadata.organizationIds.length) {
          return { state: 'finish' } as const;
        }
        return {
          state: 'run',
          provider: z.enum(['FAKE', 'APOLLO']).parse(row.searchProvider),
          targeting: z
            .strictObject({
              titles: z.array(z.string()),
              seniorities: z.array(z.string()),
              countries: z.array(z.string()),
            })
            .parse(row.searchFilters),
          maxContactsPerCompany: metadata.maxContactsPerCompany,
        } as const;
      });
    },

    async nextCompany(rawId) {
      worker('contact_enrichment.run');
      const id = idOrNotFound(rawId, 'import');
      const row = await prisma.import.findUnique({
        where: { tenantId_id: { tenantId, id } },
      });
      if (row?.status !== 'PROCESSING') {
        return { state: 'stopped' } as const;
      }
      const metadata = metadataOf(row);
      const index = row.pagesFetched;
      const organizationId = metadata.organizationIds[index];
      if (organizationId === undefined) {
        return { state: 'done' } as const;
      }
      const organization = await prisma.organization.findUnique({
        where: { tenantId_id: { tenantId, id: organizationId } },
        select: {
          id: true,
          name: true,
          normalizedDomain: true,
          countryCode: true,
        },
      });
      if (organization === null) {
        return {
          state: 'company',
          index,
          organization: null,
          skip: { outcome: 'FAILED', issues: [MESSAGES.gone] },
        } as const;
      }
      const view = {
        id: organization.id,
        name: organization.name,
        domain: organization.normalizedDomain,
        countryCode: organization.countryCode,
      };
      const targeting = z
        .object({ countries: z.array(z.string()) })
        .parse(row.searchFilters);
      let skip: CompanySkip | null = null;
      if (organization.normalizedDomain === null) {
        skip = { outcome: 'FAILED', issues: [MESSAGES.noDomain] };
      } else if (
        targeting.countries.length > 0 &&
        organization.countryCode !== null &&
        !targeting.countries.includes(organization.countryCode)
      ) {
        // A company known to be elsewhere isn't searched (and not paid for). Unknown: searched;
        // send eligibility decides about the country later.
        skip = {
          outcome: 'EXCLUDED',
          issues: [
            {
              field: 'country',
              message: `The company is in ${organization.countryCode}, outside the targeted countries.`,
            },
          ],
        };
      } else {
        const parents = domainAndParents(organization.normalizedDomain);
        const suppressed = await prisma.suppression.findFirst({
          where: { tenantId, normalizedDomain: { in: parents } },
          select: { id: true },
        });
        if (suppressed !== null) {
          skip = { outcome: 'EXCLUDED', issues: [MESSAGES.domainSuppressed] };
        } else if (
          metadata.exclusions?.domains.some((domain) =>
            parents.includes(domain),
          ) === true
        ) {
          skip = { outcome: 'EXCLUDED', issues: [MESSAGES.domainExcluded] };
        }
      }
      return { state: 'company', index, organization: view, skip } as const;
    },

    async knownPeople(provider, rawIds) {
      worker('contact_enrichment.run');
      const ids = [...new Set(rawIds)].filter(
        (id) => id.length > 0 && id.length <= 200,
      );
      if (ids.length === 0) {
        return new Map();
      }
      const since = new Date(
        now().getTime() - ENRICHMENT_LIMITS.reuseDays * DAY_MS,
      );
      // Only records of an actual lookup count: a reused record doesn't make data fresher.
      const rows = await prisma.sourceRecord.findMany({
        where: {
          tenantId,
          provider,
          externalId: { in: ids },
          contactId: { not: null },
          outcome: { in: ['CREATED', 'MATCHED'] },
          fetchedAt: { gte: since },
          payload: { path: ['reused'], equals: false },
        },
        orderBy: [{ fetchedAt: 'desc' }, { id: 'desc' }],
        select: { externalId: true, contactId: true },
      });
      const known = new Map<string, string>();
      for (const row of rows) {
        if (
          row.externalId !== null &&
          row.contactId !== null &&
          !known.has(row.externalId)
        ) {
          known.set(row.externalId, row.contactId);
        }
      }
      return known;
    },

    async freshChecks(rawAddresses) {
      worker('contact_enrichment.run');
      const addresses = [...new Set(rawAddresses)];
      if (addresses.length === 0) {
        return new Set();
      }
      const since = new Date(
        now().getTime() - VERIFICATION_MAX_AGE_DAYS * DAY_MS,
      );
      const rows = await prisma.verification.findMany({
        where: {
          tenantId,
          normalizedEmail: { in: addresses },
          checkedAt: { gte: since, lte: now() },
        },
        select: { normalizedEmail: true },
      });
      return new Set(rows.map((row) => row.normalizedEmail));
    },

    async saveCompany(rawId, index, result) {
      worker('contact_enrichment.run');
      const id = idOrNotFound(rawId, 'import');
      const holds = result.kind === 'enriched' ? result.holds : [];
      return prisma.$transaction(
        async (tx) => {
          const row = await locked(tx, id);
          const metadata = metadataOf(row);
          const total = metadata.organizationIds.length;
          if (row.status !== 'PROCESSING') {
            // Cancelled (or finished) meanwhile: the company is dropped, and so is its usage.
            await settleHolds(tx, holds, false);
            return { state: 'stopped' } as const;
          }
          if (row.pagesFetched !== index) {
            // Saved already (a repeated delivery): nothing is saved or charged again.
            await settleHolds(tx, holds, false);
            return {
              state: row.pagesFetched >= total ? 'done' : 'continue',
            } as const;
          }
          const organizationId = metadata.organizationIds[index] ?? null;
          const organization =
            organizationId === null
              ? null
              : await tx.organization.findUnique({
                  where: { tenantId_id: { tenantId, id: organizationId } },
                  select: { id: true, name: true, normalizedDomain: true },
                });
          let position = await tx.sourceRecord.count({
            where: { tenantId, importId: id },
          });
          const provider = z.enum(['FAKE', 'APOLLO']).parse(row.searchProvider);
          const at = now();
          const counts = { found: 0, saved: 0, excluded: 0, failed: 0 };

          if (result.kind === 'skipped' || organization === null) {
            const skip =
              result.kind === 'skipped'
                ? result.skip
                : ({ outcome: 'FAILED', issues: [MESSAGES.gone] } as const);
            const payload = {
              kind: 'company',
              name: organization?.name ?? null,
              domain: organization?.normalizedDomain ?? null,
            };
            position += 1;
            await tx.sourceRecord.create({
              data: {
                tenantId,
                provider,
                importId: id,
                importRowNumber: position,
                organizationId: organization?.id ?? null,
                payload,
                payloadSha256: payloadSha256(payload),
                fetchedAt: at,
                outcome: skip.outcome,
                issues: skip.issues.map((issue) => ({ ...issue })),
              },
            });
            await settleHolds(tx, holds, false);
          } else {
            const people = result.people;
            const savable = people.flatMap(
              (person): (IncomingContact | ReusedContact)[] =>
                person.kind === 'accepted'
                  ? [
                      {
                        kind: 'found' as const,
                        identity: person.contact.identity,
                        title: person.contact.title,
                        organizationId: organization.id,
                        source: {
                          provider,
                          externalId: person.contact.provenance.externalId,
                        },
                      },
                    ]
                  : person.kind === 'reused'
                    ? [{ kind: 'reused' as const, contactId: person.contactId }]
                    : [],
            );
            const saved = await saveContacts(
              tx,
              tenantId,
              savable,
              metadata.exclusions,
            );
            let next = 0;
            const listed: string[] = [];
            const records: Prisma.SourceRecordCreateManyInput[] = [];
            const verifications: Prisma.VerificationCreateManyInput[] = [];
            for (const person of people) {
              position += 1;
              counts.found += 1;
              const base = {
                tenantId,
                provider,
                importId: id,
                importRowNumber: position,
                organizationId: organization.id,
              };
              if (person.kind === 'rejected') {
                counts.failed += 1;
                const payload = {
                  kind: 'person',
                  name: person.name,
                  title: person.title,
                  company: organization.name,
                  domain: organization.normalizedDomain,
                  email: null,
                  reused: false,
                  received: asJson({
                    search: person.received.search,
                    enrichment: person.received.enrichment,
                  }),
                };
                records.push({
                  ...base,
                  externalId: person.externalId,
                  payload,
                  payloadSha256: payloadSha256(payload),
                  fetchedAt: person.retrievedAt,
                  outcome: 'FAILED',
                  issues: personIssues(
                    person.issues.length > 0
                      ? person.issues
                      : [
                          {
                            path: 'person',
                            message: 'The record could not be used.',
                          },
                        ],
                  ),
                });
                continue;
              }
              const outcome: ContactSaveOutcome | undefined = saved[next];
              next += 1;
              if (outcome === undefined) {
                throw new Error('saveContacts returned too few outcomes');
              }
              const check: CheckInput =
                person.kind === 'accepted' ? person.check : { kind: 'fresh' };
              const name =
                person.kind === 'accepted'
                  ? `${person.contact.identity.firstName} ${person.contact.identity.lastName}`
                  : person.name;
              const title =
                person.kind === 'accepted'
                  ? person.contact.title
                  : person.title;
              const relevance =
                person.kind === 'accepted'
                  ? person.contact.relevance
                  : person.relevance;
              const email =
                person.kind === 'accepted'
                  ? (person.contact.email?.address ?? null)
                  : outcome.outcome === 'MATCHED'
                    ? outcome.email
                    : null;
              const payload = {
                kind: 'person',
                name,
                title,
                company: organization.name,
                domain: organization.normalizedDomain,
                email,
                reused: person.kind === 'reused',
                attribution: metadata.attribution,
                providerClaim:
                  person.kind === 'accepted'
                    ? person.received.providerClaim
                    : null,
                emailDropped:
                  person.kind === 'accepted'
                    ? person.received.emailDropped
                    : null,
                emailProvenance:
                  person.kind === 'accepted' && person.contact.email !== null
                    ? asJson(person.contact.email.provenance)
                    : null,
                relevance: {
                  score: relevance.score,
                  matchedTitle: relevance.matchedTitle,
                  seniority: relevance.seniority,
                  reasons: [...relevance.reasons],
                },
                check:
                  check.kind === 'checked'
                    ? {
                        status: check.check.status,
                        reason: check.check.reason,
                        provider: check.check.provider,
                        checkedAt: check.check.checkedAt,
                      }
                    : check.kind === 'failed'
                      ? { failed: check.code, retryable: check.retryable }
                      : null,
                received: asJson(
                  person.kind === 'accepted'
                    ? {
                        search: person.received.search,
                        enrichment: person.received.enrichment,
                      }
                    : { search: person.search, enrichment: null },
                ),
              };
              const externalId =
                person.kind === 'accepted'
                  ? person.contact.provenance.externalId
                  : person.externalId;
              const fetchedAt =
                person.kind === 'accepted'
                  ? new Date(person.contact.provenance.retrievedAt)
                  : at;
              if (!isSaved(outcome)) {
                if (outcome.outcome === 'EXCLUDED') {
                  counts.excluded += 1;
                } else {
                  counts.failed += 1;
                }
                records.push({
                  ...base,
                  externalId,
                  payload,
                  payloadSha256: payloadSha256(payload),
                  fetchedAt,
                  outcome: outcome.outcome,
                  confidence: relevance.score,
                  issues: outcome.issues.map((issue) => ({ ...issue })),
                });
                continue;
              }
              counts.saved += 1;
              // Why a saved person can't be emailed (or not without a person): kept as reasons.
              const issues: EnrichmentIssue[] = [...outcome.notListed];
              if (person.kind === 'accepted') {
                for (const warning of person.contact.warnings) {
                  issues.push({ field: 'email', message: clip(warning) });
                }
              }
              let status: EmailVerificationStatus | null = null;
              if (check.kind === 'checked') {
                status = check.check.status;
              } else if (outcome.email !== null) {
                const stored = await tx.verification.findFirst({
                  where: {
                    tenantId,
                    contactId: outcome.contactId,
                    normalizedEmail: outcome.email,
                  },
                  orderBy: [{ checkedAt: 'desc' }, { id: 'desc' }],
                  select: { status: true },
                });
                status = stored === null ? null : CHECK_STATUS[stored.status];
              }
              if (outcome.email === null) {
                issues.push(MESSAGES.noEmail);
              } else if (status === 'invalid') {
                issues.push(MESSAGES.invalid);
              } else if (status === 'risky' || status === 'unknown') {
                issues.push(MESSAGES.review);
              } else if (check.kind === 'failed') {
                issues.push(MESSAGES.checkFailed);
              } else if (check.kind === 'unavailable') {
                issues.push(MESSAGES.unavailable);
              }
              if (
                check.kind === 'checked' &&
                outcome.email !== null &&
                check.check.address === outcome.email
              ) {
                const checkedAt = new Date(check.check.checkedAt);
                verifications.push({
                  tenantId,
                  contactId: outcome.contactId,
                  normalizedEmail: outcome.email,
                  provider: check.check.provider.toLowerCase(),
                  status: STORED_STATUS[check.check.status],
                  reason: check.check.reason,
                  checkedAt,
                  expiresAt: new Date(
                    checkedAt.getTime() + VERIFICATION_MAX_AGE_DAYS * DAY_MS,
                  ),
                  createdAt: at,
                });
              }
              // Only people who may be emailed one day go on the campaign's lead list.
              if (
                row.leadListId !== null &&
                outcome.email !== null &&
                status !== 'invalid' &&
                outcome.notListed.length === 0
              ) {
                listed.push(outcome.contactId);
              }
              records.push({
                ...base,
                externalId,
                contactId: outcome.contactId,
                payload,
                payloadSha256: payloadSha256(payload),
                fetchedAt,
                outcome: outcome.outcome,
                confidence: relevance.score,
                ...(issues.length === 0
                  ? {}
                  : {
                      issues: issues
                        .slice(0, 20)
                        .map((issue) => ({ ...issue })),
                    }),
              });
            }
            if (records.length > 0) {
              await tx.sourceRecord.createMany({ data: records });
            }
            if (verifications.length > 0) {
              await tx.verification.createMany({ data: verifications });
            }
            if (listed.length > 0 && row.leadListId !== null) {
              await tx.leadListMember.createMany({
                data: [...new Set(listed)].map((contactId) => ({
                  tenantId,
                  leadListId: row.leadListId ?? '',
                  contactId,
                  addedAt: at,
                })),
                skipDuplicates: true,
              });
            }
            // The usage of this company is counted exactly when its people are saved.
            await settleHolds(tx, holds, true);
          }
          await tx.import.update({
            where: { tenantId_id: { tenantId, id } },
            data: {
              totalRows: { increment: counts.found },
              importedRows: { increment: counts.saved },
              skippedRows: { increment: counts.excluded },
              failedRows: { increment: counts.failed },
              pagesFetched: { increment: 1 },
              errorCode: null,
            },
          });
          return { state: index + 1 >= total ? 'done' : 'continue' } as const;
        },
        { timeout: 60_000, maxWait: 10_000 },
      );
    },

    async finish(rawId) {
      worker('contact_enrichment.run');
      const id = idOrNotFound(rawId, 'import');
      return prisma.$transaction(async (tx) => {
        const row = await locked(tx, id);
        if (row.status !== 'PROCESSING') {
          return runView(tx, tenantId, row);
        }
        const updated = await tx.import.update({
          where: { tenantId_id: { tenantId, id } },
          data: { status: 'COMPLETED', completedAt: now() },
        });
        await writeAuditRecord(tx, tenantId, actor, {
          action: 'contact_enrichment.completed',
          targetType: 'import',
          targetId: id,
          metadata: {
            companies: updated.pagesFetched,
            found: updated.totalRows,
            saved: updated.importedRows,
            excluded: updated.skippedRows,
            failed: updated.failedRows,
          },
        });
        return runView(tx, tenantId, updated);
      });
    },

    async fail(rawId, rawCode, final) {
      worker('contact_enrichment.run');
      const id = idOrNotFound(rawId, 'import');
      const errorCode = errorCodeSchema.parse(rawCode);
      await prisma.$transaction(async (tx) => {
        const row = await locked(tx, id);
        if (row.status !== 'PROCESSING' && row.status !== 'PENDING') {
          return;
        }
        await tx.import.update({
          where: { tenantId_id: { tenantId, id } },
          data: final
            ? {
                status: 'FAILED',
                errorCode,
                completedAt: now(),
                startedAt: row.startedAt ?? now(),
              }
            : { errorCode },
        });
        if (final) {
          await writeAuditRecord(tx, tenantId, actor, {
            action: 'contact_enrichment.failed',
            targetType: 'import',
            targetId: id,
            metadata: { errorCode },
          });
        }
      });
    },

    async beginRecheck(rawContactId) {
      worker('contact_verification.recheck');
      const contactId = idOrNotFound(rawContactId, 'contact');
      const contact = await prisma.contact.findUnique({
        where: { tenantId_id: { tenantId, id: contactId } },
        select: { normalizedEmail: true },
      });
      return contact?.normalizedEmail ?? null;
    },

    async saveRecheck(rawContactId, check, hold) {
      worker('contact_verification.recheck');
      const contactId = idOrNotFound(rawContactId, 'contact');
      await prisma.$transaction(async (tx) => {
        const contact = await tx.contact.findUnique({
          where: { tenantId_id: { tenantId, id: contactId } },
          select: { normalizedEmail: true },
        });
        // The address changed (or the contact is gone) meanwhile: the result is for no one.
        const current = contact?.normalizedEmail === check.address;
        if (current) {
          const checkedAt = new Date(check.checkedAt);
          await tx.verification.create({
            data: {
              tenantId,
              contactId,
              normalizedEmail: check.address,
              provider: check.provider.toLowerCase(),
              status: STORED_STATUS[check.status],
              reason: check.reason,
              checkedAt,
              expiresAt: new Date(
                checkedAt.getTime() + VERIFICATION_MAX_AGE_DAYS * DAY_MS,
              ),
              createdAt: now(),
            },
          });
        }
        await settleHolds(tx, hold === null ? [] : [hold], current);
      });
    },
  };
}
