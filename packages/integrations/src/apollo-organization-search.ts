// Apollo organization search, the live OrganizationSearchProvider (task 07B, docs/decisions.md
// D-07B-*). Built only from Apollo's official documentation, checked 2026-11-06:
//   https://docs.apollo.io/reference/organization-search  (API v1, page updated 2026-09-29)
//   https://docs.apollo.io/reference/rate-limits
//   https://docs.apollo.io/reference/status-codes
//   https://docs.apollo.io/reference/authentication
// It calls one documented endpoint, POST /api/v1/mixed_companies/search, and maps only
// documented request parameters and response fields. Companies only: people search and
// enrichment are other providers. The API key comes from the environment through the
// constructor and is sent only in the x-api-key header; it never appears in an error, a
// result or a log line. Responses are untrusted: checked here, then validated record by
// record by LeadDiscoveryService.
import {
  organizationSearchFiltersSchema,
  type OrganizationSearchCapabilities,
  type OrganizationSearchFilters,
} from '@lead-fennec-ai/shared';
import { z } from 'zod';
import {
  ProviderError,
  type OrganizationSearchPage,
  type OrganizationSearchProvider,
  type OrganizationSearchRequest,
  type ProviderOrganization,
} from './providers.js';
import {
  ApolloClient,
  quotaFrom,
  type ApolloClientOptions,
} from './apollo-client.js';

/** The documented endpoint (base https://api.apollo.io/api/v1). */
export const APOLLO_ORGANIZATION_SEARCH_URL =
  'https://api.apollo.io/api/v1/mixed_companies/search';

/** Documented: up to 100 results per page, up to 500 pages, 50,000 records in all. */
export const APOLLO_MAX_PER_PAGE = 100;
export const APOLLO_MAX_PAGE = 500;
export const APOLLO_DISPLAY_LIMIT = 50_000;
/** Documented: "1 Apollo credit per page". */
export const APOLLO_CREDITS_PER_PAGE = 1;

/** Upper bound sent when an ICP's company size has no maximum (the ICP schema's own cap). */
const EMPLOYEES_UPPER_BOUND = 10_000_000;

export const APOLLO_ORGANIZATION_SEARCH_CAPABILITIES: OrganizationSearchCapabilities =
  Object.freeze({
    supportedFilters: Object.freeze([
      'industries',
      'countries',
      'employees',
      'keywords',
      'technologies',
      'annualRevenue',
    ] as const),
    maxPageSize: APOLLO_MAX_PER_PAGE,
    maxResultsPerSearch: APOLLO_DISPLAY_LIMIT,
    attribution: 'Company data from Apollo.io organization search.',
  });

/** The fetch this adapter needs; tests pass a fake (no network in tests). */
export type { ApolloFetch } from './apollo-client.js';

/** The adapter's options are the shared client's (D-08B-01). */
export type ApolloOrganizationSearchOptions = ApolloClientOptions;

/** Opaque to callers: the page to ask for and the page size kept from the first page. */
const TOKEN = /^apollo:v1:(\d{1,3}):(\d{1,3})$/;

function encodeToken(page: number, perPage: number): string {
  return `apollo:v1:${String(page)}:${String(perPage)}`;
}

function decodeToken(token: string): { page: number; perPage: number } {
  const match = TOKEN.exec(token);
  const page = Number(match?.[1]);
  const perPage = Number(match?.[2]);
  if (
    match === null ||
    page < 2 ||
    page > APOLLO_MAX_PAGE ||
    perPage < 1 ||
    perPage > APOLLO_MAX_PER_PAGE
  ) {
    throw new ProviderError('invalid_request');
  }
  return { page, perPage };
}

const regionNames = new Intl.DisplayNames(['en'], {
  type: 'region',
  fallback: 'none',
});

/**
 * ISO 3166-1 alpha-2 → the English country name, lower-case, as `organization_locations[]`
 * takes place names (documented examples: "spain", "texas", "10115, germany").
 */
export function apolloCountryName(code: string): string {
  // ISO 3166 user-assigned codes (AA, QM–QZ, XA–XZ, ZZ) and groupings (EU, EZ, UN) name no
  // country, though Intl has names for some ("Unknown Region").
  const country =
    /^[A-Z]{2}$/.test(code) && !/^(AA|Q[M-Z]|X[A-Z]|ZZ|EU|EZ|UN)$/.test(code);
  const name = country ? regionNames.of(code) : undefined;
  if (name === undefined || name === code) {
    throw new ProviderError('invalid_request');
  }
  return name.toLowerCase();
}

/** Documented: technology uids use underscores for spaces and periods ("google_analytics"). */
export function apolloTechnologyUid(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[\s.]+/g, '_');
}

/**
 * The query string of one search page: every ICP company filter mapped explicitly to its
 * documented parameter (D-07B-02). Apollo takes these as query parameters of the POST.
 */
export function apolloSearchQuery(
  filters: OrganizationSearchFilters,
  page: number,
  perPage: number,
): URLSearchParams {
  const query = new URLSearchParams();
  const add = (key: string, values: readonly string[] | undefined) => {
    for (const value of values ?? []) {
      query.append(key, value);
    }
  };
  add(
    'organization_industries[]',
    filters.industries?.map((industry) => industry.trim().toLowerCase()),
  );
  add('organization_locations[]', filters.countries?.map(apolloCountryName));
  if (filters.employees !== undefined) {
    const { min, max } = filters.employees;
    query.append(
      'organization_num_employees_ranges[]',
      `${String(min ?? 1)},${String(max ?? EMPLOYEES_UPPER_BOUND)}`,
    );
  }
  add(
    'q_organization_keyword_tags[]',
    filters.keywords?.map((keyword) => keyword.trim()),
  );
  add(
    'currently_using_any_of_technology_uids[]',
    filters.technologies?.map(apolloTechnologyUid),
  );
  if (filters.annualRevenue?.min !== undefined) {
    query.append('revenue_range[min]', String(filters.annualRevenue.min));
  }
  if (filters.annualRevenue?.max !== undefined) {
    query.append('revenue_range[max]', String(filters.annualRevenue.max));
  }
  query.append('page', String(page));
  query.append('per_page', String(perPage));
  return query;
}

/** The documented response, as far as this adapter reads it. Other keys are dropped. */
const searchResponseSchema = z.object({
  pagination: z.object({
    page: z.number().int().min(0),
    per_page: z.number().int().min(0),
    total_entries: z.number().int().min(0),
    total_pages: z.number().int().min(0),
  }),
  organizations: z.array(z.unknown()).max(APOLLO_MAX_PER_PAGE),
});

const textOrNull = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

/**
 * One documented organization record → a ProviderOrganization. Apollo's response documents
 * no industry, employee count or country, so those stay null rather than guessed. `raw` keeps
 * only the fields read here: no phone numbers, social links or other extras.
 */
export function mapApolloOrganization(record: unknown): ProviderOrganization {
  const value =
    typeof record === 'object' && record !== null
      ? (record as Record<string, unknown>)
      : {};
  const id = textOrNull(value['id']);
  const name = textOrNull(value['name']);
  const websiteUrl = textOrNull(value['website_url']);
  const primaryDomain = textOrNull(value['primary_domain']);
  return {
    externalId: id ?? '',
    name: name ?? '',
    domain: primaryDomain,
    websiteUrl,
    industry: null,
    employeeCount: null,
    countryCode: null,
    raw: {
      id,
      name,
      website_url: websiteUrl,
      primary_domain: primaryDomain,
    },
  };
}

export class ApolloOrganizationSearchProvider implements OrganizationSearchProvider {
  readonly source = 'APOLLO' as const;
  readonly capabilities = APOLLO_ORGANIZATION_SEARCH_CAPABILITIES;
  readonly #client: ApolloClient;

  constructor(options: ApolloOrganizationSearchOptions) {
    this.#client = new ApolloClient(options);
  }

  async searchOrganizations(
    request: OrganizationSearchRequest,
  ): Promise<OrganizationSearchPage> {
    const filters = organizationSearchFiltersSchema.safeParse(request.filters);
    if (
      !filters.success ||
      !Number.isInteger(request.pageSize) ||
      request.pageSize < 1 ||
      request.pageSize > APOLLO_MAX_PER_PAGE
    ) {
      throw new ProviderError('invalid_request');
    }
    // Later pages keep the first page's size, so page numbers stay aligned with offsets.
    const { page, perPage } =
      request.pageToken === null
        ? { page: 1, perPage: request.pageSize }
        : decodeToken(request.pageToken);
    const url = `${APOLLO_ORGANIZATION_SEARCH_URL}?${apolloSearchQuery(filters.data, page, perPage).toString()}`;

    const { body, headers } = await this.#client.post(url);
    const parsed = searchResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new ProviderError('bad_response');
    }
    const { pagination, organizations } = parsed.data;
    const more =
      organizations.length > 0 &&
      page < pagination.total_pages &&
      page < APOLLO_MAX_PAGE &&
      page * perPage < APOLLO_DISPLAY_LIMIT;
    return {
      organizations: organizations.map(mapApolloOrganization),
      nextPageToken: more ? encodeToken(page + 1, perPage) : null,
      totalAvailable: pagination.total_entries,
      retrievedAt: this.#client.now(),
      quota: quotaFrom(headers),
      creditsUsed: APOLLO_CREDITS_PER_PAGE,
    };
  }
}
