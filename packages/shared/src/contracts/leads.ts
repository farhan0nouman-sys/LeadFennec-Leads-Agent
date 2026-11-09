// Lead search (task 11A, docs/decisions.md D-11A-*): the workspace's people, found with
// allowlisted filters and sorts, one page at a time; one lead in detail; and the evidence about
// a lead. Every filter and sort is named here, and nothing else is accepted (strict schemas).
//
// Query values stay text, so a parsed query serializes back to the same URL: a list is one
// parameter with comma-separated values (`country=US,DE`); `leadSearchFilters` turns them into
// lists for the API. Pure zod and functions. Safe for web, API and worker.
import { z } from 'zod';
import { EMAIL_VERIFICATION_STATUSES } from './contact-enrichment.js';
import { CAMPAIGN_LEAD_STATUSES, CAMPAIGN_STATUSES } from './dashboard.js';
import {
  CONTACT_SOURCE_PROVIDERS,
  contactQualitySchema,
} from './enrichment-runs.js';
import { QUALIFICATION_STATES } from './lead-qualification.js';
import { LEAD_SCORE_BANDS } from './lead-scoring.js';

const iso = z.iso.datetime();

export const LEAD_ROUTES = {
  search: (workspaceId: string) => `/workspaces/${workspaceId}/leads`,
  lead: (workspaceId: string, contactId: string) =>
    `/workspaces/${workspaceId}/leads/${contactId}`,
  evidence: (workspaceId: string, contactId: string) =>
    `/workspaces/${workspaceId}/leads/${contactId}/evidence`,
} as const;

export const LEAD_SEARCH_LIMITS = {
  defaultPageSize: 25,
  maxPageSize: 100,
  /** Free text: at least 2 characters for `q`, at most 100 for any text filter. */
  minQueryChars: 2,
  maxTextChars: 100,
  /** Values in one list filter. */
  maxListValues: 20,
  /** A search that takes longer is stopped by the database. */
  statementTimeoutMs: 5_000,
  /** Lists in a lead's detail. */
  detailItems: 20,
  detailCampaigns: 50,
} as const;

/** What results may be sorted by; anything else is refused. */
export const LEAD_SORT_FIELDS = [
  'created',
  'activity',
  'name',
  'company',
  'score',
] as const;
export type LeadSortField = (typeof LEAD_SORT_FIELDS)[number];
export const LEAD_SORT_ORDERS = ['asc', 'desc'] as const;
export type LeadSortOrder = (typeof LEAD_SORT_ORDERS)[number];

/** The newest check of the person's current address. */
export const LEAD_VERIFICATION_FILTERS = [
  ...EMAIL_VERIFICATION_STATUSES,
  /** An address that was never checked. */
  'unchecked',
  /** No address at all. */
  'no_address',
] as const;

/** The eligibility recorded with the newest qualification decision (task 10C). */
export const LEAD_ELIGIBILITY_FILTERS = [
  'eligible',
  'review',
  'blocked',
  /** Never qualified. */
  'not_qualified',
] as const;

export const CONTACT_STATUSES = ['ACTIVE', 'ARCHIVED'] as const;

const LIST_SEPARATOR = ',';
const splitList = (value: string) =>
  value.split(LIST_SEPARATOR).map((item) => item.trim());

/** A list of allowed values in one parameter, kept as text (`band=HIGH_PRIORITY,REVIEW`). */
function listParam(
  values: readonly string[],
  normalize: (item: string) => string = (item) => item,
) {
  const allowed = new Set<string>(values);
  return z
    .string()
    .trim()
    .transform((value) => splitList(value).map(normalize).join(LIST_SEPARATOR))
    .superRefine((value, ctx) => {
      const items = splitList(value);
      if (items.length > LEAD_SEARCH_LIMITS.maxListValues) {
        ctx.addIssue({
          code: 'custom',
          message: `Use at most ${String(LEAD_SEARCH_LIMITS.maxListValues)} values.`,
        });
        return;
      }
      const unknown = items.filter((item) => !allowed.has(item));
      if (unknown.length > 0) {
        ctx.addIssue({
          code: 'custom',
          message: `Use ${values.join(', ')}.`,
        });
      }
    });
}

const textParam = z
  .string()
  .trim()
  .min(1, 'Type at least 1 character.')
  .max(
    LEAD_SEARCH_LIMITS.maxTextChars,
    `Use at most ${String(LEAD_SEARCH_LIMITS.maxTextChars)} characters.`,
  );

/** Free-form values in one parameter (industries): 1–100 characters each. */
const freeListParam = z
  .string()
  .trim()
  .transform((value) =>
    splitList(value)
      .filter((item) => item !== '')
      .join(LIST_SEPARATOR),
  )
  .superRefine((value, ctx) => {
    const items = value === '' ? [] : splitList(value);
    if (
      items.length === 0 ||
      items.length > LEAD_SEARCH_LIMITS.maxListValues ||
      items.some((item) => item.length > LEAD_SEARCH_LIMITS.maxTextChars)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: `Use 1 to ${String(LEAD_SEARCH_LIMITS.maxListValues)} values of at most ${String(LEAD_SEARCH_LIMITS.maxTextChars)} characters.`,
      });
    }
  });

const countryList = z
  .string()
  .trim()
  .toUpperCase()
  .transform((value) => splitList(value).join(LIST_SEPARATOR))
  .superRefine((value, ctx) => {
    const items = splitList(value);
    if (
      items.length > LEAD_SEARCH_LIMITS.maxListValues ||
      items.some((item) => !/^[A-Z]{2}$/.test(item))
    ) {
      ctx.addIssue({
        code: 'custom',
        message: `Use up to ${String(LEAD_SEARCH_LIMITS.maxListValues)} two-letter country codes, such as US,DE.`,
      });
    }
  });

const scoreParam = z.coerce
  .number('Use a whole number from 0 to 100.')
  .int('Use a whole number from 0 to 100.')
  .min(0, 'Use a whole number from 0 to 100.')
  .max(100, 'Use a whole number from 0 to 100.');

const instant = z.iso.datetime({
  offset: true,
  error: 'Use a date and time, such as 2026-11-01T00:00:00Z.',
});

/** The search's query string. Unknown parameters, sorts and filter values are refused. */
export const leadSearchQuerySchema = z
  .strictObject({
    /** Name, address, title or company contains this. */
    q: z
      .string()
      .trim()
      .min(
        LEAD_SEARCH_LIMITS.minQueryChars,
        `Type at least ${String(LEAD_SEARCH_LIMITS.minQueryChars)} characters.`,
      )
      .max(
        LEAD_SEARCH_LIMITS.maxTextChars,
        `Use at most ${String(LEAD_SEARCH_LIMITS.maxTextChars)} characters.`,
      )
      .optional(),
    /** The company's name or domain contains this. */
    company: textParam.optional(),
    /** The person's name or address contains this. */
    contact: textParam.optional(),
    /** The person's title contains this. */
    title: textParam.optional(),
    /** The person's country, else the company's. */
    country: countryList.optional(),
    /** The company's industry, any of these (case-insensitive). */
    industry: freeListParam.optional(),
    /** Where the person's data came from, any of these. */
    source: listParam(CONTACT_SOURCE_PROVIDERS, (item) =>
      item.toUpperCase(),
    ).optional(),
    /** Only this campaign's leads (its lead list or its enrollments); scores are this campaign's. */
    campaignId: z.uuid('Not found in this workspace.').optional(),
    /** Leads of a campaign in one of these states. */
    campaignStatus: listParam(CAMPAIGN_STATUSES, (item) =>
      item.toUpperCase(),
    ).optional(),
    /** The current lead score (the campaign's, else any campaign's). */
    scoreMin: scoreParam.optional(),
    scoreMax: scoreParam.optional(),
    band: listParam(LEAD_SCORE_BANDS, (item) => item.toUpperCase()).optional(),
    verification: listParam(LEAD_VERIFICATION_FILTERS, (item) =>
      item.toLowerCase(),
    ).optional(),
    eligibility: listParam(LEAD_ELIGIBILITY_FILTERS, (item) =>
      item.toLowerCase(),
    ).optional(),
    /** Last activity at or after / before. */
    activeAfter: instant.optional(),
    activeBefore: instant.optional(),
    /** ACTIVE by default. */
    status: listParam(CONTACT_STATUSES, (item) =>
      item.toUpperCase(),
    ).optional(),
    sort: z
      .enum(LEAD_SORT_FIELDS, {
        error: `Sort by ${LEAD_SORT_FIELDS.join(', ')}.`,
      })
      .optional(),
    order: z.enum(LEAD_SORT_ORDERS, { error: 'Use asc or desc.' }).optional(),
    limit: z.coerce
      .number('Use a whole number from 1 to 100.')
      .int('Use a whole number from 1 to 100.')
      .min(1, 'Use a whole number from 1 to 100.')
      .max(LEAD_SEARCH_LIMITS.maxPageSize, 'Use a whole number from 1 to 100.')
      .optional(),
    cursor: z.string().max(500).optional(),
  })
  .superRefine((query, ctx) => {
    if (
      query.scoreMin !== undefined &&
      query.scoreMax !== undefined &&
      query.scoreMin > query.scoreMax
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['scoreMax'],
        message: 'Use a maximum no lower than the minimum.',
      });
    }
    if (
      query.activeAfter !== undefined &&
      query.activeBefore !== undefined &&
      new Date(query.activeAfter) >= new Date(query.activeBefore)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['activeBefore'],
        message: 'Use an end after the start.',
      });
    }
    if (query.sort === 'score' && query.campaignId === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['sort'],
        message: 'Sorting by score needs a campaign (campaignId).',
      });
    }
  });

export type LeadSearchQuery = z.input<typeof leadSearchQuerySchema>;

/** A search as lists and values, for the API. */
export interface LeadSearchFilters {
  readonly q: string | null;
  readonly company: string | null;
  readonly contact: string | null;
  readonly title: string | null;
  readonly countries: readonly string[];
  /** Lower case. */
  readonly industries: readonly string[];
  readonly sources: readonly (typeof CONTACT_SOURCE_PROVIDERS)[number][];
  readonly campaignId: string | null;
  readonly campaignStatuses: readonly (typeof CAMPAIGN_STATUSES)[number][];
  readonly scoreMin: number | null;
  readonly scoreMax: number | null;
  readonly bands: readonly (typeof LEAD_SCORE_BANDS)[number][];
  readonly verification: readonly (typeof LEAD_VERIFICATION_FILTERS)[number][];
  readonly eligibility: readonly (typeof LEAD_ELIGIBILITY_FILTERS)[number][];
  readonly activeAfter: Date | null;
  readonly activeBefore: Date | null;
  readonly statuses: readonly (typeof CONTACT_STATUSES)[number][];
  readonly sort: LeadSortField;
  readonly order: LeadSortOrder;
  readonly limit: number;
  readonly cursor: string | null;
}

const listOf = <T extends string>(value: string | undefined): T[] =>
  value === undefined || value === ''
    ? []
    : [...new Set(splitList(value))].map((item) => item as T);

/** Validates a raw query and turns it into lists and values (throws a ZodError when invalid). */
export function leadSearchFilters(raw: unknown): LeadSearchFilters {
  const query = leadSearchQuerySchema.parse(raw);
  const statuses = listOf<(typeof CONTACT_STATUSES)[number]>(query.status);
  return {
    q: query.q ?? null,
    company: query.company ?? null,
    contact: query.contact ?? null,
    title: query.title ?? null,
    countries: listOf(query.country),
    industries: listOf<string>(query.industry).map((item) =>
      item.toLowerCase(),
    ),
    sources: listOf(query.source),
    campaignId: query.campaignId ?? null,
    campaignStatuses: listOf(query.campaignStatus),
    scoreMin: query.scoreMin ?? null,
    scoreMax: query.scoreMax ?? null,
    bands: listOf(query.band),
    verification: listOf(query.verification),
    eligibility: listOf(query.eligibility),
    activeAfter:
      query.activeAfter === undefined ? null : new Date(query.activeAfter),
    activeBefore:
      query.activeBefore === undefined ? null : new Date(query.activeBefore),
    statuses: statuses.length === 0 ? ['ACTIVE'] : statuses,
    sort: query.sort ?? 'created',
    order: query.order ?? 'desc',
    limit: query.limit ?? LEAD_SEARCH_LIMITS.defaultPageSize,
    cursor: query.cursor ?? null,
  };
}

/** Escapes LIKE wildcards, so typed text matches literally. */
export function likeContains(text: string): string {
  return `%${text.replace(/[\\%_]/g, (match) => `\\${match}`)}%`;
}

// ─── Results ─────────────────────────────────────────────────────────────────

const companySchema = z.strictObject({
  id: z.uuid(),
  /** Untrusted (from imports and providers). */
  name: z.string(),
  domain: z.string().nullable(),
  industry: z.string().nullable(),
  countryCode: z.string().nullable(),
});

export const leadSearchItemSchema = z.strictObject({
  id: z.uuid(),
  /** Untrusted (from imports and providers). */
  name: z.string().nullable(),
  title: z.string().nullable(),
  email: z.string().nullable(),
  status: z.enum(CONTACT_STATUSES),
  /** The person's country, else the company's. */
  countryCode: z.string().nullable(),
  company: companySchema.nullable(),
  sources: z.array(z.enum(CONTACT_SOURCE_PROVIDERS)),
  /** The newest check of the current address. */
  verification: z
    .strictObject({
      status: z.enum(EMAIL_VERIFICATION_STATUSES),
      checkedAt: iso,
    })
    .nullable(),
  /** The current score in the campaign searched, else the highest current score in any. */
  score: z
    .strictObject({
      campaignId: z.uuid(),
      value: z.int().min(0).max(100),
      band: z.enum(LEAD_SCORE_BANDS),
      version: z.int().min(1),
      scoredAt: iso,
    })
    .nullable(),
  /** The newest qualification decision (in the campaign searched, else in any). */
  qualification: z
    .strictObject({
      campaignId: z.uuid(),
      state: z.enum(QUALIFICATION_STATES),
      eligibilityStatus: z.enum(['eligible', 'review', 'blocked']),
      decidedAt: iso,
    })
    .nullable(),
  createdAt: iso,
  lastActivityAt: iso,
});
export type LeadSearchItem = z.output<typeof leadSearchItemSchema>;

export const leadSearchPageSchema = z.strictObject({
  items: z.array(leadSearchItemSchema),
  /** Pass back as `cursor`, with the same filters and sort; null on the last page. */
  nextCursor: z.string().nullable(),
  sort: z.strictObject({
    field: z.enum(LEAD_SORT_FIELDS),
    order: z.enum(LEAD_SORT_ORDERS),
  }),
});
export type LeadSearchPage = z.output<typeof leadSearchPageSchema>;

// ─── One lead ────────────────────────────────────────────────────────────────

export const leadDetailSchema = z.strictObject({
  id: z.uuid(),
  /** Untrusted (from imports and providers). */
  name: z.string().nullable(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  title: z.string().nullable(),
  email: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  countryCode: z.string().nullable(),
  status: z.enum(CONTACT_STATUSES),
  /** Name it in every change (task 11B): a stale version is refused. */
  version: z.int().min(1),
  /**
   * The address, or its domain, is on the do-not-contact list (task 11C): the lead can't be
   * emailed or added to a campaign's list.
   */
  doNotContact: z.boolean(),
  createdAt: iso,
  lastActivityAt: iso,
  company: companySchema.nullable(),
  /** The company's current website research (task 09C), when there is one. */
  research: z
    .strictObject({
      id: z.uuid(),
      version: z.int().min(1),
      status: z.string(),
      completedAt: iso.nullable(),
    })
    .nullable(),
  quality: contactQualitySchema,
  /** Lower case, sorted (task 11B). */
  tags: z.array(z.string()),
  /** Notes by members, newest first, at most 20 (untrusted text). */
  notes: z.array(
    z.strictObject({
      id: z.uuid(),
      body: z.string(),
      author: z.string().nullable(),
      createdAt: iso,
    }),
  ),
  /** Newest first, at most 20. */
  sources: z.array(
    z.strictObject({
      id: z.uuid(),
      provider: z.enum(CONTACT_SOURCE_PROVIDERS),
      externalId: z.string().nullable(),
      importId: z.uuid().nullable(),
      outcome: z.enum(['CREATED', 'MATCHED', 'EXCLUDED', 'FAILED']).nullable(),
      /** Role match, 0–100 (contact enrichment). */
      confidence: z.int().min(0).max(100).nullable(),
      /** The page's address, for a website record (http or https only). */
      url: z.string().nullable(),
      retrievedAt: iso,
    }),
  ),
  /** Checks of the person's addresses, newest first, at most 20. */
  verifications: z.array(
    z.strictObject({
      address: z.string(),
      status: z.enum(EMAIL_VERIFICATION_STATUSES),
      reason: z.string().nullable(),
      provider: z.string(),
      checkedAt: iso,
    }),
  ),
  /** Campaigns the person is a lead of (on its lead list or enrolled), at most 50. */
  campaigns: z.array(
    z.strictObject({
      id: z.uuid(),
      name: z.string(),
      status: z.enum(CAMPAIGN_STATUSES),
      onLeadList: z.boolean(),
      enrollment: z.enum(CAMPAIGN_LEAD_STATUSES).nullable(),
      score: z
        .strictObject({
          value: z.int().min(0).max(100),
          band: z.enum(LEAD_SCORE_BANDS),
          version: z.int().min(1),
          scoredAt: iso,
        })
        .nullable(),
      qualification: z
        .strictObject({
          /** Name it in a person's decision (task 10C). */
          version: z.int().min(1),
          state: z.enum(QUALIFICATION_STATES),
          eligibilityStatus: z.enum(['eligible', 'review', 'blocked']),
          decidedAt: iso,
        })
        .nullable(),
    }),
  ),
  /** Every score version in every campaign, newest first, at most 20. */
  scoreHistory: z.array(
    z.strictObject({
      campaignId: z.uuid(),
      campaignName: z.string(),
      version: z.int().min(1),
      value: z.int().min(0).max(100),
      band: z.enum(LEAD_SCORE_BANDS),
      scoredAt: iso,
    }),
  ),
  /** Qualification decisions in every campaign, newest first, at most 20. */
  activity: z.array(
    z.strictObject({
      campaignId: z.uuid(),
      campaignName: z.string(),
      version: z.int().min(1),
      state: z.enum(QUALIFICATION_STATES),
      origin: z.enum(['AUTOMATIC', 'PERSON']),
      reasons: z.array(z.string()),
      decidedBy: z.string().nullable(),
      decidedAt: iso,
    }),
  ),
  /** Lead lists the person is on, at most 50. */
  leadLists: z.array(z.strictObject({ id: z.uuid(), name: z.string() })),
  /** A list was cut at its limit. */
  truncated: z.strictObject({
    sources: z.boolean(),
    verifications: z.boolean(),
    campaigns: z.boolean(),
    leadLists: z.boolean(),
    notes: z.boolean(),
    scoreHistory: z.boolean(),
    activity: z.boolean(),
  }),
});
export type LeadDetail = z.output<typeof leadDetailSchema>;

// ─── Evidence ────────────────────────────────────────────────────────────────

export const LEAD_EVIDENCE_KINDS = [
  'WEBSITE_EXCERPT',
  'PROVIDER_FIELD',
  'AI_EXTRACTION',
  'MANUAL_NOTE',
] as const;

export const leadEvidenceQuerySchema = z.strictObject({
  limit: z.coerce
    .number('Use a whole number from 1 to 100.')
    .int('Use a whole number from 1 to 100.')
    .min(1, 'Use a whole number from 1 to 100.')
    .max(LEAD_SEARCH_LIMITS.maxPageSize, 'Use a whole number from 1 to 100.')
    .optional(),
  cursor: z.string().max(200).optional(),
  kind: z
    .enum(LEAD_EVIDENCE_KINDS, {
      error: `Use ${LEAD_EVIDENCE_KINDS.join(', ')}.`,
    })
    .optional(),
});

export const leadEvidenceItemSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(LEAD_EVIDENCE_KINDS),
  /** About the person, or about their company. */
  about: z.enum(['person', 'company']),
  /** Untrusted text: a page excerpt, a provider's field or a note. Escape it when shown. */
  excerpt: z.string(),
  sourceUrl: z.string().nullable(),
  extractLabel: z.string().nullable(),
  researchId: z.uuid().nullable(),
  capturedAt: iso,
});
export type LeadEvidenceItem = z.output<typeof leadEvidenceItemSchema>;

export const leadEvidencePageSchema = z.strictObject({
  items: z.array(leadEvidenceItemSchema),
  nextCursor: z.string().nullable(),
});
