import { describe, expect, it } from 'vitest';
import {
  ENRICHMENT_LIMITS,
  contactQuality,
  contactQualitySchema,
  enrichmentRequestSchema,
  summarizeQuality,
  type ContactQualityFacts,
} from './enrichment-runs.js';

const NOW = new Date('2026-11-08T12:00:00Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);

const SOURCE = {
  provider: 'FAKE',
  attribution: 'Synthetic people.',
  retrievedAt: daysAgo(1),
  confidence: 85,
  providerClaim: 'provider_verified',
} as const;
const CHECK = {
  address: 'ada.lovelace@acme.example',
  status: 'verified',
  reason: null,
  provider: 'FAKE',
  checkedAt: daysAgo(1),
} as const;

const facts = (
  overrides: Partial<ContactQualityFacts> = {},
): ContactQualityFacts => ({
  email: 'ada.lovelace@acme.example',
  source: {
    provider: 'FAKE',
    attribution: 'Synthetic people.',
    retrievedAt: daysAgo(1),
    confidence: 85,
    providerClaim: 'provider_verified',
  },
  check: {
    address: 'ada.lovelace@acme.example',
    status: 'verified',
    reason: null,
    provider: 'FAKE',
    checkedAt: daysAgo(1),
  },
  recheck: { pending: false, lastRequestedAt: null, lastErrorCode: null },
  ...overrides,
});

describe('contactQuality (task 08C)', () => {
  it('is good only with a fresh verified check of the address from a fresh source', () => {
    const quality = contactQuality(facts(), NOW);
    expect(contactQualitySchema.parse(quality)).toEqual(quality);
    expect(quality).toMatchObject({
      level: 'good',
      confidence: 85,
      source: { provider: 'FAKE', fresh: true },
      email: { state: 'eligible', providerClaim: 'provider_verified' },
      recheck: { pending: false, availableAt: null, lastErrorCode: null },
    });
    expect(summarizeQuality(quality)).toEqual({
      level: 'good',
      emailState: 'eligible',
    });
  });

  it("never treats a provider's claim as a check", () => {
    const quality = contactQuality(facts({ check: null }), NOW);
    expect(quality.level).toBe('review');
    expect(quality.email).toMatchObject({
      state: 'unverified',
      providerClaim: 'provider_verified',
      check: null,
    });
  });

  it('needs review for risky, unknown and old checks, and for an old source', () => {
    for (const status of ['risky', 'unknown'] as const) {
      const check = { ...CHECK, status, reason: 'catch_all' };
      expect(contactQuality(facts({ check }), NOW).level).toBe('review');
    }
    const old = { ...CHECK, checkedAt: daysAgo(31) };
    expect(contactQuality(facts({ check: old }), NOW).email?.state).toBe(
      'stale',
    );
    const stale = contactQuality(
      facts({ source: { ...SOURCE, retrievedAt: daysAgo(31) } }),
      NOW,
    );
    expect(stale.level).toBe('review');
    expect(stale.source?.fresh).toBe(false);
    expect(stale.reasons.at(-1)).toMatch(/more than 30 days ago/);
  });

  it("can't be used without an address, or with one that doesn't accept email", () => {
    const none = contactQuality(facts({ email: null, check: null }), NOW);
    expect(none).toMatchObject({ level: 'unusable', email: null });
    expect(none.reasons).toContain('No email address.');
    expect(none.recheck.availableAt).toBeNull();
    const invalid = { ...CHECK, status: 'invalid' as const };
    expect(contactQuality(facts({ check: invalid }), NOW)).toMatchObject({
      level: 'unusable',
      email: { state: 'blocked' },
    });
  });

  it('ignores a check of another address', () => {
    const other = { ...CHECK, address: 'grace@acme.example' };
    expect(contactQuality(facts({ check: other }), NOW).email?.state).toBe(
      'unverified',
    );
  });

  it('says when the next recheck may be asked for', () => {
    const recent = contactQuality(
      facts({
        recheck: {
          pending: false,
          lastRequestedAt: new Date(NOW.getTime() - 3_600_000),
          lastErrorCode: 'verification_unavailable',
        },
      }),
      NOW,
    );
    expect(recent.recheck).toEqual({
      pending: false,
      availableAt: new Date(
        NOW.getTime() +
          (ENRICHMENT_LIMITS.recheckCooldownHours - 1) * 3_600_000,
      ).toISOString(),
      lastErrorCode: 'verification_unavailable',
    });
    const dayOld = contactQuality(
      facts({
        recheck: {
          pending: false,
          lastRequestedAt: daysAgo(1),
          lastErrorCode: null,
        },
      }),
      NOW,
    );
    expect(dayOld.recheck.availableAt).toBeNull();
  });
});

describe('enrichmentRequestSchema', () => {
  it('bounds the people a company and refuses unknown fields', () => {
    expect(enrichmentRequestSchema.parse({})).toEqual({});
    expect(
      enrichmentRequestSchema.safeParse({ maxContactsPerCompany: 6 }).success,
    ).toBe(false);
    expect(
      enrichmentRequestSchema.safeParse({ maxContactsPerCompany: 0 }).success,
    ).toBe(false);
    expect(enrichmentRequestSchema.safeParse({ titles: ['CEO'] }).success).toBe(
      false,
    );
    expect(
      enrichmentRequestSchema.safeParse({ campaignId: 'not-a-uuid' }).success,
    ).toBe(false);
  });
});
