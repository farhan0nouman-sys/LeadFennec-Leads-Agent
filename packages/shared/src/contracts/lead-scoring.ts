// Lead scoring (task 10A, docs/decisions.md D-10A-*): what a lead is scored on, how much each
// factor weighs, what happens when evidence is missing, the bands and the calculation.
//
// - Six factors with whole-number weights that add up to 100 (by default 25, 20, 15, 20, 10
//   and 10). A campaign may set its own weights and missing-data policy; both are checked here.
// - An assessment rates one factor on five levels (0 to 4) and cites its evidence. Rules propose
//   assessments today (lead-scoring-rules.ts); a model or a person may later (task 10C). Only
//   this module turns assessments into a score.
// - A factor without evidence is "missing". A missing assessment has no level and no evidence
//   field at all, so it can't carry points. Missing factors earn nothing: their weight is never
//   moved onto the factors that were found, and no neutral value is assumed.
// - The score is the sum of weight × level / 4, rounded down to a whole number, so rounding never
//   lifts a lead into a higher band. Bands: High Priority 80–100, Review 60–79, Low Priority
//   0–59. The missing-data policy can only send a lead to Review, never higher.
//
// Pure and deterministic: equal inputs always give equal results, so a stored score can be
// recomputed from its stored inputs. Safe for web, API and worker.
import { z } from 'zod';
import { WEBSITE_RESEARCH_FIELDS } from './research-fields.js';

/** The calculation's version, stored with every score (scores.method_version). */
export const LEAD_SCORE_METHOD = 'lead-score/1';

export const LEAD_SCORE_FACTORS = [
  'industry',
  'decisionMaker',
  'sizeLocation',
  'supportedNeed',
  'contactQuality',
  'timing',
] as const;

export type LeadScoreFactor = (typeof LEAD_SCORE_FACTORS)[number];

export const LEAD_SCORE_FACTOR_INFO: Readonly<
  Record<
    LeadScoreFactor,
    { readonly label: string; readonly description: string }
  >
> = {
  industry: {
    label: 'Industry',
    description: 'The company works in an industry the campaign targets.',
  },
  decisionMaker: {
    label: 'Decision-maker',
    description:
      "The person's title and seniority match the roles the campaign targets.",
  },
  sizeLocation: {
    label: 'Size and location',
    description:
      "The company's number of employees and its country are in the targeted range.",
  },
  supportedNeed: {
    label: 'Supported need',
    description: 'Evidence shows the company needs what the campaign offers.',
  },
  contactQuality: {
    label: 'Contact quality',
    description: "The person's email address was checked and accepts email.",
  },
  timing: {
    label: 'Timing',
    description:
      'A recent, dated signal, such as hiring or a launch, makes now a good time.',
  },
};

export type LeadScoreWeights = Readonly<Record<LeadScoreFactor, number>>;

export const LEAD_SCORE_TOTAL_WEIGHT = 100;

export const DEFAULT_LEAD_SCORE_WEIGHTS: LeadScoreWeights = Object.freeze({
  industry: 25,
  decisionMaker: 20,
  sizeLocation: 15,
  supportedNeed: 20,
  contactQuality: 10,
  timing: 10,
});

const WEIGHT = 'Use a whole number from 0 to 100.';
const weightSchema = z
  .number(WEIGHT)
  .int(WEIGHT)
  .min(0, WEIGHT)
  .max(LEAD_SCORE_TOTAL_WEIGHT, WEIGHT);

/** Every factor's weight, whole numbers from 0 to 100 adding up to exactly 100. */
export const leadScoreWeightsSchema = z
  .strictObject(
    {
      industry: weightSchema,
      decisionMaker: weightSchema,
      sizeLocation: weightSchema,
      supportedNeed: weightSchema,
      contactQuality: weightSchema,
      timing: weightSchema,
    },
    {
      error: (issue) =>
        issue.code === 'unrecognized_keys'
          ? `Lead Fennec doesn't score ${issue.keys.map((key) => `"${key}"`).join(', ')}. The factors are ${LEAD_SCORE_FACTORS.join(', ')}.`
          : undefined,
    },
  )
  .superRefine((weights, ctx) => {
    const total = LEAD_SCORE_FACTORS.reduce(
      (sum, factor) => sum + weights[factor],
      0,
    );
    if (total !== LEAD_SCORE_TOTAL_WEIGHT) {
      ctx.addIssue({
        code: 'custom',
        message: `The weights add up to ${String(total)}. Make them add up to 100.`,
      });
    }
  });

/**
 * When the factors without evidence weigh more than the policy allows: REVIEW sends the lead to
 * Review whatever its score; SCORE keeps the band of the score (missing factors earn nothing).
 */
export const LEAD_SCORE_INSUFFICIENT_DATA_ACTIONS = [
  'SCORE',
  'REVIEW',
] as const;

/**
 * What missing evidence does to the band. A factor without evidence always earns 0 points: no
 * setting gives it a neutral or partial value, and any other key is refused by name.
 */
export const leadScoreMissingDataSchema = z.strictObject(
  {
    /** Factors that need evidence before a lead can be High Priority (else Review at most). */
    requiredFactors: z
      .array(z.enum(LEAD_SCORE_FACTORS, 'Choose factors from the list.'))
      .max(LEAD_SCORE_FACTORS.length)
      .refine(
        (factors) => new Set(factors).size === factors.length,
        'Choose each factor once.',
      ),
    /** The most combined weight of factors without evidence that still counts as enough data. */
    maxMissingWeight: weightSchema,
    whenInsufficient: z.enum(
      LEAD_SCORE_INSUFFICIENT_DATA_ACTIONS,
      'Choose SCORE or REVIEW.',
    ),
  },
  {
    error: (issue) =>
      issue.code === 'unrecognized_keys'
        ? `Lead Fennec doesn't recognize ${issue.keys.length === 1 ? 'the setting' : 'the settings'} ${issue.keys.map((key) => `"${key}"`).join(', ')}. A factor without evidence always earns 0 points.`
        : undefined,
  },
);

/** A campaign's scoring configuration (campaigns.scoring; null there means the defaults). */
export const leadScoringConfigSchema = z
  .strictObject({
    weights: leadScoreWeightsSchema,
    missingData: leadScoreMissingDataSchema,
  })
  .superRefine((config, ctx) => {
    config.missingData.requiredFactors.forEach((factor, index) => {
      if (config.weights[factor] === 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['missingData', 'requiredFactors', index],
          message: `${LEAD_SCORE_FACTOR_INFO[factor].label} has a weight of 0. Give it a weight, or don't require it.`,
        });
      }
    });
  });

export type LeadScoringConfig = z.output<typeof leadScoringConfigSchema>;
export type LeadScoreMissingDataPolicy = LeadScoringConfig['missingData'];

/** Used when a campaign hasn't set its own (docs/decisions.md D-10A-03). */
export const DEFAULT_LEAD_SCORING_CONFIG: Readonly<LeadScoringConfig> =
  Object.freeze({
    weights: { ...DEFAULT_LEAD_SCORE_WEIGHTS },
    missingData: {
      requiredFactors: ['industry', 'decisionMaker', 'supportedNeed'],
      maxMissingWeight: 30,
      whenInsufficient: 'SCORE',
    },
  });

// ─── Bands ───────────────────────────────────────────────────────────────────

export const LEAD_SCORE_BANDS = [
  'HIGH_PRIORITY',
  'REVIEW',
  'LOW_PRIORITY',
] as const;

export type LeadScoreBand = (typeof LEAD_SCORE_BANDS)[number];

/** Inclusive ranges of whole-number scores. */
export const LEAD_SCORE_BAND_RANGES: Readonly<
  Record<
    LeadScoreBand,
    { readonly min: number; readonly max: number; readonly label: string }
  >
> = {
  HIGH_PRIORITY: { min: 80, max: 100, label: 'High Priority' },
  REVIEW: { min: 60, max: 79, label: 'Review' },
  LOW_PRIORITY: { min: 0, max: 59, label: 'Low Priority' },
};

/** The band of a whole-number score from 0 to 100; anything else is refused. */
export function leadScoreBand(value: number): LeadScoreBand {
  if (!Number.isInteger(value) || value < 0 || value > 100) {
    throw new RangeError('A lead score is a whole number from 0 to 100.');
  }
  if (value >= LEAD_SCORE_BAND_RANGES.HIGH_PRIORITY.min) {
    return 'HIGH_PRIORITY';
  }
  return value >= LEAD_SCORE_BAND_RANGES.REVIEW.min ? 'REVIEW' : 'LOW_PRIORITY';
}

// ─── Assessments and their evidence ──────────────────────────────────────────

/** How well a factor fits: 0 none, 1 weak, 2 partial, 3 strong, 4 full. */
export const LEAD_FACTOR_MAX_LEVEL = 4;
export const LEAD_FACTOR_LEVEL_LABELS = [
  'No fit',
  'Weak',
  'Partial',
  'Strong',
  'Full',
] as const;

/** Stored values, as stored (verifications.status). */
export const LEAD_SCORE_EMAIL_CHECK_STATUSES = [
  'VALID',
  'RISKY',
  'UNKNOWN',
  'INVALID',
] as const;

export const LEAD_SCORE_ORGANIZATION_FIELDS = [
  'industry',
  'employeeCount',
  'countryCode',
] as const;
export const LEAD_SCORE_CONTACT_FIELDS = ['title', 'countryCode'] as const;

/** Most characters of a stored value an assessment quotes. */
export const LEAD_SCORE_VALUE_CHARS = 500;

const iso = z.iso.datetime();
const valueText = z.string().max(LEAD_SCORE_VALUE_CHARS);

/**
 * What an assessment rests on: a stored field of the company or the person (with the value
 * read), a research fact of a numbered version (with its evidence rows), an email check, or a
 * stored evidence row. Every id is checked against the workspace before a score is saved.
 */
export const leadScoreEvidenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('organization_field'),
    organizationId: z.uuid(),
    field: z.enum(LEAD_SCORE_ORGANIZATION_FIELDS),
    value: z.union([valueText, z.int().min(0)]),
  }),
  z.strictObject({
    kind: z.literal('contact_field'),
    contactId: z.uuid(),
    field: z.enum(LEAD_SCORE_CONTACT_FIELDS),
    value: valueText,
  }),
  z.strictObject({
    kind: z.literal('research_fact'),
    researchId: z.uuid(),
    researchVersion: z.int().min(1),
    field: z.enum(WEBSITE_RESEARCH_FIELDS),
    value: valueText,
    evidenceIds: z.array(z.uuid()).min(1).max(3),
  }),
  z.strictObject({
    kind: z.literal('email_check'),
    verificationId: z.uuid(),
    status: z.enum(LEAD_SCORE_EMAIL_CHECK_STATUSES),
    checkedAt: iso,
  }),
  z.strictObject({ kind: z.literal('evidence'), evidenceId: z.uuid() }),
]);

export type LeadScoreEvidence = z.output<typeof leadScoreEvidenceSchema>;

/** Who proposed an assessment. Only application code calculates the score from it. */
export const LEAD_SCORE_ASSESSORS = ['rules', 'model', 'person'] as const;

/**
 * Why a factor is missing: the lead has no data for it, the campaign targets nothing for it, or
 * nothing has assessed it yet (supported need and timing until task 10C).
 */
export const LEAD_SCORE_MISSING_REASONS = [
  'no_data',
  'no_target',
  'not_assessed',
] as const;

const explanationSchema = z.string().trim().min(1).max(300);
const factorSchema = z.enum(LEAD_SCORE_FACTORS);

/**
 * One factor's assessment. "assessed" needs at least one piece of evidence, even for level 0
 * (the evidence that it doesn't fit). "missing" has no level and no evidence: a strict object,
 * so a missing factor that claims a level or evidence is refused instead of scored.
 */
export const leadFactorAssessmentSchema = z.discriminatedUnion('status', [
  z.strictObject({
    factor: factorSchema,
    status: z.literal('assessed'),
    level: z.int().min(0).max(LEAD_FACTOR_MAX_LEVEL),
    assessedBy: z.enum(LEAD_SCORE_ASSESSORS),
    evidence: z
      .array(leadScoreEvidenceSchema)
      .min(1, 'An assessed factor cites its evidence.')
      .max(10),
    explanation: explanationSchema,
  }),
  z.strictObject({
    factor: factorSchema,
    status: z.literal('missing'),
    reason: z.enum(LEAD_SCORE_MISSING_REASONS),
    assessedBy: z.enum(LEAD_SCORE_ASSESSORS),
    explanation: explanationSchema,
  }),
]);

export type LeadFactorAssessment = z.output<typeof leadFactorAssessmentSchema>;

/** Exactly one assessment per factor. */
export const leadFactorAssessmentsSchema = z
  .array(leadFactorAssessmentSchema)
  .length(LEAD_SCORE_FACTORS.length)
  .superRefine((assessments, ctx) => {
    for (const factor of LEAD_SCORE_FACTORS) {
      if (assessments.filter((item) => item.factor === factor).length !== 1) {
        ctx.addIssue({
          code: 'custom',
          message: `Assess ${factor} exactly once.`,
        });
      }
    }
  });

/** The stored evidence rows assessments cite (research facts' rows and evidence rows), sorted. */
export function leadScoreEvidenceIds(
  assessments: readonly LeadFactorAssessment[],
): string[] {
  const ids = new Set<string>();
  for (const assessment of assessments) {
    if (assessment.status !== 'assessed') {
      continue;
    }
    for (const evidence of assessment.evidence) {
      if (evidence.kind === 'research_fact') {
        evidence.evidenceIds.forEach((id) => ids.add(id));
      } else if (evidence.kind === 'evidence') {
        ids.add(evidence.evidenceId);
      }
    }
  }
  return [...ids].sort();
}

// ─── The calculation ─────────────────────────────────────────────────────────

/** Why the band differs from (or was checked against) the score's own band. */
export const LEAD_SCORE_BAND_REASONS = [
  /** A required factor has no evidence: never High Priority. */
  'required_factor_missing',
  /** The factors without evidence weigh more than the policy allows. */
  'insufficient_data',
] as const;

export type LeadScoreBandReason = (typeof LEAD_SCORE_BAND_REASONS)[number];

export interface LeadScoreFactorResult {
  readonly factor: LeadScoreFactor;
  readonly weight: number;
  readonly status: 'assessed' | 'missing';
  /** Null when missing. */
  readonly level: number | null;
  /** weight × level / 4: a multiple of 0.25; 0 when missing. */
  readonly points: number;
}

export interface LeadScoreResult {
  readonly method: typeof LEAD_SCORE_METHOD;
  /** 0–100, rounded down. */
  readonly value: number;
  /** The band of the value alone. */
  readonly scoreBand: LeadScoreBand;
  /** The band after the missing-data policy (equal to scoreBand, or REVIEW). */
  readonly band: LeadScoreBand;
  /** Every policy condition that applied, whether or not it moved the band. */
  readonly bandReasons: readonly LeadScoreBandReason[];
  /** In LEAD_SCORE_FACTORS order. */
  readonly factors: readonly LeadScoreFactorResult[];
  /** Factors with a weight above 0 and no evidence. */
  readonly missingFactors: readonly LeadScoreFactor[];
  readonly missingWeight: number;
}

/** A configuration or assessments that aren't valid: nothing is scored. */
export class LeadScoreInputError extends Error {
  constructor(
    readonly issues: readonly {
      readonly path: string;
      readonly message: string;
    }[],
  ) {
    super('The lead score inputs are not valid');
    this.name = 'LeadScoreInputError';
  }
}

const issuePaths = (prefix: string, error: z.ZodError) =>
  error.issues.map((issue) => ({
    path: [prefix, ...issue.path.map(String)].join('.'),
    message: issue.message,
  }));

/**
 * The score of a lead from a configuration and one assessment per factor, both validated here
 * (LeadScoreInputError otherwise). Missing factors earn 0 points; the value is rounded down; the
 * policy may move the band to Review only.
 */
export function calculateLeadScore(
  rawConfig: unknown,
  rawAssessments: unknown,
): LeadScoreResult {
  const config = leadScoringConfigSchema.safeParse(rawConfig);
  const assessments = leadFactorAssessmentsSchema.safeParse(rawAssessments);
  if (!config.success || !assessments.success) {
    throw new LeadScoreInputError([
      ...(config.success ? [] : issuePaths('config', config.error)),
      ...(assessments.success
        ? []
        : issuePaths('assessments', assessments.error)),
    ]);
  }
  const { weights, missingData } = config.data;
  // In quarter points, so every sum is a whole number and no float decides a band.
  let quarters = 0;
  const factors = LEAD_SCORE_FACTORS.map((factor): LeadScoreFactorResult => {
    const weight = weights[factor];
    const assessment = assessments.data.find((item) => item.factor === factor);
    if (assessment === undefined || assessment.status === 'missing') {
      return { factor, weight, status: 'missing', level: null, points: 0 };
    }
    quarters += weight * assessment.level;
    return {
      factor,
      weight,
      status: 'assessed',
      level: assessment.level,
      points: (weight * assessment.level) / LEAD_FACTOR_MAX_LEVEL,
    };
  });
  const value = Math.floor(quarters / LEAD_FACTOR_MAX_LEVEL);
  const scoreBand = leadScoreBand(value);
  const missing = factors.filter(
    (item) => item.status === 'missing' && item.weight > 0,
  );
  const missingWeight = missing.reduce((sum, item) => sum + item.weight, 0);
  const bandReasons: LeadScoreBandReason[] = [];
  let band = scoreBand;
  if (
    missing.some((item) => missingData.requiredFactors.includes(item.factor))
  ) {
    bandReasons.push('required_factor_missing');
    if (band === 'HIGH_PRIORITY') {
      band = 'REVIEW';
    }
  }
  if (missingWeight > missingData.maxMissingWeight) {
    bandReasons.push('insufficient_data');
    if (missingData.whenInsufficient === 'REVIEW') {
      band = 'REVIEW';
    }
  }
  return {
    method: LEAD_SCORE_METHOD,
    value,
    scoreBand,
    band,
    bandReasons,
    factors,
    missingFactors: missing.map((item) => item.factor),
    missingWeight,
  };
}

const points = (value: number) =>
  Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));

const BAND_REASON_TEXT: Readonly<Record<LeadScoreBandReason, string>> = {
  required_factor_missing:
    'A factor that High Priority requires has no evidence.',
  insufficient_data:
    'The factors without evidence weigh more than the campaign allows.',
};

/** A short plain-text summary of a result (scores.reason). */
export function describeLeadScore(result: LeadScoreResult): string {
  const label = (band: LeadScoreBand) => LEAD_SCORE_BAND_RANGES[band].label;
  const parts = [
    result.band === result.scoreBand
      ? `${String(result.value)} of 100: ${label(result.band)}.`
      : `${String(result.value)} of 100: ${label(result.band)} (the score alone is ${label(result.scoreBand)}).`,
  ];
  const assessed = result.factors.filter(
    (item) => item.status === 'assessed' && item.weight > 0,
  );
  if (assessed.length > 0) {
    parts.push(
      `${assessed
        .map(
          (item) =>
            `${LEAD_SCORE_FACTOR_INFO[item.factor].label} ${points(item.points)} of ${String(item.weight)}`,
        )
        .join('; ')}.`,
    );
  }
  if (result.missingFactors.length > 0) {
    parts.push(
      `No evidence: ${result.missingFactors
        .map((factor) => LEAD_SCORE_FACTOR_INFO[factor].label)
        .join(', ')}.`,
    );
  }
  for (const reason of result.bandReasons) {
    parts.push(BAND_REASON_TEXT[reason]);
  }
  return parts.join(' ');
}
