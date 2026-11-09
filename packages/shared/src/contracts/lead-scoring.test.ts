import { describe, expect, it } from 'vitest';
import {
  calculateLeadScore,
  DEFAULT_LEAD_SCORE_WEIGHTS,
  DEFAULT_LEAD_SCORING_CONFIG,
  describeLeadScore,
  LEAD_SCORE_BAND_RANGES,
  LEAD_SCORE_BANDS,
  LEAD_SCORE_FACTORS,
  leadFactorAssessmentSchema,
  leadScoreBand,
  leadScoreEvidenceIds,
  LeadScoreInputError,
  leadScoringConfigSchema,
  leadScoreWeightsSchema,
  type LeadFactorAssessment,
  type LeadScoreFactor,
  type LeadScoringConfig,
} from './lead-scoring.js';

const CONTACT = '00000000-0000-4000-8000-000000000001';
const EVIDENCE = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

const assessed = (
  factor: LeadScoreFactor,
  level: number,
): Extract<LeadFactorAssessment, { status: 'assessed' }> => ({
  factor,
  status: 'assessed',
  level,
  assessedBy: 'rules',
  evidence: [
    { kind: 'contact_field', contactId: CONTACT, field: 'title', value: 'x' },
  ],
  explanation: 'Test assessment.',
});

const missing = (factor: LeadScoreFactor): LeadFactorAssessment => ({
  factor,
  status: 'missing',
  reason: 'no_data',
  assessedBy: 'rules',
  explanation: 'Not known.',
});

/** One assessment per factor: a level, or null for missing (default: full). */
const assessments = (
  levels: Partial<Record<LeadScoreFactor, number | null>> = {},
) =>
  LEAD_SCORE_FACTORS.map((factor) => {
    const level = levels[factor] === undefined ? 4 : levels[factor];
    return level === null ? missing(factor) : assessed(factor, level);
  });

/** A policy that never moves the band, to test the score alone. */
const NEUTRAL_POLICY: LeadScoringConfig['missingData'] = {
  requiredFactors: [],
  maxMissingWeight: 100,
  whenInsufficient: 'SCORE',
};

const config = (
  weights: Partial<Record<LeadScoreFactor, number>> = {},
  missingData: Partial<LeadScoringConfig['missingData']> = NEUTRAL_POLICY,
) => ({
  weights: { ...DEFAULT_LEAD_SCORE_WEIGHTS, ...weights },
  missingData: { ...NEUTRAL_POLICY, ...missingData },
});

const issuesOf = (value: unknown) => {
  const parsed = leadScoringConfigSchema.safeParse(value);
  expect(parsed.success).toBe(false);
  return parsed.success
    ? []
    : parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
};

describe('score weights (task 10A)', () => {
  it('defaults to 25, 20, 15, 20, 10 and 10, adding up to 100', () => {
    expect(DEFAULT_LEAD_SCORE_WEIGHTS).toEqual({
      industry: 25,
      decisionMaker: 20,
      sizeLocation: 15,
      supportedNeed: 20,
      contactQuality: 10,
      timing: 10,
    });
    expect(leadScoringConfigSchema.parse(DEFAULT_LEAD_SCORING_CONFIG)).toEqual(
      DEFAULT_LEAD_SCORING_CONFIG,
    );
  });

  it('accepts any whole numbers that add up to 100, including 0 and 100', () => {
    for (const weights of [
      {
        industry: 40,
        decisionMaker: 20,
        sizeLocation: 10,
        supportedNeed: 10,
        contactQuality: 10,
        timing: 10,
      },
      {
        industry: 100,
        decisionMaker: 0,
        sizeLocation: 0,
        supportedNeed: 0,
        contactQuality: 0,
        timing: 0,
      },
    ]) {
      expect(leadScoreWeightsSchema.parse(weights)).toEqual(weights);
    }
  });

  it('refuses weights that do not add up to exactly 100, naming the total', () => {
    for (const [change, total] of [
      [{ timing: 9 }, 99],
      [{ timing: 11 }, 101],
      [
        {
          industry: 0,
          decisionMaker: 0,
          sizeLocation: 0,
          supportedNeed: 0,
          contactQuality: 0,
          timing: 0,
        },
        0,
      ],
    ] as const) {
      expect(issuesOf(config(change))).toEqual([
        {
          path: 'weights',
          message: `The weights add up to ${String(total)}. Make them add up to 100.`,
        },
      ]);
    }
  });

  it('refuses weights that are not whole numbers from 0 to 100', () => {
    const message = 'Use a whole number from 0 to 100.';
    for (const bad of [
      12.5,
      -5,
      101,
      '25',
      Number.NaN,
      Number.POSITIVE_INFINITY,
      null,
      undefined,
    ]) {
      const issues = issuesOf(config({ industry: bad as number }));
      expect(issues, String(bad)).toContainEqual({
        path: 'weights.industry',
        message,
      });
    }
  });

  it('refuses an unknown factor by name and a missing one', () => {
    expect(
      issuesOf({
        ...config(),
        weights: { ...DEFAULT_LEAD_SCORE_WEIGHTS, budget: 0 },
      }),
    ).toEqual([
      {
        path: 'weights',
        message: expect.stringContaining(`doesn't score "budget"`) as string,
      },
    ]);
    const five = Object.fromEntries(
      Object.entries(DEFAULT_LEAD_SCORE_WEIGHTS).filter(
        ([factor]) => factor !== 'timing',
      ),
    );
    expect(issuesOf({ ...config(), weights: five })).toContainEqual({
      path: 'weights.timing',
      message: 'Use a whole number from 0 to 100.',
    });
  });
});

describe('missing-data policy (task 10A)', () => {
  it('requires a weight above 0 for every required factor', () => {
    expect(
      issuesOf(
        config(
          { timing: 0, industry: 35 },
          { requiredFactors: ['industry', 'timing'] },
        ),
      ),
    ).toEqual([
      {
        path: 'missingData.requiredFactors.1',
        message:
          "Timing has a weight of 0. Give it a weight, or don't require it.",
      },
    ]);
  });

  it('refuses repeated or unknown factors, out-of-range limits and unknown actions', () => {
    expect(
      issuesOf(config({}, { requiredFactors: ['industry', 'industry'] })),
    ).toEqual([
      {
        path: 'missingData.requiredFactors',
        message: 'Choose each factor once.',
      },
    ]);
    expect(
      issuesOf(
        config({}, { requiredFactors: ['budget' as LeadScoreFactor] }),
      ).map((issue) => issue.path),
    ).toEqual(['missingData.requiredFactors.0']);
    expect(issuesOf(config({}, { maxMissingWeight: 101 }))).toEqual([
      {
        path: 'missingData.maxMissingWeight',
        message: 'Use a whole number from 0 to 100.',
      },
    ]);
    expect(
      issuesOf(config({}, { whenInsufficient: 'GUESS' as 'SCORE' })),
    ).toEqual([
      {
        path: 'missingData.whenInsufficient',
        message: 'Choose SCORE or REVIEW.',
      },
    ]);
  });

  it('has no setting that gives a factor without evidence any points', () => {
    for (const key of ['missingFactorCredit', 'neutralValue', 'rescale']) {
      expect(
        issuesOf({
          ...config(),
          missingData: { ...NEUTRAL_POLICY, [key]: 0.5 },
        }),
      ).toEqual([
        {
          path: 'missingData',
          message: `Lead Fennec doesn't recognize the setting "${key}". A factor without evidence always earns 0 points.`,
        },
      ]);
    }
  });
});

describe('score bands (task 10A)', () => {
  it('puts 80–100 in High Priority, 60–79 in Review and 0–59 in Low Priority', () => {
    for (const [value, band] of [
      [0, 'LOW_PRIORITY'],
      [59, 'LOW_PRIORITY'],
      [60, 'REVIEW'],
      [79, 'REVIEW'],
      [80, 'HIGH_PRIORITY'],
      [100, 'HIGH_PRIORITY'],
    ] as const) {
      expect(leadScoreBand(value), String(value)).toBe(band);
    }
  });

  it('covers every whole score exactly once', () => {
    for (let value = 0; value <= 100; value += 1) {
      const containing = LEAD_SCORE_BANDS.filter(
        (band) =>
          value >= LEAD_SCORE_BAND_RANGES[band].min &&
          value <= LEAD_SCORE_BAND_RANGES[band].max,
      );
      expect(containing, String(value)).toEqual([leadScoreBand(value)]);
    }
  });

  it('refuses anything but a whole number from 0 to 100', () => {
    for (const value of [-1, 101, 79.5, Number.NaN]) {
      expect(() => leadScoreBand(value), String(value)).toThrow(RangeError);
    }
  });
});

describe('calculateLeadScore (task 10A)', () => {
  // Weights whose quarter points reach every boundary: 1 + 19 + 4 × 20.
  const fine = config({
    industry: 1,
    decisionMaker: 19,
    sizeLocation: 20,
    supportedNeed: 20,
    contactQuality: 20,
    timing: 20,
  });

  it('rounds down at the band boundaries: 79.75 is Review, 80 High Priority', () => {
    const cases = [
      // industry 0, decision-maker 1 (4.75), the other four 15 of 16 levels: 79.75.
      [{ industry: 0, decisionMaker: 1, timing: 3 }, 79, 'REVIEW'],
      [{ industry: 0, decisionMaker: 0 }, 80, 'HIGH_PRIORITY'],
      // 59.75 and 60.
      [
        {
          industry: 0,
          decisionMaker: 1,
          sizeLocation: 4,
          supportedNeed: 4,
          contactQuality: 3,
          timing: 0,
        },
        59,
        'LOW_PRIORITY',
      ],
      [
        {
          industry: 0,
          decisionMaker: 0,
          sizeLocation: 4,
          supportedNeed: 4,
          contactQuality: 4,
          timing: 0,
        },
        60,
        'REVIEW',
      ],
    ] as const;
    for (const [levels, value, band] of cases) {
      const result = calculateLeadScore(fine, assessments(levels));
      expect(result.value, JSON.stringify(levels)).toBe(value);
      expect(result.scoreBand).toBe(band);
      expect(result.band).toBe(band);
    }
  });

  it('weighs each factor by its weight and level: points = weight × level / 4', () => {
    const result = calculateLeadScore(
      config(),
      assessments({ industry: 3, sizeLocation: 1, contactQuality: 2 }),
    );
    expect(result.factors.map((item) => [item.factor, item.points])).toEqual([
      ['industry', 18.75],
      ['decisionMaker', 20],
      ['sizeLocation', 3.75],
      ['supportedNeed', 20],
      ['contactQuality', 5],
      ['timing', 10],
    ]);
    // 77.5, rounded down.
    expect(result.value).toBe(77);
  });

  it('gives missing factors nothing and never moves their weight to the others', () => {
    // Every combination of missing factors, the rest at full level.
    for (let mask = 0; mask < 2 ** LEAD_SCORE_FACTORS.length; mask += 1) {
      const absent = LEAD_SCORE_FACTORS.filter((_, i) => (mask >> i) & 1);
      const result = calculateLeadScore(
        config(),
        assessments(Object.fromEntries(absent.map((factor) => [factor, null]))),
      );
      const absentWeight = absent.reduce(
        (sum, factor) => sum + DEFAULT_LEAD_SCORE_WEIGHTS[factor],
        0,
      );
      expect(result.value, absent.join(',')).toBe(100 - absentWeight);
      expect(result.missingWeight).toBe(absentWeight);
      expect(result.missingFactors).toEqual(absent);
      for (const item of result.factors) {
        if (absent.includes(item.factor)) {
          expect(item).toMatchObject({
            status: 'missing',
            level: null,
            points: 0,
          });
        }
      }
    }
  });

  it('refuses a missing factor that claims a level or evidence, and an assessment without evidence', () => {
    const claims = [
      { ...missing('timing'), level: 4 },
      {
        ...missing('timing'),
        evidence: [
          {
            kind: 'contact_field',
            contactId: CONTACT,
            field: 'title',
            value: 'x',
          },
        ],
      },
      { ...assessed('timing', 4), evidence: [] },
      { ...assessed('timing', 4), status: 'verified' },
      { ...assessed('timing', 5) },
    ];
    for (const claim of claims) {
      expect(leadFactorAssessmentSchema.safeParse(claim).success).toBe(false);
      const list = [...assessments().slice(0, 5), claim];
      expect(() => calculateLeadScore(config(), list)).toThrow(
        LeadScoreInputError,
      );
    }
  });

  it('refuses assessments that leave out or repeat a factor', () => {
    const five = assessments().slice(0, 5);
    expect(() => calculateLeadScore(config(), five)).toThrow(
      LeadScoreInputError,
    );
    const repeated = [...five, assessed('industry', 4)];
    try {
      calculateLeadScore(config(), repeated);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(LeadScoreInputError);
      expect((error as LeadScoreInputError).issues).toEqual([
        { path: 'assessments', message: 'Assess industry exactly once.' },
        { path: 'assessments', message: 'Assess timing exactly once.' },
      ]);
    }
  });

  it('refuses an invalid configuration instead of scoring with it', () => {
    expect(() =>
      calculateLeadScore(config({ timing: 30 }), assessments()),
    ).toThrow(LeadScoreInputError);
  });

  it('keeps a lead missing a required factor out of High Priority', () => {
    const result = calculateLeadScore(
      config({}, { requiredFactors: ['timing'] }),
      assessments({ timing: null }),
    );
    expect(result).toMatchObject({
      value: 90,
      scoreBand: 'HIGH_PRIORITY',
      band: 'REVIEW',
      bandReasons: ['required_factor_missing'],
    });
  });

  it('sends a lead with too little data to Review only when the policy says so', () => {
    const sparse = assessments({
      industry: null,
      decisionMaker: null,
      sizeLocation: null,
    });
    const review = calculateLeadScore(
      config({}, { maxMissingWeight: 30, whenInsufficient: 'REVIEW' }),
      sparse,
    );
    expect(review).toMatchObject({
      value: 40,
      scoreBand: 'LOW_PRIORITY',
      band: 'REVIEW',
      bandReasons: ['insufficient_data'],
      missingWeight: 60,
    });
    const scored = calculateLeadScore(
      config({}, { maxMissingWeight: 30, whenInsufficient: 'SCORE' }),
      sparse,
    );
    expect(scored).toMatchObject({
      value: 40,
      band: 'LOW_PRIORITY',
      bandReasons: ['insufficient_data'],
    });
    // Exactly the limit is still enough data.
    const atLimit = calculateLeadScore(
      config({}, { maxMissingWeight: 60, whenInsufficient: 'REVIEW' }),
      sparse,
    );
    expect(atLimit).toMatchObject({ band: 'LOW_PRIORITY', bandReasons: [] });
  });

  it('never lifts a lead above Review because of the policy', () => {
    for (const levels of [
      {},
      { timing: null },
      { industry: 0, timing: null },
    ]) {
      for (const whenInsufficient of ['SCORE', 'REVIEW'] as const) {
        const result = calculateLeadScore(
          config({}, { maxMissingWeight: 0, whenInsufficient }),
          assessments(levels),
        );
        if (result.band !== result.scoreBand) {
          expect(result.band).toBe('REVIEW');
        }
      }
    }
  });

  it('does not count a factor with weight 0 as missing', () => {
    const result = calculateLeadScore(
      config(
        { timing: 0, industry: 35 },
        { requiredFactors: ['industry'], maxMissingWeight: 0 },
      ),
      assessments({ timing: null }),
    );
    expect(result).toMatchObject({
      value: 100,
      band: 'HIGH_PRIORITY',
      missingFactors: [],
      missingWeight: 0,
      bandReasons: [],
    });
  });

  it('is deterministic and ignores the order of the assessments', () => {
    const list = assessments({ industry: 2, timing: null });
    const first = calculateLeadScore(DEFAULT_LEAD_SCORING_CONFIG, list);
    expect(calculateLeadScore(DEFAULT_LEAD_SCORING_CONFIG, list)).toEqual(
      first,
    );
    expect(
      calculateLeadScore(DEFAULT_LEAD_SCORING_CONFIG, [...list].reverse()),
    ).toEqual(first);
  });

  it('applies the default policy: without supported need a lead is not High Priority', () => {
    const result = calculateLeadScore(
      DEFAULT_LEAD_SCORING_CONFIG,
      assessments({ supportedNeed: null }),
    );
    expect(result).toMatchObject({
      value: 80,
      scoreBand: 'HIGH_PRIORITY',
      band: 'REVIEW',
      bandReasons: ['required_factor_missing'],
    });
    expect(describeLeadScore(result)).toBe(
      '80 of 100: Review (the score alone is High Priority). Industry 25 of 25; Decision-maker 20 of 20; Size and location 15 of 15; Contact quality 10 of 10; Timing 10 of 10. No evidence: Supported need. A factor that High Priority requires has no evidence.',
    );
  });

  it('lists the stored evidence rows the assessments cite', () => {
    const list: LeadFactorAssessment[] = [
      {
        ...assessed('industry', 4),
        evidence: [
          {
            kind: 'research_fact',
            researchId: EVIDENCE(90),
            researchVersion: 2,
            field: 'industry',
            value: 'Software',
            evidenceIds: [EVIDENCE(3), EVIDENCE(1)],
          },
        ],
      },
      {
        ...assessed('timing', 2),
        evidence: [
          { kind: 'evidence', evidenceId: EVIDENCE(1) },
          { kind: 'evidence', evidenceId: EVIDENCE(2) },
        ],
      },
      missing('supportedNeed'),
    ];
    expect(leadScoreEvidenceIds(list)).toEqual([
      EVIDENCE(1),
      EVIDENCE(2),
      EVIDENCE(3),
    ]);
  });
});
