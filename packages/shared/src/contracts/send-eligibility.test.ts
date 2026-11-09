import { describe, expect, it } from 'vitest';
import {
  evaluateSendEligibility,
  leadSendDecision,
  SEND_ELIGIBILITY_CHECKS,
  SEND_ELIGIBILITY_RULES,
  sendEligibilityResultSchema,
  sendPolicySchema,
  updateSendPolicyRequestSchema,
  type LeadFit,
  type SendEligibilityFacts,
  type SendEligibilityResult,
  type SendPolicy,
} from './send-eligibility.js';

const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const AS_OF = '2026-11-07T12:00:00.000Z';
const DAY = 24 * 60 * 60 * 1000;
const daysBefore = (days: number) =>
  new Date(Date.parse(AS_OF) - days * DAY).toISOString();

const POLICY: SendPolicy = {
  regions: {
    countries: { US: 'ALLOW', GB: 'REVIEW', RU: 'BLOCK' },
    otherCountries: 'REVIEW',
  },
  sources: {
    APOLLO: 'ALLOW',
    CSV_IMPORT: 'ALLOW',
    MANUAL: 'REVIEW',
    FAKE: 'BLOCK',
  },
};

const ADDRESS = 'alex@prospect.test';

/** An eligible lead: a running campaign, a fresh check, an allowed source and country. */
function facts(
  change: Partial<SendEligibilityFacts> = {},
): SendEligibilityFacts {
  return {
    asOf: AS_OF,
    workspace: {
      outboundSendingEnabled: true,
      planEntitled: true,
      emailsPerPeriod: 1000,
      policy: POLICY,
    },
    campaign: {
      id: id(1),
      status: 'ACTIVE',
      exclusions: {
        domains: [],
        emails: [],
        leadListIds: [],
        skipContactsInOtherCampaigns: true,
      },
      sender: { status: 'ACTIVE', hasCredentials: true },
    },
    contact: {
      id: id(2),
      status: 'ACTIVE',
      email: ADDRESS,
      countryCode: 'US',
      organization: { domain: 'prospect.test', countryCode: 'US' },
    },
    emailCheck: {
      address: ADDRESS,
      status: 'verified',
      reason: null,
      provider: 'FAKE',
      checkedAt: daysBefore(5),
    },
    suppressions: { emails: [], domains: [] },
    leadListIds: [],
    otherCampaignEnrollments: 0,
    sources: ['APOLLO'],
    ...change,
  };
}

const base = facts();
const withContact = (contact: Partial<SendEligibilityFacts['contact']>) =>
  facts({ contact: { ...base.contact, ...contact } });
const withCampaign = (campaign: Partial<SendEligibilityFacts['campaign']>) =>
  facts({ campaign: { ...base.campaign, ...campaign } });
const withWorkspace = (workspace: Partial<SendEligibilityFacts['workspace']>) =>
  facts({ workspace: { ...base.workspace, ...workspace } });
const withCheck = (check: Record<string, unknown> | null) =>
  facts({
    emailCheck:
      check === null ? null : { ...(base.emailCheck as object), ...check },
  });
const withPolicy = (policy: SendPolicy | null) => withWorkspace({ policy });

/** Every reason, as [check, code, status]. */
const reasonsOf = (result: SendEligibilityResult) =>
  result.checks.flatMap((check) =>
    check.reasons.map((reason) => [check.key, reason.code, reason.status]),
  );

const FIT: LeadFit = {
  scoreId: id(9),
  version: 3,
  value: 100,
  band: 'HIGH_PRIORITY',
  scoredAt: daysBefore(1),
};

describe('evaluateSendEligibility (task 10B)', () => {
  it('passes every check for an eligible lead, in a fixed order', () => {
    const result = evaluateSendEligibility(base);
    expect(result.status).toBe('eligible');
    expect(result.rules).toBe(SEND_ELIGIBILITY_RULES);
    expect(result.evaluatedAt).toBe(AS_OF);
    expect(result.checks.map((check) => [check.key, check.status])).toEqual(
      SEND_ELIGIBILITY_CHECKS.map((check) => [check.key, 'pass']),
    );
    expect(sendEligibilityResultSchema.parse(result)).toEqual(result);
    // No score is needed to be eligible.
    expect(leadSendDecision(null, result)).toMatchObject({
      sendPermitted: true,
      needsPerson: false,
    });
  });

  it('still refuses a lead with a score of 100 that is suppressed, invalid, restricted or policy-unknown', () => {
    const cases: [string, SendEligibilityFacts, string, string[]][] = [
      [
        'suppressed',
        facts({ suppressions: { emails: [ADDRESS], domains: [] } }),
        'blocked',
        ['suppressed_email'],
      ],
      [
        'invalid',
        withCheck({ status: 'invalid' }),
        'blocked',
        ['email_invalid'],
      ],
      [
        'restricted region',
        withContact({ countryCode: 'RU' }),
        'blocked',
        ['region_blocked'],
      ],
      [
        'restricted source',
        facts({ sources: ['FAKE'] }),
        'blocked',
        ['source_blocked'],
      ],
      [
        'policy unknown',
        withPolicy(null),
        'review',
        ['source_policy_unknown', 'region_policy_unknown'],
      ],
    ];
    for (const [label, lead, status, codes] of cases) {
      const eligibility = evaluateSendEligibility(lead);
      const decision = leadSendDecision(FIT, eligibility);
      expect(eligibility.status, label).toBe(status);
      expect(
        reasonsOf(eligibility).map(([, code]) => code),
        label,
      ).toEqual(codes);
      expect(decision.sendPermitted, label).toBe(false);
      // The fit is reported unchanged next to the refusal.
      expect(decision.fit, label).toEqual(FIT);
    }
  });

  it('cannot be given a score at all', () => {
    expect(() =>
      evaluateSendEligibility({
        ...base,
        fit: FIT,
      } as unknown as SendEligibilityFacts),
    ).toThrow();
    expect(() =>
      evaluateSendEligibility({
        ...base,
        score: 100,
      } as unknown as SendEligibilityFacts),
    ).toThrow();
  });

  it('never treats an address that was not checked, or not checked recently, as permission', () => {
    const cases: [SendEligibilityFacts, string, string][] = [
      [withCheck(null), 'email_not_verified', 'blocked'],
      [
        withCheck({ address: 'someone.else@prospect.test' }),
        'email_not_verified',
        'blocked',
      ],
      [
        withCheck({ checkedAt: daysBefore(-1) }),
        'email_not_verified',
        'blocked',
      ],
      [withCheck({ verified: true }), 'email_not_verified', 'blocked'],
      [
        withCheck({ checkedAt: daysBefore(31) }),
        'verification_stale',
        'review',
      ],
      [
        withCheck({ status: 'risky', reason: 'catch_all' }),
        'email_risky',
        'review',
      ],
      [withCheck({ status: 'unknown' }), 'email_unknown', 'review'],
      [withContact({ email: null }), 'no_email', 'blocked'],
    ];
    for (const [lead, code, status] of cases) {
      expect(reasonsOf(evaluateSendEligibility(lead)), code).toEqual([
        ['verification', code, status],
      ]);
    }
    // 30 days is still recent.
    expect(
      evaluateSendEligibility(withCheck({ checkedAt: daysBefore(30) })).status,
    ).toBe('eligible');
  });

  it('allows a source only when the policy names it ALLOW', () => {
    const cases: [SendEligibilityFacts, string[][]][] = [
      [facts({ sources: [] }), [['source', 'source_unknown', 'review']]],
      [
        facts({ sources: ['WEBSITE'] }),
        [['source', 'source_policy_unknown', 'review']],
      ],
      [facts({ sources: ['MANUAL'] }), [['source', 'source_review', 'review']]],
      // The strictest source counts: one blocked source blocks.
      [
        facts({ sources: ['APOLLO', 'FAKE', 'MANUAL'] }),
        [
          ['source', 'source_blocked', 'blocked'],
          ['source', 'source_review', 'review'],
        ],
      ],
      [facts({ sources: ['APOLLO', 'CSV_IMPORT'] }), []],
    ];
    for (const [lead, reasons] of cases) {
      expect(reasonsOf(evaluateSendEligibility(lead))).toEqual(reasons);
    }
  });

  it("decides the region by the person's own country, never by the company's", () => {
    const blockOthers = (contact: Partial<SendEligibilityFacts['contact']>) =>
      facts({
        workspace: {
          ...base.workspace,
          policy: {
            ...POLICY,
            regions: { ...POLICY.regions, otherCountries: 'BLOCK' },
          },
        },
        contact: { ...base.contact, ...contact },
      });
    const cases: [SendEligibilityFacts, string[][]][] = [
      // The company is in an allowed country, but the person's country isn't known.
      [
        withContact({ countryCode: null }),
        [['region', 'country_unknown', 'review']],
      ],
      [
        blockOthers({ countryCode: null }),
        [['region', 'country_unknown', 'blocked']],
      ],
      [
        withContact({ countryCode: 'DE' }),
        [['region', 'region_not_listed', 'review']],
      ],
      [
        blockOthers({ countryCode: 'DE' }),
        [['region', 'region_not_listed', 'blocked']],
      ],
      [
        withContact({ countryCode: 'GB' }),
        [['region', 'region_review', 'review']],
      ],
      [
        withContact({
          organization: { domain: 'prospect.test', countryCode: 'RU' },
        }),
        [['region', 'company_region_blocked', 'blocked']],
      ],
    ];
    for (const [lead, reasons] of cases) {
      expect(reasonsOf(evaluateSendEligibility(lead))).toEqual(reasons);
    }
  });

  it('checks the campaign, its mailbox and the workspace before anything is sent', () => {
    const cases: [SendEligibilityFacts, string][] = [
      [withCampaign({ status: 'DRAFT' }), 'campaign_not_active'],
      [withCampaign({ status: 'PAUSED' }), 'campaign_not_active'],
      [withCampaign({ sender: null }), 'sender_missing'],
      [
        withCampaign({ sender: { status: 'PAUSED', hasCredentials: true } }),
        'sender_not_ready',
      ],
      [
        withCampaign({ sender: { status: 'ACTIVE', hasCredentials: false } }),
        'sender_not_ready',
      ],
      [withWorkspace({ outboundSendingEnabled: false }), 'sending_disabled'],
      [
        withWorkspace({ planEntitled: false, emailsPerPeriod: 0 }),
        'no_entitled_plan',
      ],
      [withWorkspace({ emailsPerPeriod: 0 }), 'plan_excludes_email'],
      [withContact({ status: 'ARCHIVED' }), 'contact_archived'],
    ];
    for (const [lead, code] of cases) {
      const result = evaluateSendEligibility(lead);
      expect(result.status, code).toBe('blocked');
      expect(
        reasonsOf(result).map(([, reason]) => reason),
        code,
      ).toEqual([code]);
    }
    expect(
      evaluateSendEligibility(withCampaign({ status: 'DRAFT' })).checks[1]
        ?.reasons[0]?.message,
    ).toBe("The campaign isn't running (it is draft).");
  });

  it("applies the do-not-contact list and the campaign's exclusions to the address and both domains", () => {
    const exclusions = base.campaign.exclusions;
    const cases: [SendEligibilityFacts, string[]][] = [
      [
        facts({ suppressions: { emails: [], domains: ['prospect.test'] } }),
        ['suppressed_domain'],
      ],
      [
        withContact({
          email: 'alex@mail.example.test',
          organization: { domain: 'prospect.test', countryCode: 'US' },
        }),
        // The check is of the old address now: the new one isn't checked.
        ['email_not_verified'],
      ],
      [
        withCampaign({ exclusions: { ...exclusions, emails: [ADDRESS] } }),
        ['excluded_email'],
      ],
      [
        withCampaign({
          exclusions: { ...exclusions, domains: ['prospect.test'] },
        }),
        ['excluded_domain'],
      ],
      [
        facts({
          leadListIds: [id(30)],
          campaign: {
            ...base.campaign,
            exclusions: { ...exclusions, leadListIds: [id(30)] },
          },
        }),
        ['excluded_lead_list'],
      ],
      [facts({ otherCampaignEnrollments: 1 }), ['in_other_campaign']],
      [
        facts({
          otherCampaignEnrollments: 1,
          campaign: {
            ...base.campaign,
            exclusions: { ...exclusions, skipContactsInOtherCampaigns: false },
          },
        }),
        [],
      ],
    ];
    for (const [lead, codes] of cases) {
      expect(
        reasonsOf(evaluateSendEligibility(lead)).map(([, code]) => code),
      ).toEqual(codes);
    }
    // A company domain on the list blocks people with an address elsewhere too.
    const elsewhere = facts({
      contact: { ...base.contact, email: 'alex@mail.example.test' },
      emailCheck: {
        ...(base.emailCheck as object),
        address: 'alex@mail.example.test',
      },
      suppressions: { emails: [], domains: ['prospect.test'] },
    });
    expect(reasonsOf(evaluateSendEligibility(elsewhere))).toEqual([
      ['suppression', 'suppressed_domain', 'blocked'],
    ]);
  });

  it('marks every block as not overridable, and lets a block win over a review', () => {
    const result = evaluateSendEligibility(
      facts({
        suppressions: { emails: [ADDRESS], domains: [] },
        emailCheck: {
          ...(base.emailCheck as object),
          checkedAt: daysBefore(40),
        },
        sources: ['MANUAL'],
      }),
    );
    expect(result.status).toBe('blocked');
    const reasons = result.checks.flatMap((check) => check.reasons);
    expect(reasons.map((reason) => [reason.code, reason.overridable])).toEqual([
      ['suppressed_email', false],
      ['verification_stale', true],
      ['source_review', true],
    ]);
    expect(leadSendDecision(FIT, result)).toMatchObject({
      sendPermitted: false,
      needsPerson: false,
    });
    const reviewOnly = evaluateSendEligibility(facts({ sources: ['MANUAL'] }));
    expect(leadSendDecision(FIT, reviewOnly)).toMatchObject({
      sendPermitted: false,
      needsPerson: true,
    });
  });

  it('is deterministic and refuses facts out of shape', () => {
    expect(evaluateSendEligibility(base)).toEqual(
      evaluateSendEligibility(base),
    );
    expect(() =>
      evaluateSendEligibility(withContact({ countryCode: 'usa' })),
    ).toThrow();
    expect(() =>
      evaluateSendEligibility(facts({ sources: ['LINKEDIN' as 'APOLLO'] })),
    ).toThrow();
  });
});

describe('send policy (task 10B)', () => {
  const issues = (value: unknown) => {
    const parsed = sendPolicySchema.safeParse(value);
    expect(parsed.success).toBe(false);
    return parsed.success
      ? []
      : parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        }));
  };

  it('accepts countries and sources with ALLOW, REVIEW or BLOCK', () => {
    expect(sendPolicySchema.parse(POLICY)).toEqual(POLICY);
    expect(
      sendPolicySchema.parse({
        regions: { countries: {}, otherCountries: 'BLOCK' },
        sources: {},
      }),
    ).toBeDefined();
  });

  it('never allows unnamed countries, and refuses anything out of shape', () => {
    expect(
      issues({
        ...POLICY,
        regions: { ...POLICY.regions, otherCountries: 'ALLOW' },
      }),
    ).toEqual([
      { path: 'regions.otherCountries', message: 'Choose REVIEW or BLOCK.' },
    ]);
    expect(
      issues({
        ...POLICY,
        regions: { ...POLICY.regions, countries: { us: 'ALLOW' } },
      }),
    ).toContainEqual({
      path: 'regions.countries.us',
      message: 'Use two-letter country codes in capitals, such as US.',
    });
    expect(
      issues({
        ...POLICY,
        regions: { ...POLICY.regions, countries: { US: 'YES' } },
      }),
    ).toEqual([
      {
        path: 'regions.countries.US',
        message: 'Choose ALLOW, REVIEW or BLOCK.',
      },
    ]);
    expect(issues({ ...POLICY, sources: { LINKEDIN: 'ALLOW' } })).toEqual([
      {
        path: 'sources',
        message:
          'Lead Fennec knows these sources only: APOLLO, CSV_IMPORT, MANUAL, WEBSITE, FAKE.',
      },
    ]);
    expect(issues({ ...POLICY, defaultAction: 'ALLOW' })).toEqual([
      {
        path: '',
        message: `Lead Fennec doesn't recognize the setting "defaultAction".`,
      },
    ]);
    const many = Object.fromEntries(
      Array.from({ length: 26 * 10 }, (_, i) => [
        String.fromCharCode(65 + Math.floor(i / 10)) +
          String.fromCharCode(65 + (i % 10)),
        'ALLOW',
      ]),
    );
    expect(
      issues({ ...POLICY, regions: { ...POLICY.regions, countries: many } }),
    ).toEqual([
      { path: 'regions.countries', message: 'Name at most 250 countries.' },
    ]);
  });

  it('saves name the version they started from, and may clear the policy', () => {
    expect(
      updateSendPolicyRequestSchema.parse({ version: 0, policy: null }),
    ).toEqual({
      version: 0,
      policy: null,
    });
    expect(
      updateSendPolicyRequestSchema.safeParse({ version: -1, policy: null })
        .success,
    ).toBe(false);
    expect(
      updateSendPolicyRequestSchema.safeParse({ policy: POLICY }).success,
    ).toBe(false);
  });
});
