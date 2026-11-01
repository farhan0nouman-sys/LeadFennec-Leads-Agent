// Two isolated fixture tenants for development and tests.
// Every address and domain uses the reserved .test TLD (RFC 2606): no real people or
// companies. Both tenants deliberately contain the same email address, domain, Apollo id and
// provider message/thread/event ids, which is only possible because uniqueness is scoped per
// tenant (and per mailbox).
// The outreach and billing data is fake history: nothing was ever sent or charged, and every
// provider id ("fake_…") and secret reference ("fake://…") points at nothing.
import {
  normalizeDomain,
  normalizeEmail,
  normalizeTimeZone,
  parseSecretRef,
} from '@lead-fennec-ai/shared';
import type { Prisma, UsageMetric } from '../generated/prisma/client.js';
import { payloadSha256 } from '../payload-hash.js';

type FixtureKey = 'alpha' | 'beta';
type WithId<T> = T & { readonly id: string };

/** Deterministic UUIDs: group "a" = Alpha, "b" = Beta, "c" = platform scope. */
function fixtureId(group: 'a' | 'b' | 'c', n: number): string {
  return `00000000-0000-4000-8000-${group}${n.toString(16).padStart(11, '0')}`;
}

export const FIXTURE_PERMISSIONS = [
  {
    key: 'members.manage',
    description: 'Invite, suspend and change roles of members',
  },
  { key: 'settings.manage', description: 'Change tenant settings' },
  { key: 'icps.read', description: 'View ideal customer profiles' },
  { key: 'icps.write', description: 'Create and edit ideal customer profiles' },
  { key: 'contacts.read', description: 'View organizations and contacts' },
  {
    key: 'contacts.write',
    description: 'Create and edit organizations and contacts',
  },
  { key: 'lead_lists.read', description: 'View lead lists' },
  { key: 'lead_lists.write', description: 'Create and edit lead lists' },
  { key: 'imports.create', description: 'Import contacts' },
  { key: 'research.run', description: 'Run research' },
  { key: 'scores.read', description: 'View scores' },
  { key: 'verifications.run', description: 'Verify email addresses' },
  { key: 'campaigns.read', description: 'View campaigns and their leads' },
  {
    key: 'campaigns.write',
    description: 'Create and edit campaigns, sequences and drafts',
  },
  { key: 'drafts.approve', description: 'Approve or reject outbound drafts' },
  { key: 'email_accounts.manage', description: 'Connect and manage mailboxes' },
  { key: 'suppressions.manage', description: 'Manage the suppression list' },
  {
    key: 'billing.read',
    description: 'View the subscription, usage and payments',
  },
  { key: 'branding.manage', description: 'Change the workspace branding' },
  { key: 'audit.read', description: 'View the audit records' },
] as const satisfies readonly Prisma.PermissionCreateManyInput[];

const MEMBER_PERMISSIONS = [
  'icps.read',
  'contacts.read',
  'contacts.write',
  'lead_lists.read',
  'lead_lists.write',
  'imports.create',
  'research.run',
  'scores.read',
  'campaigns.read',
  'campaigns.write',
] as const;

function user(
  n: number,
  email: string,
  displayName: string,
  isPlatformAdmin = false,
): WithId<Prisma.UserCreateManyInput> {
  return {
    id: fixtureId('c', n),
    email,
    normalizedEmail: normalizeEmail(email).email,
    displayName,
    isPlatformAdmin,
  };
}

/** The plan catalog (platform scope) the fixture tenants subscribe to. */
export const FIXTURE_PLANS = {
  starter: {
    id: fixtureId('c', 100),
    key: 'fixture_starter',
    name: 'Starter (fixture)',
    currency: 'USD',
    amountMinor: 4_900n,
    interval: 'MONTH',
    externalPriceId: 'fake_price_starter',
  },
  growth: {
    id: fixtureId('c', 101),
    key: 'fixture_growth',
    name: 'Growth (fixture)',
    currency: 'USD',
    amountMinor: 19_900n,
    interval: 'MONTH',
    externalPriceId: 'fake_price_growth',
  },
  dedicated: {
    id: fixtureId('c', 102),
    key: 'fixture_dedicated',
    name: 'Dedicated (fixture)',
    currency: 'GBP',
    amountMinor: 1_200_000n,
    interval: 'YEAR',
    externalPriceId: 'fake_price_dedicated',
  },
} satisfies Record<string, WithId<Prisma.BillingPlanCreateManyInput>>;

const limits = (
  planId: string,
  quantities: Record<UsageMetric, bigint>,
): Prisma.PlanLimitCreateManyInput[] =>
  Object.entries(quantities).map(([metric, quantityPerPeriod]) => ({
    planId,
    metric: metric as UsageMetric,
    quantityPerPeriod,
  }));

export const FIXTURE_PLAN_LIMITS: readonly Prisma.PlanLimitCreateManyInput[] = [
  ...limits(FIXTURE_PLANS.starter.id, {
    AI_TOKENS: 200_000n,
    LEAD_ENRICHMENTS: 250n,
    EMAIL_VERIFICATIONS: 500n,
    EMAILS_SENT: 1_000n,
  }),
  ...limits(FIXTURE_PLANS.growth.id, {
    AI_TOKENS: 2_000_000n,
    LEAD_ENRICHMENTS: 2_500n,
    EMAIL_VERIFICATIONS: 5_000n,
    EMAILS_SENT: 10_000n,
  }),
  ...limits(FIXTURE_PLANS.dedicated.id, {
    AI_TOKENS: 50_000_000n,
    LEAD_ENRICHMENTS: 50_000n,
    EMAIL_VERIFICATIONS: 100_000n,
    EMAILS_SENT: 200_000n,
  }),
];

export const FIXTURE_USERS = {
  platformAdmin: user(
    1,
    'Platform.Admin@Fixtures.TEST',
    'Platform Admin',
    true,
  ),
  alphaAdmin: user(2, 'admin@fixture-alpha.test', 'Alpha Admin'),
  betaAdmin: user(3, 'admin@fixture-beta.test', 'Beta Admin'),
  sharedMember: user(4, 'shared.member@fixtures.test', 'Shared Member'),
};

/** Billing, usage, branding, audit and notification rows of one fixture tenant (task 03C). */
export interface FixtureBilling {
  readonly subscriptions: Prisma.SubscriptionCreateManyInput[];
  readonly paymentEvents: Prisma.PaymentEventCreateManyInput[];
  readonly limitOverrides: Prisma.TenantLimitOverrideCreateManyInput[];
  readonly usageReservations: Prisma.UsageReservationCreateManyInput[];
  readonly usageLedgerEntries: Prisma.UsageLedgerEntryCreateManyInput[];
  readonly branding: Prisma.TenantBrandingCreateManyInput[];
  readonly auditRecords: Prisma.AuditRecordCreateManyInput[];
  readonly notifications: Prisma.NotificationCreateManyInput[];
}

/** Outreach and background-job rows of one fixture tenant (task 03B). */
export interface FixtureOutreach {
  readonly emailAccounts: Prisma.EmailAccountCreateManyInput[];
  readonly templates: Prisma.TemplateCreateManyInput[];
  readonly campaigns: Prisma.CampaignCreateManyInput[];
  readonly sequences: Prisma.SequenceCreateManyInput[];
  readonly sequenceSteps: Prisma.SequenceStepCreateManyInput[];
  readonly campaignLeads: Prisma.CampaignLeadCreateManyInput[];
  readonly drafts: Prisma.DraftCreateManyInput[];
  readonly approvals: Prisma.ApprovalCreateManyInput[];
  readonly outboundIntents: Prisma.OutboundIntentCreateManyInput[];
  readonly emailThreads: Prisma.EmailThreadCreateManyInput[];
  readonly outboundAttempts: Prisma.OutboundAttemptCreateManyInput[];
  readonly inboundMessages: Prisma.InboundMessageCreateManyInput[];
  readonly suppressions: Prisma.SuppressionCreateManyInput[];
  readonly jobSchedules: Prisma.JobScheduleCreateManyInput[];
  readonly jobRuns: Prisma.JobRunCreateManyInput[];
  readonly jobTasks: Prisma.JobTaskCreateManyInput[];
  readonly workerLeases: Prisma.WorkerLeaseCreateManyInput[];
  readonly outboxEvents: Prisma.OutboxEventCreateManyInput[];
  readonly inboundEvents: Prisma.InboundEventCreateManyInput[];
  readonly integrationSyncCursors: Prisma.IntegrationSyncCursorCreateManyInput[];
}

export interface FixtureTenant extends FixtureOutreach, FixtureBilling {
  readonly key: FixtureKey;
  readonly tenant: Prisma.TenantCreateManyInput & { id: string; slug: string };
  readonly settings: Prisma.TenantSettingsCreateManyInput;
  readonly roles: Prisma.RoleCreateManyInput[];
  readonly rolePermissions: Prisma.RolePermissionCreateManyInput[];
  readonly memberships: Prisma.MembershipCreateManyInput[];
  readonly icps: Prisma.IcpCreateManyInput[];
  readonly organizations: Prisma.OrganizationCreateManyInput[];
  readonly contacts: Prisma.ContactCreateManyInput[];
  readonly leadLists: Prisma.LeadListCreateManyInput[];
  readonly leadListMembers: Prisma.LeadListMemberCreateManyInput[];
  readonly imports: Prisma.ImportCreateManyInput[];
  readonly sourceRecords: Prisma.SourceRecordCreateManyInput[];
  readonly research: Prisma.ResearchCreateManyInput[];
  readonly evidence: Prisma.EvidenceCreateManyInput[];
  readonly scores: Prisma.ScoreCreateManyInput[];
  readonly verifications: Prisma.VerificationCreateManyInput[];
}

/** Ids of every fixture row, for tests that need to reference them. */
export function fixtureIds(key: FixtureKey) {
  const g = key === 'alpha' ? 'a' : 'b';
  return {
    tenant: fixtureId(g, 1),
    roleAdmin: fixtureId(g, 10),
    roleMember: fixtureId(g, 11),
    membershipAdmin: fixtureId(g, 20),
    membershipShared: fixtureId(g, 21),
    icp: fixtureId(g, 30),
    orgShared: fixtureId(g, 40),
    orgOwn: fixtureId(g, 41),
    contactShared: fixtureId(g, 50),
    contactOwn: fixtureId(g, 51),
    contactNoEmail: fixtureId(g, 52),
    leadList: fixtureId(g, 60),
    import: fixtureId(g, 70),
    sourceCsvRow1: fixtureId(g, 80),
    sourceCsvRow2: fixtureId(g, 81),
    sourceApollo: fixtureId(g, 82),
    research: fixtureId(g, 90),
    evidence: fixtureId(g, 100),
    score: fixtureId(g, 110),
    scoreOrg: fixtureId(g, 111),
    verification: fixtureId(g, 120),
    emailAccount: fixtureId(g, 130),
    templateIntro: fixtureId(g, 140),
    templateFollowUp: fixtureId(g, 141),
    campaign: fixtureId(g, 150),
    sequence: fixtureId(g, 160),
    stepIntro: fixtureId(g, 170),
    stepFollowUp: fixtureId(g, 171),
    leadShared: fixtureId(g, 180),
    leadOwn: fixtureId(g, 181),
    draftSharedV1: fixtureId(g, 190),
    draftSharedV2: fixtureId(g, 191),
    draftOwnV1: fixtureId(g, 192),
    approvalRejected: fixtureId(g, 200),
    approvalApproved: fixtureId(g, 201),
    intent: fixtureId(g, 210),
    attemptFailed: fixtureId(g, 220),
    attemptSent: fixtureId(g, 221),
    thread: fixtureId(g, 230),
    reply: fixtureId(g, 240),
    suppressionEmail: fixtureId(g, 250),
    suppressionDomain: fixtureId(g, 251),
    schedule: fixtureId(g, 260),
    scheduleMailboxSync: fixtureId(g, 261),
    run: fixtureId(g, 270),
    taskSend: fixtureId(g, 280),
    taskGenerate: fixtureId(g, 281),
    lease: fixtureId(g, 290),
    eventSent: fixtureId(g, 300),
    eventStopped: fixtureId(g, 301),
    inboundEvent: fixtureId(g, 310),
    syncCursor: fixtureId(g, 320),
    subscription: fixtureId(g, 330),
    subscriptionPrevious: fixtureId(g, 331),
    inboundEventPaymentFailed: fixtureId(g, 340),
    inboundEventPaymentSucceeded: fixtureId(g, 341),
    paymentFailed: fixtureId(g, 350),
    paymentSucceeded: fixtureId(g, 351),
    reservationCommitted: fixtureId(g, 360),
    reservationReleased: fixtureId(g, 361),
    reservationExpired: fixtureId(g, 362),
    ledgerReserved: fixtureId(g, 370),
    ledgerSend: fixtureId(g, 371),
    ledgerAdjustment: fixtureId(g, 372),
    limitOverride: fixtureId(g, 380),
    auditApproval: fixtureId(g, 390),
    auditSync: fixtureId(g, 391),
    auditAdminAccess: fixtureId(g, 392),
    notificationApproval: fixtureId(g, 400),
    notificationPayment: fixtureId(g, 401),
  };
}

type FixtureIds = ReturnType<typeof fixtureIds>;

function contactIdentity(rawEmail: string) {
  const { email, domain } = normalizeEmail(rawEmail);
  return { email: rawEmail, normalizedEmail: email, emailDomain: domain };
}

function sourceRecord(
  data: Omit<Prisma.SourceRecordCreateManyInput, 'payloadSha256'> & {
    payload: Prisma.InputJsonObject;
  },
): Prisma.SourceRecordCreateManyInput {
  return { ...data, payloadSha256: payloadSha256(data.payload) };
}

function inboundEvent(
  data: Omit<Prisma.InboundEventCreateManyInput, 'payloadSha256'> & {
    payload: Prisma.InputJsonObject;
  },
): Prisma.InboundEventCreateManyInput {
  return { ...data, payloadSha256: payloadSha256(data.payload) };
}

function secondsAfter(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1000);
}

interface OutreachPeople {
  /** Raw email of the contact both tenants share. */
  readonly sharedRaw: string;
  readonly ownFirstName: string;
  readonly ownOrgName: string;
}

/**
 * A campaign in mid-flight: the shared contact received step 1 (AI draft rejected, edited
 * version approved, first attempt failed, second sent) and replied, so the lead stopped; the
 * other contact's step 1 draft awaits approval.
 */
function buildOutreach(
  key: FixtureKey,
  ids: FixtureIds,
  people: OutreachPeople,
): FixtureOutreach {
  const tenantId = ids.tenant;
  const alpha = key === 'alpha';
  const provider = alpha ? 'GMAIL' : 'MICROSOFT_GRAPH';
  const mailboxRaw = alpha
    ? 'Outreach@Fixture-Alpha.test'
    : 'outreach@fixture-beta.test';
  const mailbox = normalizeEmail(mailboxRaw);
  const recipient = normalizeEmail(people.sharedRaw).email;
  const campaignZone = normalizeTimeZone(
    alpha ? 'America/New_York' : 'Europe/London',
  );
  const ownLeadZone = normalizeTimeZone(
    alpha ? 'America/Chicago' : 'Europe/Dublin',
  );
  // 09:30 local time on 2026-10-06 in the campaign's zone (EDT = UTC-4, BST = UTC+1).
  const scheduledAt = new Date(
    alpha ? '2026-10-06T13:30:00Z' : '2026-10-06T08:30:00Z',
  );
  const sentAt = secondsAfter(scheduledAt, 302);
  const replyAt = new Date('2026-10-07T15:00:00Z');
  const messageId = (attempt: number) =>
    `<fixture-0001.${String(attempt)}@${mailbox.domain}>`;
  const sentSubject = 'Growing the sales team at Shared Prospect Co';
  const syncPosition = alpha ? '1048577' : 'fake-delta-0002';
  const step1 = {
    tenantId,
    sequenceId: ids.sequence,
    sequenceStepId: ids.stepIntro,
  };

  return {
    emailAccounts: [
      {
        tenantId,
        id: ids.emailAccount,
        provider,
        email: mailboxRaw,
        normalizedEmail: mailbox.email,
        displayName: alpha ? 'Alpha Outreach' : 'Beta Outreach',
        status: 'ACTIVE',
        externalAccountId: `fake-account-${key}`,
        secretRef: parseSecretRef(
          `fake://email-accounts/fixture-${key}/outreach`,
        ).ref,
        dailySendLimit: 40,
        connectedAt: new Date('2026-10-05T12:00:00Z'),
      },
    ],
    templates: [
      {
        tenantId,
        id: ids.templateIntro,
        name: 'Intro',
        subject: 'Quick question about {{organization.name}}',
        body: 'Hi {{contact.first_name}},\n\nFixture template text.\n',
      },
      {
        tenantId,
        id: ids.templateFollowUp,
        name: 'Follow-up',
        subject: 'Re: Quick question about {{organization.name}}',
        body: 'Hi {{contact.first_name}},\n\nFollowing up on my note (fixture text).\n',
      },
    ],
    campaigns: [
      {
        tenantId,
        id: ids.campaign,
        name: 'Q4 outreach',
        description: 'Fixture campaign (fake data).',
        status: 'ACTIVE',
        icpId: ids.icp,
        leadListId: ids.leadList,
        emailAccountId: ids.emailAccount,
        timezone: campaignZone,
        sendWeekdays: [1, 2, 3, 4, 5],
        sendWindowStartMinute: 9 * 60,
        sendWindowEndMinute: 17 * 60,
        activatedAt: new Date('2026-10-05T13:00:00Z'),
      },
    ],
    sequences: [
      {
        tenantId,
        id: ids.sequence,
        campaignId: ids.campaign,
        name: 'Main sequence',
        status: 'ACTIVE',
      },
    ],
    sequenceSteps: [
      {
        tenantId,
        id: ids.stepIntro,
        sequenceId: ids.sequence,
        position: 1,
        delayMinutes: 0,
        templateId: ids.templateIntro,
      },
      {
        tenantId,
        id: ids.stepFollowUp,
        sequenceId: ids.sequence,
        position: 2,
        delayMinutes: 3 * 24 * 60,
        templateId: ids.templateFollowUp,
      },
    ],
    campaignLeads: [
      {
        tenantId,
        id: ids.leadShared,
        campaignId: ids.campaign,
        sequenceId: ids.sequence,
        contactId: ids.contactShared,
        status: 'STOPPED',
        stopReason: 'REPLIED',
        timezone: campaignZone,
        currentStepPosition: 1,
        enrolledAt: new Date('2026-10-05T13:05:00Z'),
        stoppedAt: secondsAfter(replyAt, 5),
      },
      {
        tenantId,
        id: ids.leadOwn,
        campaignId: ids.campaign,
        sequenceId: ids.sequence,
        contactId: ids.contactOwn,
        status: 'ACTIVE',
        // This lead is scheduled in its own zone: 09:30 local on 2026-10-08.
        timezone: ownLeadZone,
        nextActionAt: new Date(
          alpha ? '2026-10-08T14:30:00Z' : '2026-10-08T08:30:00Z',
        ),
        enrolledAt: new Date('2026-10-05T13:05:00Z'),
      },
    ],
    drafts: [
      {
        ...step1,
        id: ids.draftSharedV1,
        campaignLeadId: ids.leadShared,
        version: 1,
        status: 'REJECTED',
        source: 'AI',
        subject: 'Hiring two account executives?',
        body: 'Hi Alex,\n\nAI-written fixture text.\n',
        model: 'fake-model',
        promptVersion: 'draft-v0',
        createdAt: new Date('2026-10-05T13:10:00Z'),
      },
      {
        ...step1,
        id: ids.draftSharedV2,
        campaignLeadId: ids.leadShared,
        version: 2,
        status: 'APPROVED',
        source: 'MANUAL',
        subject: sentSubject,
        body: 'Hi Alex,\n\nEdited fixture text.\n',
        createdByMembershipId: ids.membershipAdmin,
        createdAt: new Date('2026-10-05T13:30:00Z'),
      },
      {
        ...step1,
        id: ids.draftOwnV1,
        campaignLeadId: ids.leadOwn,
        version: 1,
        status: 'PENDING_APPROVAL',
        source: 'TEMPLATE',
        templateId: ids.templateIntro,
        templateVersion: 1,
        subject: `Quick question about ${people.ownOrgName}`,
        body: `Hi ${people.ownFirstName},\n\nFixture template text.\n`,
        createdAt: new Date('2026-10-07T12:00:00Z'),
      },
    ],
    approvals: [
      {
        tenantId,
        id: ids.approvalRejected,
        draftId: ids.draftSharedV1,
        decision: 'REJECTED',
        decidedByMembershipId: ids.membershipAdmin,
        note: 'Too generic: mention the hiring signal.',
        decidedAt: new Date('2026-10-05T13:20:00Z'),
      },
      {
        tenantId,
        id: ids.approvalApproved,
        draftId: ids.draftSharedV2,
        decision: 'APPROVED',
        decidedByMembershipId: ids.membershipAdmin,
        decidedAt: new Date('2026-10-05T13:40:00Z'),
      },
    ],
    outboundIntents: [
      {
        tenantId,
        id: ids.intent,
        campaignLeadId: ids.leadShared,
        sequenceStepId: ids.stepIntro,
        draftId: ids.draftSharedV2,
        approvalId: ids.approvalApproved,
        approvalDecision: 'APPROVED',
        emailAccountId: ids.emailAccount,
        recipientEmail: recipient,
        status: 'SENT',
        scheduledAt,
        scheduledTimezone: campaignZone,
        sentAt,
        createdAt: new Date('2026-10-05T13:41:00Z'),
      },
    ],
    emailThreads: [
      {
        tenantId,
        id: ids.thread,
        emailAccountId: ids.emailAccount,
        providerThreadId: 'fake-thread-0001',
        campaignLeadId: ids.leadShared,
        subject: sentSubject,
        lastMessageAt: replyAt,
        createdAt: sentAt,
      },
    ],
    outboundAttempts: [
      {
        tenantId,
        id: ids.attemptFailed,
        outboundIntentId: ids.intent,
        attemptNumber: 1,
        emailAccountId: ids.emailAccount,
        status: 'FAILED',
        internetMessageId: messageId(1),
        errorCode: 'provider_unavailable',
        retryable: true,
        startedAt: secondsAfter(scheduledAt, 1),
        finishedAt: secondsAfter(scheduledAt, 3),
      },
      {
        tenantId,
        id: ids.attemptSent,
        outboundIntentId: ids.intent,
        attemptNumber: 2,
        emailAccountId: ids.emailAccount,
        status: 'SENT',
        internetMessageId: messageId(2),
        providerMessageId: 'fake-msg-0001',
        emailThreadId: ids.thread,
        startedAt: secondsAfter(scheduledAt, 300),
        finishedAt: sentAt,
      },
    ],
    inboundMessages: [
      {
        tenantId,
        id: ids.reply,
        emailAccountId: ids.emailAccount,
        emailThreadId: ids.thread,
        providerMessageId: 'fake-msg-0002',
        internetMessageId: '<fixture-reply-0001@shared-prospect.test>',
        inReplyTo: messageId(2),
        fromEmail: people.sharedRaw,
        fromNormalizedEmail: recipient,
        subject: `Re: ${sentSubject}`,
        snippet: 'Thanks, happy to talk next week. (fixture text)',
        receivedAt: replyAt,
        classification: 'REPLY',
        classifiedAt: secondsAfter(replyAt, 3),
        outboundAttemptId: ids.attemptSent,
      },
    ],
    suppressions: [
      {
        tenantId,
        id: ids.suppressionEmail,
        normalizedEmail: normalizeEmail('Opted.Out@Shared-Prospect.test').email,
        reason: 'OPT_OUT',
        source: 'INBOUND_MESSAGE',
        note: 'Asked not to be contacted (fixture).',
      },
      {
        tenantId,
        id: ids.suppressionDomain,
        normalizedDomain: normalizeDomain('https://www.competitor.test/'),
        reason: 'MANUAL',
        source: 'MANUAL',
      },
    ],
    jobSchedules: [
      {
        tenantId,
        id: ids.schedule,
        name: 'Campaign dispatch',
        jobType: 'campaign.dispatch',
        cronExpression: '*/15 9-16 * * 1-5',
        timezone: campaignZone,
        campaignId: ids.campaign,
        // 09:00 local on 2026-10-08.
        nextRunAt: new Date(
          alpha ? '2026-10-08T13:00:00Z' : '2026-10-08T08:00:00Z',
        ),
        lastRunAt: scheduledAt,
      },
      {
        tenantId,
        id: ids.scheduleMailboxSync,
        name: 'Mailbox sync',
        jobType: 'mailbox.sync',
        intervalSeconds: 300,
        emailAccountId: ids.emailAccount,
        nextRunAt: secondsAfter(replyAt, 300),
        lastRunAt: replyAt,
      },
    ],
    jobRuns: [
      {
        tenantId,
        id: ids.run,
        scheduleId: ids.schedule,
        jobType: 'campaign.dispatch',
        trigger: 'SCHEDULE',
        status: 'SUCCEEDED',
        scheduledFor: scheduledAt,
        startedAt: secondsAfter(scheduledAt, 1),
        finishedAt: secondsAfter(scheduledAt, 303),
        stats: { intentsSent: 1, attemptsFailed: 1 },
      },
    ],
    jobTasks: [
      {
        tenantId,
        id: ids.taskSend,
        runId: ids.run,
        taskType: 'outbound.send',
        idempotencyKey: `outbound_intent:${ids.intent}`,
        status: 'SUCCEEDED',
        payload: { outboundIntentId: ids.intent },
        availableAt: scheduledAt,
        attemptCount: 2,
        lastErrorCode: 'provider_unavailable',
        startedAt: secondsAfter(scheduledAt, 1),
        finishedAt: sentAt,
      },
      {
        tenantId,
        id: ids.taskGenerate,
        taskType: 'draft.generate',
        idempotencyKey: `campaign_lead:${ids.leadOwn}:step:2`,
        status: 'PENDING',
        payload: {
          campaignLeadId: ids.leadOwn,
          sequenceStepId: ids.stepFollowUp,
        },
        availableAt: new Date('2026-10-10T13:30:00Z'),
      },
    ],
    workerLeases: [
      {
        tenantId,
        id: ids.lease,
        resourceType: 'email_account.send',
        resourceId: ids.emailAccount,
        holderId: 'worker-fixture-1',
        fencingToken: 2n,
        acquiredAt: secondsAfter(scheduledAt, 300),
        expiresAt: secondsAfter(scheduledAt, 360),
      },
    ],
    outboxEvents: [
      {
        tenantId,
        id: ids.eventSent,
        aggregateType: 'outbound_intent',
        aggregateId: ids.intent,
        eventType: 'outbound_intent.sent',
        payload: { outboundIntentId: ids.intent, attemptNumber: 2 },
        occurredAt: sentAt,
        publishedAt: secondsAfter(sentAt, 1),
        publishAttempts: 1,
      },
      {
        tenantId,
        id: ids.eventStopped,
        aggregateType: 'campaign_lead',
        aggregateId: ids.leadShared,
        eventType: 'campaign_lead.stopped',
        payload: { campaignLeadId: ids.leadShared, reason: 'REPLIED' },
        occurredAt: secondsAfter(replyAt, 5),
      },
    ],
    inboundEvents: [
      inboundEvent({
        tenantId,
        id: ids.inboundEvent,
        provider,
        eventKey: 'fake-notification-0001',
        eventType: 'mailbox.changed',
        emailAccountId: ids.emailAccount,
        payload: { mailbox: mailbox.email, position: syncPosition },
        status: 'PROCESSED',
        attempts: 1,
        receivedAt: secondsAfter(replyAt, 1),
        processedAt: secondsAfter(replyAt, 4),
      }),
    ],
    integrationSyncCursors: [
      {
        tenantId,
        id: ids.syncCursor,
        provider,
        resource: alpha ? 'gmail.history' : 'graph.messages_delta',
        scopeKey: ids.emailAccount,
        emailAccountId: ids.emailAccount,
        cursor: syncPosition,
        lastSyncedAt: secondsAfter(replyAt, 4),
      },
    ],
  };
}

/**
 * Billing history: the tenant started on Starter, cancelled, and subscribed to a bigger plan;
 * the first payment of the new subscription failed and the retry succeeded. Usage in the
 * current period: a research run (reserved, committed, partly credited back), a released and
 * an expired hold; last period's send. Plus an override, branding, audit records (a member, a
 * worker and a platform admin) and two notifications. Both tenants share the same structure
 * and dates, so their rows differ only in tenant and values.
 */
function buildBilling(
  key: FixtureKey,
  ids: FixtureIds,
): FixtureBilling & {
  readonly inboundEvents: Prisma.InboundEventCreateManyInput[];
} {
  const tenantId = ids.tenant;
  const alpha = key === 'alpha';
  const plan = alpha ? FIXTURE_PLANS.growth : FIXTURE_PLANS.dedicated;
  const previousPeriodStart = new Date('2026-09-15T00:00:00Z');
  const periodStart = new Date('2026-10-15T00:00:00Z');
  const periodEnd = new Date(
    alpha ? '2026-11-15T00:00:00Z' : '2027-10-15T00:00:00Z',
  );
  const failedAt = secondsAfter(periodStart, 30);
  const paidAt = new Date('2026-10-16T08:59:50Z');
  const researchAt = new Date('2026-10-16T10:00:00Z');
  const adminUser = alpha ? FIXTURE_USERS.alphaAdmin : FIXTURE_USERS.betaAdmin;
  const stripeEvent = (
    id: string,
    eventKey: string,
    eventType: string,
    receivedAt: Date,
  ) =>
    inboundEvent({
      tenantId,
      id,
      provider: 'STRIPE',
      eventKey,
      eventType,
      payload: { id: eventKey, type: eventType, object: 'fake_in_0001' },
      status: 'PROCESSED',
      attempts: 1,
      receivedAt,
      processedAt: secondsAfter(receivedAt, 2),
    });

  return {
    subscriptions: [
      {
        tenantId,
        id: ids.subscriptionPrevious,
        planId: FIXTURE_PLANS.starter.id,
        provider: 'STRIPE',
        status: 'CANCELED',
        externalCustomerId: `fake_cus_${key}`,
        externalSubscriptionId: `fake_sub_${key}_1`,
        currentPeriodStart: previousPeriodStart,
        currentPeriodEnd: periodStart,
        canceledAt: new Date('2026-10-10T16:00:00Z'),
        endedAt: periodStart,
        lastSyncedAt: secondsAfter(periodStart, 5),
        createdAt: previousPeriodStart,
      },
      {
        tenantId,
        id: ids.subscription,
        planId: plan.id,
        provider: 'STRIPE',
        status: 'ACTIVE',
        externalCustomerId: `fake_cus_${key}`,
        externalSubscriptionId: `fake_sub_${key}_2`,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        lastSyncedAt: secondsAfter(paidAt, 15),
        createdAt: periodStart,
      },
    ],
    inboundEvents: [
      stripeEvent(
        ids.inboundEventPaymentFailed,
        'fake_evt_0001',
        'invoice.payment_failed',
        secondsAfter(failedAt, 1),
      ),
      stripeEvent(
        ids.inboundEventPaymentSucceeded,
        'fake_evt_0002',
        'invoice.paid',
        secondsAfter(paidAt, 1),
      ),
    ],
    paymentEvents: [
      {
        tenantId,
        id: ids.paymentFailed,
        provider: 'STRIPE',
        externalEventId: 'fake_evt_0001',
        kind: 'PAYMENT_FAILED',
        subscriptionId: ids.subscription,
        inboundEventId: ids.inboundEventPaymentFailed,
        externalObjectId: 'fake_in_0001',
        amountMinor: plan.amountMinor,
        currency: plan.currency,
        failureCode: 'card_declined',
        occurredAt: failedAt,
        recordedAt: secondsAfter(failedAt, 3),
      },
      {
        tenantId,
        id: ids.paymentSucceeded,
        provider: 'STRIPE',
        externalEventId: 'fake_evt_0002',
        kind: 'PAYMENT_SUCCEEDED',
        subscriptionId: ids.subscription,
        inboundEventId: ids.inboundEventPaymentSucceeded,
        externalObjectId: 'fake_in_0001',
        amountMinor: plan.amountMinor,
        currency: plan.currency,
        occurredAt: paidAt,
        recordedAt: secondsAfter(paidAt, 3),
      },
    ],
    limitOverrides: [
      alpha
        ? {
            tenantId,
            id: ids.limitOverride,
            metric: 'EMAILS_SENT',
            quantityPerPeriod: 15_000n,
            reason: 'Pilot: raised sending allowance (fixture).',
          }
        : {
            tenantId,
            id: ids.limitOverride,
            metric: 'AI_TOKENS',
            quantityPerPeriod: 80_000_000n,
            reason: 'Contracted allowance (fixture).',
          },
    ],
    usageReservations: [
      {
        tenantId,
        id: ids.reservationCommitted,
        metric: 'AI_TOKENS',
        quantity: 4_000n,
        periodStart,
        status: 'COMMITTED',
        idempotencyKey: `research:${ids.research}`,
        purpose: 'research.run',
        createdAt: researchAt,
        expiresAt: secondsAfter(researchAt, 900),
        committedQuantity: 1_380n,
        settledAt: secondsAfter(researchAt, 30),
      },
      {
        tenantId,
        id: ids.reservationReleased,
        metric: 'LEAD_ENRICHMENTS',
        quantity: 1n,
        periodStart,
        status: 'RELEASED',
        idempotencyKey: 'enrichment:fixture-0001',
        purpose: 'enrichment.run',
        createdAt: secondsAfter(researchAt, 60),
        expiresAt: secondsAfter(researchAt, 960),
        settledAt: secondsAfter(researchAt, 65),
      },
      {
        tenantId,
        id: ids.reservationExpired,
        metric: 'EMAIL_VERIFICATIONS',
        quantity: 25n,
        periodStart,
        status: 'EXPIRED',
        idempotencyKey: 'verification-batch:fixture-0001',
        purpose: 'verification.batch',
        createdAt: secondsAfter(researchAt, 120),
        expiresAt: secondsAfter(researchAt, 1020),
        settledAt: secondsAfter(researchAt, 1080),
      },
    ],
    usageLedgerEntries: [
      {
        tenantId,
        id: ids.ledgerReserved,
        metric: 'AI_TOKENS',
        periodStart,
        kind: 'USAGE',
        quantity: 1_380n,
        reservationId: ids.reservationCommitted,
        idempotencyKey: `reservation:${ids.reservationCommitted}`,
        occurredAt: secondsAfter(researchAt, 30),
      },
      {
        tenantId,
        id: ids.ledgerSend,
        metric: 'EMAILS_SENT',
        // The fixture send (2026-10-06) counts in the previous period.
        periodStart: previousPeriodStart,
        kind: 'USAGE',
        quantity: 1n,
        idempotencyKey: `outbound_intent:${ids.intent}`,
        occurredAt: new Date(
          alpha ? '2026-10-06T13:35:02Z' : '2026-10-06T08:35:02Z',
        ),
      },
      {
        tenantId,
        id: ids.ledgerAdjustment,
        metric: 'AI_TOKENS',
        periodStart,
        kind: 'ADJUSTMENT',
        quantity: -380n,
        idempotencyKey: 'adjustment:fixture-0001',
        note: 'Credit for a research run that returned no result (fixture).',
        occurredAt: new Date('2026-10-17T09:00:00Z'),
      },
    ],
    branding: [
      {
        tenantId,
        displayName: alpha ? 'Alpha Outreach' : 'Beta Dental Partners',
        logoUrl: `https://fixture-${key}.test/logo.png`,
        primaryColor: alpha ? '#1F6FEB' : '#0E7C66',
        accentColor: alpha ? '#F78166' : '#F2C94C',
        emailFooter: `${alpha ? 'Alpha Outreach' : 'Beta Dental Partners'} (fixture footer text)`,
        supportEmail: normalizeEmail(`Support@Fixture-${key}.test`).email,
      },
    ],
    auditRecords: [
      {
        tenantId,
        id: ids.auditApproval,
        actorType: 'MEMBER',
        actorUserId: adminUser.id,
        actorMembershipId: ids.membershipAdmin,
        action: 'approval.decided',
        targetType: 'approval',
        targetId: ids.approvalApproved,
        metadata: { decision: 'APPROVED' },
        occurredAt: new Date('2026-10-05T13:40:00Z'),
      },
      {
        tenantId,
        id: ids.auditSync,
        actorType: 'SYSTEM',
        actorName: 'billing_sync',
        action: 'subscription.synced',
        targetType: 'subscription',
        targetId: ids.subscription,
        metadata: { status: 'ACTIVE' },
        occurredAt: secondsAfter(paidAt, 15),
      },
      {
        tenantId,
        id: ids.auditAdminAccess,
        actorType: 'PLATFORM_ADMIN',
        actorUserId: FIXTURE_USERS.platformAdmin.id,
        action: 'platform_admin.access_opened',
        reason: 'Support request FIX-0001: a campaign stopped (fixture).',
        requestId: 'fixture-request-0001',
        occurredAt: new Date('2026-10-18T12:00:00Z'),
      },
    ],
    notifications: [
      {
        tenantId,
        id: ids.notificationApproval,
        recipientMembershipId: ids.membershipAdmin,
        type: 'draft.awaiting_approval',
        title: 'A draft is waiting for your approval',
        body: 'Step 1 of "Q4 outreach" for one lead (fixture).',
        linkPath: `/campaigns/${ids.campaign}/approvals`,
        dedupeKey: `draft:${ids.draftOwnV1}`,
        createdAt: new Date('2026-10-07T12:00:05Z'),
      },
      {
        tenantId,
        id: ids.notificationPayment,
        recipientMembershipId: ids.membershipAdmin,
        type: 'billing.payment_failed',
        title: 'A payment failed',
        body: 'The card was declined; it will be retried (fixture).',
        linkPath: '/settings/billing',
        dedupeKey: `payment_event:${ids.paymentFailed}`,
        createdAt: secondsAfter(failedAt, 10),
        readAt: new Date('2026-10-15T08:00:00Z'),
      },
    ],
  };
}

function buildTenant(key: FixtureKey): FixtureTenant {
  const ids = fixtureIds(key);
  const tenantId = ids.tenant;
  const alpha = key === 'alpha';
  const ownOrgName = alpha ? 'Alpha Only Analytics' : 'Beta Only Dental';
  const ownWebsite = alpha
    ? 'https://alpha-only.test'
    : 'http://WWW.Beta-Only.test/';
  const ownContact = alpha
    ? {
        firstName: 'Jordan',
        lastName: 'Lee',
        rawEmail: 'Jordan.Lee@Alpha-Only.test',
      }
    : {
        firstName: 'Sam',
        lastName: 'Patel',
        rawEmail: 'sam.patel@beta-only.test',
      };
  const sharedRaw = 'Alex.Rivera@Shared-Prospect.TEST';
  const outreach = buildOutreach(key, ids, {
    sharedRaw,
    ownFirstName: ownContact.firstName,
    ownOrgName,
  });
  const billing = buildBilling(key, ids);

  const contacts: WithId<Prisma.ContactCreateManyInput>[] = [
    {
      tenantId,
      id: ids.contactShared,
      organizationId: ids.orgShared,
      firstName: 'Alex',
      lastName: 'Rivera',
      title: alpha ? 'VP Sales' : 'Practice Manager',
      ...contactIdentity(sharedRaw),
      countryCode: alpha ? 'US' : 'GB',
    },
    {
      tenantId,
      id: ids.contactOwn,
      organizationId: ids.orgOwn,
      firstName: ownContact.firstName,
      lastName: ownContact.lastName,
      title: alpha ? 'Head of Revenue' : 'Owner',
      ...contactIdentity(ownContact.rawEmail),
    },
    {
      tenantId,
      id: ids.contactNoEmail,
      firstName: 'Riley',
      lastName: 'Chen',
      title: 'Operations Lead',
      linkedinUrl: `https://social.example.test/in/riley-chen-${key}`,
    },
  ];

  const csvRow = (n: 1 | 2, contactId: string, raw: string) =>
    sourceRecord({
      tenantId,
      id: n === 1 ? ids.sourceCsvRow1 : ids.sourceCsvRow2,
      provider: 'CSV_IMPORT',
      importId: ids.import,
      importRowNumber: n,
      contactId,
      payload: { row: n, email: raw, source_file: 'fixture-contacts.csv' },
    });

  return {
    key,
    tenant: {
      id: tenantId,
      slug: `fixture-${key}`,
      name: alpha ? 'Fixture Tenant Alpha' : 'Fixture Tenant Beta',
      deploymentMode: alpha ? 'HOSTED' : 'DEDICATED',
    },
    settings: { tenantId, timezone: alpha ? 'UTC' : 'Europe/London' },
    roles: [
      {
        tenantId,
        id: ids.roleAdmin,
        key: 'client_admin',
        name: 'Client Admin',
        isSystem: true,
      },
      {
        tenantId,
        id: ids.roleMember,
        key: 'client_member',
        name: 'Client Team Member',
        isSystem: true,
      },
    ],
    rolePermissions: [
      ...FIXTURE_PERMISSIONS.map((p) => ({
        tenantId,
        roleId: ids.roleAdmin,
        permissionKey: p.key,
      })),
      ...MEMBER_PERMISSIONS.map((permissionKey) => ({
        tenantId,
        roleId: ids.roleMember,
        permissionKey,
      })),
    ],
    memberships: [
      {
        tenantId,
        id: ids.membershipAdmin,
        userId: alpha
          ? FIXTURE_USERS.alphaAdmin.id
          : FIXTURE_USERS.betaAdmin.id,
        roleId: ids.roleAdmin,
        status: 'ACTIVE',
      },
      {
        tenantId,
        id: ids.membershipShared,
        userId: FIXTURE_USERS.sharedMember.id,
        roleId: ids.roleMember,
        status: alpha ? 'ACTIVE' : 'INVITED',
      },
    ],
    icps: [
      {
        tenantId,
        id: ids.icp,
        name: alpha
          ? 'Mid-market SaaS revenue leaders'
          : 'Independent dental clinics',
        description: alpha
          ? 'Revenue leaders at B2B software companies with 50-500 employees.'
          : 'Owners and practice managers of independent dental clinics.',
        criteria: alpha
          ? {
              industries: ['software'],
              employees: { min: 50, max: 500 },
              titles: ['VP Sales', 'Head of Revenue'],
            }
          : {
              industries: ['dental'],
              employees: { min: 5, max: 50 },
              titles: ['Owner', 'Practice Manager'],
            },
        status: 'ACTIVE',
      },
    ],
    organizations: [
      {
        tenantId,
        id: ids.orgShared,
        name: 'Shared Prospect Co',
        websiteUrl: 'https://www.Shared-Prospect.test/',
        normalizedDomain: normalizeDomain('https://www.Shared-Prospect.test/'),
        industry: alpha ? 'software' : 'dental',
        employeeCount: alpha ? 120 : 18,
        countryCode: alpha ? 'US' : 'GB',
      },
      {
        tenantId,
        id: ids.orgOwn,
        name: ownOrgName,
        websiteUrl: ownWebsite,
        normalizedDomain: normalizeDomain(ownWebsite),
      },
    ],
    contacts,
    leadLists: [
      { tenantId, id: ids.leadList, name: 'Q4 pipeline', icpId: ids.icp },
    ],
    leadListMembers: contacts.map((c) => ({
      tenantId,
      leadListId: ids.leadList,
      contactId: c.id,
    })),
    imports: [
      {
        tenantId,
        id: ids.import,
        source: 'CSV',
        status: 'COMPLETED',
        fileName: 'fixture-contacts.csv',
        leadListId: ids.leadList,
        totalRows: 2,
        importedRows: 2,
        startedAt: new Date('2026-10-01T09:00:00Z'),
        completedAt: new Date('2026-10-01T09:00:05Z'),
      },
    ],
    sourceRecords: [
      csvRow(1, ids.contactShared, sharedRaw),
      csvRow(2, ids.contactOwn, ownContact.rawEmail),
      sourceRecord({
        tenantId,
        id: ids.sourceApollo,
        provider: 'APOLLO',
        externalId: 'apollo-person-0001',
        contactId: ids.contactShared,
        organizationId: ids.orgShared,
        payload: {
          id: 'apollo-person-0001',
          title: 'VP Sales',
          organization: 'Shared Prospect Co',
        },
      }),
    ],
    research: [
      {
        tenantId,
        id: ids.research,
        contactId: ids.contactShared,
        organizationId: ids.orgShared,
        icpId: ids.icp,
        status: 'COMPLETED',
        summary: 'Fixture research summary (fake data).',
        findings: {
          fit: alpha ? 'strong' : 'moderate',
          signals: ['hiring', 'new location'],
        },
        model: 'fake-model',
        promptVersion: 'research-v0',
        inputTokens: 1200,
        outputTokens: 180,
        startedAt: new Date('2026-10-02T10:00:00Z'),
        completedAt: new Date('2026-10-02T10:00:30Z'),
      },
    ],
    evidence: [
      {
        tenantId,
        id: ids.evidence,
        kind: 'WEBSITE_EXCERPT',
        contactId: ids.contactShared,
        organizationId: ids.orgShared,
        researchId: ids.research,
        sourceRecordId: ids.sourceApollo,
        sourceUrl: 'https://shared-prospect.test/careers',
        excerpt: 'We are hiring two account executives (fixture text).',
      },
    ],
    scores: [
      {
        tenantId,
        id: ids.score,
        icpId: ids.icp,
        contactId: ids.contactShared,
        researchId: ids.research,
        value: alpha ? 82 : 64,
        reason: alpha
          ? 'VP Sales at a 120-person software company that is hiring sales staff.'
          : 'Practice manager at an 18-person clinic; partial fit on size.',
        method: alpha ? 'AI' : 'RULES',
        methodVersion: 'fixture-v1',
      },
      {
        tenantId,
        id: ids.scoreOrg,
        icpId: ids.icp,
        // Scored from organization data alone (no research): deleting the shared contact
        // cascades its research, which a score must not still reference.
        organizationId: ids.orgShared,
        value: alpha ? 78 : 58,
        reason: alpha
          ? 'B2B software company with 120 employees, inside the ICP range.'
          : 'Independent clinic with 18 staff, inside the ICP range.',
        method: 'RULES',
        methodVersion: 'fixture-v1',
      },
    ],
    verifications: [
      {
        tenantId,
        id: ids.verification,
        contactId: ids.contactShared,
        normalizedEmail: normalizeEmail(sharedRaw).email,
        provider: 'fake',
        status: alpha ? 'VALID' : 'RISKY',
        checkedAt: new Date('2026-10-03T08:00:00Z'),
        expiresAt: new Date('2027-01-01T00:00:00Z'),
      },
    ],
    ...outreach,
    ...billing,
    inboundEvents: [...outreach.inboundEvents, ...billing.inboundEvents],
  };
}

export const FIXTURE_TENANTS: readonly FixtureTenant[] = [
  buildTenant('alpha'),
  buildTenant('beta'),
];
