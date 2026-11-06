import { describe, expect, it } from 'vitest';
import {
  checkContactEmails,
  ContactEnrichmentAgent,
} from './contact-enrichment.js';
import {
  FAKE_PEOPLE_PER_COMPANY,
  FakeContactEnrichmentProvider,
  FakeEmailVerificationProvider,
  FakePeopleSearchProvider,
  fakeStaff,
} from './fake-contacts.js';
import { fakeOrganizationDirectory } from './fake-organization-search.js';
import { createFakeProviders } from './fakes.js';
import { ProviderError, type PeopleSearchProvider } from './providers.js';

// People search, enrichment and verification fakes and the ContactEnrichmentAgent (tasks 08A
// and 08B, docs/decisions.md D-08A-*, D-08B-*). Everything is synthetic and deterministic.
const NOW = new Date('2026-11-06T09:00:00Z');
const ORG = {
  id: '0190f5c2-7d1e-7c3a-9c1e-4f6a8b2d3e10',
  name: 'Northwind Analytics',
  domain: 'northwind-analytics.example',
};
const TARGETING = {
  titles: ['VP Sales', 'Head of Revenue'],
  seniorities: ['VP'],
};
const ALL = { titles: [], seniorities: [] };
const domains = fakeOrganizationDirectory()
  .flatMap((o) => (o.domain?.endsWith('.example') === true ? [o.domain] : []))
  .slice(0, 40);

const agentWith = (
  people = new FakePeopleSearchProvider({ now: () => NOW }),
  enrichment = new FakeContactEnrichmentProvider({ now: () => NOW }),
) => ({
  people,
  enrichment,
  agent: new ContactEnrichmentAgent(people, enrichment),
});

describe('contact fakes (tasks 08A, 08B)', () => {
  it('give the same synthetic staff every time, without addresses or profiles', async () => {
    const staff = fakeStaff({ name: ORG.name, domain: ORG.domain });
    expect(staff).toHaveLength(FAKE_PEOPLE_PER_COMPANY);
    expect(fakeStaff({ name: ORG.name, domain: ORG.domain })).toEqual(staff);
    for (const person of staff) {
      expect(person.raw['synthetic']).toBe(true);
      expect(person.linkedinUrl).toBeNull();
      expect(Object.keys(person)).not.toContain('email');
    }
    const people = new FakePeopleSearchProvider({ now: () => NOW });
    const first = await people.searchPeople({
      organization: { name: ORG.name, domain: ORG.domain },
      titles: [],
      seniorities: [],
      pageSize: 5,
      pageToken: null,
    });
    expect(first.people).toHaveLength(5);
    expect(first.nextPageToken).toBe('p:5');
    expect(first).toMatchObject({ retrievedAt: NOW, creditsUsed: 0 });
    const rest = await people.searchPeople({
      organization: { name: ORG.name, domain: ORG.domain },
      titles: [],
      seniorities: [],
      pageSize: 5,
      pageToken: first.nextPageToken,
    });
    expect([...first.people, ...rest.people]).toEqual(staff);
    expect(rest.nextPageToken).toBeNull();
    expect(createFakeProviders().peopleSearch).toBeInstanceOf(
      FakePeopleSearchProvider,
    );
  });

  it('find work addresses on the company domain only, in batches, with a claim that is not a check', async () => {
    const enrichment = new FakeContactEnrichmentProvider({ now: () => NOW });
    const results = [];
    let credits = 0;
    for (const domain of domains.slice(0, 10)) {
      const staff = fakeStaff({ name: domain, domain });
      const batch = await enrichment.enrichContacts(
        staff.map((person) => ({
          externalId: person.externalId,
          firstName: person.firstName,
          lastName: person.lastName,
          organizationName: domain,
          organizationDomain: domain,
        })),
      );
      expect(batch.retrievedAt).toEqual(NOW);
      credits += batch.creditsUsed ?? 0;
      results.push(...batch.results);
    }
    expect(credits).toBe(results.filter((r) => r !== null).length);
    const found = results.filter((r) => r?.email != null);
    expect(found.length).toBeGreaterThan(0);
    expect(found.length).toBeLessThan(results.length);
    for (const result of found) {
      expect(result?.email).toMatch(
        /^[a-z0-9]+\.[a-z0-9]+@[a-z0-9.-]+\.example$/,
      );
    }
    expect(new Set(found.map((r) => r?.providerClaim))).toEqual(
      new Set(['provider_verified', 'provider_unverified']),
    );
    // More than a batch is refused; someone without an id or a last name can't be matched.
    await expect(
      enrichment.enrichContacts(
        Array.from({ length: 11 }, () => ({
          externalId: null,
          firstName: 'A',
          lastName: 'B',
          organizationName: null,
          organizationDomain: ORG.domain,
        })),
      ),
    ).rejects.toThrow(ProviderError);
    const lonely = await enrichment.enrichContacts([
      {
        externalId: null,
        firstName: 'Ada',
        lastName: null,
        organizationName: null,
        organizationDomain: ORG.domain,
      },
    ]);
    expect(lonely.results).toEqual([null]);
  });

  it('check addresses as verified, risky, unknown or invalid, the same every time', async () => {
    const verifier = new FakeEmailVerificationProvider({
      now: () => NOW,
      overrides: { 'Override@Example.example': 'risky' },
    });
    const addresses = domains.flatMap((domain) =>
      fakeStaff({ name: domain, domain }).map(
        (p) =>
          `${p.firstName.toLowerCase()}.${(p.lastName ?? '').toLowerCase()}@${domain}`,
      ),
    );
    const statuses = [];
    for (const address of addresses) {
      const result = await verifier.verify(address);
      expect(result.checkedAt).toEqual(NOW);
      statuses.push(result.status);
    }
    expect(new Set(statuses)).toEqual(
      new Set(['verified', 'risky', 'unknown', 'invalid']),
    );
    const again = new FakeEmailVerificationProvider({ now: () => NOW });
    const repeat = [];
    for (const address of addresses) {
      repeat.push((await again.verify(address)).status);
    }
    expect(repeat).toEqual(statuses);
    expect(await verifier.verify('not an email')).toMatchObject({
      status: 'invalid',
      reason: 'syntax',
    });
    expect(await verifier.verify('ada@nowhere.invalid')).toMatchObject({
      status: 'invalid',
      reason: 'no_domain',
    });
    expect(
      await verifier.verify('catchall.test@northwind.example'),
    ).toMatchObject({ status: 'risky', reason: 'catch_all' });
    expect(await verifier.verify(' override@example.example ')).toMatchObject({
      address: 'override@example.example',
      status: 'risky',
      reason: 'override',
    });
  });
});

describe('ContactEnrichmentAgent (tasks 08A, 08B)', () => {
  it('finds the most relevant people, with provenance, addresses to check and costs', async () => {
    const { agent, enrichment, people } = agentWith();
    const { result, usage } = await agent.run({
      organization: ORG,
      targeting: TARGETING,
      maxContacts: 3,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.rejected).toEqual([]);
    expect(result.contacts.length).toBeGreaterThan(0);
    expect(result.contacts.length).toBeLessThanOrEqual(3);
    const scores = result.contacts.map((c) => c.relevance.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(scores.every((score) => score > 0)).toBe(true);
    for (const contact of result.contacts) {
      expect(contact.provenance).toMatchObject({
        provider: 'FAKE',
        retrievedAt: NOW.toISOString(),
      });
      expect(contact.provenance.externalId).toMatch(/^fake-person-/);
      if (contact.email !== null) {
        expect(contact.email.domain).toBe(ORG.domain);
        expect(contact.email.provenance.externalId).toBe(
          contact.provenance.externalId,
        );
        expect(contact.identity.key).toBe(`email:${contact.email.address}`);
      }
    }
    // One batch for the people chosen; costs as the providers report them.
    expect(enrichment.requests).toHaveLength(1);
    expect(enrichment.requests[0]?.length).toBe(result.contacts.length);
    expect(people.requests[0]?.seniorities).toEqual(['vp']);
    expect(usage).toMatchObject({
      searchRequests: 1,
      searchCredits: 0,
      enrichmentRequests: 1,
      enrichmentCredits: result.contacts.length,
      repeatedProviderIds: 0,
      unmatched: 0,
    });
    // Same input, same answer.
    expect(
      await agentWith().agent.run({
        organization: ORG,
        targeting: TARGETING,
        maxContacts: 3,
      }),
    ).toEqual({ result, usage });
  });

  it('completes partial search records through enrichment, and keeps a repeated provider id once', async () => {
    const people = new FakePeopleSearchProvider({
      now: () => NOW,
      partial: true,
      repeatIds: true,
    });
    const { agent } = agentWith(people);
    const { result, usage } = await agent.run({
      organization: ORG,
      targeting: ALL,
      maxContacts: FAKE_PEOPLE_PER_COMPANY,
    });
    expect(usage.repeatedProviderIds).toBe(1);
    expect(result.ok && result.rejected).toEqual([]);
    const staff = fakeStaff({ name: ORG.name, domain: ORG.domain });
    for (const contact of result.ok ? result.contacts : []) {
      const person = staff.find(
        (p) => p.externalId === contact.provenance.externalId,
      );
      expect(contact.identity.lastName).toBe(person?.lastName);
    }
    expect(
      new Set(
        result.ok ? result.contacts.map((c) => c.provenance.externalId) : [],
      ).size,
    ).toBe(result.ok ? result.contacts.length : -1);
  });

  it('refuses records left partial, and reports missing and guessed addresses', async () => {
    // A partial search record the enrichment provider can't match stays partial: refused.
    const noMatch = new ContactEnrichmentAgent(
      new FakePeopleSearchProvider({ now: () => NOW, partial: true }),
      {
        source: 'FAKE',
        attribution: 'Synthetic.',
        maxBatchSize: 10,
        enrichContacts: (requests) =>
          Promise.resolve({
            results: requests.map(() => null),
            retrievedAt: NOW,
            creditsUsed: 0,
          }),
      },
    );
    const unmatched = await noMatch.run({
      organization: ORG,
      targeting: ALL,
      maxContacts: 3,
    });
    expect(unmatched.usage).toMatchObject({
      unmatched: 3,
      enrichmentCredits: 0,
    });
    expect(unmatched.result.ok && unmatched.result.contacts).toEqual([]);
    expect(
      unmatched.result.ok &&
        unmatched.result.rejected.map((r) => r.issues[0]?.path),
    ).toEqual([
      'contacts.0.lastName',
      'contacts.1.lastName',
      'contacts.2.lastName',
    ]);

    // Without a company domain nobody is looked up (or paid for).
    const noDomain = agentWith();
    await noDomain.agent.run({
      organization: { ...ORG, domain: null },
      targeting: ALL,
      maxContacts: 3,
    });
    expect(noDomain.enrichment.requests).toEqual([]);

    // A guessed address is dropped, never used; people without one are skipped unpaid.
    const staff = fakeStaff({ name: ORG.name, domain: ORG.domain });
    const withEmail = staff.filter((p) => p.hasEmail === true);
    const guessedId = withEmail[0]?.externalId ?? '';
    const guessing = agentWith(
      undefined,
      new FakeContactEnrichmentProvider({
        now: () => NOW,
        guessedFor: [guessedId],
      }),
    );
    const { result, usage } = await guessing.agent.run({
      organization: ORG,
      targeting: ALL,
      maxContacts: FAKE_PEOPLE_PER_COMPANY,
    });
    expect(usage.skippedWithoutEmail).toBe(staff.length - withEmail.length);
    expect(usage.droppedEmails).toBe(1);
    const guessed = result.ok
      ? result.contacts.find((c) => c.provenance.externalId === guessedId)
      : undefined;
    expect(guessed?.email).toBeNull();
    // Every enriched person was looked up once, never one without an address.
    expect(
      guessing.enrichment.requests
        .flat()
        .map((r) => r.externalId)
        .sort(),
    ).toEqual(withEmail.map((p) => p.externalId).sort());
  });

  it('refuses unattributed records, and passes provider failures on', async () => {
    const fake = new FakePeopleSearchProvider({ now: () => NOW });
    const anonymous: PeopleSearchProvider = {
      source: 'FAKE',
      attribution: '',
      maxPageSize: fake.maxPageSize,
      searchPeople: (request) => fake.searchPeople(request),
    };
    const refused = await new ContactEnrichmentAgent(
      anonymous,
      new FakeContactEnrichmentProvider({ now: () => NOW }),
    ).run({ organization: ORG, targeting: TARGETING, maxContacts: 2 });
    expect(refused.result.ok && refused.result.contacts).toEqual([]);
    expect(
      refused.result.ok && refused.result.rejected[0]?.issues[0]?.path,
    ).toBe('contacts.0.provenance.attribution');

    const exhausted = agentWith(
      undefined,
      new FakeContactEnrichmentProvider({ failures: { 1: 'quota_exceeded' } }),
    );
    await expect(
      exhausted.agent.run({
        organization: ORG,
        targeting: ALL,
        maxContacts: 3,
      }),
    ).rejects.toMatchObject({ code: 'quota_exceeded', retryable: false });
  });

  it('makes only verified addresses automatically eligible, and records failed checks', async () => {
    const { agent } = agentWith();
    const { result } = await agent.run({
      organization: ORG,
      targeting: ALL,
      maxContacts: FAKE_PEOPLE_PER_COMPANY,
    });
    if (!result.ok) {
      throw new Error('expected an answer');
    }
    const checked = await checkContactEmails(
      new FakeEmailVerificationProvider({ now: () => NOW }),
      result.contacts,
      NOW,
    );
    for (const { contact, check, eligibility, failure } of checked) {
      expect(failure).toBeNull();
      if (check === null) {
        expect(contact.email).toBeNull();
        expect(eligibility).toMatchObject({
          automatic: false,
          state: 'unverified',
        });
        continue;
      }
      expect(check).toMatchObject({
        provider: 'FAKE',
        checkedAt: NOW.toISOString(),
      });
      expect(eligibility.automatic).toBe(check.status === 'verified');
      if (check.status === 'risky' || check.status === 'unknown') {
        expect(eligibility.state).toBe('needs_review');
      }
      if (check.status === 'invalid') {
        expect(eligibility.state).toBe('blocked');
      }
    }
    // Every address risky: none automatic, though the enrichment claimed some verified.
    const allRisky = await checkContactEmails(
      {
        source: 'FAKE',
        verify: (address) =>
          Promise.resolve({
            address,
            status: 'risky',
            reason: 'catch_all',
            checkedAt: NOW,
          }),
      },
      result.contacts,
      NOW,
    );
    expect(allRisky.some((c) => c.eligibility.automatic)).toBe(false);

    // Verification failures: retryable or permanent, and never a status.
    const addresses = result.contacts.flatMap((c) =>
      c.email === null ? [] : [c.email.address],
    );
    const [slow, refused] = addresses;
    const failing = await checkContactEmails(
      new FakeEmailVerificationProvider({
        now: () => NOW,
        failures: {
          [slow ?? '']: 'timeout',
          [refused ?? '']: 'unauthorized',
        },
      }),
      result.contacts,
      NOW,
    );
    const failureOf = (address: string | undefined) =>
      failing.find((c) => c.contact.email?.address === address);
    expect(failureOf(slow)).toMatchObject({
      check: null,
      failure: { code: 'timeout', retryable: true },
      eligibility: { automatic: false, state: 'unverified' },
    });
    expect(failureOf(refused)).toMatchObject({
      check: null,
      failure: { code: 'unauthorized', retryable: false },
      eligibility: { automatic: false, state: 'unverified' },
    });
  });
});
