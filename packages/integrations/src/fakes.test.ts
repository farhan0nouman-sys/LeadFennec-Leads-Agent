import { describe, expect, it } from 'vitest';
import {
  FakeAiProvider,
  FakeBillingProvider,
  FakeCrmProvider,
  FakeEmailVerificationProvider,
  FakeLeadDataProvider,
  FakeMailboxProvider,
  FakeTransactionalMailProvider,
  createFakeProviders,
} from './fakes.js';
import type { LeadRecord, OutboundEmail } from './providers.js';

const message: OutboundEmail = {
  from: 'sender@example.test',
  to: 'prospect@example.test',
  subject: 'Hello',
  textBody: 'Body',
  idempotencyKey: 'intent-1',
};

describe('FakeMailboxProvider', () => {
  it('records the message instead of sending it', async () => {
    const mailbox = new FakeMailboxProvider('gmail');
    const receipt = await mailbox.send(message);
    expect(receipt.providerMessageId).toBe('gmail-fake-1');
    expect(mailbox.sent).toEqual([message]);
  });

  it('does not send twice for the same idempotency key', async () => {
    const mailbox = new FakeMailboxProvider('microsoft-graph');
    const first = await mailbox.send(message);
    const second = await mailbox.send({ ...message, subject: 'Retry' });
    expect(second).toEqual(first);
    expect(mailbox.sent).toHaveLength(1);
  });
});

describe('FakeAiProvider', () => {
  it('returns scripted outputs in order and records requests', async () => {
    const ai = new FakeAiProvider([{ fit: true }, { fit: false }]);
    const request = {
      task: 'qualify',
      instructions: 'i',
      input: 'x',
      maxOutputTokens: 50,
    };
    expect((await ai.generate(request)).output).toEqual({ fit: true });
    expect((await ai.generate(request)).output).toEqual({ fit: false });
    expect(ai.requests).toHaveLength(2);
    await expect(ai.generate(request)).rejects.toThrow(/no scripted output/);
  });
});

describe('FakeLeadDataProvider', () => {
  const person = (id: string, title: string): LeadRecord => ({
    externalId: id,
    firstName: 'Ada',
    lastName: id,
    title,
    companyName: 'Example Co',
    companyDomain: 'example.test',
  });
  const provider = new FakeLeadDataProvider([
    person('1', 'Head of Sales'),
    person('2', 'CTO'),
    person('3', 'VP Sales'),
  ]);

  it('filters by title and pages results', async () => {
    const first = await provider.searchPeople({
      titles: ['sales'],
      page: 1,
      perPage: 1,
    });
    expect(first.people.map((p) => p.externalId)).toEqual(['1']);
    expect(first.hasMore).toBe(true);
    const second = await provider.searchPeople({
      titles: ['sales'],
      page: 2,
      perPage: 1,
    });
    expect(second.people.map((p) => p.externalId)).toEqual(['3']);
    expect(second.hasMore).toBe(false);
  });
});

describe('other fakes', () => {
  it('verification returns configured statuses, unknown otherwise', async () => {
    const verifier = new FakeEmailVerificationProvider({
      'ok@example.test': 'valid',
    });
    expect((await verifier.verify('OK@example.test')).status).toBe('valid');
    expect((await verifier.verify('other@example.test')).status).toBe(
      'unknown',
    );
  });

  it('CRM upserts by email', async () => {
    const crm = new FakeCrmProvider();
    const contact = {
      email: 'A@x.test',
      firstName: 'A',
      lastName: 'B',
      companyName: null,
    };
    const first = await crm.upsertContact(contact);
    const again = await crm.upsertContact({
      ...contact,
      email: 'a@x.test',
      lastName: 'C',
    });
    expect(again).toEqual(first);
    expect(crm.contacts.get('a@x.test')?.lastName).toBe('C');
  });

  it('billing ignores a repeated idempotency key', async () => {
    const billing = new FakeBillingProvider();
    const usage = {
      customerId: 'c1',
      meter: 'leads',
      quantity: 3,
      idempotencyKey: 'k1',
    };
    await billing.recordUsage(usage);
    await billing.recordUsage(usage);
    expect(billing.usage).toHaveLength(1);
  });

  it('transactional mail records messages instead of sending them', async () => {
    const mail = new FakeTransactionalMailProvider();
    const receipt = await mail.send({
      to: 'user@example.test',
      subject: 'Verify your email',
      textBody: 'Open the link.',
      template: 'auth.verify_email',
    });
    expect(receipt.messageId).toBe('fake-mail-1');
    expect(mail.sent.map((m) => m.template)).toEqual(['auth.verify_email']);
  });

  it('createFakeProviders returns a fresh fake for every provider', () => {
    const providers = createFakeProviders();
    expect(Object.keys(providers).sort()).toEqual([
      'ai',
      'billing',
      'crm',
      'emailVerification',
      'gmail',
      'leadData',
      'mail',
      'microsoftGraph',
    ]);
    expect(createFakeProviders().gmail).not.toBe(providers.gmail);
  });
});
