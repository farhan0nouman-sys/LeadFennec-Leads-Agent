// The lead qualification screens' words and choices (task 10C, docs/decisions.md D-10C-*).
// Pure: no React, no fetch. Fit, eligibility and qualification are shown apart; this module
// never combines them into a decision of its own: the API's sendPermitted and readyToContact
// say what may happen.
import {
  LEAD_FACTOR_LEVEL_LABELS,
  QUALIFICATION_STATES,
  type LeadQualificationView,
  type LeadScoreAgentStatus,
  type QualificationReviewReason,
  type QualificationState,
} from '@lead-fennec-ai/shared';

export const leadsHref = (workspaceId: string, campaignId: string) =>
  `/workspaces/${workspaceId}/campaigns/${campaignId}/leads`;

export const leadHref = (
  workspaceId: string,
  campaignId: string,
  contactId: string,
) => `${leadsHref(workspaceId, campaignId)}/${contactId}`;

export const ASSESSED_BY_TEXT = {
  rules: 'Rules',
  model: 'Qualification agent',
  person: 'A person',
} as const;

export const MISSING_TEXT = {
  no_data: 'No evidence',
  no_target: 'Not targeted',
  not_assessed: 'Not assessed',
} as const;

export const AGENT_STATUS_TEXT: Readonly<Record<LeadScoreAgentStatus, string>> =
  {
    completed:
      'The qualification agent rated supported need and timing, and every rating checked out.',
    review_required:
      "Some of the agent's ratings didn't check out. They count as missing, and a person should look.",
    no_facts:
      'There were no research facts to read, so the agent was not asked.',
    unavailable:
      'No model was available, so supported need and timing were not rated.',
  };

export const AGENT_REVIEW_TEXT: Readonly<
  Record<QualificationReviewReason, string>
> = {
  invalid_output: "The answer wasn't in the required shape.",
  refusal: 'The model declined to answer.',
  output_truncated: 'The answer was cut off.',
  content_filtered: 'The answer was filtered.',
  output_incomplete: "The answer wasn't complete.",
  factor_missing: 'A factor was not answered exactly once.',
  unknown_fact: "It cited a fact that wasn't given.",
  level_without_evidence: 'It gave a rating without citing a fact.',
  timing_without_signal: 'It rated timing on facts other than hiring or news.',
  suspicious_instructions: 'A fact or the answer tried to instruct a model.',
};

const isReviewReason = (code: string): code is QualificationReviewReason =>
  code in AGENT_REVIEW_TEXT;

/** A review item's words (unknown codes shown as they are). */
export function agentReviewText(reason: string): string {
  return isReviewReason(reason) ? AGENT_REVIEW_TEXT[reason] : reason;
}

/** "18.75 of 25": points can be quarters. */
export function pointsText(points: number, weight: number): string {
  const shown = Number.isInteger(points)
    ? String(points)
    : String(Number(points.toFixed(2)));
  return `${shown} of ${String(weight)}`;
}

/** A factor's rating in words: its level, or why it is missing. */
export function ratingText(factor: {
  readonly status: 'assessed' | 'missing';
  readonly level: number | null;
  readonly missingReason: keyof typeof MISSING_TEXT | null;
}): string {
  if (factor.status === 'missing' || factor.level === null) {
    return factor.missingReason === null
      ? 'Missing'
      : MISSING_TEXT[factor.missingReason];
  }
  return LEAD_FACTOR_LEVEL_LABELS[factor.level] ?? String(factor.level);
}

/** The states a person may choose: a blocked person can't be qualified. */
export function decisionStates(
  view: Pick<LeadQualificationView, 'eligibility'>,
): QualificationState[] {
  const blocked = view.eligibility.checks.some(
    (check) => check.scope === 'lead' && check.status === 'blocked',
  );
  return QUALIFICATION_STATES.filter(
    (state) => !blocked || state !== 'QUALIFIED',
  );
}

/**
 * The eligibility reasons a person may accept by qualifying the lead (never a block). The
 * campaign's own blocks (a draft campaign) don't stop it; a block of the person's own does.
 */
export function acceptableReasons(
  view: Pick<LeadQualificationView, 'eligibility'>,
): { readonly code: string; readonly message: string }[] {
  if (!decisionStates(view).includes('QUALIFIED')) {
    return [];
  }
  return view.eligibility.checks.flatMap((check) =>
    check.reasons
      .filter((reason) => reason.status === 'review' && reason.overridable)
      .map((reason) => ({ code: reason.code, message: reason.message })),
  );
}
