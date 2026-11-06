import { describe, expect, it } from 'vitest';
import {
  IdentityNormalizationError,
  normalizeContactIdentity,
  normalizeLinkedinUrl,
} from '../identity.js';
import {
  VERIFICATION_MAX_AGE_DAYS,
  emailCheckSchema,
  emailSendEligibility,
  enrichedContactSchema,
  inferSeniority,
  normalizeTitle,
  parseContactEnrichmentOutput,
  parseSeniority,
  rankRoleRelevance,
  type EmailCheck,
} from './contact-enrichment.js';

// Contact enrichment contracts (task 08A, docs/decisions.md D-08A-*).
const NOW = new Date('2026-11-06T09:00:00Z');
const provenance = {
  provider: 'FAKE',
  externalId: 'fake-person-1',
  retrievedAt: '2026-11-06T08:59:00Z',
  attribution: 'Synthetic people from the Lead Fennec test directory.',
} as const;
const INPUT = {
  organization: {
    id: '0190f5c2-7d1e-7c3a-9c1e-4f6a8b2d3e10',
    name: 'Northwind Analytics',
    domain: 'northwind.example',
  },
  targeting: { titles: ['VP Sales', 'Head of Revenue'], seniorities: ['VP'] },
  maxContacts: 5,
};
const contact = (overrides: Record<string, unknown> = {}) => ({
  firstName: 'Ada',
  lastName: 'Lovelace',
  title: 'VP Sales',
  seniority: null,
  linkedinUrl: null,
  email: { address: 'Ada.Lovelace@Northwind.example', provenance },
  provenance,
  ...overrides,
});
const check = (overrides: Partial<EmailCheck> = {}): EmailCheck => ({
  address: 'ada.lovelace@northwind.example',
  status: 'verified',
  reason: null,
  provider: 'FAKE',
  checkedAt: '2026-11-06T08:00:00Z',
  ...overrides,
});

describe('contact identity (task 08A)', () => {
  it('keys a person by email, else LinkedIn, else company and name', () => {
    expect(
      normalizeContactIdentity({
        firstName: '  José ',
        lastName: "O'Brien-Núñez",
        email: 'Jose.OBrien@Northwind.example',
        organizationDomain: 'www.Northwind.example',
      }),
    ).toEqual({
      firstName: 'José',
      lastName: "O'Brien-Núñez",
      nameKey: 'jose o brien nunez',
      email: 'jose.obrien@northwind.example',
      linkedinUrl: null,
      organizationDomain: 'northwind.example',
      key: 'email:jose.obrien@northwind.example',
    });
    expect(
      normalizeContactIdentity({
        firstName: 'Ada',
        lastName: 'Lovelace',
        linkedinUrl: 'http://linkedin.com/in/Ada-Lovelace/',
      }).key,
    ).toBe('linkedin:ada-lovelace');
    expect(
      normalizeContactIdentity({
        firstName: 'Ada',
        lastName: 'Lovelace',
        organizationDomain: 'northwind.example',
      }).key,
    ).toBe('name:northwind.example:ada lovelace');
    expect(
      normalizeLinkedinUrl('https://de.linkedin.com/in/ada-lovelace'),
    ).toBe('https://www.linkedin.com/in/ada-lovelace');
  });

  it('refuses what is malformed or unidentifiable', () => {
    for (const input of [
      { firstName: ' ', lastName: 'X', organizationDomain: 'a.example' },
      { firstName: 'A', lastName: 'B', email: 'not-an-email' },
      {
        firstName: 'A',
        lastName: 'B',
        linkedinUrl: 'https://evil.example/in/ada',
      },
      { firstName: 'A', lastName: 'B', linkedinUrl: 'javascript:alert(1)' },
      {
        firstName: 'A',
        lastName: 'B',
        linkedinUrl: 'https://www.linkedin.com/company/x',
      },
      { firstName: 'A', lastName: 'B' },
    ]) {
      expect(() => normalizeContactIdentity(input)).toThrow(
        IdentityNormalizationError,
      );
    }
  });
});

describe('role relevance (task 08A)', () => {
  it('reads titles and seniority', () => {
    expect(normalizeTitle('Sr. VP, Sales & Marketing')).toBe(
      'senior vice president sales and marketing',
    );
    expect(inferSeniority('VP of Sales')).toBe('vp');
    expect(inferSeniority('Chief Revenue Officer')).toBe('c_suite');
    expect(inferSeniority('Co-Founder')).toBe('founder');
    expect(inferSeniority('Head of Growth')).toBe('head');
    expect(inferSeniority('Sales Development Representative')).toBe('entry');
    expect(inferSeniority('Account Executive')).toBeNull();
    expect(parseSeniority('Directors')).toBe('director');
    expect(parseSeniority('C-level')).toBe('c_suite');
    expect(parseSeniority('vp')).toBe('vp');
  });

  it('ranks the same title above similar ones, and the right seniority higher', () => {
    const targeting = { titles: ['VP Sales'], seniorities: ['VP'] };
    const exact = rankRoleRelevance({ title: 'VP Sales' }, targeting);
    const words = rankRoleRelevance({ title: 'VP of Sales, EMEA' }, targeting);
    const partial = rankRoleRelevance({ title: 'Sales Manager' }, targeting);
    const other = rankRoleRelevance({ title: 'Software Engineer' }, targeting);
    expect(exact).toMatchObject({
      score: 100,
      matchedTitle: 'VP Sales',
      seniority: 'vp',
      seniorityMatches: true,
    });
    expect(words.score).toBe(85);
    expect(partial.score).toBeGreaterThan(other.score);
    expect(partial.score).toBeLessThan(words.score);
    expect(other.score).toBe(0);
    // Next to a target level counts half.
    expect(
      rankRoleRelevance(
        { title: 'Head of Sales' },
        { titles: [], seniorities: ['VP'] },
      ).score,
    ).toBe(15);
    // No targets: seniority alone, more senior first.
    const ceo = rankRoleRelevance(
      { title: 'CEO' },
      { titles: [], seniorities: [] },
    );
    const rep = rankRoleRelevance(
      { title: 'Sales Representative' },
      { titles: [], seniorities: [] },
    );
    expect(ceo.score).toBeGreaterThan(rep.score);
  });
});

describe('ContactEnrichmentAgent output (task 08A)', () => {
  it('accepts attributed, well-formed contacts and ranks them', () => {
    const result = parseContactEnrichmentOutput(
      {
        contacts: [
          contact({
            firstName: 'Grace',
            lastName: 'Hopper',
            title: 'Sales Manager',
            email: null,
            linkedinUrl: 'https://www.linkedin.com/in/grace-hopper',
          }),
          contact(),
        ],
      },
      INPUT,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.rejected).toEqual([]);
    expect(result.contacts.map((c) => c.identity.key)).toEqual([
      'email:ada.lovelace@northwind.example',
      'linkedin:grace-hopper',
    ]);
    expect(result.contacts[0]).toMatchObject({
      title: 'VP Sales',
      seniority: 'vp',
      relevance: { score: 100 },
      email: {
        address: 'ada.lovelace@northwind.example',
        domain: 'northwind.example',
        provenance,
      },
      provenance,
      warnings: [],
    });
  });

  it('rejects malformed or unattributed contacts, each with its reason', () => {
    const unattributed = Object.fromEntries(
      Object.entries(contact()).filter(([key]) => key !== 'provenance'),
    );
    const result = parseContactEnrichmentOutput(
      {
        contacts: [
          unattributed,
          contact({ provenance: { ...provenance, attribution: '' } }),
          contact({ email: { address: 'ada@northwind.example' } }),
          contact({ email: { address: 'not an email', provenance } }),
          contact({ firstName: '' }),
          contact({ linkedinUrl: 'https://evil.example/in/ada', email: null }),
          contact({ seniority: 'overlord' }),
          contact({
            email: null,
            linkedinUrl: null,
            firstName: 'No',
            lastName: 'Way',
          }),
          contact(),
          contact(),
        ].slice(0, 10),
      },
      { ...INPUT, maxContacts: 10 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.rejected.map((r) => r.index)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 9,
    ]);
    expect(result.rejected[0]?.issues[0]?.path).toBe('contacts.0.provenance');
    expect(result.rejected[2]?.issues[0]?.path).toBe(
      'contacts.2.email.provenance',
    );
    expect(result.rejected[3]?.issues).toEqual([
      {
        path: 'contacts.3.email.address',
        message: 'This is not an email address.',
      },
    ]);
    expect(result.rejected[7]?.issues).toEqual([
      { path: 'contacts.9', message: 'The same person appears twice.' },
    ]);
    // Without email or profile, the company's domain still identifies the person.
    expect(result.contacts.map((c) => c.identity.key)).toEqual([
      'email:ada.lovelace@northwind.example',
      'name:northwind.example:no way',
    ]);
  });

  it('never lets an answer claim that an address is verified or send-eligible', () => {
    for (const claim of [
      {
        email: {
          address: 'ada@northwind.example',
          provenance,
          status: 'verified',
        },
      },
      {
        email: { address: 'ada@northwind.example', provenance, verified: true },
      },
      { sendEligible: true },
      { verification: check() },
    ]) {
      expect(enrichedContactSchema.safeParse(contact(claim)).success).toBe(
        false,
      );
    }
    const result = parseContactEnrichmentOutput(
      {
        contacts: [
          contact({
            email: {
              address: 'ada@northwind.example',
              provenance,
              status: 'verified',
            },
          }),
        ],
      },
      INPUT,
    );
    expect(result.ok && result.contacts).toEqual([]);
  });

  it('drops an address at another domain, and refuses an answer that is too long or not an answer', () => {
    const result = parseContactEnrichmentOutput(
      {
        contacts: [
          contact({ email: { address: 'ada@gmail.example', provenance } }),
        ],
      },
      INPUT,
    );
    expect(result.ok && result.contacts[0]?.email).toBeNull();
    expect(result.ok && result.contacts[0]?.warnings).toEqual([
      "The address at gmail.example was dropped: it isn't at northwind.example.",
    ]);
    // A subdomain is the company's.
    const sub = parseContactEnrichmentOutput(
      {
        contacts: [
          contact({
            email: { address: 'ada@eu.northwind.example', provenance },
          }),
        ],
      },
      INPUT,
    );
    expect(sub.ok && sub.contacts[0]?.email?.domain).toBe(
      'eu.northwind.example',
    );
    expect(
      parseContactEnrichmentOutput(
        { contacts: Array.from({ length: 6 }, () => contact()) },
        INPUT,
      ),
    ).toEqual({
      ok: false,
      issues: [
        {
          path: 'contacts',
          message: 'The answer has more contacts than the 5 asked for.',
        },
      ],
    });
    for (const raw of [
      null,
      'contacts',
      { people: [] },
      { contacts: [], extra: 1 },
    ]) {
      expect(parseContactEnrichmentOutput(raw, INPUT).ok).toBe(false);
    }
  });
});

describe('email checks and send eligibility (task 08A)', () => {
  const address = 'Ada.Lovelace@northwind.example';

  it('is automatic only for a fresh verified check of the same address', () => {
    expect(emailSendEligibility(address, check(), NOW)).toEqual({
      automatic: true,
      state: 'eligible',
      reason: 'The address was verified recently.',
    });
    expect(
      emailSendEligibility(address, check({ status: 'invalid' }), NOW),
    ).toMatchObject({
      automatic: false,
      state: 'blocked',
    });
    const old = new Date(
      NOW.getTime() - (VERIFICATION_MAX_AGE_DAYS + 1) * 86_400_000,
    ).toISOString();
    expect(
      emailSendEligibility(address, check({ checkedAt: old }), NOW),
    ).toMatchObject({
      automatic: false,
      state: 'stale',
    });
  });

  it('never makes risky or unknown addresses automatically eligible', () => {
    for (const status of ['risky', 'unknown'] as const) {
      for (const checkedAt of [
        '2026-11-06T08:59:59Z',
        '2026-10-30T00:00:00Z',
      ]) {
        expect(
          emailSendEligibility(address, check({ status, checkedAt }), NOW),
        ).toMatchObject({ automatic: false, state: 'needs_review' });
      }
    }
  });

  it('treats anything but a real check as unverified, however email-shaped', () => {
    for (const notACheck of [
      undefined,
      null,
      'verified',
      address,
      { address, status: 'verified' },
      { ...check(), provider: 'SOMEONE' },
      { ...check(), checkedAt: 'yesterday' },
      { ...check(), extra: true },
      check({ address: 'someone.else@northwind.example' }),
      check({ checkedAt: '2026-11-07T00:00:00Z' }),
    ]) {
      expect(emailSendEligibility(address, notACheck, NOW)).toMatchObject({
        automatic: false,
        state: 'unverified',
      });
    }
    expect(
      emailCheckSchema.safeParse({ ...check(), status: 'valid' }).success,
    ).toBe(false);
  });
});
