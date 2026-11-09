// Deterministic fakes for finding people, their work addresses and checking addresses (tasks
// 08A and 08B, docs/decisions.md D-08A-05, D-08B-*). Synthetic only: invented names on the
// company's own domain (the fake companies use .example domains), no profile URLs, and
// `raw.synthetic` on every record. The same input always gives the same answer, with no clock
// or randomness in the data; the time comes from the injected clock.
import {
  normalizeEmail,
  type EmailVerificationStatus,
  type SeniorityLevel,
} from '@lead-fennec-ai/shared';
import {
  ProviderError,
  type ContactEnrichmentBatch,
  type ContactEnrichmentProvider,
  type ContactEnrichmentRequest,
  type EmailCheckResult,
  type EmailVerificationProvider,
  type EnrichedPerson,
  type PeopleSearchPage,
  type PeopleSearchProvider,
  type PeopleSearchRequest,
  type ProviderErrorCode,
  type ProviderPerson,
} from './providers.js';

/** FNV-1a, 32 bits: a stable hash for picking fake data. */
function hash(text: string): number {
  let value = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

const FIRST_NAMES = [
  'Ada',
  'Grace',
  'Alan',
  'Katherine',
  'Linus',
  'Margaret',
  'Dennis',
  'Barbara',
  'Ken',
  'Frances',
  'Edsger',
  'Radia',
  'Donald',
  'Hedy',
  'Tim',
  'Sophie',
  'Niklaus',
  'Jean',
  'John',
  'Annie',
] as const;

const LAST_NAMES = [
  'Lovelace',
  'Hopper',
  'Turing',
  'Johnson',
  'Torvalds',
  'Hamilton',
  'Ritchie',
  'Liskov',
  'Thompson',
  'Allen',
  'Dijkstra',
  'Perlman',
  'Knuth',
  'Lamarr',
  'Berners',
  'Wilson',
  'Wirth',
  'Bartik',
  'Backus',
  'Easley',
] as const;

const ROLES: readonly (readonly [string, SeniorityLevel])[] = [
  ['Chief Executive Officer', 'c_suite'],
  ['VP Sales', 'vp'],
  ['Head of Revenue', 'head'],
  ['Director of Marketing', 'director'],
  ['Sales Manager', 'manager'],
  ['Senior Account Executive', 'senior'],
  ['Sales Development Representative', 'entry'],
  ['Chief Technology Officer', 'c_suite'],
  ['VP Engineering', 'vp'],
  ['Head of Growth', 'head'],
  ['Operations Manager', 'manager'],
  ['Founder', 'founder'],
];

export const FAKE_PEOPLE_PER_COMPANY = 8;

export const FAKE_PEOPLE_ATTRIBUTION =
  'Synthetic people from the Lead Fennec test directory, not real people.';
const ATTRIBUTION = FAKE_PEOPLE_ATTRIBUTION;

const pick = <T>(list: readonly T[], index: number): T => {
  // Hash arithmetic can go negative: wrap into the list.
  const value = list[((index % list.length) + list.length) % list.length];
  if (value === undefined) {
    throw new Error('empty list');
  }
  return value;
};

const asciiLocal = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

/** The fake's address for a person: one in six has none. */
function fakeAddress(
  firstName: string,
  lastName: string,
  domain: string,
): { address: string | null; seed: number } {
  const local = `${asciiLocal(firstName)}.${asciiLocal(lastName)}`;
  const seed = hash(`${local}@${domain}`);
  return { address: seed % 6 === 0 ? null : `${local}@${domain}`, seed };
}

/** The fixed staff of a fake company: 8 synthetic people, the same for the same domain. */
export function fakeStaff(
  organization: PeopleSearchRequest['organization'],
): ProviderPerson[] {
  const seed = hash(organization.domain ?? organization.name.toLowerCase());
  return Array.from({ length: FAKE_PEOPLE_PER_COMPANY }, (_, i) => {
    const [title, seniority] = pick(ROLES, seed + i);
    const firstName = pick(FIRST_NAMES, seed + i * 7);
    const lastName = pick(LAST_NAMES, Math.imul(seed, 3) + i * 11);
    return {
      externalId: `fake-person-${(seed % 100_000).toString(36)}-${String(i + 1)}`,
      firstName,
      lastName,
      title,
      seniority,
      linkedinUrl: null,
      organizationDomain: organization.domain,
      hasEmail:
        organization.domain === null
          ? false
          : fakeAddress(firstName, lastName, organization.domain).address !==
            null,
      raw: { synthetic: true, title, seniority },
    };
  });
}

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 2);

export interface FakePeopleSearchOptions {
  readonly now?: () => Date;
  /** Withhold last names, as a provider's search may (D-08B-02). */
  readonly partial?: boolean;
  /** Repeat the first person at the end of every page (a provider's duplicates). */
  readonly repeatIds?: boolean;
}

/** Finds people at a fake company: a title word in common, or a seniority asked for. */
export class FakePeopleSearchProvider implements PeopleSearchProvider {
  readonly source = 'FAKE' as const;
  readonly attribution = ATTRIBUTION;
  readonly maxPageSize = 25;
  readonly requests: PeopleSearchRequest[] = [];
  readonly #now: () => Date;
  readonly #partial: boolean;
  readonly #repeatIds: boolean;

  constructor(options: FakePeopleSearchOptions = {}) {
    this.#now = options.now ?? (() => new Date());
    this.#partial = options.partial ?? false;
    this.#repeatIds = options.repeatIds ?? false;
  }

  searchPeople(request: PeopleSearchRequest): Promise<PeopleSearchPage> {
    this.requests.push(request);
    if (request.pageSize < 1 || request.pageSize > this.maxPageSize) {
      return Promise.reject(new ProviderError('invalid_request'));
    }
    const offset =
      request.pageToken === null
        ? 0
        : Number(/^p:(\d{1,4})$/.exec(request.pageToken)?.[1] ?? NaN);
    if (!Number.isInteger(offset)) {
      return Promise.reject(new ProviderError('invalid_request'));
    }
    const wanted = new Set(request.titles.flatMap(words));
    const levels = new Set(request.seniorities);
    const matches = fakeStaff(request.organization).filter(
      (person) =>
        (wanted.size === 0 && levels.size === 0) ||
        words(person.title ?? '').some((word) => wanted.has(word)) ||
        (person.seniority !== null && levels.has(person.seniority)),
    );
    const slice = matches.slice(offset, offset + request.pageSize);
    const next = offset + slice.length;
    const shown = slice.map((person) =>
      this.#partial ? { ...person, lastName: null } : person,
    );
    const first = shown[0];
    return Promise.resolve({
      people:
        this.#repeatIds && first !== undefined ? [...shown, first] : shown,
      nextPageToken: next < matches.length ? `p:${String(next)}` : null,
      retrievedAt: this.#now(),
      creditsUsed: 0,
    });
  }
}

export interface FakeContactEnrichmentOptions {
  readonly now?: () => Date;
  /** Calls (1-based) that fail with this code. */
  readonly failures?: Readonly<Record<number, ProviderErrorCode>>;
  /** Make the address of these people (by external id) a guess, which must be dropped. */
  readonly guessedFor?: readonly string[];
}

/**
 * Finds what it knows about fake people, in batches of 10: their full names and roles, and
 * first.last@ the company's domain for five in six of them. A person without an external id
 * and without a last name can't be matched (null). Its claim about an address alternates; it
 * is never a check. One credit per person matched.
 */
export class FakeContactEnrichmentProvider implements ContactEnrichmentProvider {
  readonly source = 'FAKE' as const;
  readonly attribution = ATTRIBUTION;
  readonly maxBatchSize = 10;
  readonly requests: (readonly ContactEnrichmentRequest[])[] = [];
  readonly #now: () => Date;
  readonly #failures: Readonly<Record<number, ProviderErrorCode>>;
  readonly #guessed: ReadonlySet<string>;

  constructor(options: FakeContactEnrichmentOptions = {}) {
    this.#now = options.now ?? (() => new Date());
    this.#failures = options.failures ?? {};
    this.#guessed = new Set(options.guessedFor ?? []);
  }

  enrichContacts(
    requests: readonly ContactEnrichmentRequest[],
  ): Promise<ContactEnrichmentBatch> {
    this.requests.push(requests);
    const failure = this.#failures[this.requests.length];
    if (failure !== undefined) {
      return Promise.reject(new ProviderError(failure));
    }
    if (requests.length > this.maxBatchSize) {
      return Promise.reject(new ProviderError('invalid_request'));
    }
    const results = requests.map((request): EnrichedPerson | null => {
      const person = fakeStaff({
        name: request.organizationName ?? request.organizationDomain,
        domain: request.organizationDomain,
      }).find((p) => p.externalId === request.externalId);
      const firstName = person?.firstName ?? request.firstName;
      const lastName = person?.lastName ?? request.lastName;
      if (lastName === null) {
        return null;
      }
      const { address, seed } = fakeAddress(
        firstName,
        lastName,
        request.organizationDomain,
      );
      const guessed =
        request.externalId !== null && this.#guessed.has(request.externalId);
      return {
        externalId: person?.externalId ?? request.externalId,
        firstName,
        lastName,
        title: person?.title ?? null,
        seniority: person?.seniority ?? null,
        linkedinUrl: null,
        organizationDomain: request.organizationDomain,
        email: guessed ? null : address,
        providerClaim:
          address === null || guessed
            ? null
            : seed % 3 === 0
              ? 'provider_verified'
              : 'provider_unverified',
        emailDropped: guessed && address !== null ? 'guessed' : null,
        raw: { synthetic: true },
      };
    });
    return Promise.resolve({
      results,
      retrievedAt: this.#now(),
      creditsUsed: results.filter((r) => r !== null).length,
    });
  }
}

/** The fake's answer for an address it has no rule for, by a stable hash. */
function bucketOf(address: string): {
  status: EmailVerificationStatus;
  reason: string | null;
} {
  const bucket = hash(address) % 10;
  if (bucket < 5) {
    return { status: 'verified', reason: null };
  }
  if (bucket < 7) {
    return { status: 'risky', reason: 'catch_all' };
  }
  if (bucket < 9) {
    return { status: 'unknown', reason: 'timeout' };
  }
  return { status: 'invalid', reason: 'no_mailbox' };
}

/**
 * Checks addresses deterministically. Rules first: bad syntax and the reserved `.invalid`
 * domain are invalid; `catchall` in the local part is risky; `overrides` set any address, and
 * `failures` make a check of an address fail (a ProviderError). Otherwise about half are
 * verified, a fifth risky, a fifth unknown and a tenth invalid, always the same for the same
 * address.
 */
export class FakeEmailVerificationProvider implements EmailVerificationProvider {
  readonly source = 'FAKE' as const;
  readonly checked: string[] = [];
  readonly #now: () => Date;
  readonly #overrides: ReadonlyMap<string, EmailVerificationStatus>;
  readonly #failures: ReadonlyMap<string, ProviderErrorCode>;

  constructor(
    options: {
      readonly now?: () => Date;
      readonly overrides?: Readonly<Record<string, EmailVerificationStatus>>;
      readonly failures?: Readonly<Record<string, ProviderErrorCode>>;
    } = {},
  ) {
    this.#now = options.now ?? (() => new Date());
    const lower = <T>(entries: Readonly<Record<string, T>>) =>
      new Map(
        Object.entries(entries).map(([address, value]) => [
          address.trim().toLowerCase(),
          value,
        ]),
      );
    this.#overrides = lower(options.overrides ?? {});
    this.#failures = lower(options.failures ?? {});
  }

  verify(address: string): Promise<EmailCheckResult> {
    this.checked.push(address);
    const failure = this.#failures.get(address.trim().toLowerCase());
    if (failure !== undefined) {
      return Promise.reject(new ProviderError(failure));
    }
    const checkedAt = this.#now();
    let normalized: string;
    try {
      normalized = normalizeEmail(address).email;
    } catch {
      return Promise.resolve({
        address: address.trim().toLowerCase().slice(0, 254),
        status: 'invalid',
        reason: 'syntax',
        checkedAt,
      });
    }
    const override = this.#overrides.get(normalized);
    const result =
      override !== undefined
        ? { status: override, reason: 'override' }
        : normalized.endsWith('.invalid')
          ? { status: 'invalid' as const, reason: 'no_domain' }
          : normalized.split('@')[0]?.includes('catchall') === true
            ? { status: 'risky' as const, reason: 'catch_all' }
            : bucketOf(normalized);
    return Promise.resolve({ address: normalized, ...result, checkedAt });
  }
}
