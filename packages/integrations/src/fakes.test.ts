import { describe, expect, it } from 'vitest';
import {
  FakeBillingProvider,
  FakeCrmProvider,
  FakeMailboxProvider,
  FakeTransactionalMailProvider,
  createFakeProviders,
} from './fakes.js';
import type { OutboundEmail } from './providers.js';

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

describe('other fakes', () => {
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
      'contactEnrichment',
      'crm',
      'emailVerification',
      'gmail',
      'mail',
      'microsoftGraph',
      'organizationSearch',
      'peopleSearch',
      'websiteFetcher',
    ]);
    expect(createFakeProviders().gmail).not.toBe(providers.gmail);
  });
});
