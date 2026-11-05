import { describe, expect, it } from 'vitest';
import { normalizeCompanyIdentity } from '../identity.js';
import {
  DISCOVERY_MAX_RESULTS,
  discoveryRequestSchema,
  icpCriteriaSchema,
  planOrganizationSearch,
  type OrganizationSearchCapabilities,
} from './lead-discovery.js';

const CAPABILITIES: OrganizationSearchCapabilities = {
  supportedFilters: ['industries', 'countries', 'employees', 'keywords'],
  maxPageSize: 25,
  maxResultsPerSearch: 500,
  attribution: 'Test directory',
};

/** The alpha fixture ICP's criteria (packages/database fixtures). */
const FIXTURE_CRITERIA = {
  industries: ['software'],
  employees: { min: 50, max: 500 },
  titles: ['VP Sales', 'Head of Revenue'],
};

const issues = (criteria: unknown, maxResults = 100) => {
  const result = planOrganizationSearch(criteria, maxResults, CAPABILITIES);
  return result.ok ? [] : result.issues;
};

describe('lead discovery contract (task 07A)', () => {
  it('turns an ICP into a company search, leaving people criteria for later', () => {
    const result = planOrganizationSearch(FIXTURE_CRITERIA, 100, CAPABILITIES);
    expect(result).toEqual({
      ok: true,
      plan: {
        filters: {
          industries: ['software'],
          employees: { min: 50, max: 500 },
        },
        maxResults: 100,
        ignoredCriteria: ['titles'],
      },
    });
    // Normalized on the way: trimmed terms, upper-case country codes.
    const normalized = planOrganizationSearch(
      { industries: ['  dental '], countries: ['de', 'at'] },
      10,
      CAPABILITIES,
    );
    expect(normalized.ok && normalized.plan.filters).toEqual({
      industries: ['dental'],
      countries: ['DE', 'AT'],
    });
  });

  it('refuses unknown criteria by name', () => {
    expect(
      issues({ industries: ['software'], revenue: 5, funding: 'A' }),
    ).toEqual([
      {
        path: 'criteria',
        message:
          'Lead Fennec doesn\'t recognize the filters "revenue", "funding".',
      },
    ]);
    expect(issues({ industry: 'software' })[0]?.message).toBe(
      'Lead Fennec doesn\'t recognize the filter "industry".',
    );
  });

  it('refuses filters the provider can not apply, and searches without company filters', () => {
    expect(
      issues({
        industries: ['software'],
        technologies: ['Salesforce'],
        annualRevenue: { min: 1_000_000 },
      }),
    ).toEqual([
      {
        path: 'criteria.technologies',
        message:
          "Company search can't filter by technologies yet. Remove it from the profile to search.",
      },
      {
        path: 'criteria.annualRevenue',
        message:
          "Company search can't filter by annual revenue yet. Remove it from the profile to search.",
      },
    ]);
    expect(issues({ titles: ['CEO'] })).toEqual([
      {
        path: 'criteria',
        message:
          'The ideal customer profile has no company filters (industry, country, company size or keywords). Add one before searching.',
      },
    ]);
    expect(issues(null)[0]?.path).toBe('criteria');
  });

  it('checks bounds of the criteria and of the request', () => {
    expect(issues({ countries: ['USA'] })).toEqual([
      {
        path: 'criteria.countries.0',
        message: 'Use two-letter country codes, such as US.',
      },
    ]);
    expect(issues({ employees: { min: 500, max: 50 } })[0]).toEqual({
      path: 'criteria.employees.max',
      message: 'Use a maximum at least as large as the minimum.',
    });
    expect(
      issues({
        keywords: Array.from({ length: 21 }, (_, i) => `k${String(i)}`),
      })[0]?.message,
    ).toBe('Use at most 20 entries.');
    // The provider's cap and the platform's cap, whichever is lower.
    expect(issues(FIXTURE_CRITERIA, 501)).toEqual([
      {
        path: 'maxResults',
        message: 'Ask for at most 500 companies in one search.',
      },
    ]);
    expect(issues(FIXTURE_CRITERIA, 0)[0]?.message).toBe(
      'Ask for at least 1 company.',
    );
    const generous = { ...CAPABILITIES, maxResultsPerSearch: 50_000 };
    const capped = planOrganizationSearch(FIXTURE_CRITERIA, 1001, generous);
    expect(capped.ok ? null : capped.issues[0]?.message).toBe(
      `Ask for at most ${String(DISCOVERY_MAX_RESULTS)} companies in one search.`,
    );
    expect(
      discoveryRequestSchema
        .safeParse({ icpId: 'nope', maxResults: 2000 })
        .error?.issues.map((issue) => issue.path.join('.')),
    ).toEqual(['icpId', 'maxResults']);
    expect(icpCriteriaSchema.safeParse({}).success).toBe(true);
  });

  it('normalizes company identities', () => {
    const acme = normalizeCompanyIdentity({
      name: '  Acme   Widgets, Inc. ',
      website: 'https://WWW.Acme-Widgets.example/about',
    });
    expect(acme).toEqual({
      name: 'Acme Widgets, Inc.',
      nameKey: 'acme widgets',
      domain: 'acme-widgets.example',
      key: 'domain:acme-widgets.example',
    });
    // Without a usable domain, the name key identifies the company.
    expect(
      normalizeCompanyIdentity({
        name: 'Müller & Söhne GmbH',
        domain: 'not a domain',
      }),
    ).toEqual({
      name: 'Müller & Söhne GmbH',
      nameKey: 'muller and sohne',
      domain: null,
      key: 'name:muller and sohne',
    });
    expect(normalizeCompanyIdentity({ name: 'MULLER AND SOHNE' }).key).toBe(
      'name:muller and sohne',
    );
    // A legal form alone is still a name.
    expect(normalizeCompanyIdentity({ name: 'Co.' }).nameKey).toBe('co');
    expect(() => normalizeCompanyIdentity({ name: '   ' })).toThrow();
    expect(() => normalizeCompanyIdentity({ name: '***' })).toThrow();
  });
});
