// The rules that assess lead-score factors from stored data (task 10A, docs/decisions.md
// D-10A-04): industry, decision-maker, size and location, and contact quality. Supported need
// and timing need a reading of the research (task 10C), so the rules leave them "not assessed".
//
// Every assessment cites the stored values it read. A value that isn't stored is missing, never
// guessed, and a missing factor earns nothing. The facts a run read (targets, the person, the
// company, the research version, the email check, the time) are kept with the score
// (leadScoreInputsSchema), so the score can be recomputed and checked later
// (reproduceLeadScore). Stored text (titles, industries) is untrusted data: it is only compared
// and quoted, never followed. Pure and deterministic.
import { z } from 'zod';
import type { AudienceFilters } from './campaigns.js';
import {
  rankRoleRelevance,
  VERIFICATION_MAX_AGE_DAYS,
} from './contact-enrichment.js';
import type { IcpCriteria } from './lead-discovery.js';
import {
  calculateLeadScore,
  LEAD_FACTOR_MAX_LEVEL,
  LEAD_SCORE_BAND_RANGES,
  LEAD_SCORE_EMAIL_CHECK_STATUSES,
  LEAD_SCORE_FACTORS,
  LEAD_SCORE_METHOD,
  LEAD_SCORE_VALUE_CHARS,
  leadFactorAssessmentsSchema,
  leadScoringConfigSchema,
  type LeadFactorAssessment,
  type LeadScoreEvidence,
  type LeadScoreFactor,
  type LeadScoreResult,
} from './lead-scoring.js';

/** The rules' version, stored with every score's inputs. */
export const LEAD_SCORE_RULES_VERSION = 'lead-score-rules/1';

const iso = z.iso.datetime();
const countryCode = z.string().regex(/^[A-Z]{2}$/);
const valueText = z.string().max(LEAD_SCORE_VALUE_CHARS);

/** What the campaign targets, from its lead filters, else its ICP. */
export const leadScoreTargetsSchema = z.strictObject({
  industries: z.array(z.string().max(100)).max(50),
  titles: z.array(z.string().max(100)).max(50),
  seniorities: z.array(z.string().max(40)).max(10),
  countries: z.array(countryCode).max(50),
  employees: z.strictObject({
    min: z.int().min(1).nullable(),
    max: z.int().min(1).nullable(),
  }),
});

export type LeadScoreTargets = z.output<typeof leadScoreTargetsSchema>;

/**
 * The campaign's targets: each list from the campaign's lead filters when they set it (they
 * narrow the audience), else from its ICP. Seniorities come from the ICP only.
 */
export function scoringTargets(
  filters: AudienceFilters | null,
  icp: IcpCriteria | null,
): LeadScoreTargets {
  const pick = (
    campaign: readonly string[] | undefined,
    profile: readonly string[] | undefined,
  ) => [
    ...(campaign !== undefined && campaign.length > 0
      ? campaign
      : (profile ?? [])),
  ];
  const campaignRange =
    filters !== null &&
    (filters.employeeCountMin !== undefined ||
      filters.employeeCountMax !== undefined);
  return {
    industries: pick(filters?.industries, icp?.industries),
    titles: pick(filters?.titles, icp?.titles),
    seniorities: [...(icp?.seniorities ?? [])],
    countries: pick(filters?.countries, icp?.countries),
    employees: campaignRange
      ? {
          min: filters.employeeCountMin ?? null,
          max: filters.employeeCountMax ?? null,
        }
      : { min: icp?.employees?.min ?? null, max: icp?.employees?.max ?? null },
  };
}

/** Everything the rules read, as it was when the score was calculated. */
export const leadScoreFactsSchema = z.strictObject({
  /** Freshness (of an email check) is judged at this time. */
  asOf: iso,
  targets: leadScoreTargetsSchema,
  contact: z.strictObject({
    id: z.uuid(),
    title: valueText.nullable(),
    countryCode: countryCode.nullable(),
    hasEmail: z.boolean(),
  }),
  organization: z
    .strictObject({
      id: z.uuid(),
      industry: valueText.nullable(),
      employeeCount: z.int().min(0).nullable(),
      countryCode: countryCode.nullable(),
    })
    .nullable(),
  /** The company's current research version (task 09C) and its industry fact, if any. */
  research: z
    .strictObject({
      id: z.uuid(),
      version: z.int().min(1),
      completedAt: iso,
      industry: z
        .strictObject({
          value: valueText,
          evidenceIds: z.array(z.uuid()).min(1).max(3),
        })
        .nullable(),
    })
    .nullable(),
  /** The newest check of the person's current address. */
  emailCheck: z
    .strictObject({
      verificationId: z.uuid(),
      status: z.enum(LEAD_SCORE_EMAIL_CHECK_STATUSES),
      checkedAt: iso,
    })
    .nullable(),
});

export type LeadScoreFacts = z.output<typeof leadScoreFactsSchema>;

// ─── The rules ───────────────────────────────────────────────────────────────

const STOP_WORDS = new Set(['of', 'and', 'the', 'for', 'at', 'in', 'to', 'a']);

/** Lower-case ASCII words ("Computer Software & IT" → "computer software it"). */
function normalizeTerm(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const termWords = (text: string) =>
  normalizeTerm(text)
    .split(' ')
    .filter((word) => word !== '' && !STOP_WORDS.has(word));

/** Untrusted text inside an explanation: shortened and quoted, never interpreted. */
const quote = (text: string) =>
  `"${text.length > 80 ? `${text.slice(0, 77)}...` : text}"`;

const clip = (text: string) =>
  text.length > 300 ? `${text.slice(0, 297)}...` : text;

function missing(
  factor: LeadScoreFactor,
  reason: 'no_data' | 'no_target' | 'not_assessed',
  explanation: string,
): LeadFactorAssessment {
  return {
    factor,
    status: 'missing',
    reason,
    assessedBy: 'rules',
    explanation: clip(explanation),
  };
}

function assessed(
  factor: LeadScoreFactor,
  level: number,
  evidence: LeadScoreEvidence[],
  explanation: string,
): LeadFactorAssessment {
  return {
    factor,
    status: 'assessed',
    level,
    assessedBy: 'rules',
    evidence,
    explanation: clip(explanation),
  };
}

/**
 * Industry: the company's stored industry, else its research's industry fact, against the
 * targeted industries. The same words: full; every word of one in the other: strong; a shared
 * word: weak; nothing in common: none.
 */
function industry(facts: LeadScoreFacts): LeadFactorAssessment {
  const targets = facts.targets.industries;
  if (targets.length === 0) {
    return missing(
      'industry',
      'no_target',
      'The campaign targets no industries. Add industries, or give this factor a weight of 0.',
    );
  }
  const organization = facts.organization;
  const fact = facts.research?.industry ?? null;
  let value: string;
  let evidence: LeadScoreEvidence[];
  if (organization !== null && organization.industry !== null) {
    value = organization.industry;
    evidence = [
      {
        kind: 'organization_field',
        organizationId: organization.id,
        field: 'industry',
        value,
      },
    ];
  } else if (facts.research !== null && fact !== null) {
    value = fact.value;
    evidence = [
      {
        kind: 'research_fact',
        researchId: facts.research.id,
        researchVersion: facts.research.version,
        field: 'industry',
        value,
        evidenceIds: fact.evidenceIds,
      },
    ];
  } else {
    return missing(
      'industry',
      'no_data',
      "The company's industry isn't known.",
    );
  }
  const own = normalizeTerm(value);
  const ownWords = termWords(value);
  let level = 0;
  let matched: string | null = null;
  for (const target of targets) {
    const wanted = termWords(target);
    let candidate = 0;
    if (own !== '' && own === normalizeTerm(target)) {
      candidate = 4;
    } else if (
      wanted.length > 0 &&
      ownWords.length > 0 &&
      (wanted.every((word) => ownWords.includes(word)) ||
        ownWords.every((word) => wanted.includes(word)))
    ) {
      candidate = 3;
    } else if (wanted.some((word) => ownWords.includes(word))) {
      candidate = 1;
    }
    if (candidate > level) {
      level = candidate;
      matched = target;
    }
  }
  const source =
    evidence[0]?.kind === 'research_fact' ? ' (from research)' : '';
  const explanation =
    matched === null
      ? `The industry ${quote(value)}${source} isn't one of the targeted industries.`
      : level === 4
        ? `The industry ${quote(value)}${source} is a targeted industry.`
        : level === 3
          ? `The industry ${quote(value)}${source} matches the targeted industry ${quote(matched)}.`
          : `The industry ${quote(value)}${source} shares a word with the targeted industry ${quote(matched)}.`;
  return assessed('industry', level, evidence, explanation);
}

/**
 * Decision-maker: the person's title against the targeted titles and seniorities, ranked by
 * rankRoleRelevance (task 08A, the one definition of role fit). Its 0–100 score is scaled to
 * what the campaign targets: titles count up to 70, seniorities up to 30.
 */
function decisionMaker(facts: LeadScoreFacts): LeadFactorAssessment {
  const { titles, seniorities } = facts.targets;
  if (titles.length === 0 && seniorities.length === 0) {
    return missing(
      'decisionMaker',
      'no_target',
      'The campaign targets no titles or seniorities. Add some, or give this factor a weight of 0.',
    );
  }
  const title = facts.contact.title;
  if (title === null || title.trim() === '') {
    return missing(
      'decisionMaker',
      'no_data',
      "The person's title isn't known.",
    );
  }
  const relevance = rankRoleRelevance({ title }, { titles, seniorities });
  const reachable =
    (titles.length > 0 ? 70 : 0) + (seniorities.length > 0 ? 30 : 0);
  const level = Math.min(
    LEAD_FACTOR_MAX_LEVEL,
    Math.floor((LEAD_FACTOR_MAX_LEVEL * relevance.score) / reachable),
  );
  return assessed(
    'decisionMaker',
    level,
    [
      {
        kind: 'contact_field',
        contactId: facts.contact.id,
        field: 'title',
        value: title,
      },
    ],
    level > 0 && relevance.reasons.length > 0
      ? `${relevance.reasons.join('; ')}.`
      : `The title ${quote(title)} doesn't match the targeted roles.`,
  );
}

const rangeText = (min: number | null, max: number | null) =>
  min !== null && max !== null
    ? `${String(min)} to ${String(max)}`
    : min !== null
      ? `at least ${String(min)}`
      : `at most ${String(max)}`;

/**
 * Size and location: the company's employees against the targeted range and its country (else
 * the person's) against the targeted countries. Each targeted part is an equal share; a part
 * whose value isn't known earns nothing.
 */
function sizeLocation(facts: LeadScoreFacts): LeadFactorAssessment {
  const { employees, countries } = facts.targets;
  const sizeTargeted = employees.min !== null || employees.max !== null;
  const locationTargeted = countries.length > 0;
  if (!sizeTargeted && !locationTargeted) {
    return missing(
      'sizeLocation',
      'no_target',
      'The campaign targets no company size or countries. Add them, or give this factor a weight of 0.',
    );
  }
  const organization = facts.organization;
  const evidence: LeadScoreEvidence[] = [];
  const notes: string[] = [];
  let parts = 0;
  let matches = 0;
  if (sizeTargeted) {
    parts += 1;
    const count = organization?.employeeCount ?? null;
    if (organization !== null && count !== null) {
      const inside =
        (employees.min === null || count >= employees.min) &&
        (employees.max === null || count <= employees.max);
      matches += inside ? 1 : 0;
      evidence.push({
        kind: 'organization_field',
        organizationId: organization.id,
        field: 'employeeCount',
        value: count,
      });
      notes.push(
        `${String(count)} employees, ${inside ? 'inside' : 'outside'} ${rangeText(employees.min, employees.max)}`,
      );
    } else {
      notes.push("the number of employees isn't known");
    }
  }
  if (locationTargeted) {
    parts += 1;
    const fromCompany = organization?.countryCode ?? null;
    const country = fromCompany ?? facts.contact.countryCode;
    if (country !== null) {
      const inside = countries.includes(country);
      matches += inside ? 1 : 0;
      evidence.push(
        organization !== null && fromCompany !== null
          ? {
              kind: 'organization_field',
              organizationId: organization.id,
              field: 'countryCode',
              value: country,
            }
          : {
              kind: 'contact_field',
              contactId: facts.contact.id,
              field: 'countryCode',
              value: country,
            },
      );
      notes.push(
        `${fromCompany !== null ? 'company' : "person's"} country ${country} is ${inside ? '' : 'not '}targeted`,
      );
    } else {
      notes.push("the country isn't known");
    }
  }
  if (evidence.length === 0) {
    return missing(
      'sizeLocation',
      'no_data',
      `${notes.join('; ')}.`.replace(/^./, (c) => c.toUpperCase()),
    );
  }
  return assessed(
    'sizeLocation',
    (LEAD_FACTOR_MAX_LEVEL * matches) / parts,
    evidence,
    `${notes.join('; ')}.`.replace(/^./, (c) => c.toUpperCase()),
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Contact quality: the newest check of the person's current address. Verified within 30 days:
 * full; verified earlier: partial; risky: weak; unknown or invalid: none. No address or no
 * check (or one dated after the score): missing.
 */
function contactQuality(facts: LeadScoreFacts): LeadFactorAssessment {
  if (!facts.contact.hasEmail) {
    return missing(
      'contactQuality',
      'no_data',
      'The person has no email address.',
    );
  }
  const check = facts.emailCheck;
  const asOf = Date.parse(facts.asOf);
  if (check === null || Date.parse(check.checkedAt) > asOf) {
    return missing(
      'contactQuality',
      'no_data',
      "The email address hasn't been checked.",
    );
  }
  const evidence: LeadScoreEvidence[] = [
    {
      kind: 'email_check',
      verificationId: check.verificationId,
      status: check.status,
      checkedAt: check.checkedAt,
    },
  ];
  switch (check.status) {
    case 'VALID':
      return asOf - Date.parse(check.checkedAt) >
        VERIFICATION_MAX_AGE_DAYS * DAY_MS
        ? assessed(
            'contactQuality',
            2,
            evidence,
            `The address was verified more than ${String(VERIFICATION_MAX_AGE_DAYS)} days ago.`,
          )
        : assessed(
            'contactQuality',
            4,
            evidence,
            'The address was verified recently.',
          );
    case 'RISKY':
      return assessed(
        'contactQuality',
        1,
        evidence,
        'The address may not accept email (for example, the domain accepts everything).',
      );
    case 'UNKNOWN':
      return assessed(
        'contactQuality',
        0,
        evidence,
        "The check couldn't tell whether the address accepts email.",
      );
    case 'INVALID':
      return assessed(
        'contactQuality',
        0,
        evidence,
        "The address doesn't accept email.",
      );
  }
}

/**
 * One assessment per factor, in LEAD_SCORE_FACTORS order, from the facts alone. Supported need
 * and timing are left "not assessed" (task 10C reads the research for them).
 */
export function assessLeadFactors(raw: LeadScoreFacts): LeadFactorAssessment[] {
  const facts = leadScoreFactsSchema.parse(raw);
  return [
    industry(facts),
    decisionMaker(facts),
    sizeLocation(facts),
    missing(
      'supportedNeed',
      'not_assessed',
      'Not assessed yet: it needs a reading of the research, which the qualification step will add.',
    ),
    contactQuality(facts),
    missing(
      'timing',
      'not_assessed',
      'Not assessed yet: it needs a reading of the research, which the qualification step will add.',
    ),
  ];
}

// ─── Stored inputs and reproduction ──────────────────────────────────────────

/**
 * What became of the qualification agent's answer (task 10C): completed (every proposal checked
 * out), review_required (refused, invalid or flagged: its factors are missing), no_facts (no
 * research to read, the model wasn't called), unavailable (no model configured).
 */
export const LEAD_SCORE_AGENT_STATUSES = [
  'completed',
  'review_required',
  'no_facts',
  'unavailable',
] as const;

export type LeadScoreAgentStatus = (typeof LEAD_SCORE_AGENT_STATUSES)[number];

export const leadScoreAgentRunSchema = z.strictObject({
  status: z.enum(LEAD_SCORE_AGENT_STATUSES),
  prompt: z.string().max(100),
  promptSha256: z.string().regex(/^[0-9a-f]{64}$/),
  schema: z.string().max(100),
  provider: z.enum(['OPENAI', 'FAKE']),
  model: z.string().max(200),
  /** Why something was refused or flagged, by factor (null: the whole answer). */
  reviewItems: z
    .array(
      z.strictObject({
        reason: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
        factor: z.enum(LEAD_SCORE_FACTORS).nullable(),
      }),
    )
    .max(20),
});

export type LeadScoreAgentRun = z.output<typeof leadScoreAgentRunSchema>;

/**
 * Everything a stored score was calculated from (scores.inputs): the versions of the
 * calculation and the rules, the configuration and the campaign version it came from, the facts
 * the rules read, and the assessments. Validated before every write and every read.
 */
export const leadScoreInputsSchema = z.strictObject({
  v: z.literal(1),
  method: z.literal(LEAD_SCORE_METHOD),
  rules: z.literal(LEAD_SCORE_RULES_VERSION),
  config: leadScoringConfigSchema,
  /** "default" when the campaign hadn't set its own. */
  configSource: z.enum(['campaign', 'default']),
  campaign: z.strictObject({
    id: z.uuid(),
    version: z.int().min(1),
    icpId: z.uuid().nullable(),
  }),
  facts: leadScoreFactsSchema,
  assessments: leadFactorAssessmentsSchema,
  /**
   * The qualification agent's run, when it proposed assessments (task 10C): its prompt and
   * schema versions, the model, and what application code made of the answer. Absent before 10C.
   */
  agent: leadScoreAgentRunSchema.optional(),
});

export type LeadScoreInputs = z.output<typeof leadScoreInputsSchema>;

/** JSON with object keys sorted, so equal data compares equal. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item as Record<string, unknown>)
            .sort()
            .map((key) => [key, (item as Record<string, unknown>)[key]]),
        )
      : item,
  );
}

export interface LeadScoreReproduction {
  /** True when the stored inputs give the stored value and band again. */
  readonly reproducible: boolean;
  readonly differences: readonly string[];
  /** The recalculated result (null when the inputs can't be read). */
  readonly result: LeadScoreResult | null;
}

/**
 * Recalculates a stored score from its stored inputs: the rules again on the stored facts
 * (every rules assessment must come out the same), then the calculation on the stored
 * assessments (the value and the band must come out the same).
 */
export function reproduceLeadScore(
  rawInputs: unknown,
  stored: { readonly value: number; readonly band: string },
): LeadScoreReproduction {
  const parsed = leadScoreInputsSchema.safeParse(rawInputs);
  if (!parsed.success) {
    return {
      reproducible: false,
      differences: ["The stored inputs aren't valid."],
      result: null,
    };
  }
  const inputs = parsed.data;
  const differences: string[] = [];
  const again = assessLeadFactors(inputs.facts);
  for (const assessment of inputs.assessments) {
    if (assessment.assessedBy !== 'rules') {
      continue;
    }
    const rerun = again.find((item) => item.factor === assessment.factor);
    if (stableJson(rerun) !== stableJson(assessment)) {
      differences.push(
        `The rules assess ${assessment.factor} differently from the stored assessment.`,
      );
    }
  }
  const result = calculateLeadScore(inputs.config, inputs.assessments);
  if (result.value !== stored.value) {
    differences.push(
      `The inputs give ${String(result.value)}, not the stored ${String(stored.value)}.`,
    );
  }
  if (result.band !== stored.band) {
    differences.push(
      `The inputs give ${LEAD_SCORE_BAND_RANGES[result.band].label}, not the stored band.`,
    );
  }
  return { reproducible: differences.length === 0, differences, result };
}
