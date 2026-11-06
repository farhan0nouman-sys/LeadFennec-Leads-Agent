import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  APOLLO_ORGANIZATION_SEARCH_URL,
  ApolloOrganizationSearchProvider,
  apolloSearchQuery,
  type ApolloFetch,
  type ApolloOrganizationSearchOptions,
} from './apollo-organization-search.js';
import { FakeOrganizationSearchProvider } from './fake-organization-search.js';
import { LeadDiscoveryService } from './lead-discovery.js';
import { ProviderError } from './providers.js';
import {
  LiveProvidersUnavailableError,
  createOrganizationSearchProvider,
  organizationSearchDeclaration,
} from './registry.js';

// Mocked contract tests for the Apollo organization search adapter (task 07B, docs/decisions.md
// D-07B-*). Every answer is a synthetic fixture shaped like Apollo's documentation
// (src/fixtures/apollo/README.md); the fetch is a script, so nothing leaves the process.
const KEY = 'synthetic-test-key-0000000000';
const NOW = new Date('2026-11-06T09:00:00Z');

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/apollo/${name}`, import.meta.url), 'utf8');

type Reply = (signal: AbortSignal) => Response | Promise<Response>;

const reply =
  (name: string, status = 200, headers: Record<string, string> = {}): Reply =>
  () =>
    new Response(fixture(name), {
      status,
      headers: {
        'content-type': name.endsWith('.txt')
          ? 'text/plain'
          : 'application/json',
        ...headers,
      },
    });

/** Waits for the abort, as the real fetch does. */
const hang: Reply = (signal) =>
  new Promise<Response>((_resolve, reject) => {
    signal.addEventListener('abort', () => {
      reject(new DOMException('This operation was aborted', 'AbortError'));
    });
  });

function apollo(
  replies: Reply[],
  options: Partial<ApolloOrganizationSearchOptions> = {},
) {
  const requests: {
    url: URL;
    method: string;
    headers: Record<string, string>;
    redirect: string;
  }[] = [];
  const waits: number[] = [];
  const fetch: ApolloFetch = async (url, init) => {
    requests.push({
      url: new URL(url),
      method: init.method,
      headers: { ...init.headers },
      redirect: init.redirect,
    });
    const next = replies.shift();
    if (next === undefined) {
      throw new Error('unexpected request');
    }
    return next(init.signal);
  };
  const provider = new ApolloOrganizationSearchProvider({
    apiKey: KEY,
    fetch,
    now: () => NOW,
    sleep: (milliseconds) => {
      waits.push(milliseconds);
      return Promise.resolve();
    },
    ...options,
  });
  return { provider, requests, waits };
}

const first = { filters: { industries: ['software'] }, pageSize: 2 };

const failure = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ProviderError);
    // Never the key, and never Apollo's own words.
    const text = `${String(error)} ${JSON.stringify(error)}`;
    expect(text).not.toContain(KEY);
    expect(text).not.toMatch(/apollo|api key|paid plans|synthetic/i);
    return error as ProviderError;
  }
  throw new Error('expected a ProviderError');
};

describe('Apollo organization search: request (task 07B)', () => {
  it('maps every ICP company filter to its documented parameter', () => {
    const query = apolloSearchQuery(
      {
        industries: ['Computer Software'],
        countries: ['DE', 'US', 'GB'],
        employees: { min: 50, max: 500 },
        keywords: ['SaaS'],
        technologies: ['Google Analytics', 'wordpress.org'],
        annualRevenue: { min: 1_000_000 },
      },
      1,
      100,
    );
    expect([...query.keys()].sort()).toEqual(
      [
        'currently_using_any_of_technology_uids[]',
        'currently_using_any_of_technology_uids[]',
        'organization_industries[]',
        'organization_locations[]',
        'organization_locations[]',
        'organization_locations[]',
        'organization_num_employees_ranges[]',
        'page',
        'per_page',
        'q_organization_keyword_tags[]',
        'revenue_range[min]',
      ].sort(),
    );
    expect(query.getAll('organization_industries[]')).toEqual([
      'computer software',
    ]);
    expect(query.getAll('organization_locations[]')).toEqual([
      'germany',
      'united states',
      'united kingdom',
    ]);
    expect(query.getAll('organization_num_employees_ranges[]')).toEqual([
      '50,500',
    ]);
    expect(query.getAll('q_organization_keyword_tags[]')).toEqual(['SaaS']);
    expect(query.getAll('currently_using_any_of_technology_uids[]')).toEqual([
      'google_analytics',
      'wordpress_org',
    ]);
    expect(query.get('revenue_range[min]')).toBe('1000000');
    expect(query.get('revenue_range[max]')).toBeNull();
    // Open-ended company sizes get explicit bounds.
    expect(
      apolloSearchQuery({ employees: { min: 200 } }, 1, 10).get(
        'organization_num_employees_ranges[]',
      ),
    ).toBe('200,10000000');
    expect(
      apolloSearchQuery({ employees: { max: 20 } }, 1, 10).get(
        'organization_num_employees_ranges[]',
      ),
    ).toBe('1,20');
    // A code that names no country is refused, not sent.
    for (const code of ['ZZ', 'XA', 'QQ', 'EU']) {
      expect(() => apolloSearchQuery({ countries: [code] }, 1, 10)).toThrow(
        ProviderError,
      );
    }
  });

  it('calls only the documented endpoint, with the key in its header only', async () => {
    const { provider, requests } = apollo([
      reply('organization-search-page-1.json'),
    ]);
    await provider.searchOrganizations({ ...first, pageToken: null });
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.method).toBe('POST');
    expect(`${request?.url.origin ?? ''}${request?.url.pathname ?? ''}`).toBe(
      APOLLO_ORGANIZATION_SEARCH_URL,
    );
    expect(request?.headers).toEqual({
      'x-api-key': KEY,
      accept: 'application/json',
    });
    expect(request?.redirect).toBe('error');
    expect(request?.url.toString()).not.toContain(KEY);
    expect(request?.url.searchParams.get('page')).toBe('1');
    expect(request?.url.searchParams.get('per_page')).toBe('2');
  });

  it('refuses what it would have to guess, before any request', async () => {
    const { provider, requests } = apollo([]);
    for (const request of [
      { ...first, pageSize: 101, pageToken: null },
      { ...first, pageSize: 0, pageToken: null },
      { ...first, pageToken: 'forged' },
      { ...first, pageToken: 'apollo:v1:501:100' },
      { ...first, pageToken: 'apollo:v1:2:101' },
      {
        filters: { industries: ['software'], sector: 'x' } as never,
        pageSize: 2,
        pageToken: null,
      },
    ]) {
      expect((await failure(provider.searchOrganizations(request))).code).toBe(
        'invalid_request',
      );
    }
    expect(requests).toEqual([]);
    expect(
      () => new ApolloOrganizationSearchProvider({ apiKey: 'bad key\r\nx: 1' }),
    ).toThrow('The Apollo API key is missing or malformed.');
    expect(() => new ApolloOrganizationSearchProvider({ apiKey: '' })).toThrow(
      /missing or malformed/,
    );
  });
});

describe('Apollo organization search: answers (task 07B)', () => {
  it('pages through results with documented fields only, and reports cost and quota', async () => {
    const { provider, requests } = apollo([
      reply('organization-search-page-1.json', 200, {
        'x-rate-limit-minute': '50',
        'x-minute-requests-left': '49',
        'x-hourly-requests-left': '199',
        'x-24-hour-requests-left': '599',
      }),
      reply('organization-search-page-2.json'),
    ]);
    const one = await provider.searchOrganizations({
      ...first,
      pageToken: null,
    });
    expect(one).toMatchObject({
      nextPageToken: 'apollo:v1:2:2',
      totalAvailable: 3,
      retrievedAt: NOW,
      quota: { remaining: 49, resetAt: null },
      creditsUsed: 1,
    });
    expect(one.organizations).toEqual([
      {
        externalId: '6a1f0000000000000000a001',
        name: 'Northwind Analytics GmbH',
        domain: 'northwind-analytics.example',
        websiteUrl: 'http://www.northwind-analytics.example',
        // Not in Apollo's documented response: left empty, never guessed.
        industry: null,
        employeeCount: null,
        countryCode: null,
        raw: {
          id: '6a1f0000000000000000a001',
          name: 'Northwind Analytics GmbH',
          website_url: 'http://www.northwind-analytics.example',
          primary_domain: 'northwind-analytics.example',
        },
      },
      {
        externalId: '6a1f0000000000000000a002',
        name: 'Contoso Ledger Inc.',
        domain: null,
        websiteUrl: 'https://contoso-ledger.example/',
        industry: null,
        employeeCount: null,
        countryCode: null,
        raw: {
          id: '6a1f0000000000000000a002',
          name: 'Contoso Ledger Inc.',
          website_url: 'https://contoso-ledger.example/',
          primary_domain: null,
        },
      },
    ]);
    // Phone numbers, links and other extras are not kept.
    expect(JSON.stringify(one)).not.toMatch(/555|social\.example|phone/);

    // The next page keeps the first page's size, even when asked for fewer.
    const two = await provider.searchOrganizations({
      ...first,
      pageSize: 1,
      pageToken: one.nextPageToken,
    });
    expect(requests[1]?.url.searchParams.get('page')).toBe('2');
    expect(requests[1]?.url.searchParams.get('per_page')).toBe('2');
    expect(two.organizations.map((o) => o.externalId)).toEqual([
      '6a1f0000000000000000a003',
    ]);
    expect(two.nextPageToken).toBeNull();
    expect(two.quota).toBeNull();
  });

  it('stops at the documented 500-page limit', async () => {
    const body = JSON.stringify({
      pagination: {
        page: 500,
        per_page: 100,
        total_entries: 90_000,
        total_pages: 900,
      },
      organizations: [{ id: 'x', name: 'Last Page Co' }],
    });
    const { provider } = apollo([() => new Response(body, { status: 200 })]);
    const page = await provider.searchOrganizations({
      ...first,
      pageToken: 'apollo:v1:500:100',
    });
    expect(page.nextPageToken).toBeNull();
  });

  it('handles an empty result', async () => {
    const { provider, requests } = apollo([
      reply('organization-search-empty.json'),
    ]);
    const discovery = new LeadDiscoveryService(provider);
    const result = await discovery.run(
      discovery.plan({ industries: ['no such industry'] }, 25),
    );
    expect(result).toMatchObject({
      provider: 'APOLLO',
      organizations: [],
      pages: 1,
      received: 0,
      creditsUsed: 1,
    });
    expect(requests).toHaveLength(1);
  });

  it('finds companies for an ICP through LeadDiscoveryService, never people', async () => {
    const { provider, requests } = apollo([
      reply('organization-search-page-1.json'),
      reply('organization-search-page-2.json'),
    ]);
    const discovery = new LeadDiscoveryService(provider);
    const plan = discovery.plan(
      { industries: ['software'], titles: ['VP Sales'] },
      3,
    );
    expect(plan.ignoredCriteria).toEqual(['titles']);
    const result = await discovery.run(plan);
    expect(result.organizations.map((o) => o.identity.key)).toEqual([
      'domain:northwind-analytics.example',
      'domain:contoso-ledger.example',
      'domain:fabrikam-robotics.example',
    ]);
    expect(result.organizations[0]?.source).toEqual({
      provider: 'APOLLO',
      externalId: '6a1f0000000000000000a001',
      retrievedAt: NOW,
      attribution: 'Company data from Apollo.io organization search.',
    });
    expect(result.creditsUsed).toBe(2);
    for (const request of requests) {
      const keys = [...request.url.searchParams.keys()];
      expect(keys.some((key) => /person|title|email|seniorit/.test(key))).toBe(
        false,
      );
    }
  });
});

describe('Apollo organization search: failures (task 07B)', () => {
  it('fails authentication once, without retrying or repeating the provider', async () => {
    const { provider, requests } = apollo([
      reply('error-401.txt', 401),
      reply('error-401.txt', 401),
    ]);
    const error = await failure(
      provider.searchOrganizations({ ...first, pageToken: null }),
    );
    expect(error).toMatchObject({ code: 'unauthorized', retryable: false });
    expect(error.message).toBe('The provider did not accept the credentials.');
    expect(requests).toHaveLength(1);

    const plan = apollo([reply('error-403.json', 403)]);
    expect(
      await failure(
        plan.provider.searchOrganizations({ ...first, pageToken: null }),
      ),
    ).toMatchObject({ code: 'forbidden', retryable: false });
  });

  it('waits out a short rate limit, then answers', async () => {
    const { provider, requests, waits } = apollo([
      reply('error-429-minute.json', 429, { 'retry-after': '2' }),
      reply('organization-search-page-1.json'),
    ]);
    const page = await provider.searchOrganizations({
      ...first,
      pageToken: null,
    });
    expect(page.organizations).toHaveLength(2);
    expect(requests).toHaveLength(2);
    expect(waits).toEqual([2000]);
  });

  it('reports quota limits instead of waiting for hours', async () => {
    // The daily allowance is used up: not retried, and says when.
    const daily = apollo([
      reply('error-429-day.json', 429, { 'retry-after': '50000' }),
    ]);
    expect(
      await failure(
        daily.provider.searchOrganizations({ ...first, pageToken: null }),
      ),
    ).toMatchObject({
      code: 'quota_exceeded',
      retryable: false,
      retryAfterSeconds: 50_000,
    });
    expect(daily.requests).toHaveLength(1);
    expect(daily.waits).toEqual([]);

    // An hourly limit with a long wait: given back to the caller, not slept on.
    const hourly = apollo([
      reply('error-429-minute.json', 429, { 'retry-after': '3600' }),
    ]);
    expect(
      await failure(
        hourly.provider.searchOrganizations({ ...first, pageToken: null }),
      ),
    ).toMatchObject({ code: 'rate_limited', retryAfterSeconds: 3600 });
    expect(hourly.waits).toEqual([]);

    // Platform load: the suggested 60 s, retried only when the caller allows that long.
    const busy = apollo([reply('error-429-platform.json', 429)]);
    expect(
      await failure(
        busy.provider.searchOrganizations({ ...first, pageToken: null }),
      ),
    ).toMatchObject({ code: 'rate_limited', retryAfterSeconds: 60 });
    const patient = apollo(
      [
        reply('error-429-platform.json', 429),
        reply('organization-search-empty.json'),
      ],
      { maxRetryDelaySeconds: 60 },
    );
    await patient.provider.searchOrganizations({ ...first, pageToken: null });
    expect(patient.waits).toEqual([60_000]);
  });

  it('retries a bounded number of times', async () => {
    const { provider, requests, waits } = apollo([
      reply('error-429-minute.json', 429, { 'retry-after': '1' }),
      reply('error-429-minute.json', 429, { 'retry-after': '1' }),
      reply('error-429-minute.json', 429, { 'retry-after': '1' }),
      reply('organization-search-page-1.json'),
    ]);
    expect(
      await failure(
        provider.searchOrganizations({ ...first, pageToken: null }),
      ),
    ).toMatchObject({ code: 'rate_limited', retryable: true });
    expect(requests).toHaveLength(3);
    expect(waits).toEqual([1000, 1000]);
  });

  it('times out, retries with back-off, and gives up', async () => {
    const { provider, requests, waits } = apollo([hang, hang, hang], {
      timeoutMs: 20,
    });
    expect(
      await failure(
        provider.searchOrganizations({ ...first, pageToken: null }),
      ),
    ).toMatchObject({ code: 'timeout', retryable: true });
    expect(requests).toHaveLength(3);
    expect(waits).toEqual([1000, 2000]);

    // A fetch that ignores the abort still ends at the deadline.
    const stuck = apollo([() => new Promise<Response>(() => undefined)], {
      timeoutMs: 20,
      maxAttempts: 1,
    });
    expect(
      await failure(
        stuck.provider.searchOrganizations({ ...first, pageToken: null }),
      ),
    ).toMatchObject({ code: 'timeout' });

    // One timeout, then an answer.
    const recovered = apollo([hang, reply('organization-search-empty.json')], {
      timeoutMs: 20,
    });
    await expect(
      recovered.provider.searchOrganizations({ ...first, pageToken: null }),
    ).resolves.toMatchObject({ organizations: [] });
  });

  it('treats server errors, network errors and unreadable answers as such', async () => {
    const server = apollo([
      () => new Response('<html>Bad gateway</html>', { status: 502 }),
      reply('organization-search-empty.json'),
    ]);
    await server.provider.searchOrganizations({ ...first, pageToken: null });
    expect(server.requests).toHaveLength(2);

    const offline = apollo(
      [() => Promise.reject(new TypeError(`fetch failed: ${KEY}`))],
      { maxAttempts: 1 },
    );
    expect(
      await failure(
        offline.provider.searchOrganizations({ ...first, pageToken: null }),
      ),
    ).toMatchObject({ code: 'unavailable' });

    for (const body of [
      '<html>not json</html>',
      JSON.stringify({ organizations: [] }),
      JSON.stringify({
        pagination: { page: 1, per_page: 2, total_entries: 1, total_pages: 1 },
        organizations: 'none',
      }),
    ]) {
      const odd = apollo([
        () => new Response(body, { status: 200 }),
        () => new Response(body, { status: 200 }),
      ]);
      expect(
        await failure(
          odd.provider.searchOrganizations({ ...first, pageToken: null }),
        ),
      ).toMatchObject({ code: 'bad_response', retryable: false });
      expect(odd.requests).toHaveLength(1);
    }

    const refused = apollo([
      () => new Response('{"error":"bad parameter"}', { status: 422 }),
    ]);
    expect(
      await failure(
        refused.provider.searchOrganizations({ ...first, pageToken: null }),
      ),
    ).toMatchObject({ code: 'invalid_request', retryable: false });
  });
});

describe('organization search by environment (task 07B)', () => {
  it('uses the fake in development and test, Apollo with a key elsewhere', () => {
    for (const appEnv of ['development', 'test'] as const) {
      expect(
        createOrganizationSearchProvider(appEnv, { apolloApiKey: KEY }),
      ).toBeInstanceOf(FakeOrganizationSearchProvider);
      expect(organizationSearchDeclaration(appEnv).source).toBe('FAKE');
    }
    for (const appEnv of ['staging', 'production'] as const) {
      expect(
        createOrganizationSearchProvider(appEnv, { apolloApiKey: KEY }),
      ).toBeInstanceOf(ApolloOrganizationSearchProvider);
      expect(() => createOrganizationSearchProvider(appEnv, {})).toThrow(
        LiveProvidersUnavailableError,
      );
      expect(organizationSearchDeclaration(appEnv)).toMatchObject({
        source: 'APOLLO',
        capabilities: { maxPageSize: 100, maxResultsPerSearch: 50_000 },
      });
    }
  });
});
