// Apollo people lookup and contact enrichment (task 08B, docs/decisions.md D-08B-*), two separate
// adapters built only from Apollo's official documentation, checked 2026-11-06:
//   People API Search: https://docs.apollo.io/reference/people-api-search (updated 2026-09-29)
//   Bulk People Enrichment: https://docs.apollo.io/reference/bulk-people-enrichment (updated
//   2026-11-04); People Enrichment: https://docs.apollo.io/reference/people-enrichment
// Search finds people (0 credits) and returns partial records: no email, an obfuscated last
// name. Enrichment matches up to 10 people per call and returns their full names and work
// addresses, at the credits Apollo reports. Personal emails, phone numbers and waterfall
// enrichment are never requested. An address Apollo extrapolated (a guess) is dropped, and
// Apollo's own email status is kept only as an untrusted claim.
import {
  SENIORITY_LEVELS,
  normalizeEmail,
  type SeniorityLevel,
} from '@lead-fennec-ai/shared';
import { z } from 'zod';
import { ApolloClient, type ApolloClientOptions } from './apollo-client.js';
import {
  ProviderError,
  type ContactEnrichmentBatch,
  type ContactEnrichmentProvider,
  type ContactEnrichmentRequest,
  type EnrichedPerson,
  type PeopleSearchPage,
  type PeopleSearchProvider,
  type PeopleSearchRequest,
  type ProviderPerson,
} from './providers.js';

export const APOLLO_PEOPLE_SEARCH_URL =
  'https://api.apollo.io/api/v1/mixed_people/api_search';
export const APOLLO_BULK_MATCH_URL =
  'https://api.apollo.io/api/v1/people/bulk_match';

/** Documented: 100 records per page, up to 500 pages, 50,000 records. */
const PEOPLE_MAX_PER_PAGE = 100;
const PEOPLE_MAX_PAGE = 500;
const PEOPLE_DISPLAY_LIMIT = 50_000;
/** Documented: up to 10 people per bulk enrichment request. */
const BULK_MATCH_MAX = 10;

const ATTRIBUTION = 'People data from Apollo.io.';

const TOKEN = /^apollo:people:v1:(\d{1,3}):(\d{1,3})$/;

function decodeToken(token: string): { page: number; perPage: number } {
  const match = TOKEN.exec(token);
  const page = Number(match?.[1]);
  const perPage = Number(match?.[2]);
  if (
    match === null ||
    page < 2 ||
    page > PEOPLE_MAX_PAGE ||
    perPage < 1 ||
    perPage > PEOPLE_MAX_PER_PAGE
  ) {
    throw new ProviderError('invalid_request');
  }
  return { page, perPage };
}

const textOrNull = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

const seniorityOf = (value: unknown): SeniorityLevel | null =>
  SENIORITY_LEVELS.find((level) => level === value) ?? null;

/** The query of one people search page: every filter mapped to its documented parameter. */
export function apolloPeopleQuery(
  request: PeopleSearchRequest,
  page: number,
  perPage: number,
): URLSearchParams {
  const query = new URLSearchParams();
  for (const title of request.titles) {
    query.append('person_titles[]', title.trim());
  }
  for (const level of request.seniorities) {
    // Our levels are Apollo's documented values.
    query.append('person_seniorities[]', level);
  }
  if (request.organization.domain !== null) {
    query.append('q_organization_domains_list[]', request.organization.domain);
  }
  query.append('page', String(page));
  query.append('per_page', String(perPage));
  return query;
}

const peopleResponseSchema = z.object({
  total_entries: z.number().int().min(0),
  people: z.array(z.unknown()).max(PEOPLE_MAX_PER_PAGE),
});

/** One documented search record → a partial ProviderPerson (no email, no last name). */
export function mapApolloSearchPerson(
  record: unknown,
  organizationDomain: string | null,
): ProviderPerson {
  const value =
    typeof record === 'object' && record !== null
      ? (record as Record<string, unknown>)
      : {};
  const id = textOrNull(value['id']);
  const firstName = textOrNull(value['first_name']);
  const title = textOrNull(value['title']);
  const hasEmail =
    typeof value['has_email'] === 'boolean' ? value['has_email'] : null;
  return {
    externalId: id ?? '',
    firstName: firstName ?? '',
    // Only an obfuscated last name is documented: withheld until enrichment.
    lastName: null,
    title,
    seniority: null,
    linkedinUrl: null,
    // The company searched for (the domain filter); not read from the record.
    organizationDomain,
    hasEmail,
    raw: {
      id,
      first_name: firstName,
      last_name_obfuscated: textOrNull(value['last_name_obfuscated']),
      title,
      has_email: hasEmail,
    },
  };
}

export class ApolloPeopleSearchProvider implements PeopleSearchProvider {
  readonly source = 'APOLLO' as const;
  readonly attribution = ATTRIBUTION;
  readonly maxPageSize = PEOPLE_MAX_PER_PAGE;
  readonly #client: ApolloClient;

  constructor(options: ApolloClientOptions) {
    this.#client = new ApolloClient(options);
  }

  async searchPeople(request: PeopleSearchRequest): Promise<PeopleSearchPage> {
    // Without a domain the company can't be targeted precisely: refused, not guessed.
    if (
      request.organization.domain === null ||
      !Number.isInteger(request.pageSize) ||
      request.pageSize < 1 ||
      request.pageSize > PEOPLE_MAX_PER_PAGE
    ) {
      throw new ProviderError('invalid_request');
    }
    const { page, perPage } =
      request.pageToken === null
        ? { page: 1, perPage: request.pageSize }
        : decodeToken(request.pageToken);
    const { body } = await this.#client.post(
      `${APOLLO_PEOPLE_SEARCH_URL}?${apolloPeopleQuery(request, page, perPage).toString()}`,
    );
    const parsed = peopleResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new ProviderError('bad_response');
    }
    const { people, total_entries: total } = parsed.data;
    const more =
      people.length > 0 &&
      page * perPage < total &&
      page < PEOPLE_MAX_PAGE &&
      page * perPage < PEOPLE_DISPLAY_LIMIT;
    return {
      people: people.map((record) =>
        mapApolloSearchPerson(record, request.organization.domain),
      ),
      nextPageToken: more
        ? `apollo:people:v1:${String(page + 1)}:${String(perPage)}`
        : null,
      retrievedAt: this.#client.now(),
      // Documented: "0 credits".
      creditsUsed: 0,
    };
  }
}

const bulkResponseSchema = z.object({
  matches: z.array(z.unknown().nullable()).max(BULK_MATCH_MAX),
  credits_consumed: z.number().min(0).nullish(),
});

/**
 * One documented enrichment record → an EnrichedPerson. The address is kept only when it is
 * one and Apollo didn't extrapolate it (`extrapolated_email_confidence` set means a guess).
 * `email_status` "verified" is only Apollo's claim.
 */
export function mapApolloEnrichedPerson(
  record: unknown,
): EnrichedPerson | null {
  if (typeof record !== 'object' || record === null) {
    return null;
  }
  const value = record as Record<string, unknown>;
  const organization =
    typeof value['organization'] === 'object' && value['organization'] !== null
      ? (value['organization'] as Record<string, unknown>)
      : {};
  const rawEmail = textOrNull(value['email']);
  const extrapolated =
    typeof value['extrapolated_email_confidence'] === 'number';
  let email: string | null = null;
  let emailDropped: EnrichedPerson['emailDropped'] = null;
  if (rawEmail !== null) {
    if (extrapolated) {
      emailDropped = 'guessed';
    } else {
      try {
        email = normalizeEmail(rawEmail).email;
      } catch {
        emailDropped = 'malformed';
      }
    }
  }
  const status = textOrNull(value['email_status']);
  return {
    externalId: textOrNull(value['id']),
    firstName: textOrNull(value['first_name']),
    lastName: textOrNull(value['last_name']),
    title: textOrNull(value['title']),
    seniority: seniorityOf(value['seniority']),
    linkedinUrl: textOrNull(value['linkedin_url']),
    organizationDomain: textOrNull(organization['primary_domain']),
    email,
    providerClaim:
      email === null
        ? null
        : status === 'verified'
          ? 'provider_verified'
          : 'provider_unverified',
    emailDropped,
    raw: {
      id: textOrNull(value['id']),
      first_name: textOrNull(value['first_name']),
      last_name: textOrNull(value['last_name']),
      title: textOrNull(value['title']),
      seniority: textOrNull(value['seniority']),
      linkedin_url: textOrNull(value['linkedin_url']),
      email_status: status,
      extrapolated_email_confidence: extrapolated
        ? value['extrapolated_email_confidence']
        : null,
      organization_id: textOrNull(value['organization_id']),
    },
  };
}

export class ApolloContactEnrichmentProvider implements ContactEnrichmentProvider {
  readonly source = 'APOLLO' as const;
  readonly attribution = ATTRIBUTION;
  readonly maxBatchSize = BULK_MATCH_MAX;
  readonly #client: ApolloClient;

  constructor(options: ApolloClientOptions) {
    this.#client = new ApolloClient(options);
  }

  async enrichContacts(
    requests: readonly ContactEnrichmentRequest[],
  ): Promise<ContactEnrichmentBatch> {
    if (requests.length === 0) {
      return { results: [], retrievedAt: this.#client.now(), creditsUsed: 0 };
    }
    // A provider id asked twice is sent once (and paid for once).
    const keyOf = (r: ContactEnrichmentRequest) =>
      r.externalId === null
        ? `name:${r.firstName}|${r.lastName ?? ''}|${r.organizationDomain}`
        : `id:${r.externalId}`;
    const unique = [...new Map(requests.map((r) => [keyOf(r), r])).values()];
    if (unique.length > BULK_MATCH_MAX) {
      throw new ProviderError('invalid_request');
    }
    const details = unique.map((r) => ({
      ...(r.externalId === null ? {} : { id: r.externalId }),
      first_name: r.firstName,
      ...(r.lastName === null ? {} : { last_name: r.lastName }),
      ...(r.organizationName === null
        ? {}
        : { organization_name: r.organizationName }),
      domain: r.organizationDomain,
    }));
    // No reveal or waterfall parameters: work addresses only, nothing personal.
    const { body } = await this.#client.post(APOLLO_BULK_MATCH_URL, {
      details,
    });
    const parsed = bulkResponseSchema.safeParse(body);
    // Unmatched people are null in place: the answer must line up with the request.
    if (!parsed.success || parsed.data.matches.length !== unique.length) {
      throw new ProviderError('bad_response');
    }
    const byKey = new Map(
      unique.map((r, i) => [
        keyOf(r),
        mapApolloEnrichedPerson(parsed.data.matches[i]),
      ]),
    );
    return {
      results: requests.map((r) => byKey.get(keyOf(r)) ?? null),
      retrievedAt: this.#client.now(),
      creditsUsed: parsed.data.credits_consumed ?? null,
    };
  }
}
