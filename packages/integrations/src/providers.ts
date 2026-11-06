// Provider capability interfaces. PROVISIONAL (docs/decisions.md D-02C-05, O-07): shaped
// only by what tests need today, to be reconciled with the data model (01B). Provider-
// specific details (endpoints, auth, scopes, rate limits) belong in live adapters and
// require checking the provider's current official docs first.
import type {
  DiscoveryProvider,
  OrganizationSearchCapabilities,
  OrganizationSearchFilters,
} from '@lead-fennec-ai/shared';

/** OpenAI. `output` is untrusted: callers must validate it against their own schema. */
export interface AiProvider {
  generate(request: AiGenerateRequest): Promise<AiGenerateResult>;
}

export interface AiGenerateRequest {
  readonly task: string;
  readonly instructions: string;
  readonly input: string;
  readonly maxOutputTokens: number;
}

export interface AiGenerateResult {
  readonly output: unknown;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
}

/**
 * Searching companies (task 07A, docs/decisions.md D-07A-02). Provider-neutral: a live adapter
 * maps its own fields to these, declares what it supports, and reports quota and cost when the
 * provider does. Separate from people search (LeadDataProvider) and from enrichment.
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

/** Apollo. */
export interface LeadDataProvider {
  searchPeople(query: PeopleSearchQuery): Promise<PeopleSearchPage>;
}

export interface PeopleSearchQuery {
  readonly titles: readonly string[];
  readonly page: number;
  readonly perPage: number;
}

export interface LeadRecord {
  readonly externalId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly title: string | null;
  readonly companyName: string | null;
  readonly companyDomain: string | null;
}

export interface PeopleSearchPage {
  readonly people: readonly LeadRecord[];
  readonly hasMore: boolean;
}

/** Email verification. */
export type EmailVerificationStatus = 'valid' | 'invalid' | 'risky' | 'unknown';

export interface EmailVerificationProvider {
  verify(email: string): Promise<EmailVerificationResult>;
}

export interface EmailVerificationResult {
  readonly email: string;
  readonly status: EmailVerificationStatus;
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
  readonly ai: AiProvider;
  readonly leadData: LeadDataProvider;
  readonly organizationSearch: OrganizationSearchProvider;
  readonly emailVerification: EmailVerificationProvider;
  readonly gmail: MailboxProvider;
  readonly microsoftGraph: MailboxProvider;
  readonly crm: CrmProvider;
  readonly billing: BillingProvider;
  readonly mail: TransactionalMailProvider;
}
