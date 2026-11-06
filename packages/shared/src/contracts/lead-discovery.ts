// Lead discovery contract (task 07A, docs/decisions.md D-07A-*): the ideal customer profile's
// criteria, how they become an organization search, the discovery request and the run it
// creates. Searching finds companies only; finding people and enriching contacts are later
// steps. Provider-neutral: no field or limit here comes from a provider's API. Pure zod.
import { z } from 'zod';

export const DISCOVERY_ROUTES = {
  request: (workspaceId: string) =>
    `/workspaces/${workspaceId}/imports/discovery`,
  run: (workspaceId: string, runId: string) =>
    `/workspaces/${workspaceId}/imports/${runId}`,
} as const;

/** Most companies one search may return, whatever the provider allows. */
export const DISCOVERY_MAX_RESULTS = 1000;
export const DISCOVERY_DEFAULT_RESULTS = 100;

const term = (max: number) =>
  z
    .string()
    .trim()
    .min(1, 'Enter some text, or leave this out.')
    .max(max, `Use at most ${String(max)} characters.`);

const terms = (items: number, chars: number) =>
  z.array(term(chars)).max(items, `Use at most ${String(items)} entries.`);

const WHOLE = 'Use a whole number.';

/** A range with an optional lower and upper bound, lower ≤ upper. */
const range = (max: number) =>
  z
    .strictObject({
      min: z
        .number(WHOLE)
        .int(WHOLE)
        .min(1, 'Use at least 1.')
        .max(max)
        .optional(),
      max: z
        .number(WHOLE)
        .int(WHOLE)
        .min(1, 'Use at least 1.')
        .max(max)
        .optional(),
    })
    .refine(
      (r) => r.min === undefined || r.max === undefined || r.min <= r.max,
      {
        path: ['max'],
        message: 'Use a maximum at least as large as the minimum.',
      },
    );

const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'Use two-letter country codes, such as US.');

/**
 * An ICP's targeting criteria (icps.criteria), validated before every write and every search.
 * Company criteria drive organization search; people criteria (titles, seniorities) are kept
 * for finding people later. Anything else is refused by name.
 */
export const icpCriteriaSchema = z.strictObject(
  {
    industries: terms(20, 100).optional(),
    countries: z
      .array(countryCodeSchema)
      .max(50, 'Use at most 50 entries.')
      .optional(),
    /** Number of employees. */
    employees: range(10_000_000).optional(),
    keywords: terms(20, 60).optional(),
    technologies: terms(20, 60).optional(),
    /** Yearly revenue in US dollars. */
    annualRevenue: range(1_000_000_000_000).optional(),
    titles: terms(30, 100).optional(),
    seniorities: terms(10, 40).optional(),
  },
  {
    error: (issue) =>
      issue.code === 'unrecognized_keys'
        ? `Lead Fennec doesn't recognize ${issue.keys.length === 1 ? 'the filter' : 'the filters'} ${issue.keys.map((key) => `"${key}"`).join(', ')}.`
        : undefined,
  },
);

export type IcpCriteria = z.output<typeof icpCriteriaSchema>;

export const ORGANIZATION_FILTER_KEYS = [
  'industries',
  'countries',
  'employees',
  'keywords',
  'technologies',
  'annualRevenue',
] as const;

export const PEOPLE_FILTER_KEYS = ['titles', 'seniorities'] as const;

export type OrganizationFilterKey = (typeof ORGANIZATION_FILTER_KEYS)[number];
export type PeopleFilterKey = (typeof PEOPLE_FILTER_KEYS)[number];

/** The company part of the criteria: what an organization search filters by. */
export const organizationSearchFiltersSchema = icpCriteriaSchema.pick({
  industries: true,
  countries: true,
  employees: true,
  keywords: true,
  technologies: true,
  annualRevenue: true,
});

export type OrganizationSearchFilters = z.output<
  typeof organizationSearchFiltersSchema
>;

const FILTER_LABELS: Readonly<Record<OrganizationFilterKey, string>> = {
  industries: 'industry',
  countries: 'country',
  employees: 'company size',
  keywords: 'keywords',
  technologies: 'technologies',
  annualRevenue: 'annual revenue',
};

/** What a provider can do, declared by the provider (never guessed). */
export interface OrganizationSearchCapabilities {
  readonly supportedFilters: readonly OrganizationFilterKey[];
  readonly maxPageSize: number;
  readonly maxResultsPerSearch: number;
  /** Shown with every result, as the provider requires. */
  readonly attribution: string;
}

export interface OrganizationSearchPlan {
  readonly filters: OrganizationSearchFilters;
  readonly maxResults: number;
  /** People criteria of the ICP, left for finding people later. */
  readonly ignoredCriteria: readonly PeopleFilterKey[];
}

export interface PlanIssue {
  readonly path: string;
  readonly message: string;
}

/**
 * Turns an ICP's criteria into an organization search for a provider, or says clearly why it
 * can't: criteria that aren't valid, no company filter at all, a filter the provider can't
 * apply, or more results than one search may return. Nothing is requested from a provider.
 */
export function planOrganizationSearch(
  criteria: unknown,
  maxResults: number,
  capabilities: OrganizationSearchCapabilities,
):
  | { readonly ok: true; readonly plan: OrganizationSearchPlan }
  | { readonly ok: false; readonly issues: readonly PlanIssue[] } {
  const issues: PlanIssue[] = [];
  const cap = Math.min(DISCOVERY_MAX_RESULTS, capabilities.maxResultsPerSearch);
  if (!Number.isInteger(maxResults) || maxResults < 1) {
    issues.push({ path: 'maxResults', message: 'Ask for at least 1 company.' });
  } else if (maxResults > cap) {
    issues.push({
      path: 'maxResults',
      message: `Ask for at most ${String(cap)} companies in one search.`,
    });
  }
  const parsed = icpCriteriaSchema.safeParse(criteria);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({
        path: ['criteria', ...issue.path.map(String)].join('.'),
        message: issue.message,
      });
    }
    return { ok: false, issues };
  }
  const present = ORGANIZATION_FILTER_KEYS.filter(
    (key) => parsed.data[key] !== undefined,
  );
  if (present.length === 0) {
    issues.push({
      path: 'criteria',
      message:
        'The ideal customer profile has no company filters (industry, country, company size or keywords). Add one before searching.',
    });
  }
  for (const key of present) {
    if (!capabilities.supportedFilters.includes(key)) {
      issues.push({
        path: `criteria.${key}`,
        message: `Company search can't filter by ${FILTER_LABELS[key]} yet. Remove it from the profile to search.`,
      });
    }
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  const filters = Object.fromEntries(
    present.map((key) => [key, parsed.data[key]]),
  ) as OrganizationSearchFilters;
  return {
    ok: true,
    plan: {
      filters,
      maxResults,
      ignoredCriteria: PEOPLE_FILTER_KEYS.filter(
        (key) => parsed.data[key] !== undefined,
      ),
    },
  };
}

/** Starts a search from an ICP of the workspace. */
export const discoveryRequestSchema = z
  .object({
    icpId: z.uuid('Choose an ideal customer profile.'),
    maxResults: z
      .number(WHOLE)
      .int(WHOLE)
      .min(1, 'Ask for at least 1 company.')
      .max(
        DISCOVERY_MAX_RESULTS,
        `Ask for at most ${String(DISCOVERY_MAX_RESULTS)} companies in one search.`,
      )
      .optional(),
  })
  .strict();

/** Providers a search may use: FAKE in development and tests (synthetic data only). */
export const DISCOVERY_PROVIDERS = ['FAKE', 'APOLLO'] as const;
export type DiscoveryProvider = (typeof DISCOVERY_PROVIDERS)[number];

export const IMPORT_STATUSES = [
  'PENDING',
  'PROCESSING',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
] as const;

/** The answer to a request: the run, and where to follow it. */
export const discoveryAcceptedSchema = z
  .object({
    runId: z.uuid(),
    status: z.enum(IMPORT_STATUSES),
    /** The API path of the run (GET it for the status). */
    statusUrl: z.string(),
  })
  .strict();

const iso = z.iso.datetime();
const count = z.number().int().min(0);

/** A run: what was asked, from which source, and how far it got. */
export const importRunSchema = z
  .object({
    id: z.uuid(),
    source: z.enum(['CSV', 'APOLLO', 'ORGANIZATION_SEARCH']),
    status: z.enum(IMPORT_STATUSES),
    /** Organization searches only. */
    search: z
      .object({
        icpId: z.uuid(),
        provider: z.enum(DISCOVERY_PROVIDERS),
        filters: organizationSearchFiltersSchema,
        maxResults: z.number().int().min(1),
        ignoredCriteria: z.array(z.enum(PEOPLE_FILTER_KEYS)),
        attribution: z.string(),
      })
      .strict()
      .nullable(),
    /** CSV imports only: the file's name as uploaded (untrusted text). */
    fileName: z.string().nullable(),
    /**
     * found: records received (rows, or companies the provider returned); saved: kept in the
     * workspace, of which created are new; excluded: on the suppression list; failed: not
     * usable; repeated: the same company again within the run (found minus the others).
     */
    counts: z
      .object({
        found: count,
        saved: count,
        created: count,
        excluded: count,
        failed: count,
        repeated: count,
      })
      .strict(),
    /** Pages fetched from the provider so far (searches). */
    pagesFetched: count,
    /** Machine-readable: why it failed, or the last error of a run being retried. */
    errorCode: z.string().nullable(),
    createdAt: iso,
    startedAt: iso.nullable(),
    completedAt: iso.nullable(),
  })
  .strict();

export type ImportRun = z.output<typeof importRunSchema>;
export type DiscoveryAccepted = z.output<typeof discoveryAcceptedSchema>;
