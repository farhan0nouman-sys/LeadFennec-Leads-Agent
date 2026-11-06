import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ApolloFetch } from './apollo-client.js';
import {
  APOLLO_BULK_MATCH_URL,
  APOLLO_PEOPLE_SEARCH_URL,
  ApolloContactEnrichmentProvider,
  ApolloPeopleSearchProvider,
} from './apollo-people.js';
import { ContactEnrichmentAgent } from './contact-enrichment.js';
import {
  FakeContactEnrichmentProvider,
  FakeEmailVerificationProvider,
  FakePeopleSearchProvider,
} from './fake-contacts.js';
import { ProviderError, type ContactEnrichmentRequest } from './providers.js';
import {
  LiveProvidersUnavailableError,
  createContactDataProviders,
  createEmailVerificationProvider,
} from './registry.js';

// Mocked contract tests for Apollo people lookup and enrichment (task 08B, docs/decisions.md
// D-08B-*). Answers are synthetic fixtures in the documented shapes (src/fixtures/apollo); the
// fetch is a script, so nothing leaves the process.
const KEY = 'synthetic-test-key-0000000000';
const NOW = new Date('2026-11-06T09:00:00Z');
const DOMAIN = 'northwind-analytics.example';
const ORG = {
  id: '0190f5c2-7d1e-7c3a-9c1e-4f6a8b2d3e10',
  name: 'Northwind Analytics',
  domain: DOMAIN,
};

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/apollo/${name}`, import.meta.url), 'utf8');
const PEOPLE = JSON.parse(fixture('bulk-match-people.json')) as Record<
  string,
  unknown
>;

interface Seen {
  url: URL;
  headers: Record<string, string>;
  body: unknown;
}

/** A scripted Apollo: search pages by `page`, bulk matches from the people fixture. */
function apollo(
  options: {
    pages?: Record<string, string>;
    credits?: number;
    bulkStatus?: number;
    bulkBody?: string;
    misalign?: boolean;
  } = {},
) {
  const seen: Seen[] = [];
  const fetch: ApolloFetch = (url, init) => {
    const parsed = new URL(url);
    const body: unknown =
      init.body === undefined ? undefined : JSON.parse(init.body);
    seen.push({ url: parsed, headers: { ...init.headers }, body });
    if (`${parsed.origin}${parsed.pathname}` === APOLLO_PEOPLE_SEARCH_URL) {
      const page = parsed.searchParams.get('page') ?? '1';
      return Promise.resolve(
        new Response(
          fixture(options.pages?.[page] ?? 'people-search-empty.json'),
          {
            status: 200,
          },
        ),
      );
    }
    if (`${parsed.origin}${parsed.pathname}` === APOLLO_BULK_MATCH_URL) {
      if (options.bulkStatus !== undefined) {
        return Promise.resolve(
          new Response(options.bulkBody ?? '', { status: options.bulkStatus }),
        );
      }
      const details = (body as { details: { id?: string }[] }).details;
      const matches = details.map((d) => PEOPLE[d.id ?? ''] ?? null);
      return Promise.resolve(
        new Response(
          JSON.stringify({
            request_id: 1,
            status: 'success',
            error_code: null,
            error_message: null,
            total_requested_enrichments: details.length,
            unique_enriched_records: matches.filter((m) => m !== null).length,
            missing_records: matches.filter((m) => m === null).length,
            credits_consumed:
              options.credits ?? matches.filter((m) => m !== null).length,
            matches: options.misalign === true ? matches.slice(1) : matches,
          }),
          { status: 200 },
        ),
      );
    }
    return Promise.reject(new Error(`unexpected URL ${parsed.pathname}`));
  };
  const client = {
    apiKey: KEY,
    fetch,
    now: () => NOW,
    sleep: () => Promise.resolve(),
  };
  return {
    seen,
    people: new ApolloPeopleSearchProvider(client),
    enrichment: new ApolloContactEnrichmentProvider(client),
  };
}

const request = (id: string, firstName: string): ContactEnrichmentRequest => ({
  externalId: id,
  firstName,
  lastName: null,
  organizationName: 'Northwind Analytics',
  organizationDomain: DOMAIN,
});

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderError);
    expect(`${String(error)} ${JSON.stringify(error)}`).not.toContain(KEY);
    return error as ProviderError;
  }
  throw new Error('expected a ProviderError');
};

describe('Apollo people search (task 08B)', () => {
  it('asks the documented endpoint for the company and roles, and gets partial records', async () => {
    const { people, seen } = apollo({
      pages: { '1': 'people-search-page-1.json' },
    });
    const page = await people.searchPeople({
      organization: { name: ORG.name, domain: DOMAIN },
      titles: ['VP Sales'],
      seniorities: ['vp', 'head'],
      pageSize: 2,
      pageToken: null,
    });
    const [call] = seen;
    expect(`${call?.url.origin ?? ''}${call?.url.pathname ?? ''}`).toBe(
      APOLLO_PEOPLE_SEARCH_URL,
    );
    expect(call?.url.searchParams.getAll('person_titles[]')).toEqual([
      'VP Sales',
    ]);
    expect(call?.url.searchParams.getAll('person_seniorities[]')).toEqual([
      'vp',
      'head',
    ]);
    expect(
      call?.url.searchParams.getAll('q_organization_domains_list[]'),
    ).toEqual([DOMAIN]);
    expect(call?.headers).toEqual({
      'x-api-key': KEY,
      accept: 'application/json',
    });
    expect(call?.body).toBeUndefined();
    expect(page).toMatchObject({
      nextPageToken: 'apollo:people:v1:2:2',
      retrievedAt: NOW,
      creditsUsed: 0,
    });
    expect(page.people[0]).toEqual({
      externalId: '6a1f0000000000000000b001',
      firstName: 'Ada',
      // Only an obfuscated last name is documented: withheld.
      lastName: null,
      title: 'VP Sales',
      seniority: null,
      linkedinUrl: null,
      organizationDomain: DOMAIN,
      hasEmail: true,
      raw: {
        id: '6a1f0000000000000000b001',
        first_name: 'Ada',
        last_name_obfuscated: 'Lo***e',
        title: 'VP Sales',
        has_email: true,
      },
    });
    expect(JSON.stringify(page)).not.toMatch(/@|has_direct_phone/);
  });

  it('handles empty results, and refuses a company without a domain before asking', async () => {
    const { people, seen } = apollo();
    const empty = await people.searchPeople({
      organization: { name: ORG.name, domain: DOMAIN },
      titles: [],
      seniorities: [],
      pageSize: 25,
      pageToken: null,
    });
    expect(empty).toMatchObject({ people: [], nextPageToken: null });
    const before = seen.length;
    for (const bad of [
      {
        organization: { name: ORG.name, domain: null },
        pageSize: 25,
        pageToken: null,
      },
      {
        organization: { name: ORG.name, domain: DOMAIN },
        pageSize: 101,
        pageToken: null,
      },
      {
        organization: { name: ORG.name, domain: DOMAIN },
        pageSize: 25,
        pageToken: 'forged',
      },
    ]) {
      expect(
        (
          await failure(
            people.searchPeople({ ...bad, titles: [], seniorities: [] }),
          )
        ).code,
      ).toBe('invalid_request');
    }
    expect(seen).toHaveLength(before);
  });
});

describe('Apollo contact enrichment (task 08B)', () => {
  it('matches people in one call, keeps provider ids, claims and missing addresses apart, and counts credits', async () => {
    const { enrichment, seen } = apollo();
    const batch = await enrichment.enrichContacts([
      request('6a1f0000000000000000b001', 'Ada'),
      request('6a1f0000000000000000b002', 'Grace'),
      request('6a1f0000000000000000b006', 'Hedy'),
      // The same provider id again: sent once, answered twice.
      request('6a1f0000000000000000b001', 'Ada'),
    ]);
    const [call] = seen;
    expect(call?.url.toString()).toBe(APOLLO_BULK_MATCH_URL);
    expect(call?.headers).toEqual({
      'x-api-key': KEY,
      accept: 'application/json',
      'content-type': 'application/json',
    });
    // Work addresses only: no reveal or waterfall parameters, and no guessed last names.
    expect(call?.body).toEqual({
      details: [
        {
          id: '6a1f0000000000000000b001',
          first_name: 'Ada',
          organization_name: 'Northwind Analytics',
          domain: DOMAIN,
        },
        {
          id: '6a1f0000000000000000b002',
          first_name: 'Grace',
          organization_name: 'Northwind Analytics',
          domain: DOMAIN,
        },
        {
          id: '6a1f0000000000000000b006',
          first_name: 'Hedy',
          organization_name: 'Northwind Analytics',
          domain: DOMAIN,
        },
      ],
    });
    expect(batch.creditsUsed).toBe(2);
    expect(batch.retrievedAt).toEqual(NOW);
    const [ada, grace, hedy, adaAgain] = batch.results;
    expect(ada).toMatchObject({
      externalId: '6a1f0000000000000000b001',
      firstName: 'Ada',
      lastName: 'Lovelace',
      seniority: 'vp',
      organizationDomain: DOMAIN,
      email: 'ada.lovelace@northwind-analytics.example',
      // Apollo's "verified" is its claim, not our status.
      providerClaim: 'provider_verified',
      emailDropped: null,
    });
    expect(Object.keys(ada ?? {})).not.toContain('status');
    expect(ada?.raw).not.toHaveProperty('photo_url');
    // A match without an address, and someone Apollo couldn't match.
    expect(grace).toMatchObject({
      lastName: 'Hopper',
      email: null,
      providerClaim: null,
    });
    expect(hedy).toBeNull();
    expect(adaAgain).toEqual(ada);
  });

  it('drops guessed and malformed addresses, and keeps fractional credits', async () => {
    const { enrichment } = apollo({ credits: 1.5 });
    const batch = await enrichment.enrichContacts([
      request('6a1f0000000000000000b004', 'Katherine'),
      request('6a1f0000000000000000b005', 'Linus'),
    ]);
    expect(batch.creditsUsed).toBe(1.5);
    expect(batch.results[0]).toMatchObject({
      lastName: 'Johnson',
      email: null,
      emailDropped: 'guessed',
      providerClaim: null,
    });
    expect(batch.results[1]).toMatchObject({
      email: null,
      emailDropped: 'malformed',
      providerClaim: null,
    });
  });

  it('fails clearly on quota exhaustion, bad keys and answers that do not line up', async () => {
    const quota = apollo({
      bulkStatus: 429,
      bulkBody: fixture('error-429-day.json'),
    });
    expect(
      await failure(
        quota.enrichment.enrichContacts([
          request('6a1f0000000000000000b001', 'Ada'),
        ]),
      ),
    ).toMatchObject({ code: 'quota_exceeded', retryable: false });
    expect(quota.seen).toHaveLength(1);
    const unauthorized = apollo({
      bulkStatus: 401,
      bulkBody: fixture('error-401.txt'),
    });
    expect(
      await failure(
        unauthorized.enrichment.enrichContacts([
          request('6a1f0000000000000000b001', 'Ada'),
        ]),
      ),
    ).toMatchObject({ code: 'unauthorized', retryable: false });
    const misaligned = apollo({ misalign: true });
    expect(
      await failure(
        misaligned.enrichment.enrichContacts([
          request('6a1f0000000000000000b001', 'Ada'),
          request('6a1f0000000000000000b002', 'Grace'),
        ]),
      ),
    ).toMatchObject({ code: 'bad_response' });
    // More than 10 people in one call is refused before asking.
    const many = apollo();
    expect(
      (
        await failure(
          many.enrichment.enrichContacts(
            Array.from({ length: 11 }, (_, i) =>
              request(`id-${String(i)}`, 'X'),
            ),
          ),
        )
      ).code,
    ).toBe('invalid_request');
    expect(many.seen).toEqual([]);
  });
});

describe('ContactEnrichmentAgent on Apollo (task 08B)', () => {
  it('finds, completes and costs contacts; repeated ids once; people without an address skipped; unmatched refused', async () => {
    const { people, enrichment, seen } = apollo({
      pages: {
        '1': 'people-search-page-1.json',
        '2': 'people-search-page-2.json',
      },
    });
    // Apollo pages of 2 for the fixtures.
    const narrow = {
      source: people.source,
      attribution: people.attribution,
      maxPageSize: 2,
      searchPeople: people.searchPeople.bind(people),
    };
    const { result, usage } = await new ContactEnrichmentAgent(
      narrow,
      enrichment,
    ).run({
      organization: ORG,
      targeting: { titles: [], seniorities: [] },
      maxContacts: 10,
    });
    expect(usage).toEqual({
      searchRequests: 2,
      searchCredits: 0,
      enrichmentRequests: 1,
      enrichmentCredits: 2,
      repeatedProviderIds: 1,
      skippedWithoutEmail: 1,
      unmatched: 1,
      droppedEmails: 0,
    });
    if (!result.ok) {
      throw new Error('expected an answer');
    }
    expect(
      result.contacts.map((c) => [
        c.identity.firstName,
        c.identity.lastName,
        c.email?.address ?? null,
      ]),
    ).toEqual([
      ['Ada', 'Lovelace', 'ada.lovelace@northwind-analytics.example'],
      ['Grace', 'Hopper', null],
    ]);
    expect(result.contacts[0]?.provenance).toMatchObject({
      provider: 'APOLLO',
      externalId: '6a1f0000000000000000b001',
      attribution: 'People data from Apollo.io.',
    });
    // Hedy: Apollo couldn't match her, so her record stays partial and is refused.
    expect(result.rejected).toEqual([
      expect.objectContaining({
        issues: [
          expect.objectContaining({
            path: expect.stringMatching(/lastName$/) as unknown as string,
          }),
        ],
      }),
    ]);
    // Alan (no address) was never sent to enrichment.
    const bulk = seen.find((s) => s.url.toString() === APOLLO_BULK_MATCH_URL);
    expect(JSON.stringify(bulk?.body)).not.toContain('b003');
  });
});

describe('providers by environment (task 08B)', () => {
  it('uses fakes locally, Apollo with a key elsewhere, and fails closed without one', () => {
    for (const appEnv of ['development', 'test'] as const) {
      const local = createContactDataProviders(appEnv, { apolloApiKey: KEY });
      expect(local.peopleSearch).toBeInstanceOf(FakePeopleSearchProvider);
      expect(local.contactEnrichment).toBeInstanceOf(
        FakeContactEnrichmentProvider,
      );
      expect(createEmailVerificationProvider(appEnv)).toBeInstanceOf(
        FakeEmailVerificationProvider,
      );
    }
    for (const appEnv of ['staging', 'production'] as const) {
      const live = createContactDataProviders(appEnv, { apolloApiKey: KEY });
      expect(live.peopleSearch).toBeInstanceOf(ApolloPeopleSearchProvider);
      expect(live.contactEnrichment).toBeInstanceOf(
        ApolloContactEnrichmentProvider,
      );
      expect(() => createContactDataProviders(appEnv, {})).toThrow(
        LiveProvidersUnavailableError,
      );
      // No verification service is chosen: never a stand-in.
      expect(() => createEmailVerificationProvider(appEnv)).toThrow(
        /No email verification service is selected/,
      );
    }
  });
});
