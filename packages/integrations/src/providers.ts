// Provider capability interfaces. PROVISIONAL (docs/decisions.md D-02C-05, O-07): shaped
// only by what tests need today, to be reconciled with the data model (01B). Provider-
// specific details (endpoints, auth, scopes, rate limits) belong in live adapters and
// require checking the provider's current official docs first.

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
  readonly emailVerification: EmailVerificationProvider;
  readonly gmail: MailboxProvider;
  readonly microsoftGraph: MailboxProvider;
  readonly crm: CrmProvider;
  readonly billing: BillingProvider;
  readonly mail: TransactionalMailProvider;
}
