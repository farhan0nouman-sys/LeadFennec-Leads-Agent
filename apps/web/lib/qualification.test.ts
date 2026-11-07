import { describe, expect, it } from 'vitest';
import {
  acceptableReasons,
  agentReviewText,
  decisionStates,
  leadHref,
  pointsText,
  ratingText,
} from './qualification';

const check = (
  key: string,
  scope: 'lead' | 'campaign',
  status: 'pass' | 'review' | 'blocked',
  reasons: { code: string; status: 'review' | 'blocked' }[] = [],
) => ({
  key,
  label: key,
  scope,
  status,
  reasons: reasons.map((reason) => ({
    ...reason,
    overridable: reason.status === 'review',
    message: `${reason.code} message`,
  })),
});

const eligibility = (
  status: 'eligible' | 'review' | 'blocked',
  checks: ReturnType<typeof check>[],
) =>
  ({
    eligibility: {
      rules: 'send-eligibility/1',
      status,
      evaluatedAt: '2026-11-07T12:00:00.000Z',
      checks,
    },
  }) as never;

describe('qualification screen helpers (task 10C)', () => {
  it('writes points as quarters and ratings in words', () => {
    expect(pointsText(18.75, 25)).toBe('18.75 of 25');
    expect(pointsText(20, 20)).toBe('20 of 20');
    expect(pointsText(2.5, 10)).toBe('2.5 of 10');
    expect(
      ratingText({ status: 'assessed', level: 4, missingReason: null }),
    ).toBe('Full');
    expect(
      ratingText({ status: 'assessed', level: 0, missingReason: null }),
    ).toBe('No fit');
    expect(
      ratingText({
        status: 'missing',
        level: null,
        missingReason: 'no_target',
      }),
    ).toBe('Not targeted');
  });

  it('never offers to qualify a person who is blocked', () => {
    const blocked = eligibility('blocked', [
      check('suppression', 'lead', 'blocked', [
        { code: 'suppressed_email', status: 'blocked' },
      ]),
    ]);
    expect(decisionStates(blocked)).toEqual(['REVIEW', 'REJECTED']);
    expect(acceptableReasons(blocked)).toEqual([]);
    // A draft campaign blocks sending, not the person.
    const draft = eligibility('blocked', [
      check('campaign', 'campaign', 'blocked', [
        { code: 'campaign_not_active', status: 'blocked' },
      ]),
    ]);
    expect(decisionStates(draft)).toEqual(['QUALIFIED', 'REVIEW', 'REJECTED']);
    expect(acceptableReasons(draft)).toEqual([]);
  });

  it('offers to accept only the reasons that need a person', () => {
    const review = eligibility('review', [
      check('verification', 'lead', 'review', [
        { code: 'verification_stale', status: 'review' },
      ]),
      check('region', 'lead', 'review', [
        { code: 'region_review', status: 'review' },
      ]),
    ]);
    expect(acceptableReasons(review).map((reason) => reason.code)).toEqual([
      'verification_stale',
      'region_review',
    ]);
    // A draft campaign blocks sending for everyone; the person's own checks can still be accepted.
    const draftAndReview = eligibility('blocked', [
      check('campaign', 'campaign', 'blocked', [
        { code: 'campaign_not_active', status: 'blocked' },
      ]),
      check('region', 'lead', 'review', [
        { code: 'region_review', status: 'review' },
      ]),
    ]);
    expect(
      acceptableReasons(draftAndReview).map((reason) => reason.code),
    ).toEqual(['region_review']);
    // Never when the person is blocked.
    const blockedAndReview = eligibility('blocked', [
      check('suppression', 'lead', 'blocked', [
        { code: 'suppressed_email', status: 'blocked' },
      ]),
      check('region', 'lead', 'review', [
        { code: 'region_review', status: 'review' },
      ]),
    ]);
    expect(acceptableReasons(blockedAndReview)).toEqual([]);
  });

  it('builds the lead link and names agent review reasons', () => {
    expect(leadHref('w', 'c', 'p')).toBe('/workspaces/w/campaigns/c/leads/p');
    expect(agentReviewText('unknown_fact')).toBe(
      "It cited a fact that wasn't given.",
    );
    expect(agentReviewText('something_new')).toBe('something_new');
  });
});
