// ContactEnrichmentAgent (tasks 08A and 08B, docs/decisions.md D-08A-02, D-08A-05, D-08B-*):
// finds people for the roles an ICP targets at one company through a PeopleSearchProvider,
// ranks them by role relevance (application code, never a model), looks up the chosen few in
// batches through a separate ContactEnrichmentProvider, and answers in the agent's output
// shape. The answer goes through parseContactEnrichmentOutput like any untrusted answer, so a
// record without provenance, with a missing last name or a malformed field is refused, not
// passed on. It reports what the run cost and what it skipped. Addresses are checked
// separately (checkContactEmails); nothing here decides that an address may be sent to.
import {
  contactEnrichmentInputSchema,
  emailSendEligibility,
  parseContactEnrichmentOutput,
  parseSeniority,
  rankRoleRelevance,
  type AcceptedContact,
  type EmailCheck,
  type ParsedEnrichment,
  type RoleRelevance,
  type SendEligibility,
  type SeniorityLevel,
} from '@lead-fennec-ai/shared';
import type { z } from 'zod';
import {
  ProviderError,
  type ContactEnrichmentProvider,
  type EmailVerificationProvider,
  type EnrichedPerson,
  type PeopleSearchProvider,
  type ProviderErrorCode,
  type ProviderPerson,
} from './providers.js';

export interface ContactEnrichmentAgentOptions {
  /** People-search pages per run (default 3): a run always ends. */
  readonly maxPages?: number;
}

/** What a run asked of the providers and what it left out (D-08B-04). */
export interface EnrichmentUsage {
  readonly searchRequests: number;
  /** Summed as the provider reports them; null when it never did. */
  readonly searchCredits: number | null;
  readonly enrichmentRequests: number;
  readonly enrichmentCredits: number | null;
  /** Search records whose provider id had been seen already (kept once). */
  readonly repeatedProviderIds: number;
  /** People the search said have no address: not looked up, so not paid for. */
  readonly skippedWithoutEmail: number;
  /** Chosen people the enrichment provider couldn't match. */
  readonly unmatched: number;
  /** Addresses the provider sent that were not kept (guessed or malformed). */
  readonly droppedEmails: number;
  /** Chosen people the workspace already had fresh data for: not looked up, so not paid for. */
  readonly reused: number;
}

/** What a run is told about the workspace (task 08C, D-08C-03). */
export interface EnrichmentRunOptions {
  /**
   * Of these people-search ids, the ones the workspace looked up recently. They are reused: never
   * sent to the enrichment provider again, so never paid for twice.
   */
  readonly known?: (
    externalIds: readonly string[],
  ) => Promise<ReadonlySet<string>>;
}

/** A chosen person the workspace already has: as the search returned them, ranked. */
export interface ReusedPerson {
  readonly person: ProviderPerson;
  readonly relevance: RoleRelevance;
  readonly retrievedAt: Date;
}

/** What the providers sent about one chosen person, kept as provenance (never executed). */
export interface PersonRecord {
  /** As the people search returned them (its raw record included). */
  readonly person: ProviderPerson;
  readonly retrievedAt: Date;
  readonly enrichment: Readonly<Record<string, unknown>> | null;
  /** The enrichment provider's claim about the address. Untrusted: never a check. */
  readonly providerClaim: EnrichedPerson['providerClaim'];
  readonly emailDropped: EnrichedPerson['emailDropped'];
}

export interface EnrichmentRun {
  readonly result: ParsedEnrichment;
  readonly usage: EnrichmentUsage;
  /** Chosen people who were reused instead of looked up (in the order chosen). */
  readonly reused: readonly ReusedPerson[];
  /** By people-search id: what was received about each person looked up. */
  readonly records: ReadonlyMap<string, PersonRecord>;
}

const addCredits = (total: number | null, credits: number | null) =>
  credits === null ? total : (total ?? 0) + credits;

export class ContactEnrichmentAgent {
  readonly #people: PeopleSearchProvider;
  readonly #enrichment: ContactEnrichmentProvider;
  readonly #maxPages: number;

  constructor(
    people: PeopleSearchProvider,
    enrichment: ContactEnrichmentProvider,
    options: ContactEnrichmentAgentOptions = {},
  ) {
    this.#people = people;
    this.#enrichment = enrichment;
    this.#maxPages = Math.min(Math.max(options.maxPages ?? 3, 1), 10);
  }

  /** The most relevant people at the company, with addresses to check. Provider errors propagate. */
  async run(
    rawInput: z.input<typeof contactEnrichmentInputSchema>,
    options: EnrichmentRunOptions = {},
  ): Promise<EnrichmentRun> {
    const input = contactEnrichmentInputSchema.parse(rawInput);
    const seniorities = input.targeting.seniorities
      .map(parseSeniority)
      .filter((level): level is SeniorityLevel => level !== null);
    const found: { person: ProviderPerson; retrievedAt: Date }[] = [];
    const seenIds = new Set<string>();
    let repeatedProviderIds = 0;
    let searchRequests = 0;
    let searchCredits: number | null = null;
    let pageToken: string | null = null;
    for (let page = 0; page < this.#maxPages; page += 1) {
      const result = await this.#people.searchPeople({
        organization: {
          name: input.organization.name,
          domain: input.organization.domain,
        },
        titles: input.targeting.titles,
        seniorities,
        pageSize: this.#people.maxPageSize,
        pageToken,
      });
      searchRequests += 1;
      searchCredits = addCredits(searchCredits, result.creditsUsed);
      for (const person of result.people) {
        if (seenIds.has(person.externalId)) {
          repeatedProviderIds += 1;
          continue;
        }
        seenIds.add(person.externalId);
        found.push({ person, retrievedAt: result.retrievedAt });
      }
      pageToken = result.nextPageToken;
      if (pageToken === null) {
        break;
      }
    }

    // Application code ranks; with targets, people who match nothing are left out, and so are
    // people the search says have no address (looking them up would only cost).
    const targeted =
      input.targeting.titles.length > 0 ||
      input.targeting.seniorities.length > 0;
    const candidates = found
      .map((entry) => ({
        ...entry,
        relevance: rankRoleRelevance(
          { title: entry.person.title, seniority: entry.person.seniority },
          input.targeting,
        ),
      }))
      .filter((entry) => !targeted || entry.relevance.score > 0);
    const withEmail = candidates.filter(
      (entry) => entry.person.hasEmail !== false,
    );
    const skippedWithoutEmail = candidates.length - withEmail.length;
    const chosen = withEmail
      .sort(
        (a, b) =>
          b.relevance.score - a.relevance.score ||
          a.person.externalId.localeCompare(b.person.externalId),
      )
      .slice(0, input.maxContacts);

    // People the workspace already looked up recently are reused, not looked up (or paid for)
    // again; the rest are enriched.
    const known =
      options.known === undefined || chosen.length === 0
        ? new Set<string>()
        : await options.known(chosen.map(({ person }) => person.externalId));
    const reused = chosen
      .filter(({ person }) => known.has(person.externalId))
      .map(({ person, relevance, retrievedAt }) => ({
        person,
        relevance,
        retrievedAt,
      }));
    const toEnrich = chosen.filter(
      ({ person }) => !known.has(person.externalId),
    );

    // Enrichment in the provider's batches, only when the company's domain is known.
    const enriched = new Map<
      string,
      { match: EnrichedPerson; retrievedAt: Date }
    >();
    let enrichmentRequests = 0;
    let enrichmentCredits: number | null = null;
    let unmatched = 0;
    let droppedEmails = 0;
    const domain = input.organization.domain;
    if (domain !== null) {
      for (let i = 0; i < toEnrich.length; i += this.#enrichment.maxBatchSize) {
        const batch = toEnrich.slice(i, i + this.#enrichment.maxBatchSize);
        const answer = await this.#enrichment.enrichContacts(
          batch.map(({ person }) => ({
            externalId: person.externalId,
            firstName: person.firstName,
            lastName: person.lastName,
            organizationName: input.organization.name,
            organizationDomain: domain,
          })),
        );
        enrichmentRequests += 1;
        enrichmentCredits = addCredits(enrichmentCredits, answer.creditsUsed);
        batch.forEach(({ person }, index) => {
          const match = answer.results[index] ?? null;
          if (match === null) {
            unmatched += 1;
            return;
          }
          if (match.emailDropped !== null) {
            droppedEmails += 1;
          }
          enriched.set(person.externalId, {
            match,
            retrievedAt: answer.retrievedAt,
          });
        });
      }
    }

    const records = new Map<string, PersonRecord>();
    const contacts = toEnrich.map(({ person, retrievedAt }) => {
      const found = enriched.get(person.externalId);
      records.set(person.externalId, {
        person,
        retrievedAt,
        enrichment: found?.match.raw ?? null,
        providerClaim: found?.match.providerClaim ?? null,
        emailDropped: found?.match.emailDropped ?? null,
      });
      const match = found?.match ?? null;
      return {
        firstName: match?.firstName ?? person.firstName,
        // A last name the search withheld and enrichment didn't give: refused as partial.
        lastName: match?.lastName ?? person.lastName,
        title: match?.title ?? person.title,
        seniority: match?.seniority ?? person.seniority,
        linkedinUrl: match?.linkedinUrl ?? person.linkedinUrl,
        email:
          match?.email == null || found === undefined
            ? null
            : {
                address: match.email,
                provenance: {
                  provider: this.#enrichment.source,
                  externalId: match.externalId,
                  retrievedAt: found.retrievedAt.toISOString(),
                  attribution: this.#enrichment.attribution,
                },
              },
        provenance: {
          provider: this.#people.source,
          externalId: person.externalId,
          retrievedAt: retrievedAt.toISOString(),
          attribution: this.#people.attribution,
        },
      };
    });
    return {
      result: parseContactEnrichmentOutput({ contacts }, input),
      usage: {
        searchRequests,
        searchCredits,
        enrichmentRequests,
        enrichmentCredits,
        repeatedProviderIds,
        skippedWithoutEmail,
        unmatched,
        droppedEmails,
        reused: reused.length,
      },
      reused,
      records,
    };
  }
}

export interface CheckedContact {
  readonly contact: AcceptedContact;
  /** Null for a contact without an address, or when the check failed. */
  readonly check: EmailCheck | null;
  /** Decided here from the check, never from the address or a provider's claim. */
  readonly eligibility: SendEligibility;
  /** Why the check failed: retryable (try again later) or permanent. */
  readonly failure: {
    readonly code: ProviderErrorCode;
    readonly retryable: boolean;
  } | null;
}

/**
 * Checks each contact's address and says whether it may be sent to without a person. A failed
 * check is recorded (retryable or permanent) and leaves the address unverified; it never
 * becomes a status.
 */
export async function checkContactEmails(
  verifier: EmailVerificationProvider,
  contacts: readonly AcceptedContact[],
  now: Date,
): Promise<CheckedContact[]> {
  const checked: CheckedContact[] = [];
  for (const contact of contacts) {
    if (contact.email === null) {
      checked.push({
        contact,
        check: null,
        eligibility: emailSendEligibility('', null, now),
        failure: null,
      });
      continue;
    }
    let result;
    try {
      result = await verifier.verify(contact.email.address);
    } catch (error) {
      if (!(error instanceof ProviderError)) {
        throw error;
      }
      checked.push({
        contact,
        check: null,
        eligibility: emailSendEligibility(contact.email.address, null, now),
        failure: { code: error.code, retryable: error.retryable },
      });
      continue;
    }
    const check: EmailCheck = {
      address: result.address,
      status: result.status,
      reason: result.reason,
      provider: verifier.source,
      checkedAt: result.checkedAt.toISOString(),
    };
    checked.push({
      contact,
      check,
      eligibility: emailSendEligibility(contact.email.address, check, now),
      failure: null,
    });
  }
  return checked;
}
