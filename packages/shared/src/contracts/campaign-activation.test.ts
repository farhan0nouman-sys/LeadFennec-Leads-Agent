import { describe, expect, it } from 'vitest';
import {
  ACTIVATION_CHECKS,
  BUILT_SERVICES,
  evaluateActivation,
  type ActivationCheckKey,
  type ActivationFacts,
  type CampaignServices,
} from './campaign-activation.js';
import { API } from './endpoints.js';

const ID = (n: number) =>
  `0b7f4e2a-3c1d-4e5f-8a9b-${String(n).padStart(12, '0')}`;
const SUBJECT = { id: ID(1), version: 7, status: 'DRAFT' as const };
const ALL_BUILT: CampaignServices = {
  eligibility: true,
  drafting: true,
  sending: true,
};

/** A connected, healthy mailbox. */
const MAILBOX: NonNullable<ActivationFacts['mailbox']> = {
  status: 'ACTIVE',
  hasCredentials: true,
  dailySendLimit: 50,
  failingSyncs: 0,
};

/** Deterministic facts of a campaign where every check passes. */
function readyFacts(): ActivationFacts {
  return {
    campaign: {
      businessProfile: { companyName: 'Example Co', description: 'Examples.' },
      offer: { name: 'Audit', description: 'A free audit.' },
      audience: { icpId: ID(2), leadListId: ID(3), filters: {} },
      leadLimits: { dailyNewLeads: 20, maxLeads: 400 },
      sender: { emailAccountId: ID(4) },
      sequence: {
        steps: [
          { id: ID(5), position: 1, delayMinutes: 0, templateId: ID(6) },
          { id: ID(7), position: 2, delayMinutes: 4320, templateId: ID(6) },
        ],
      },
      timezone: 'Europe/Berlin',
      schedule: {
        weekdays: [1, 2, 3],
        windowStartMinute: 540,
        windowEndMinute: 1020,
      },
      approvalMode: 'HUMAN',
    },
    icp: { status: 'ACTIVE' },
    leadList: { status: 'ACTIVE', contactsWithEmail: 12 },
    mailbox: {
      status: 'ACTIVE',
      hasCredentials: true,
      dailySendLimit: 50,
      failingSyncs: 0,
    },
    templates: { [ID(6)]: 'ACTIVE' },
    approvers: 1,
    workspace: { requireSendApproval: true, outboundSendingEnabled: true },
    plan: { entitled: true, emailsPerPeriod: 5000 },
  };
}

/** The blocked checks and their reasons. */
const blocked = (facts: ActivationFacts, services = ALL_BUILT) =>
  Object.fromEntries(
    evaluateActivation(SUBJECT, facts, services)
      .checks.filter((check) => !check.passed)
      .map((check) => [check.key, check.reasons]),
  ) as Partial<Record<ActivationCheckKey, string[]>>;

const withCampaign = (
  change: Partial<ActivationFacts['campaign']>,
): ActivationFacts => {
  const facts = readyFacts();
  return { ...facts, campaign: { ...facts.campaign, ...change } };
};

describe('campaign activation checks (task 06C)', () => {
  it('passes every check for a complete campaign once the later services exist', () => {
    const report = evaluateActivation(SUBJECT, readyFacts(), ALL_BUILT);
    expect(report.ready).toBe(true);
    expect(report.checks.map((check) => check.key)).toEqual(
      ACTIVATION_CHECKS.map((check) => check.key),
    );
    expect(report.checks.every((check) => check.passed)).toBe(true);
    expect(report).toMatchObject({
      campaignId: ID(1),
      version: 7,
      status: 'DRAFT',
    });
  });

  it('fails closed while the later services are not built', () => {
    expect(BUILT_SERVICES).toEqual({
      eligibility: false,
      drafting: false,
      sending: false,
    });
    const report = evaluateActivation(SUBJECT, readyFacts(), BUILT_SERVICES);
    expect(report.ready).toBe(false);
    expect(blocked(readyFacts(), BUILT_SERVICES)).toEqual({
      eligibility_service: [
        "Checking each lead against the do-not-contact list and email verification isn't available yet.",
      ],
      drafting_service: [
        "Preparing each email from its template isn't available yet.",
      ],
      sending_service: [
        "Sending email through Gmail or Microsoft 365 isn't available yet.",
      ],
    });
  });

  it('names each blocker, and only that one', () => {
    const facts = readyFacts();
    const cases: readonly [
      string,
      ActivationFacts,
      Partial<Record<ActivationCheckKey, string[]>>,
    ][] = [
      [
        'no business profile',
        withCampaign({ businessProfile: null }),
        {
          business_profile: [
            'Add your company name.',
            'Describe what your company does.',
          ],
        },
      ],
      [
        'offer without description',
        withCampaign({ offer: { name: 'Audit' } }),
        { offer: ['Describe what the offer includes.'] },
      ],
      [
        'archived lead list',
        { ...facts, leadList: { status: 'ARCHIVED', contactsWithEmail: 3 } },
        { audience: ['The lead list is archived or no longer available.'] },
      ],
      [
        'a profile without a lead list',
        withCampaign({
          audience: { icpId: ID(2), leadListId: null, filters: {} },
        }),
        {
          eligibility: [
            "Finding leads from an ideal customer profile alone isn't available yet. Choose a lead list.",
          ],
        },
      ],
      [
        'a lead list without email addresses',
        { ...facts, leadList: { status: 'ACTIVE', contactsWithEmail: 0 } },
        { eligibility: ['Nobody on the lead list has an email address.'] },
      ],
      [
        'no limits',
        withCampaign({ leadLimits: { dailyNewLeads: null, maxLeads: null } }),
        {
          limits: [
            'Set how many new leads join per day.',
            'Set how many leads join in total.',
          ],
        },
      ],
      [
        'more new leads a day than the mailbox can send',
        withCampaign({ leadLimits: { dailyNewLeads: 60, maxLeads: 400 } }),
        {
          limits: [
            'The mailbox sends at most 50 emails a day. Lower the new leads per day to that or fewer.',
          ],
        },
      ],
      [
        'no mailbox',
        {
          ...withCampaign({ sender: { emailAccountId: null } }),
          mailbox: null,
        },
        { sender: ['Choose the mailbox the campaign sends from.'] },
      ],
      [
        'a mailbox waiting for authorization',
        {
          ...facts,
          mailbox: {
            ...MAILBOX,
            status: 'PENDING',
            hasCredentials: false,
          },
        },
        { sender: ["The mailbox hasn't been authorized yet."] },
      ],
      [
        'a mailbox that needs reconnecting and failed to sync',
        {
          ...facts,
          mailbox: { ...MAILBOX, status: 'ERROR', failingSyncs: 1 },
        },
        {
          sender: [
            'The mailbox needs reconnecting.',
            "The mailbox's last sync failed.",
          ],
        },
      ],
      [
        'steps without usable templates',
        {
          ...withCampaign({
            sequence: {
              steps: [
                { id: ID(5), position: 1, delayMinutes: 0, templateId: null },
                { id: ID(7), position: 2, delayMinutes: 60, templateId: ID(8) },
              ],
            },
          }),
        },
        {
          sequence: [
            'Step 1 has no template.',
            'The template of step 2 is archived or no longer available.',
          ],
        },
      ],
      [
        'no steps',
        withCampaign({ sequence: { steps: [] } }),
        { sequence: ['Add at least one step.'] },
      ],
      [
        'an invalid schedule',
        withCampaign({
          timezone: 'Mars/Olympus',
          schedule: {
            weekdays: [],
            windowStartMinute: 600,
            windowEndMinute: 600,
          },
        }),
        {
          schedule: [
            'Choose at least one day to send on.',
            'End the sending window after it starts.',
            'Choose a valid time zone.',
          ],
        },
      ],
      [
        'nobody can approve',
        { ...facts, approvers: 0 },
        {
          approval: [
            'Nobody in this workspace can approve emails. Give someone a role that can.',
          ],
        },
      ],
      [
        'automatic approval where the workspace requires a person',
        withCampaign({ approvalMode: 'AUTOMATIC' }),
        {
          approval: [
            "This workspace requires a person to approve every email, so automatic approval can't be used.",
          ],
        },
      ],
      [
        'no plan, sending turned off',
        {
          ...facts,
          plan: null,
          workspace: {
            requireSendApproval: true,
            outboundSendingEnabled: false,
          },
        },
        {
          workspace: [
            'This workspace has no active plan.',
            'Sending is turned off for this workspace.',
          ],
        },
      ],
      [
        'a plan without email',
        { ...facts, plan: { entitled: true, emailsPerPeriod: 0 } },
        { workspace: ["The workspace's plan doesn't include sending email."] },
      ],
    ];
    for (const [name, subject, expected] of cases) {
      expect(blocked(subject), name).toEqual(expected);
    }
    // Automatic approval is fine where the workspace allows it, even with nobody to approve.
    expect(
      blocked({
        ...withCampaign({ approvalMode: 'AUTOMATIC' }),
        approvers: 0,
        workspace: { requireSendApproval: false, outboundSendingEnabled: true },
      }),
    ).toEqual({});
  });

  it('is never ready for a campaign that is not a draft', () => {
    for (const status of [
      'ACTIVE',
      'PAUSED',
      'COMPLETED',
      'CANCELLED',
    ] as const) {
      expect(
        evaluateActivation({ ...SUBJECT, status }, readyFacts(), ALL_BUILT)
          .ready,
        status,
      ).toBe(false);
    }
  });

  it('starts only through its own endpoint, with the reviewed version', () => {
    expect(API.campaigns.activate).toMatchObject({
      method: 'POST',
      permission: 'campaigns.write',
    });
    expect(API.campaigns.activate.errors).toEqual([
      'version_conflict',
      'campaign_not_editable',
      'campaign_not_ready',
    ]);
    // Saving can't set a status (strict schema, see campaigns.test.ts) and makes readiness stale.
    expect(API.campaigns.update.invalidates).toContain('campaignReadiness');
  });
});
