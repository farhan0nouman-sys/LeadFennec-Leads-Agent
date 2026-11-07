// Provider capability interfaces. PROVISIONAL (docs/decisions.md D-02C-05, O-07): shaped
// only by what tests need today, to be reconciled with the data model (01B). Provider-
// specific details (endpoints, auth, scopes, rate limits) belong in live adapters and
// require checking the provider's current official docs first.
import type {
  ContactDataProvider,
  DiscoveryProvider,
  EmailVerificationProviderName,
  EmailVerificationStatus,
  OrganizationSearchCapabilities,
  OrganizationSearchFilters,
  SeniorityLevel,
} from '@lead-fennec-ai/shared';
import type { ModelProvider } from './model/types.js';
import type { WebsiteFetcher } from './website/types.js';

/**
 * Searching companies (task 07A, docs/decisions.md D-07A-02). Provider-neutral: a live adapter
 * maps its own fields to these, declares what it supports, and reports quota and cost when the
 * provider does. Separate from people search (PeopleSearchProvider) and from enrichment.
 */
export interface OrganizationSearchProvider {
  /** Recorded with every result as its source. */
  readonly source: DiscoveryProvider;
  readonly capabilities: OrganizationSearchCapabilities;
  /** Throws ProviderError; never a provider's own message or response. */
  searchOrganizations(
    request: OrganizationSearchRequest,
  ): Promise<OrganizationSearchPage>;
}

export interface OrganizationSearchRequest {
  /** Only filters the provider declared it supports. */
  readonly filters: OrganizationSearchFilters;
  /**
   * At most capabilities.maxPageSize. A provider that pages by number keeps the first page's
   * size for later pages (its token says so), so it may return more than asked: the caller
   * takes what it needs.
   */
  readonly pageSize: number;
  /** Null for the first page, else the previous page's nextPageToken (opaque). */
  readonly pageToken: string | null;
}

/** A company as the provider returned it. Every field is untrusted until validated. */
export interface ProviderOrganization {
  /** The provider's id for the company: provenance, and dedupe across runs. */
  readonly externalId: string;
  readonly name: string;
  readonly domain: string | null;
  readonly websiteUrl: string | null;
  readonly industry: string | null;
  readonly employeeCount: number | null;
  /** ISO 3166-1 alpha-2. */
  readonly countryCode: string | null;
  /** The record as received, kept as provenance. Never executed. */
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface ProviderQuota {
  /** Requests or credits left, as the provider counts them; null when it doesn't say. */
  readonly remaining: number | null;
  readonly resetAt: Date | null;
}

export interface OrganizationSearchPage {
  readonly organizations: readonly ProviderOrganization[];
  /** Null on the last page. */
  readonly nextPageToken: string | null;
  /** Matches the provider reports in total, if it does. */
  readonly totalAvailable: number | null;
  readonly retrievedAt: Date;
  readonly quota: ProviderQuota | null;
  /** Credits this request cost, when the provider reports it. */
  readonly creditsUsed: number | null;
}

/**
 * Why a provider request failed, in our words only: a provider's message or response body
 * never travels with it (it may hold account details or the request).
 */
export const PROVIDER_ERROR_CODES = [
  'unauthorized',
  'forbidden',
  'quota_exceeded',
  'rate_limited',
  'invalid_request',
  'unavailable',
  'timeout',
  /** The answer was not in the documented shape (task 07B); not retried. */
  'bad_response',
  /** The caller cancelled the request (task 09B). */
  'canceled',
] as const;

export type ProviderErrorCode = (typeof PROVIDER_ERROR_CODES)[number];

const PROVIDER_ERROR_TEXT: Readonly<Record<ProviderErrorCode, string>> = {
  unauthorized: 'The provider did not accept the credentials.',
  forbidden: 'The provider account may not do this.',
  quota_exceeded: "The provider account's quota is used up.",
  rate_limited: 'The provider asked to slow down.',
  invalid_request: 'The provider refused the request.',
  unavailable: 'The provider is not reachable.',
  timeout: 'The provider did not answer in time.',
  bad_response: "The provider's answer could not be read.",
  canceled: 'The request was cancelled.',
};

/** Retrying later can help; the others need a person (credentials, plan, request). */
const RETRYABLE: ReadonlySet<ProviderErrorCode> = new Set([
  'rate_limited',
  'unavailable',
  'timeout',
]);

export class ProviderError extends Error {
  override readonly name = 'ProviderError';
  readonly retryable: boolean;

  constructor(
    readonly code: ProviderErrorCode,
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(PROVIDER_ERROR_TEXT[code]);
    this.retryable = RETRYABLE.has(code);
  }
}

/**
 * Finding people at a company (task 08A, docs/decisions.md D-08A-05): names, titles and
 * profiles, never email addresses. Separate from enrichment and from verification.
 */
export interface PeopleSearchProvider {
  readonly source: ContactDataProvider;
  /** Shown with every person, as the provider requires. */
  readonly attribution: string;
  readonly maxPageSize: number;
  /** Throws ProviderError; never a provider's own message or response. */
  searchPeople(request: PeopleSearchRequest): Promise<PeopleSearchPage>;
}

export interface PeopleSearchRequest {
  readonly organization: {
    readonly name: string;
    readonly domain: string | null;
  };
  readonly titles: readonly string[];
  readonly seniorities: readonly SeniorityLevel[];
  /** At most maxPageSize. */
  readonly pageSize: number;
  /** Null for the first page, else the previous page's nextPageToken (opaque). */
  readonly pageToken: string | null;
}

/**
 * A person as the provider returned them. Every field is untrusted until validated. A search
 * record can be partial (Apollo withholds the last name until enrichment, D-08B-02).
 */
export interface ProviderPerson {
  readonly externalId: string;
  readonly firstName: string;
  /** Null when the provider doesn't give it (yet). */
  readonly lastName: string | null;
  readonly title: string | null;
  readonly seniority: SeniorityLevel | null;
  readonly linkedinUrl: string | null;
  readonly organizationDomain: string | null;
  /** Whether the provider says it has an address for the person; null when it doesn't say. */
  readonly hasEmail: boolean | null;
  /** The record as received, kept as provenance. Never executed. */
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface PeopleSearchPage {
  readonly people: readonly ProviderPerson[];
  readonly nextPageToken: string | null;
  readonly retrievedAt: Date;
  readonly creditsUsed: number | null;
}

/**
 * Finding people's work addresses (tasks 08A and 08B, D-08A-05, D-08B-03), in batches. It
 * returns what the provider knows about each person, an address and the provider's own claim
 * about it. The claim is kept as an untrusted claim and never becomes a verification status:
 * only an EmailVerificationProvider check does. A guessed address is never returned.
 */
export interface ContactEnrichmentProvider {
  readonly source: ContactDataProvider;
  readonly attribution: string;
  /** People per call. */
  readonly maxBatchSize: number;
  /** Throws ProviderError; never a provider's own message or response. */
  enrichContacts(
    requests: readonly ContactEnrichmentRequest[],
  ): Promise<ContactEnrichmentBatch>;
}

export interface ContactEnrichmentRequest {
  /** The provider's id for the person, from its people search. */
  readonly externalId: string | null;
  readonly firstName: string;
  readonly lastName: string | null;
  readonly organizationName: string | null;
  readonly organizationDomain: string;
}

/** What the provider knows about one person. Every field is untrusted until validated. */
export interface EnrichedPerson {
  readonly externalId: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly title: string | null;
  readonly seniority: SeniorityLevel | null;
  readonly linkedinUrl: string | null;
  readonly organizationDomain: string | null;
  /** Null when the provider has no address, or only one that wasn't kept (emailDropped). */
  readonly email: string | null;
  /** What the provider says about its address. Untrusted; not a verification. */
  readonly providerClaim: 'provider_verified' | 'provider_unverified' | null;
  /** Why an address the provider sent was not kept: a guess, or not an address. */
  readonly emailDropped: 'guessed' | 'malformed' | null;
  /** The documented fields as received, kept as provenance. Never executed. */
  readonly raw: Readonly<Record<string, unknown>>;
}

export interface ContactEnrichmentBatch {
  /** In the order of the requests; null for a person the provider couldn't match. */
  readonly results: readonly (EnrichedPerson | null)[];
  readonly retrievedAt: Date;
  /** As the provider reports it (it can be fractional); null when it doesn't. */
  readonly creditsUsed: number | null;
}

/**
 * Checking whether an address accepts email (task 08A, D-08A-04): the only source of an
 * address's status. The status alone never makes an address send-eligible; see
 * emailSendEligibility in @lead-fennec-ai/shared.
 */
export interface EmailVerificationProvider {
  readonly source: EmailVerificationProviderName;
  /** Throws ProviderError for a failed check; an inconclusive one is status "unknown". */
  verify(address: string): Promise<EmailCheckResult>;
}

export interface EmailCheckResult {
  /** The address checked, normalized. */
  readonly address: string;
  readonly status: EmailVerificationStatus;
  /** A short machine-readable reason (e.g. "catch_all"), or null. */
  readonly reason: string | null;
  readonly checkedAt: Date;
}

/** Gmail and Microsoft Graph. */
export interface MailboxProvider {
  send(message: OutboundEmail): Promise<SendReceipt>;
}

export interface OutboundEmail {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly textBody: string;
  /** The same key must never produce a second send. */
  readonly idempotencyKey: string;
}

export interface SendReceipt {
  readonly providerMessageId: string;
}

/** GoHighLevel. */
export interface CrmProvider {
  upsertContact(contact: CrmContact): Promise<{ readonly externalId: string }>;
}

export interface CrmContact {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly companyName: string | null;
}

/** Stripe. */
export interface BillingProvider {
  recordUsage(record: UsageRecord): Promise<void>;
}

export interface UsageRecord {
  readonly customerId: string;
  readonly meter: string;
  readonly quantity: number;
  readonly idempotencyKey: string;
}

/**
 * Platform email to users (verification, password reset, security notices), as opposed to a
 * tenant's outreach mailboxes. The live provider is not chosen yet (docs/decisions.md O-19).
 */
export interface TransactionalMailProvider {
  send(message: TransactionalEmail): Promise<TransactionalSendReceipt>;
}

export interface TransactionalEmail {
  readonly to: string;
  readonly subject: string;
  /** Plain text. May contain a one-time link; never log it. */
  readonly textBody: string;
  /** Template key, e.g. "auth.verify_email". Safe to log. */
  readonly template: string;
}

export interface TransactionalSendReceipt {
  readonly messageId: string;
}

export interface ProviderSet {
  /** OpenAI (task 09B): answers only, never tools; its output is untrusted. */
  readonly ai: ModelProvider;
  readonly peopleSearch: PeopleSearchProvider;
  readonly contactEnrichment: ContactEnrichmentProvider;
  readonly organizationSearch: OrganizationSearchProvider;
  readonly emailVerification: EmailVerificationProvider;
  readonly gmail: MailboxProvider;
  readonly microsoftGraph: MailboxProvider;
  readonly crm: CrmProvider;
  readonly billing: BillingProvider;
  readonly mail: TransactionalMailProvider;
  /** Public web pages (task 09A): the safe fetcher, or the synthetic fake. */
  readonly websiteFetcher: WebsiteFetcher;
}
