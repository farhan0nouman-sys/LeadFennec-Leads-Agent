// Lead qualification (task 10C, docs/decisions.md D-10C-*): the LeadQualificationAgent's
// contract, the qualified / review / rejected states, how a state is decided, a person's
// decision, and what the API shows of a lead.
//
// - The agent only proposes: for supported need and timing (the factors rules can't judge) a
//   level, the research facts it rests on and a short explanation. Application code checks every
//   cited fact and calculates the score (calculateLeadScore). A proposal that fails is dropped:
//   its factor is missing and the lead goes to Review.
// - A state is decided by rules from the score, eligibility and the agent's outcome, and always
//   carries its reasons. A person may decide another state, with a note; it is audited and never
//   lifts a block. Accepting the eligibility checks that need a person (stale or risky email,
//   unnamed country or source) is the only way a person can widen what may be sent, and only for
//   those review reasons. A blocked lead can't be qualified.
// Pure zod and functions. Safe for web, API and worker.
import { z } from 'zod';
import { businessProfileSchema, offerSchema } from './campaigns.js';
import { CAMPAIGN_STATUSES } from './dashboard.js';
import {
  LEAD_SCORE_AGENT_STATUSES,
  type LeadScoreAgentStatus,
} from './lead-scoring-rules.js';
import {
  LEAD_FACTOR_MAX_LEVEL,
  LEAD_SCORE_ASSESSORS,
  LEAD_SCORE_BAND_REASONS,
  LEAD_SCORE_BANDS,
  LEAD_SCORE_FACTORS,
  LEAD_SCORE_MISSING_REASONS,
  type LeadScoreBand,
} from './lead-scoring.js';
import { WEBSITE_RESEARCH_FIELDS } from './research-fields.js';
import {
  SEND_ELIGIBILITY_REASON_CODES,
  sendEligibilityResultSchema,
  type SendEligibilityResult,
} from './send-eligibility.js';

const iso = z.iso.datetime();

export const QUALIFICATION_ROUTES = {
  leads: (workspaceId: string, campaignId: string) =>
    `/workspaces/${workspaceId}/campaigns/${campaignId}/leads`,
  lead: (workspaceId: string, campaignId: string, contactId: string) =>
    `/workspaces/${workspaceId}/campaigns/${campaignId}/leads/${contactId}`,
  qualify: (workspaceId: string, campaignId: string, contactId: string) =>
    `/workspaces/${workspaceId}/campaigns/${campaignId}/leads/${contactId}/qualify`,
  decisions: (workspaceId: string, campaignId: string, contactId: string) =>
    `/workspaces/${workspaceId}/campaigns/${campaignId}/leads/${contactId}/decisions`,
} as const;

// ─── The agent's contract ────────────────────────────────────────────────────

/** The factors the agent is asked about; rules assess the others. */
export const QUALIFICATION_MODEL_FACTORS = ['supportedNeed', 'timing'] as const;
export type QualificationModelFactor =
  (typeof QUALIFICATION_MODEL_FACTORS)[number];

/** Shown to the model with each factor. */
export const QUALIFICATION_FACTOR_GUIDE: Readonly<
  Record<QualificationModelFactor, string>
> = {
  supportedNeed:
    "How strongly the facts show the company needs what the campaign offers. 4: a fact states a need the offer meets. 3: facts make the need very likely. 2: facts suggest it. 1: a weak hint. 0: facts show the company doesn't need it. null: the facts say nothing about it.",
  timing:
    'How strongly a recent, dated signal makes now a good time to write. Only facts of the fields hiring and recent_news count. 4: a signal from the last 3 months that matches the offer. 3: a recent signal. 2: an older or less related one. 1: a weak hint. 0: a signal that now is a bad time. null: no such signal.',
};

/** Research fields that can show timing. */
export const QUALIFICATION_TIMING_FIELDS = ['hiring', 'recent_news'] as const;

export const QUALIFICATION_LIMITS = {
  maxFacts: 30,
  maxQuotesPerFact: 3,
  maxQuoteChars: 300,
  maxValueChars: 300,
  maxFactIdsPerAssessment: 5,
  maxExplanationChars: 300,
  maxIgnoredInstructions: 5,
} as const;

const Q = QUALIFICATION_LIMITS;

/** Fact ids are assigned by application code: F1 to F99. */
export const QUALIFICATION_FACT_ID = /^F[1-9][0-9]?$/;
const factIdSchema = z.string().regex(QUALIFICATION_FACT_ID);

/** What the agent reads: the campaign, the company, the person's title, verified facts. */
export const qualificationInputSchema = z.strictObject({
  /** "Recent" is judged at this time. */
  asOf: iso,
  campaign: z.strictObject({
    businessProfile: businessProfileSchema.nullable(),
    offer: offerSchema.nullable(),
  }),
  company: z.strictObject({
    name: z.string().max(200).nullable(),
    domain: z.string().max(253).nullable(),
  }),
  person: z.strictObject({ title: z.string().max(500).nullable() }),
  /** Verified research facts (task 09C): untrusted page text, quoted. */
  facts: z
    .array(
      z.strictObject({
        id: factIdSchema,
        field: z.enum(WEBSITE_RESEARCH_FIELDS),
        value: z.string().max(Q.maxValueChars),
        quotes: z
          .array(z.string().max(Q.maxQuoteChars))
          .max(Q.maxQuotesPerFact),
        /** When the page was read, or null for a person's correction. */
        retrievedAt: iso.nullable(),
      }),
    )
    .max(Q.maxFacts)
    .refine(
      (facts) => new Set(facts.map((fact) => fact.id)).size === facts.length,
      'fact ids must be unique',
    ),
});

export type QualificationInput = z.input<typeof qualificationInputSchema>;

/**
 * What the model must answer, checked before anything else. A strict object: anything else (a
 * score, a state, an eligibility, a tool call) refuses the answer.
 */
export const qualificationModelOutputSchema = z.strictObject({
  assessments: z
    .array(
      z.strictObject({
        factor: z.enum(QUALIFICATION_MODEL_FACTORS),
        level: z.int().min(0).max(LEAD_FACTOR_MAX_LEVEL).nullable(),
        factIds: z.array(factIdSchema).max(Q.maxFactIdsPerAssessment),
        explanation: z.string().trim().min(1).max(Q.maxExplanationChars),
      }),
    )
    .max(QUALIFICATION_MODEL_FACTORS.length),
  /** Fact text that tried to instruct the model, which it ignored. */
  ignoredInstructions: z
    .array(
      z.strictObject({
        factId: factIdSchema,
        quote: z.string().max(Q.maxQuoteChars),
      }),
    )
    .max(Q.maxIgnoredInstructions),
});

export type QualificationModelOutput = z.output<
  typeof qualificationModelOutputSchema
>;

/** Why the agent's answer, or one proposal, wasn't used. */
export const QUALIFICATION_REVIEW_REASONS = [
  'invalid_output',
  'refusal',
  'output_truncated',
  'content_filtered',
  'output_incomplete',
  /** A factor asked for wasn't answered, or was answered twice. */
  'factor_missing',
  /** It cites a fact id that wasn't provided. */
  'unknown_fact',
  /** A level without any cited fact. */
  'level_without_evidence',
  /** Timing that rests on facts other than hiring or recent news. */
  'timing_without_signal',
  /** The explanation or a cited fact tries to instruct a model. */
  'suspicious_instructions',
] as const;

export type QualificationReviewReason =
  (typeof QUALIFICATION_REVIEW_REASONS)[number];

// ─── States and their reasons ────────────────────────────────────────────────

export const QUALIFICATION_STATES = [
  'QUALIFIED',
  'REVIEW',
  'REJECTED',
] as const;
export type QualificationState = (typeof QUALIFICATION_STATES)[number];
export const QUALIFICATION_ORIGINS = ['AUTOMATIC', 'PERSON'] as const;
export type QualificationOrigin = (typeof QUALIFICATION_ORIGINS)[number];

export const QUALIFICATION_STATE_LABELS: Readonly<
  Record<QualificationState, string>
> = { QUALIFIED: 'Qualified', REVIEW: 'Review', REJECTED: 'Rejected' };

export const QUALIFICATION_REASON_CODES = [
  'score_high_priority',
  'score_review',
  'score_low_priority',
  'not_scored',
  'eligibility_blocked',
  'eligibility_review',
  'agent_review',
  'agent_unavailable',
  'person_decision',
] as const;

export type QualificationReasonCode =
  (typeof QUALIFICATION_REASON_CODES)[number];

export const qualificationReasonSchema = z.strictObject({
  code: z.enum(QUALIFICATION_REASON_CODES),
  message: z.string().max(500),
  /** Codes behind it (eligibility reasons, score band reasons, agent review reasons). */
  details: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)).max(30),
});

export type QualificationReason = z.output<typeof qualificationReasonSchema>;

/** A decision's reasons (lead_qualifications.reasons): at least one, so every state is explained. */
export const qualificationReasonsSchema = z
  .array(qualificationReasonSchema)
  .min(1)
  .max(10);

const leadChecks = (eligibility: SendEligibilityResult) =>
  eligibility.checks.filter((check) => check.scope === 'lead');

/** Codes of the person's own eligibility reasons with this status (campaign checks left out). */
export function leadEligibilityCodes(
  eligibility: SendEligibilityResult,
  status: 'review' | 'blocked',
): string[] {
  return leadChecks(eligibility).flatMap((check) =>
    check.reasons
      .filter((reason) => reason.status === status)
      .map((reason) => reason.code),
  );
}

/**
 * The status of the person's own eligibility checks (lead_qualifications.eligibility_status):
 * the campaign's checks, such as a draft campaign, are left out.
 */
export function leadEligibilityStatus(
  eligibility: SendEligibilityResult,
): 'eligible' | 'review' | 'blocked' {
  const checks = leadChecks(eligibility);
  return checks.some((check) => check.status === 'blocked')
    ? 'blocked'
    : checks.some((check) => check.status === 'review')
      ? 'review'
      : 'eligible';
}

export interface QualificationFacts {
  /** The current lead score, or null when the lead hasn't been scored. */
  readonly fit: {
    readonly value: number;
    readonly band: LeadScoreBand;
    readonly bandReasons: readonly string[];
  } | null;
  readonly eligibility: SendEligibilityResult;
  /** What became of the agent's answer, or null when it wasn't asked. */
  readonly agentStatus: LeadScoreAgentStatus | null;
}

/**
 * The automatic state, always with its reasons. A block of the person's own eligibility
 * rejects (the campaign's own checks, such as a draft campaign, don't); an agent answer that
 * didn't check out or no model sends to Review; otherwise the score's band decides, and a High
 * Priority lead whose eligibility needs a person goes to Review.
 */
export function classifyLead(facts: QualificationFacts): {
  readonly state: QualificationState;
  readonly reasons: QualificationReason[];
} {
  const blocked = leadEligibilityCodes(facts.eligibility, 'blocked');
  if (blocked.length > 0) {
    return {
      state: 'REJECTED',
      reasons: [
        {
          code: 'eligibility_blocked',
          message: 'This person may not be emailed (see eligibility).',
          details: blocked,
        },
      ],
    };
  }
  if (facts.fit === null) {
    return {
      state: 'REVIEW',
      reasons: [
        {
          code: 'not_scored',
          message: "This lead hasn't been scored.",
          details: [],
        },
      ],
    };
  }
  const reasons: QualificationReason[] = [];
  if (facts.agentStatus === 'review_required') {
    reasons.push({
      code: 'agent_review',
      message:
        "The qualification agent's answer didn't check out, so its factors count as missing. A person should look.",
      details: [],
    });
  } else if (facts.agentStatus === 'unavailable') {
    reasons.push({
      code: 'agent_unavailable',
      message:
        "No model was available, so supported need and timing weren't assessed. A person should look.",
      details: [],
    });
  }
  const band = facts.fit.band;
  const value = String(facts.fit.value);
  const details = [...facts.fit.bandReasons];
  if (band === 'LOW_PRIORITY') {
    return {
      state: reasons.length > 0 ? 'REVIEW' : 'REJECTED',
      reasons: [
        ...reasons,
        {
          code: 'score_low_priority',
          message: `The score is ${value} of 100: Low Priority.`,
          details,
        },
      ],
    };
  }
  if (band === 'REVIEW') {
    return {
      state: 'REVIEW',
      reasons: [
        ...reasons,
        {
          code: 'score_review',
          message: `The score is ${value} of 100: Review.`,
          details,
        },
      ],
    };
  }
  const review = leadEligibilityCodes(facts.eligibility, 'review');
  if (review.length > 0) {
    reasons.push({
      code: 'eligibility_review',
      message:
        'Some eligibility checks need a person before this lead may be emailed.',
      details: review,
    });
  }
  return {
    state: reasons.length > 0 ? 'REVIEW' : 'QUALIFIED',
    reasons: [
      ...reasons,
      {
        code: 'score_high_priority',
        message: `The score is ${value} of 100: High Priority.`,
        details,
      },
    ],
  };
}

// ─── A person's decision ─────────────────────────────────────────────────────

export const QUALIFICATION_NOTE_CHARS = 1000;

/**
 * A person's decision names the qualification version it started from (0: none yet) and why.
 * acceptReview accepts the eligibility reasons that need a person (never a block), and only
 * with QUALIFIED.
 */
export const qualificationDecisionRequestSchema = z
  .strictObject({
    version: z.int().min(0),
    state: z.enum(
      QUALIFICATION_STATES,
      'Choose Qualified, Review or Rejected.',
    ),
    note: z
      .string()
      .trim()
      .min(1, 'Say why, so others can follow the decision.')
      .max(
        QUALIFICATION_NOTE_CHARS,
        `Use at most ${String(QUALIFICATION_NOTE_CHARS)} characters.`,
      ),
    acceptReview: z.boolean().optional(),
  })
  .refine((body) => body.acceptReview !== true || body.state === 'QUALIFIED', {
    path: ['acceptReview'],
    message: 'Accept the eligibility checks only when qualifying the lead.',
  });

export type QualificationDecisionRequest = z.input<
  typeof qualificationDecisionRequestSchema
>;

export const qualifyRequestSchema = z.strictObject({});

export const qualifyAcceptedSchema = z.strictObject({
  /** queued: a new run; running: one was already queued or running. */
  state: z.enum(['queued', 'running']),
});

export type QualifyAccepted = z.output<typeof qualifyAcceptedSchema>;

export const QUALIFICATION_ERROR_CODES = [
  /** 409: the lead's eligibility blocks it; it can't be qualified. */
  'qualification_blocked',
] as const;

export interface QualificationDecisionFacts {
  readonly state: QualificationState;
  readonly origin: QualificationOrigin;
  readonly acceptedReviewReasons: readonly string[];
}

/**
 * Whether the campaign may email the person now (sendPermitted) and should (readyToContact).
 * Eligible: permitted. Needing a person: permitted only when a person's current decision
 * qualified the lead and accepted every one of the current review reasons; a new review reason
 * needs them again. Blocked: never, whatever the score or the decision.
 */
export function contactDecision(
  eligibility: SendEligibilityResult,
  qualification: QualificationDecisionFacts | null,
): { readonly sendPermitted: boolean; readonly readyToContact: boolean } {
  const qualified = qualification?.state === 'QUALIFIED';
  let sendPermitted = eligibility.status === 'eligible';
  if (
    eligibility.status === 'review' &&
    qualified &&
    qualification.origin === 'PERSON'
  ) {
    const open = eligibility.checks.flatMap((check) =>
      check.reasons.filter((reason) => reason.status === 'review'),
    );
    sendPermitted = open.every(
      (reason) =>
        reason.overridable &&
        qualification.acceptedReviewReasons.includes(reason.code),
    );
  }
  return { sendPermitted, readyToContact: sendPermitted && qualified };
}

// ─── What the API shows ──────────────────────────────────────────────────────

/** One piece of evidence, ready to show (untrusted text escaped when rendered). */
export const leadEvidenceViewSchema = z.strictObject({
  kind: z.enum([
    'organization_field',
    'contact_field',
    'research_fact',
    'email_check',
    'evidence',
  ]),
  /** What it is, e.g. "Company record: industry". */
  label: z.string(),
  /** The value read, e.g. "software". */
  detail: z.string(),
  /** A quoted page excerpt or a note, when there is one. */
  excerpt: z.string().nullable(),
  url: z.string().nullable(),
  capturedAt: iso.nullable(),
});

export type LeadEvidenceView = z.output<typeof leadEvidenceViewSchema>;

export const leadFactorViewSchema = z.strictObject({
  factor: z.enum(LEAD_SCORE_FACTORS),
  label: z.string(),
  description: z.string(),
  weight: z.int().min(0).max(100),
  status: z.enum(['assessed', 'missing']),
  level: z.int().min(0).max(LEAD_FACTOR_MAX_LEVEL).nullable(),
  points: z.number().min(0).max(100),
  assessedBy: z.enum(LEAD_SCORE_ASSESSORS),
  /** Written by the rules, or by the model (untrusted text). */
  explanation: z.string(),
  missingReason: z.enum(LEAD_SCORE_MISSING_REASONS).nullable(),
  evidence: z.array(leadEvidenceViewSchema),
});

export const leadFitViewSchema = z.strictObject({
  scoreId: z.uuid(),
  version: z.int().min(1),
  value: z.int().min(0).max(100),
  band: z.enum(LEAD_SCORE_BANDS),
  scoreBand: z.enum(LEAD_SCORE_BANDS),
  bandReasons: z.array(z.enum(LEAD_SCORE_BAND_REASONS)),
  method: z.enum(['RULES', 'AI', 'MANUAL']),
  methodVersion: z.string(),
  rulesVersion: z.string(),
  scoredAt: iso,
  agent: z
    .strictObject({
      status: z.enum(LEAD_SCORE_AGENT_STATUSES),
      prompt: z.string(),
      provider: z.string(),
      model: z.string(),
      reviewItems: z.array(
        z.strictObject({
          reason: z.string(),
          factor: z.enum(LEAD_SCORE_FACTORS).nullable(),
        }),
      ),
    })
    .nullable(),
  factors: z.array(leadFactorViewSchema),
});

export type LeadFitView = z.output<typeof leadFitViewSchema>;

export const qualificationDecisionViewSchema = z.strictObject({
  id: z.uuid(),
  version: z.int().min(1),
  state: z.enum(QUALIFICATION_STATES),
  origin: z.enum(QUALIFICATION_ORIGINS),
  reasons: qualificationReasonsSchema,
  /** Eligibility reasons a person accepted (review only, never a block). */
  acceptedReviewReasons: z.array(z.enum(SEND_ELIGIBILITY_REASON_CODES)),
  /** A person's note (untrusted text). */
  note: z.string().nullable(),
  /** The deciding member's name or email, for a person's decision. */
  decidedBy: z.string().nullable(),
  decidedAt: iso,
  scoreId: z.uuid().nullable(),
  eligibilityStatus: z.enum(['eligible', 'review', 'blocked']),
});

export type QualificationDecisionView = z.output<
  typeof qualificationDecisionViewSchema
>;

/** One lead of a campaign: who, how well they fit, whether they may be emailed, and the state. */
export const leadQualificationViewSchema = z.strictObject({
  campaign: z.strictObject({
    id: z.uuid(),
    name: z.string(),
    status: z.enum(CAMPAIGN_STATUSES),
  }),
  contact: z.strictObject({
    id: z.uuid(),
    /** Untrusted (from imports and providers). */
    name: z.string().nullable(),
    title: z.string().nullable(),
    email: z.string().nullable(),
    company: z.strictObject({ id: z.uuid(), name: z.string() }).nullable(),
  }),
  /** The current score with its explanations and evidence; null before the first. */
  fit: leadFitViewSchema.nullable(),
  /** Decided now, without the score. */
  eligibility: sendEligibilityResultSchema,
  qualification: qualificationDecisionViewSchema.nullable(),
  /** Every decision, newest first, at most 20. */
  history: z.array(qualificationDecisionViewSchema),
  sendPermitted: z.boolean(),
  readyToContact: z.boolean(),
  /** A qualification run is queued or running. */
  pending: z.boolean(),
});

export type LeadQualificationView = z.output<
  typeof leadQualificationViewSchema
>;

export const leadListItemSchema = z.strictObject({
  id: z.uuid(),
  name: z.string().nullable(),
  title: z.string().nullable(),
  company: z.string().nullable(),
  score: z
    .strictObject({
      value: z.int().min(0).max(100),
      band: z.enum(LEAD_SCORE_BANDS),
    })
    .nullable(),
  state: z.enum(QUALIFICATION_STATES).nullable(),
});

export const leadPageSchema = z.strictObject({
  /** The campaign's lead list, or null when it has none (then there are no leads yet). */
  leadListId: z.uuid().nullable(),
  items: z.array(leadListItemSchema),
  nextCursor: z.string().nullable(),
});

export type LeadListItem = z.output<typeof leadListItemSchema>;
export type LeadPage = z.output<typeof leadPageSchema>;
