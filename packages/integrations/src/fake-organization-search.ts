// A deterministic company directory for development and tests (task 07A). Every company is
// synthetic, on the reserved .example top-level domain: no real business, person or address.
// The same request always returns the same companies in the same order; quota and failures can
// be scripted to exercise error handling.
import type {
  OrganizationSearchCapabilities,
  OrganizationSearchFilters,
} from '@lead-fennec-ai/shared';
import {
  ProviderError,
  type OrganizationSearchPage,
  type OrganizationSearchProvider,
  type OrganizationSearchRequest,
  type ProviderErrorCode,
  type ProviderOrganization,
} from './providers.js';

const INDUSTRIES = [
  'software',
  'dental',
  'logistics',
  'manufacturing',
  'healthcare',
  'retail',
] as const;
const COUNTRIES = ['US', 'DE', 'GB', 'FR', 'AT', 'CA'] as const;
const FIRST = [
  'Northwind',
  'Bluefield',
  'Copperleaf',
  'Brightline',
  'Silverpine',
  'Harborview',
  'Redwood',
  'Lakeside',
  'Summit',
  'Oakridge',
] as const;
const SECOND = [
  'Systems',
  'Labs',
  'Partners',
  'Works',
  'Group',
  'Clinics',
  'Freight',
  'Health',
  'Goods',
  'Tools',
] as const;

export const FAKE_DIRECTORY_SIZE = 240;

const pick = <T>(list: readonly T[], index: number): T =>
  list[index % list.length] as T;

/**
 * The directory, in a fixed order. A few entries are deliberately untidy, as real provider data
 * is: an upper-case "WWW." domain, a website but no domain, neither, an invalid domain, and a
 * second company on another one's domain.
 */
export function fakeOrganizationDirectory(): readonly ProviderOrganization[] {
  const entries: ProviderOrganization[] = [];
  for (let i = 0; i < FAKE_DIRECTORY_SIZE; i += 1) {
    const number = String(i + 1).padStart(3, '0');
    const name = `${pick(FIRST, i)} ${pick(SECOND, Math.floor(i / 10))} ${number}`;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
    let domain: string | null = `${slug}.example`;
    let websiteUrl: string | null = `https://${slug}.example`;
    switch (i % 40) {
      case 3:
        domain = `WWW.${slug.toUpperCase()}.EXAMPLE`;
        break;
      case 7:
        domain = null;
        websiteUrl = `https://www.${slug}.example/about`;
        break;
      case 11:
        domain = null;
        websiteUrl = null;
        break;
      case 19:
        domain = 'not a domain';
        websiteUrl = null;
        break;
      case 29: {
        // Same domain as the company before it: one identity, kept once per run.
        const previous = entries.at(-1);
        domain = previous?.domain ?? domain;
        break;
      }
      default:
        break;
    }
    const industry = pick(INDUSTRIES, i);
    const countryCode = pick(COUNTRIES, Math.floor(i / INDUSTRIES.length));
    const employeeCount = 5 + ((i * 7919) % 4995);
    const externalId = `fake-org-${String(i + 1).padStart(4, '0')}`;
    entries.push({
      externalId,
      name,
      domain,
      websiteUrl,
      industry,
      employeeCount,
      countryCode,
      raw: {
        id: externalId,
        name,
        domain,
        website: websiteUrl,
        industry,
        employees: employeeCount,
        country: countryCode,
        synthetic: true,
      },
    });
  }
  return entries;
}

export const FAKE_ORGANIZATION_SEARCH_CAPABILITIES: OrganizationSearchCapabilities =
  Object.freeze({
    supportedFilters: Object.freeze([
      'industries',
      'countries',
      'employees',
      'keywords',
    ] as const),
    maxPageSize: 25,
    maxResultsPerSearch: 500,
    attribution:
      'Synthetic companies from the Lead Fennec test directory, not real businesses.',
  });

const lower = (values: readonly string[] | undefined) =>
  values?.map((value) => value.toLowerCase());

function matches(
  organization: ProviderOrganization,
  filters: OrganizationSearchFilters,
): boolean {
  const industries = lower(filters.industries);
  if (
    industries !== undefined &&
    !industries.includes((organization.industry ?? '').toLowerCase())
  ) {
    return false;
  }
  if (
    filters.countries !== undefined &&
    !filters.countries.includes(organization.countryCode ?? '')
  ) {
    return false;
  }
  const employees = organization.employeeCount ?? 0;
  if (
    (filters.employees?.min !== undefined &&
      employees < filters.employees.min) ||
    (filters.employees?.max !== undefined && employees > filters.employees.max)
  ) {
    return false;
  }
  const keywords = lower(filters.keywords);
  if (keywords !== undefined) {
    const text =
      `${organization.name} ${organization.industry ?? ''}`.toLowerCase();
    if (!keywords.some((keyword) => text.includes(keyword))) {
      return false;
    }
  }
  return true;
}

export interface FakeOrganizationSearchOptions {
  /** Clock for retrievedAt (tests pass a fixed one). */
  readonly now?: () => Date;
  /** Requests the fake account may make; then quota_exceeded. Unlimited when left out. */
  readonly quota?: number;
  /** Errors to throw on given requests, by 1-based request number. */
  readonly failures?: Readonly<Record<number, ProviderErrorCode>>;
  /** Another directory (tests); the standard one otherwise. */
  readonly directory?: readonly ProviderOrganization[];
}

/** Deterministic organization search over the synthetic directory. */
export class FakeOrganizationSearchProvider implements OrganizationSearchProvider {
  readonly source = 'FAKE' as const;
  readonly capabilities = FAKE_ORGANIZATION_SEARCH_CAPABILITIES;
  readonly requests: OrganizationSearchRequest[] = [];
  private readonly directory: readonly ProviderOrganization[];
  private quotaLeft: number | null;

  constructor(private readonly options: FakeOrganizationSearchOptions = {}) {
    this.directory = options.directory ?? fakeOrganizationDirectory();
    this.quotaLeft = options.quota ?? null;
  }

  searchOrganizations(
    request: OrganizationSearchRequest,
  ): Promise<OrganizationSearchPage> {
    this.requests.push(request);
    const failure = this.options.failures?.[this.requests.length];
    if (failure !== undefined) {
      return Promise.reject(
        new ProviderError(failure, failure === 'rate_limited' ? 30 : null),
      );
    }
    if (this.quotaLeft !== null) {
      if (this.quotaLeft <= 0) {
        return Promise.reject(new ProviderError('quota_exceeded'));
      }
      this.quotaLeft -= 1;
    }
    const unsupported = Object.keys(request.filters).filter(
      (key) =>
        !(this.capabilities.supportedFilters as readonly string[]).includes(
          key,
        ),
    );
    const offset =
      request.pageToken === null
        ? 0
        : Number(/^p:(\d{1,6})$/.exec(request.pageToken)?.[1] ?? Number.NaN);
    if (
      unsupported.length > 0 ||
      !Number.isInteger(offset) ||
      !Number.isInteger(request.pageSize) ||
      request.pageSize < 1 ||
      request.pageSize > this.capabilities.maxPageSize
    ) {
      return Promise.reject(new ProviderError('invalid_request'));
    }
    const found = this.directory.filter((organization) =>
      matches(organization, request.filters),
    );
    const next = offset + request.pageSize;
    return Promise.resolve({
      organizations: found.slice(offset, next),
      nextPageToken: next < found.length ? `p:${String(next)}` : null,
      totalAvailable: found.length,
      retrievedAt: (this.options.now ?? (() => new Date()))(),
      quota:
        this.quotaLeft === null
          ? null
          : { remaining: this.quotaLeft, resetAt: null },
      // Synthetic: one credit per request, so cost tracking can be exercised.
      creditsUsed: 1,
    });
  }
}
