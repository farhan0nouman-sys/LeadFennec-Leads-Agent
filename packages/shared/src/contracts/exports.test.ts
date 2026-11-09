import { describe, expect, it } from 'vitest';
import {
  LEAD_EXPORT_COLUMNS,
  leadExportCsv,
  leadExportRequestSchema,
} from './exports.js';
import type { LeadSearchItem } from './leads.js';
import {
  addSuppressionRequestSchema,
  deletionRequestSchema,
  normalizeSuppressionValue,
} from './suppressions.js';

const lead = (overrides: Partial<LeadSearchItem> = {}): LeadSearchItem => ({
  id: '0190f5c2-7d1e-7c3a-9c1e-4f6a8b2d3e10',
  name: '=HYPERLINK("http://evil.example","x")',
  title: '@SUM(A1)',
  email: 'pat@acme.example',
  status: 'ACTIVE',
  countryCode: 'US',
  company: {
    id: '0190f5c2-7d1e-7c3a-9c1e-4f6a8b2d3e11',
    name: 'Acme, Inc.',
    domain: 'acme.example',
    industry: '-software',
    countryCode: 'US',
  },
  sources: ['APOLLO', 'CSV_IMPORT'],
  verification: { status: 'verified', checkedAt: '2026-11-01T00:00:00.000Z' },
  score: null,
  qualification: null,
  createdAt: '2026-11-01T00:00:00.000Z',
  lastActivityAt: '2026-11-02T00:00:00.000Z',
  ...overrides,
});

// Lead exports and the do-not-contact list (task 11C).
describe('lead export files', () => {
  it('writes a byte-order mark, the header and rows whose cells stay text', () => {
    const csv = leadExportCsv([
      lead(),
      lead({ email: null, verification: null, company: null }),
    ]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split('\r\n');
    expect(lines[0]).toBe(LEAD_EXPORT_COLUMNS.join(','));
    expect(lines[1]).toBe(
      [
        '0190f5c2-7d1e-7c3a-9c1e-4f6a8b2d3e10',
        `"'=HYPERLINK(""http://evil.example"",""x"")"`,
        `'@SUM(A1)`,
        'pat@acme.example',
        'verified',
        '2026-11-01T00:00:00.000Z',
        '"Acme, Inc."',
        'acme.example',
        `'-software`,
        'US',
        '',
        '',
        '',
        '',
        'APOLLO CSV_IMPORT',
        '2026-11-01T00:00:00.000Z',
        '2026-11-02T00:00:00.000Z',
      ].join(','),
    );
    expect(lines[2]).toContain(',no address,');
    expect(lines.at(-1)).toBe('');
  });

  it('starts from the first lead: no page or page size', () => {
    expect(leadExportRequestSchema.safeParse({ filters: {} }).success).toBe(
      true,
    );
    expect(
      leadExportRequestSchema
        .safeParse({ filters: { cursor: 'x', limit: 5 } })
        .error?.issues.map((issue) => issue.path.join('.')),
    ).toEqual(['filters.cursor', 'filters.limit']);
    // The search's own rules still apply.
    expect(
      leadExportRequestSchema.safeParse({ filters: { sort: 'nope' } }).success,
    ).toBe(false);
  });
});

describe('the do-not-contact list', () => {
  it('normalizes addresses and domains, and refuses anything else', () => {
    expect(normalizeSuppressionValue('email', ' Pat@Acme.Example ')).toBe(
      'pat@acme.example',
    );
    expect(
      normalizeSuppressionValue('domain', 'https://www.Acme.example/'),
    ).toBe('acme.example');
    expect(normalizeSuppressionValue('email', 'acme.example')).toBeNull();
    expect(
      addSuppressionRequestSchema.safeParse({
        kind: 'domain',
        value: 'not a domain',
      }).error?.issues[0]?.message,
    ).toBe('This is not a domain, such as example.com.');
    // A member can't record a bounce or a deletion request by hand.
    expect(
      addSuppressionRequestSchema.safeParse({
        kind: 'email',
        value: 'pat@acme.example',
        reason: 'DELETION_REQUEST',
      }).success,
    ).toBe(false);
    expect(
      addSuppressionRequestSchema.parse({
        kind: 'email',
        value: 'pat@acme.example',
        note: '',
      }).note,
    ).toBeUndefined();
    expect(deletionRequestSchema.safeParse({ email: 'nope' }).success).toBe(
      false,
    );
  });
});
