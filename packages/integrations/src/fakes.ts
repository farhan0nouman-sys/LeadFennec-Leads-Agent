import type {
  AiGenerateRequest,
  AiGenerateResult,
  AiProvider,
  BillingProvider,
  CrmContact,
  CrmProvider,
  EmailVerificationProvider,
  EmailVerificationResult,
  EmailVerificationStatus,
  LeadDataProvider,
  LeadRecord,
  MailboxProvider,
  OutboundEmail,
  PeopleSearchPage,
  PeopleSearchQuery,
  ProviderSet,
  SendReceipt,
  TransactionalEmail,
  TransactionalMailProvider,
  TransactionalSendReceipt,
  UsageRecord,
} from './providers.js';

// In-memory fakes: deterministic, inspectable, and they never open a network connection.

/** Returns scripted outputs in order; throws when the script runs out. */
export class FakeAiProvider implements AiProvider {
  readonly requests: AiGenerateRequest[] = [];
  private readonly outputs: unknown[];

  constructor(outputs: readonly unknown[] = []) {
    this.outputs = [...outputs];
  }

  generate(request: AiGenerateRequest): Promise<AiGenerateResult> {
    this.requests.push(request);
    if (this.outputs.length === 0) {
      return Promise.reject(
        new Error(
          `FakeAiProvider: no scripted output for task "${request.task}"`,
        ),
      );
    }
    const output = this.outputs.shift();
    return Promise.resolve({
      output,
      usage: {
        inputTokens: Math.ceil(
          (request.instructions.length + request.input.length) / 4,
        ),
        outputTokens: Math.ceil(JSON.stringify(output ?? null).length / 4),
      },
    });
  }
}

/** Searches a fixed list by case-insensitive title match, with page/perPage paging. */
export class FakeLeadDataProvider implements LeadDataProvider {
  readonly queries: PeopleSearchQuery[] = [];

  constructor(private readonly people: readonly LeadRecord[] = []) {}

  searchPeople(query: PeopleSearchQuery): Promise<PeopleSearchPage> {
    this.queries.push(query);
    const titles = query.titles.map((title) => title.toLowerCase());
    const matches = this.people.filter(
      (person) =>
        titles.length === 0 ||
        titles.some((title) => person.title?.toLowerCase().includes(title)),
    );
    const start = (query.page - 1) * query.perPage;
    return Promise.resolve({
      people: matches.slice(start, start + query.perPage),
      hasMore: start + query.perPage < matches.length,
    });
  }
}

/** Returns the configured status per address; anything else is "unknown". */
export class FakeEmailVerificationProvider implements EmailVerificationProvider {
  readonly checked: string[] = [];

  constructor(
    private readonly statuses: Readonly<
      Record<string, EmailVerificationStatus>
    > = {},
  ) {}

  verify(email: string): Promise<EmailVerificationResult> {
    this.checked.push(email);
    return Promise.resolve({
      email,
      status: this.statuses[email.toLowerCase()] ?? 'unknown',
    });
  }
}

/** Records messages instead of sending them. A repeated idempotency key is not re-sent. */
export class FakeMailboxProvider implements MailboxProvider {
  readonly sent: OutboundEmail[] = [];
  private readonly receipts = new Map<string, SendReceipt>();

  constructor(private readonly name: string) {}

  send(message: OutboundEmail): Promise<SendReceipt> {
    const existing = this.receipts.get(message.idempotencyKey);
    if (existing !== undefined) {
      return Promise.resolve(existing);
    }
    this.sent.push(message);
    const receipt = {
      providerMessageId: `${this.name}-fake-${String(this.sent.length)}`,
    };
    this.receipts.set(message.idempotencyKey, receipt);
    return Promise.resolve(receipt);
  }
}

/** Upserts contacts by lower-cased email. */
export class FakeCrmProvider implements CrmProvider {
  readonly contacts = new Map<
    string,
    CrmContact & { readonly externalId: string }
  >();

  upsertContact(contact: CrmContact): Promise<{ readonly externalId: string }> {
    const key = contact.email.toLowerCase();
    const externalId =
      this.contacts.get(key)?.externalId ??
      `crm-fake-${String(this.contacts.size + 1)}`;
    this.contacts.set(key, { ...contact, externalId });
    return Promise.resolve({ externalId });
  }
}

/** Records usage; a repeated idempotency key is ignored. */
export class FakeBillingProvider implements BillingProvider {
  readonly usage: UsageRecord[] = [];

  recordUsage(record: UsageRecord): Promise<void> {
    if (
      !this.usage.some(
        (existing) => existing.idempotencyKey === record.idempotencyKey,
      )
    ) {
      this.usage.push(record);
    }
    return Promise.resolve();
  }
}

/**
 * Records transactional email instead of sending it. Tests read one-time links from
 * `sent`; nothing logs the message bodies.
 */
export class FakeTransactionalMailProvider implements TransactionalMailProvider {
  readonly sent: TransactionalEmail[] = [];

  send(message: TransactionalEmail): Promise<TransactionalSendReceipt> {
    this.sent.push(message);
    return Promise.resolve({
      messageId: `fake-mail-${String(this.sent.length)}`,
    });
  }
}

export interface FakeProviderSet extends ProviderSet {
  readonly ai: FakeAiProvider;
  readonly leadData: FakeLeadDataProvider;
  readonly emailVerification: FakeEmailVerificationProvider;
  readonly gmail: FakeMailboxProvider;
  readonly microsoftGraph: FakeMailboxProvider;
  readonly crm: FakeCrmProvider;
  readonly billing: FakeBillingProvider;
  readonly mail: FakeTransactionalMailProvider;
}

export function createFakeProviders(): FakeProviderSet {
  return {
    ai: new FakeAiProvider(),
    leadData: new FakeLeadDataProvider(),
    emailVerification: new FakeEmailVerificationProvider(),
    gmail: new FakeMailboxProvider('gmail'),
    microsoftGraph: new FakeMailboxProvider('microsoft-graph'),
    crm: new FakeCrmProvider(),
    billing: new FakeBillingProvider(),
    mail: new FakeTransactionalMailProvider(),
  };
}
