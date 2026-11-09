import { describe, expect, it } from 'vitest';
import {
  FAKE_DIRECTORY_SIZE,
  FakeOrganizationSearchProvider,
  fakeOrganizationDirectory,
} from './fake-organization-search.js';
import { createFakeProviders } from './fakes.js';
import {
  DiscoveryPlanError,
  LeadDiscoveryService,
  type DiscoveredOrganization,
} from './lead-discovery.js';
import { ProviderError, type ProviderOrganization } from './providers.js';

const NOW = new Date('2026-11-05T09:00:00Z');
/** The alpha fixture ICP's criteria. */
const SOFTWARE = {
  industries: ['software'],
  employees: { min: 50, max: 2000 },
  titles: ['VP Sales'],
};

const service = (
  provider = new FakeOrganizationSearchProvider({ now: () => NOW }),
) => ({ provider, discovery: new LeadDiscoveryService(provider) }) as const;

const ids = (organizations: readonly DiscoveredOrganization[]) =>
  organizations.map((o) => o.source.externalId);

const rejection = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
};

describe('FakeOrganizationSearchProvider (task 07A)', () => {
  it('is a fixed, synthetic directory: no real company, the same every time', () => {
    const directory = fakeOrganizationDirectory();
    expect(directory).toHaveLength(FAKE_DIRECTORY_SIZE);
    expect(fakeOrganizationDirectory()).toEqual(directory);
    for (const organization of directory) {
      expect(organization.raw['synthetic']).toBe(true);
      for (const host of [organization.domain, organization.websiteUrl]) {
        if (host !== null && host !== 'not a domain') {
          expect(host.toLowerCase()).toMatch(/\.example(\/|$)/);
        }
      }
    }
    expect(createFakeProviders().organizationSearch).toBeInstanceOf(
      FakeOrganizationSearchProvider,
    );
  });

  it('pages by opaque tokens and refuses what it does not support', async () => {
    const provider = new FakeOrganizationSearchProvider({ now: () => NOW });
    const filters = { industries: ['software'] };
    const first = await provider.searchOrganizations({
      filters,
      pageSize: 25,
      pageToken: null,
    });
    expect(first.organizations).toHaveLength(25);
    expect(first.nextPageToken).toBe('p:25');
    expect(first.totalAvailable).toBe(40);
    expect(first.retrievedAt).toEqual(NOW);
    const last = await provider.searchOrganizations({
      filters,
      pageSize: 25,
      pageToken: first.nextPageToken,
    });
    expect(last.organizations).toHaveLength(15);
    expect(last.nextPageToken).toBeNull();
    for (const request of [
      { filters, pageSize: 26, pageToken: null },
      { filters, pageSize: 10, pageToken: 'forged' },
      { filters: { technologies: ['x'] }, pageSize: 10, pageToken: null },
    ]) {
      const error = await rejection(provider.searchOrganizations(request));
      expect(error).toBeInstanceOf(ProviderError);
      expect((error as ProviderError).code).toBe('invalid_request');
    }
  });

  it('reports quota, and fails with sanitized, typed errors', async () => {
    const provider = new FakeOrganizationSearchProvider({
      quota: 2,
      failures: { 2: 'rate_limited' },
    });
    const request = {
      filters: { countries: ['DE'] },
      pageSize: 5,
      pageToken: null,
    };
    expect((await provider.searchOrganizations(request)).quota).toEqual({
      remaining: 1,
      resetAt: null,
    });
    const limited = (await rejection(
      provider.searchOrganizations(request),
    )) as ProviderError;
    expect(limited).toMatchObject({
      code: 'rate_limited',
      retryable: true,
      retryAfterSeconds: 30,
      message: 'The provider asked to slow down.',
    });
    await provider.searchOrganizations(request);
    const exhausted = (await rejection(
      provider.searchOrganizations(request),
    )) as ProviderError;
    expect(exhausted).toMatchObject({
      code: 'quota_exceeded',
      retryable: false,
    });
    expect(exhausted.message).toBe("The provider account's quota is used up.");
  });
});

describe('LeadDiscoveryService (task 07A)', () => {
  it('checks the search before asking the provider anything', () => {
    const { provider, discovery } = service();
    for (const [criteria, max, path] of [
      [
        { industries: ['software'], technologies: ['CRM'] },
        10,
        'criteria.technologies',
      ],
      [{ industries: ['software'] }, 501, 'maxResults'],
      [{ sector: 'software' }, 10, 'criteria'],
      [{ titles: ['CEO'] }, 10, 'criteria'],
    ] as const) {
      try {
        discovery.plan(criteria, max);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(DiscoveryPlanError);
        expect((error as DiscoveryPlanError).issues[0]?.path).toBe(path);
      }
    }
    expect(provider.requests).toEqual([]);
  });

  it('finds matching companies with normalized identities and provenance, repeatably', async () => {
    const { provider, discovery } = service();
    const plan = discovery.plan(SOFTWARE, 500);
    expect(plan.ignoredCriteria).toEqual(['titles']);
    const result = await discovery.run(plan);
    expect(result).toMatchObject({
      provider: 'FAKE',
      attribution:
        'Synthetic companies from the Lead Fennec test directory, not real businesses.',
      duplicates: 0,
      invalid: 0,
    });
    expect(result.organizations.length).toBeGreaterThan(0);
    for (const organization of result.organizations) {
      expect(organization.industry).toBe('software');
      expect(organization.employeeCount).toBeGreaterThanOrEqual(50);
      expect(organization.employeeCount).toBeLessThanOrEqual(2000);
      expect(organization.source).toMatchObject({
        provider: 'FAKE',
        retrievedAt: NOW,
      });
      if (organization.identity.domain !== null) {
        expect(organization.identity.domain).toMatch(/^[a-z0-9-]+\.example$/);
        expect(organization.identity.key).toBe(
          `domain:${organization.identity.domain}`,
        );
      } else {
        expect(organization.identity.key).toMatch(/^name:/);
      }
    }
    expect(result.creditsUsed).toBe(result.pages);
    // Nothing about people is requested.
    expect(provider.requests.every((r) => !('titles' in r.filters))).toBe(true);

    // The same search with a new provider: the same companies, in the same order.
    const again = await service().discovery.run(plan);
    expect(ids(again.organizations)).toEqual(ids(result.organizations));
    expect(again.organizations.map((o) => o.identity)).toEqual(
      result.organizations.map((o) => o.identity),
    );
  });

  it('cleans untidy provider data: domains, websites, duplicates and invalid records', async () => {
    const directory = fakeOrganizationDirectory();
    const untidy = directory
      .filter((_, i) => [3, 7, 11, 19, 28, 29].includes(i % 40))
      .slice(0, 6);
    const base = directory[0];
    if (base === undefined) {
      throw new Error('empty directory');
    }
    const broken: ProviderOrganization = {
      ...base,
      externalId: 'fake-broken',
      countryCode: 'Germany',
    };
    const provider = new FakeOrganizationSearchProvider({
      now: () => NOW,
      directory: [...untidy, broken],
    });
    const discovery = new LeadDiscoveryService(provider);
    const result = await discovery.run(
      discovery.plan({ keywords: ['a', 'e', 'i', 'o', 'u'] }, 100),
    );
    const byId = new Map(
      result.organizations.map((o) => [o.source.externalId, o]),
    );
    // "WWW.NAME.EXAMPLE" → "name.example".
    const upper = byId.get(untidy[0]?.externalId ?? '');
    expect(upper?.identity.domain).toMatch(/^[a-z0-9-]+\.example$/);
    // A website without a domain gives the domain.
    expect(byId.get(untidy[1]?.externalId ?? '')?.identity.domain).toMatch(
      /\.example$/,
    );
    // Neither, or an invalid domain: the name key identifies it.
    expect(byId.get(untidy[2]?.externalId ?? '')?.identity.key).toMatch(
      /^name:/,
    );
    expect(byId.get(untidy[3]?.externalId ?? '')?.identity.key).toMatch(
      /^name:/,
    );
    // The second company on the same domain is a duplicate; the broken record is invalid.
    expect(result.duplicates).toBe(1);
    expect(result.invalid).toBe(1);
    expect(byId.has('fake-broken')).toBe(false);
    // The broken record is reported, so a run can list it as failed (task 07C).
    const rejected = [];
    for await (const page of new LeadDiscoveryService(
      new FakeOrganizationSearchProvider({
        now: () => NOW,
        directory: [...untidy, broken],
      }),
    ).pages(discovery.plan({ keywords: ['a', 'e', 'i', 'o', 'u'] }, 100))) {
      rejected.push(...page.rejected);
    }
    expect(rejected.map((r) => r.externalId)).toEqual(['fake-broken']);
    expect(rejected[0]?.raw).toEqual(broken.raw);
  });

  it('stops at the requested number and can resume an interrupted run', async () => {
    const { provider, discovery } = service();
    const plan = discovery.plan({ countries: ['US', 'DE'] }, 30);
    const full = await discovery.run(plan);
    expect(full.organizations).toHaveLength(30);
    expect(provider.requests.map((r) => r.pageSize)).toEqual([25, 5]);

    // Interrupted after the first page: resume from its token with what was found.
    const fresh = service();
    const pages = fresh.discovery.pages(plan);
    const step = await pages.next();
    if (step.done === true) {
      throw new Error('no first page');
    }
    const first = step.value;
    const rest: DiscoveredOrganization[] = [];
    for await (const page of fresh.discovery.pages(plan, {
      pageToken: first.nextPageToken,
      seen: first.organizations.map((o) => o.identity.key),
      found: first.organizations.length,
    })) {
      rest.push(...page.organizations);
    }
    expect(ids([...first.organizations, ...rest])).toEqual(
      ids(full.organizations),
    );
  });

  it('passes provider errors on, after the pages it already got', async () => {
    const { discovery } = service(
      new FakeOrganizationSearchProvider({ failures: { 2: 'timeout' } }),
    );
    const plan = discovery.plan({ industries: ['retail'] }, 40);
    const got: number[] = [];
    const error = await rejection(
      (async () => {
        for await (const page of discovery.pages(plan)) {
          got.push(page.organizations.length);
        }
      })(),
    );
    expect(got).toEqual([25]);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error).toMatchObject({ code: 'timeout', retryable: true });
  });
});
