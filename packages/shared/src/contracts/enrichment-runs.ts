// Contact enrichment runs (task 08C, docs/decisions.md D-08C-*): finding people for the companies
// an earlier run discovered, how a run is asked for and followed, what each person found became,
// how good a contact's data is, and the manual recheck of an address.
//
// - A run is bounded: at most 25 companies, at most 5 people a company. Its targets (titles,
//   seniorities, countries) are the ICP's, copied when it is asked for, and never change.
// - A person already in the workspace is matched, never duplicated, and one looked up recently is
//   reused without asking (or paying) the provider again.
// - Quality is decided here from stored facts (the source, the role match, the newest check of the
//   address); an address's status comes only from an email check (emailSendEligibility).
// Pure zod and functions. Safe for web, API and worker.
import { z } from 'zod';
import {
  CONTACT_DATA_PROVIDERS,
  EMAIL_VERIFICATION_STATUSES,
  VERIFICATION_MAX_AGE_DAYS,
  emailSendEligibility,
  type EmailVerificationStatus,
  type SendEligibilityState,
} from './contact-enrichment.js';

const iso = z.iso.datetime();
const count = z.number().int().min(0);

export const ENRICHMENT_ROUTES = {
  /** POST: find people for the companies of a run. */
  request: (workspaceId: string, importId: string) =>
    `/workspaces/${workspaceId}/imports/${importId}/enrichment`,
  /** GET: what each person (or skipped company) of an enrichment run became. */
  contacts: (workspaceId: string, importId: string) =>
    `/workspaces/${workspaceId}/imports/${importId}/contacts`,
  /** POST: check a contact's address again. */
  recheck: (workspaceId: string, contactId: string) =>
    `/workspaces/${workspaceId}/contacts/${contactId}/recheck`,
} as const;

export const ENRICHMENT_LIMITS = {
  /** Companies one run covers (the first of the source run, in its order). */
  maxCompanies: 25,
  defaultContactsPerCompany: 3,
  maxContactsPerCompany: 5,
  /** A person looked up this recently is reused: not looked up or paid for again. */
  reuseDays: 30,
  /** A contact's address can be rechecked once in this time… */
  recheckCooldownHours: 24,
  /** …and a workspace can recheck this many addresses in 24 hours. */
  rechecksPerDay: 50,
} as const;

const DAY_MS = 86_400_000;

/** Find people for the companies of a completed run. */
export const enrichmentRequestSchema = z.strictObject({
  /**
   * Optional: the campaign whose exclusions apply and whose lead list receives the people who
   * may be contacted. Its ICP is used when the run has none (a CSV import).
   */
  campaignId: z.uuid().nullable().optional(),
  maxContactsPerCompany: z
    .int('Use a whole number.')
    .min(1, 'Ask for at least 1 person a company.')
    .max(
      ENRICHMENT_LIMITS.maxContactsPerCompany,
      `Use at most ${String(ENRICHMENT_LIMITS.maxContactsPerCompany)} people a company.`,
    )
    .optional(),
});
export type EnrichmentRequest = z.input<typeof enrichmentRequestSchema>;

/** The ICP's people targets, copied into the run. */
export const enrichmentTargetingSchema = z.strictObject({
  titles: z.array(z.string().min(1).max(100)).max(30),
  seniorities: z.array(z.string().min(1).max(40)).max(10),
  /** ISO 3166-1 alpha-2; empty: any country. A company known to be elsewhere is skipped. */
  countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(50),
});
export type EnrichmentTargeting = z.output<typeof enrichmentTargetingSchema>;

/** What an enrichment run was asked and how far it got (a part of importRunSchema). */
export const enrichmentRunInfoSchema = z.strictObject({
  /** The run whose companies are enriched. */
  sourceImportId: z.uuid(),
  icpId: z.uuid(),
  campaignId: z.uuid().nullable(),
  /** Where the people who may be contacted are added; null: nowhere. */
  leadListId: z.uuid().nullable(),
  provider: z.enum(CONTACT_DATA_PROVIDERS),
  attribution: z.string(),
  targeting: enrichmentTargetingSchema,
  maxContactsPerCompany: z.int().min(1).max(5),
  companies: z.strictObject({
    /** Companies the run covers. */
    total: count,
    /** Companies handled so far (people saved, or skipped with reasons). */
    done: count,
    /** Of those: skipped before asking the provider (country, exclusions, no domain). */
    skipped: count,
    /** Companies the source run had beyond the limit: not covered. */
    beyondLimit: count,
  }),
});
export type EnrichmentRunInfo = z.output<typeof enrichmentRunInfoSchema>;

// ─── Results ─────────────────────────────────────────────────────────────────

export const ENRICHMENT_ISSUE_FIELDS = [
  'company',
  'country',
  'person',
  'email',
] as const;

export const enrichmentIssueSchema = z.strictObject({
  field: z.enum(ENRICHMENT_ISSUE_FIELDS),
  message: z.string().min(1).max(300),
});
export type EnrichmentIssue = z.output<typeof enrichmentIssueSchema>;

/** What happened to one person, or to a company skipped before the provider was asked. */
export const ENRICHMENT_OUTCOMES = [
  /** A new contact was saved. */
  'CREATED',
  /** The person was already in the workspace: linked, not duplicated (and maybe reused). */
  'MATCHED',
  /** On the do-not-contact list, excluded by the campaign, or (a company) skipped. */
  'EXCLUDED',
  /** Not usable (a partial or malformed record): not saved. */
  'FAILED',
] as const;

export const enrichmentResultSchema = z.strictObject({
  id: z.uuid(),
  position: z.int().min(1),
  kind: z.enum(['person', 'company']),
  outcome: z.enum(ENRICHMENT_OUTCOMES),
  /** Untrusted text (from the provider): escape it when shown. */
  company: z.strictObject({
    id: z.uuid().nullable(),
    name: z.string().nullable(),
    domain: z.string().nullable(),
  }),
  person: z
    .strictObject({
      name: z.string().nullable(),
      title: z.string().nullable(),
      email: z.string().nullable(),
      contactId: z.uuid().nullable(),
      /** Role match, 0–100 (application code). */
      confidence: z.int().min(0).max(100).nullable(),
      /** Looked up before and reused: not asked for or paid for again. */
      reused: z.boolean(),
      /** The check made during the run; null: none (no address, a failed check, or reused). */
      check: z.enum(EMAIL_VERIFICATION_STATUSES).nullable(),
    })
    .nullable(),
  /** Why it was excluded or failed, or why a saved person can't be emailed. */
  issues: z.array(enrichmentIssueSchema),
  retrievedAt: iso,
});
export type EnrichmentResult = z.output<typeof enrichmentResultSchema>;

export const enrichmentResultPageSchema = z.strictObject({
  items: z.array(enrichmentResultSchema),
  nextCursor: z.string().nullable(),
});

export const enrichmentResultsQuerySchema = z.strictObject({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(200).optional(),
  outcome: z.enum(ENRICHMENT_OUTCOMES).optional(),
});

// ─── Contact quality ─────────────────────────────────────────────────────────

/** Where a contact's data came from (SourceProvider). */
export const CONTACT_SOURCE_PROVIDERS = [
  'APOLLO',
  'CSV_IMPORT',
  'MANUAL',
  'WEBSITE',
  'FAKE',
] as const;
export type ContactSourceProvider = (typeof CONTACT_SOURCE_PROVIDERS)[number];

export const CONTACT_QUALITY_LEVELS = [
  /** A fresh verified address, from a fresh source. */
  'good',
  /** Usable only after a person decides, or after a new check or lookup. */
  'review',
  /** No address, or one that doesn't accept email. */
  'unusable',
] as const;
export type ContactQualityLevel = (typeof CONTACT_QUALITY_LEVELS)[number];

const EMAIL_STATES = [
  'eligible',
  'needs_review',
  'stale',
  'unverified',
  'blocked',
] as const satisfies readonly SendEligibilityState[];

export const contactQualitySchema = z.strictObject({
  level: z.enum(CONTACT_QUALITY_LEVELS),
  /** Why, in a few words each. */
  reasons: z.array(z.string()),
  /** The newest record the contact came from. */
  source: z
    .strictObject({
      provider: z.enum(CONTACT_SOURCE_PROVIDERS),
      attribution: z.string().nullable(),
      retrievedAt: iso,
      /** Retrieved within the reuse window. */
      fresh: z.boolean(),
    })
    .nullable(),
  /** Role match of the newest enrichment, 0–100; null when it wasn't found by enrichment. */
  confidence: z.int().min(0).max(100).nullable(),
  email: z
    .strictObject({
      address: z.string(),
      /** The data provider's own claim about the address. Untrusted: never a check. */
      providerClaim: z
        .enum(['provider_verified', 'provider_unverified'])
        .nullable(),
      /** The newest check of this exact address. */
      check: z
        .strictObject({
          status: z.enum(EMAIL_VERIFICATION_STATUSES),
          reason: z.string().nullable(),
          provider: z.string(),
          checkedAt: iso,
        })
        .nullable(),
      /** emailSendEligibility, from the check alone. */
      state: z.enum(EMAIL_STATES),
      stateReason: z.string(),
    })
    .nullable(),
  recheck: z.strictObject({
    /** A recheck is queued or running. */
    pending: z.boolean(),
    /** When the next recheck may be asked for; null: now (or never, without an address). */
    availableAt: iso.nullable(),
    /** Why the last recheck failed, if it did. */
    lastErrorCode: z.string().nullable(),
  }),
});
export type ContactQuality = z.output<typeof contactQualitySchema>;

/** The stored facts quality is decided from (all optional: a contact may lack any of them). */
export interface ContactQualityFacts {
  readonly email: string | null;
  readonly source: {
    readonly provider: ContactSourceProvider;
    readonly attribution: string | null;
    readonly retrievedAt: Date;
    readonly confidence: number | null;
    readonly providerClaim: 'provider_verified' | 'provider_unverified' | null;
  } | null;
  readonly check: {
    readonly address: string;
    readonly status: EmailVerificationStatus;
    readonly reason: string | null;
    /** Upper case for the check's schema, e.g. "FAKE". */
    readonly provider: string;
    readonly checkedAt: Date;
  } | null;
  readonly recheck: {
    readonly pending: boolean;
    readonly lastRequestedAt: Date | null;
    readonly lastErrorCode: string | null;
  };
}

/**
 * How good a contact's data is (task 08C, D-08C-05), decided from stored facts at `now`. The
 * address's state is emailSendEligibility's: only a fresh `verified` check of this exact address
 * is good. The level never permits sending by itself; send eligibility (10B) decides that.
 */
export function contactQuality(
  facts: ContactQualityFacts,
  now: Date,
): ContactQuality {
  const reasons: string[] = [];
  const source =
    facts.source === null
      ? null
      : {
          provider: facts.source.provider,
          attribution: facts.source.attribution,
          retrievedAt: facts.source.retrievedAt.toISOString(),
          fresh:
            now.getTime() - facts.source.retrievedAt.getTime() <=
            ENRICHMENT_LIMITS.reuseDays * DAY_MS,
        };
  let email: ContactQuality['email'] = null;
  let level: ContactQualityLevel;
  if (facts.email === null) {
    level = 'unusable';
    reasons.push('No email address.');
  } else {
    const check =
      facts.check === null
        ? null
        : {
            address: facts.check.address,
            status: facts.check.status,
            reason: facts.check.reason,
            provider: facts.check.provider,
            checkedAt: facts.check.checkedAt.toISOString(),
          };
    const eligibility = emailSendEligibility(facts.email, check, now);
    email = {
      address: facts.email,
      providerClaim: facts.source?.providerClaim ?? null,
      check:
        check === null
          ? null
          : {
              status: check.status,
              reason: check.reason,
              provider: check.provider,
              checkedAt: check.checkedAt,
            },
      state: eligibility.state,
      stateReason: eligibility.reason,
    };
    reasons.push(eligibility.reason);
    level =
      eligibility.state === 'blocked'
        ? 'unusable'
        : eligibility.state === 'eligible'
          ? 'good'
          : 'review';
  }
  if (source !== null && !source.fresh) {
    reasons.push(
      `The data was retrieved more than ${String(ENRICHMENT_LIMITS.reuseDays)} days ago.`,
    );
    if (level === 'good') {
      level = 'review';
    }
  }
  const last = facts.recheck.lastRequestedAt;
  const nextAt =
    last === null
      ? null
      : new Date(
          last.getTime() + ENRICHMENT_LIMITS.recheckCooldownHours * 3_600_000,
        );
  return {
    level,
    reasons,
    source,
    confidence: facts.source?.confidence ?? null,
    email,
    recheck: {
      pending: facts.recheck.pending,
      availableAt:
        facts.email === null || nextAt === null || nextAt <= now
          ? null
          : nextAt.toISOString(),
      lastErrorCode: facts.recheck.lastErrorCode,
    },
  };
}

/** The short form shown in lists. */
export const contactQualitySummarySchema = z.strictObject({
  level: z.enum(CONTACT_QUALITY_LEVELS),
  emailState: z.enum(EMAIL_STATES).nullable(),
});
export type ContactQualitySummary = z.output<
  typeof contactQualitySummarySchema
>;

export const summarizeQuality = (
  quality: ContactQuality,
): ContactQualitySummary => ({
  level: quality.level,
  emailState: quality.email?.state ?? null,
});

/** A verified check is trusted this long (VERIFICATION_MAX_AGE_DAYS); rechecks follow it. */
export const CHECK_FRESH_DAYS = VERIFICATION_MAX_AGE_DAYS;

// ─── Recheck ─────────────────────────────────────────────────────────────────

export const recheckRequestSchema = z.strictObject({});

export const recheckAcceptedSchema = z.strictObject({
  contactId: z.uuid(),
  /** Queued now, or already queued (repeating the request changes nothing). */
  status: z.enum(['queued', 'already_queued']),
});
export type RecheckAccepted = z.output<typeof recheckAcceptedSchema>;

export const enrichmentAcceptedSchema = z.strictObject({
  runId: z.uuid(),
  status: z.enum(['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED']),
  /** The API path of the run (GET it for the status and progress). */
  statusUrl: z.string(),
});
export type EnrichmentAccepted = z.output<typeof enrichmentAcceptedSchema>;

export const ENRICHMENT_ERROR_CODES = [
  /** 409: no email verification service is set up, so addresses can't be checked (O-35). */
  'verification_unavailable',
  /** 409: the contact has no address to check. */
  'no_email_address',
] as const;
