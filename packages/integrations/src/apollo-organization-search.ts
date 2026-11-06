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
  type ProviderQuota,
} from './providers.js';

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
export type ApolloFetch = (
  url: string,
  init: {
    readonly method: 'POST';
    readonly headers: Readonly<Record<string, string>>;
    readonly redirect: 'error';
    readonly signal: AbortSignal;
  },
) => Promise<Response>;

export interface ApolloOrganizationSearchOptions {
  /** From the environment (APOLLO_API_KEY). Never logged, stored or returned. */
  readonly apiKey: string;
  readonly fetch?: ApolloFetch;
  readonly now?: () => Date;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  /** Per attempt, including reading the answer. Default 15 s. */
  readonly timeoutMs?: number;
  /** Attempts per page, the first included. Default 3. */
  readonly maxAttempts?: number;
  /** A retry that would wait longer than this is not made; the error says when to retry. */
  readonly maxRetryDelaySeconds?: number;
}

const apiKeySchema = z
  .string()
  .min(8)
  .max(200)
  .regex(/^[\x21-\x7e]+$/);

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

const errorBodySchema = z.object({
  error_details: z
    .object({
      code: z.string().optional(),
      suggestions: z
        .array(
          z.object({ retry_after_seconds: z.number().int().min(0).optional() }),
        )
        .optional(),
      context: z
        .object({ window: z.object({ value: z.string() }).optional() })
        .optional(),
    })
    .optional(),
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

/** Whole seconds from a Retry-After header; null when absent or not a number of seconds. */
function retryAfterHeader(headers: Headers): number | null {
  const value = headers.get('retry-after');
  return value !== null && /^\d{1,6}$/.test(value.trim())
    ? Number(value.trim())
    : null;
}

/** The fewest requests left in any window the headers report (documented headers). */
function quotaFrom(headers: Headers): ProviderQuota | null {
  const left = [
    'x-minute-requests-left',
    'x-hourly-requests-left',
    'x-24-hour-requests-left',
  ]
    .map((name) => headers.get(name)?.trim() ?? '')
    .filter((value) => /^\d{1,9}$/.test(value))
    .map(Number);
  // Windows open with the first request and aren't aligned to the clock: no reset time.
  return left.length === 0
    ? null
    : { remaining: Math.min(...left), resetAt: null };
}

/** A refused request → our error. The provider's own message never travels (D-07B-04). */
function errorFor(
  status: number,
  headers: Headers,
  body: string,
): ProviderError {
  if (status === 401) {
    return new ProviderError('unauthorized');
  }
  if (status === 403) {
    // A plan without API access, or a key not scoped to this endpoint.
    return new ProviderError('forbidden');
  }
  if (status === 429) {
    let details: z.output<typeof errorBodySchema>['error_details'];
    try {
      details = errorBodySchema.safeParse(JSON.parse(body)).data?.error_details;
    } catch {
      details = undefined;
    }
    if (details?.code === 'USAGE.RATE_LIMIT.PLATFORM_RATE_LIMIT') {
      // Platform load: no Retry-After; the suggestion says when (documented as 60 s).
      const suggested = details.suggestions?.find(
        (s) => s.retry_after_seconds !== undefined,
      )?.retry_after_seconds;
      return new ProviderError('rate_limited', suggested ?? 60);
    }
    const retryAfter = retryAfterHeader(headers);
    if (details?.context?.window?.value === 'day') {
      // The team's daily allowance for this endpoint is used up.
      return new ProviderError('quota_exceeded', retryAfter);
    }
    return new ProviderError('rate_limited', retryAfter);
  }
  if (status >= 500) {
    return new ProviderError('unavailable');
  }
  return new ProviderError('invalid_request');
}

const defaultSleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class ApolloOrganizationSearchProvider implements OrganizationSearchProvider {
  readonly source = 'APOLLO' as const;
  readonly capabilities = APOLLO_ORGANIZATION_SEARCH_CAPABILITIES;
  readonly #apiKey: string;
  readonly #fetch: ApolloFetch;
  readonly #now: () => Date;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #timeoutMs: number;
  readonly #maxAttempts: number;
  readonly #maxRetryDelaySeconds: number;

  constructor(options: ApolloOrganizationSearchOptions) {
    // Checked without echoing it: a malformed key could also inject a header.
    if (!apiKeySchema.safeParse(options.apiKey).success) {
      throw new Error('The Apollo API key is missing or malformed.');
    }
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.#now = options.now ?? (() => new Date());
    this.#sleep = options.sleep ?? defaultSleep;
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    this.#maxAttempts = Math.min(Math.max(options.maxAttempts ?? 3, 1), 5);
    this.#maxRetryDelaySeconds = options.maxRetryDelaySeconds ?? 30;
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

    const { body, headers } = await this.#withRetries(url);
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
      retrievedAt: this.#now(),
      quota: quotaFrom(headers),
      creditsUsed: APOLLO_CREDITS_PER_PAGE,
    };
  }

  /** Bounded retries: retryable errors only, at most maxAttempts, never a long wait. */
  async #withRetries(
    url: string,
  ): Promise<{ body: unknown; headers: Headers }> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.#attempt(url);
      } catch (error) {
        if (
          !(error instanceof ProviderError) ||
          !error.retryable ||
          attempt >= this.#maxAttempts
        ) {
          throw error;
        }
        const waitSeconds = error.retryAfterSeconds ?? 2 ** (attempt - 1);
        if (waitSeconds > this.#maxRetryDelaySeconds) {
          throw error;
        }
        await this.#sleep(waitSeconds * 1000);
      }
    }
  }

  async #attempt(url: string): Promise<{ body: unknown; headers: Headers }> {
    const controller = new AbortController();
    // Settles the attempt at the deadline even if the fetch ignores the abort.
    const deadline = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener(
        'abort',
        () => {
          reject(new ProviderError('timeout'));
        },
        { once: true },
      );
    });
    const timer = setTimeout(() => {
      controller.abort();
    }, this.#timeoutMs);
    try {
      const exchange = (async () => {
        const response = await this.#fetch(url, {
          method: 'POST',
          headers: {
            'x-api-key': this.#apiKey,
            accept: 'application/json',
          },
          // A redirect could carry the key to another host: refused.
          redirect: 'error',
          signal: controller.signal,
        });
        return { response, text: await response.text() };
      })();
      const { response, text } = await Promise.race([exchange, deadline]);
      if (!response.ok) {
        throw errorFor(response.status, response.headers, text);
      }
      try {
        return { body: JSON.parse(text) as unknown, headers: response.headers };
      } catch {
        throw new ProviderError('bad_response');
      }
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }
      // The cause (a network error or the abort) is dropped: it may name the request.
      throw new ProviderError(
        controller.signal.aborted ? 'timeout' : 'unavailable',
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
