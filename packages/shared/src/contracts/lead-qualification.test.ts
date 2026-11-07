import { describe, expect, it } from 'vitest';
import {
  classifyLead,
  contactDecision,
  leadEligibilityStatus,
  qualificationDecisionRequestSchema,
  qualificationModelOutputSchema,
  qualificationReasonsSchema,
  type QualificationFacts,
} from './lead-qualification.js';
import {
  evaluateSendEligibility,
  type SendEligibilityFacts,
} from './send-eligibility.js';

const id = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
const AS_OF = '2026-11-07T12:00:00.000Z';
const ADDRESS = 'alex@prospect.test';

const base: SendEligibilityFacts = {
  asOf: AS_OF,
  workspace: {
    outboundSendingEnabled: true,
    planEntitled: true,
    emailsPerPeriod: 1000,
    policy: {
      regions: {
        countries: { US: 'ALLOW', GB: 'REVIEW' },
        otherCountries: 'REVIEW',
      },
      sources: { APOLLO: 'ALLOW' },
    },
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
    checkedAt: '2026-11-01T12:00:00.000Z',
  },
  suppressions: { emails: [], domains: [] },
  leadListIds: [],
  otherCampaignEnrollments: 0,
  sources: ['APOLLO'],
};

const eligible = evaluateSendEligibility(base);
const suppressed = evaluateSendEligibility({
  ...base,
  suppressions: { emails: [ADDRESS], domains: [] },
});
const needsPerson = evaluateSendEligibility({
  ...base,
  contact: { ...base.contact, countryCode: 'GB' },
});
const draftCampaign = evaluateSendEligibility({
  ...base,
  campaign: { ...base.campaign, status: 'DRAFT' },
});

const fit = (
  value: number,
  band: 'HIGH_PRIORITY' | 'REVIEW' | 'LOW_PRIORITY',
) => ({
  value,
  band,
  bandReasons: [],
});

const classify = (facts: Partial<QualificationFacts>) =>
  classifyLead({
    fit: fit(90, 'HIGH_PRIORITY'),
    eligibility: eligible,
    agentStatus: 'completed',
    ...facts,
  });

const codes = (result: ReturnType<typeof classifyLead>) =>
  result.reasons.map((reason) => reason.code);

describe('classifyLead (task 10C)', () => {
  it('qualifies a High Priority lead whose own eligibility passes', () => {
    expect(classify({})).toMatchObject({
      state: 'QUALIFIED',
      reasons: [
        {
          code: 'score_high_priority',
          message: 'The score is 90 of 100: High Priority.',
        },
      ],
    });
    // A draft campaign is the campaign's matter, not the lead's.
    expect(leadEligibilityStatus(draftCampaign)).toBe('eligible');
    expect(classify({ eligibility: draftCampaign }).state).toBe('QUALIFIED');
  });

  it('rejects a lead blocked by its own eligibility, whatever the score', () => {
    for (const band of ['HIGH_PRIORITY', 'REVIEW', 'LOW_PRIORITY'] as const) {
      const result = classify({ fit: fit(100, band), eligibility: suppressed });
      expect(result).toMatchObject({
        state: 'REJECTED',
        reasons: [
          { code: 'eligibility_blocked', details: ['suppressed_email'] },
        ],
      });
    }
  });

  it('sends a lead to Review when the agent failed, no model ran, or a person must look', () => {
    expect(classify({ agentStatus: 'review_required' })).toMatchObject({
      state: 'REVIEW',
    });
    expect(codes(classify({ agentStatus: 'review_required' }))).toEqual([
      'agent_review',
      'score_high_priority',
    ]);
    expect(
      codes(
        classify({ agentStatus: 'unavailable', fit: fit(30, 'LOW_PRIORITY') }),
      ),
    ).toEqual(['agent_unavailable', 'score_low_priority']);
    expect(
      classify({ agentStatus: 'unavailable', fit: fit(30, 'LOW_PRIORITY') })
        .state,
    ).toBe('REVIEW');
    expect(classify({ eligibility: needsPerson })).toMatchObject({
      state: 'REVIEW',
      reasons: [
        { code: 'eligibility_review', details: ['region_review'] },
        { code: 'score_high_priority' },
      ],
    });
    expect(classify({ fit: fit(65, 'REVIEW') })).toMatchObject({
      state: 'REVIEW',
      reasons: [{ code: 'score_review' }],
    });
    expect(classify({ fit: null })).toMatchObject({
      state: 'REVIEW',
      reasons: [{ code: 'not_scored' }],
    });
  });

  it('rejects a Low Priority lead when nothing needs a person', () => {
    expect(classify({ fit: fit(40, 'LOW_PRIORITY') })).toMatchObject({
      state: 'REJECTED',
      reasons: [{ code: 'score_low_priority' }],
    });
  });

  it('explains every classification', () => {
    for (const fitValue of [
      null,
      fit(90, 'HIGH_PRIORITY'),
      fit(65, 'REVIEW'),
      fit(10, 'LOW_PRIORITY'),
    ]) {
      for (const eligibility of [
        eligible,
        suppressed,
        needsPerson,
        draftCampaign,
      ]) {
        for (const agentStatus of [
          null,
          'completed',
          'review_required',
          'no_facts',
          'unavailable',
        ] as const) {
          const result = classifyLead({
            fit: fitValue,
            eligibility,
            agentStatus,
          });
          expect(qualificationReasonsSchema.parse(result.reasons)).toEqual(
            result.reasons,
          );
          expect(
            result.reasons.every((reason) => reason.message.length > 0),
          ).toBe(true);
        }
      }
    }
  });
});

describe('contactDecision (task 10C)', () => {
  const person = (
    state: 'QUALIFIED' | 'REVIEW' | 'REJECTED',
    acceptedReviewReasons: string[] = [],
  ) => ({ state, origin: 'PERSON' as const, acceptedReviewReasons });

  it('permits an eligible lead, and is ready only when it is qualified', () => {
    expect(contactDecision(eligible, null)).toEqual({
      sendPermitted: true,
      readyToContact: false,
    });
    expect(contactDecision(eligible, person('QUALIFIED'))).toEqual({
      sendPermitted: true,
      readyToContact: true,
    });
    expect(contactDecision(eligible, person('REJECTED')).readyToContact).toBe(
      false,
    );
  });

  it("permits review reasons only when a person's qualification accepted every one of them", () => {
    expect(contactDecision(needsPerson, null).sendPermitted).toBe(false);
    expect(
      contactDecision(needsPerson, person('QUALIFIED')).sendPermitted,
    ).toBe(false);
    expect(
      contactDecision(needsPerson, person('QUALIFIED', ['region_review'])),
    ).toEqual({
      sendPermitted: true,
      readyToContact: true,
    });
    // A rules decision can't accept anything.
    expect(
      contactDecision(needsPerson, {
        state: 'QUALIFIED',
        origin: 'AUTOMATIC',
        acceptedReviewReasons: ['region_review'],
      }).sendPermitted,
    ).toBe(false);
    // A new review reason needs a person again.
    const more = evaluateSendEligibility({
      ...base,
      contact: { ...base.contact, countryCode: 'GB' },
      sources: ['APOLLO', 'MANUAL'],
    });
    expect(
      contactDecision(more, person('QUALIFIED', ['region_review']))
        .sendPermitted,
    ).toBe(false);
  });

  it('never permits a block, whatever a person accepted', () => {
    expect(
      contactDecision(
        suppressed,
        person('QUALIFIED', ['suppressed_email', 'region_review']),
      ),
    ).toEqual({ sendPermitted: false, readyToContact: false });
    expect(
      contactDecision(
        draftCampaign,
        person('QUALIFIED', ['campaign_not_active']),
      ),
    ).toEqual({ sendPermitted: false, readyToContact: false });
  });
});

describe('qualification schemas (task 10C)', () => {
  it("needs a note for a person's decision, and accepts review reasons only when qualifying", () => {
    expect(
      qualificationDecisionRequestSchema.safeParse({
        version: 1,
        state: 'REJECTED',
        note: '',
      }).success,
    ).toBe(false);
    expect(
      qualificationDecisionRequestSchema.safeParse({
        version: 1,
        state: 'REJECTED',
        note: 'No budget.',
        acceptReview: true,
      }).error?.issues[0]?.path,
    ).toEqual(['acceptReview']);
    expect(
      qualificationDecisionRequestSchema.safeParse({
        version: 1,
        state: 'QUALIFIED',
        note: 'Fits.',
        overrideBlocks: true,
      }).success,
    ).toBe(false);
  });

  it('refuses a model answer that carries anything beyond ratings', () => {
    const ok = {
      assessments: [
        { factor: 'timing', level: 3, factIds: ['F1'], explanation: 'Hiring.' },
      ],
      ignoredInstructions: [],
    };
    expect(qualificationModelOutputSchema.safeParse(ok).success).toBe(true);
    for (const bad of [
      { ...ok, score: 100 },
      { ...ok, state: 'QUALIFIED' },
      { ...ok, assessments: [{ ...ok.assessments[0], level: 5 }] },
      { ...ok, assessments: [{ ...ok.assessments[0], factor: 'industry' }] },
      { ...ok, assessments: [{ ...ok.assessments[0], factIds: ['E1'] }] },
    ]) {
      expect(qualificationModelOutputSchema.safeParse(bad).success).toBe(false);
    }
  });
});
