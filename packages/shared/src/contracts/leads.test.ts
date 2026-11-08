import { describe, expect, it } from 'vitest';
import {
  LEAD_SEARCH_LIMITS,
  leadSearchFilters,
  leadSearchQuerySchema,
  likeContains,
} from './leads.js';

// The lead search query (task 11A): allowlisted filters and sorts, lists as text, defaults.
describe('lead search query (task 11A)', () => {
  it('has safe defaults', () => {
    expect(leadSearchFilters({})).toMatchObject({
      q: null,
      countries: [],
      statuses: ['ACTIVE'],
      sort: 'created',
      order: 'desc',
      limit: LEAD_SEARCH_LIMITS.defaultPageSize,
      cursor: null,
    });
  });

  it('reads lists as text, normalized, once each, and parses back to the same text', () => {
    const query = leadSearchQuerySchema.parse({
      country: ' us, de ,US',
      source: 'apollo,csv_import',
      band: 'high_priority',
      verification: 'Verified,no_address',
      industry: 'Software, Retail',
      scoreMin: '60',
    });
    expect(query).toMatchObject({
      country: 'US,DE,US',
      source: 'APOLLO,CSV_IMPORT',
      band: 'HIGH_PRIORITY',
      verification: 'verified,no_address',
      industry: 'Software,Retail',
      scoreMin: 60,
    });
    // What a client serializes is accepted again unchanged.
    expect(leadSearchQuerySchema.parse(query)).toEqual(query);
    expect(leadSearchFilters(query)).toMatchObject({
      countries: ['US', 'DE'],
      sources: ['APOLLO', 'CSV_IMPORT'],
      industries: ['software', 'retail'],
      verification: ['verified', 'no_address'],
    });
  });

  it('refuses unknown sorts, parameters and values', () => {
    const paths = (raw: unknown) => {
      const result = leadSearchQuerySchema.safeParse(raw);
      return result.success
        ? []
        : result.error.issues.map((issue) => issue.path.join('.'));
    };
    expect(paths({ sort: 'email' })).toEqual(['sort']);
    expect(paths({ sort: 'score' })).toEqual(['sort']);
    expect(
      paths({
        sort: 'score',
        campaignId: '0190f5c2-7d1e-7c3a-9c1e-4f6a8b2d3e10',
      }),
    ).toEqual([]);
    expect(paths({ order: 'random' })).toEqual(['order']);
    expect(paths({ select: '*' })).toEqual(['']);
    expect(paths({ source: 'LINKEDIN' })).toEqual(['source']);
    expect(paths({ eligibility: 'eligible,maybe' })).toEqual(['eligibility']);
    expect(paths({ scoreMin: '101' })).toEqual(['scoreMin']);
    expect(paths({ scoreMin: '70', scoreMax: '60' })).toEqual(['scoreMax']);
    expect(
      paths({
        activeAfter: '2026-11-02T00:00:00Z',
        activeBefore: '2026-11-01T00:00:00Z',
      }),
    ).toEqual(['activeBefore']);
    expect(paths({ limit: '0' })).toEqual(['limit']);
    expect(paths({ q: 'x'.repeat(101) })).toEqual(['q']);
    expect(paths({ industry: ' , ' })).toEqual(['industry']);
  });

  it('matches typed text literally', () => {
    expect(likeContains('50%_off\\')).toBe('%50\\%\\_off\\\\%');
    expect(likeContains('Acme')).toBe('%Acme%');
  });
});
