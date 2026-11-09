// The WebsiteResearchAgent (task 09B, docs/decisions.md D-09B-03 and D-09B-04).
//
// Bounded extracts and campaign context in; facts, hypotheses, unknown fields, review items,
// evidence ids and a confidence out. The model gets fixed instructions, the data and a strict
// output schema, and no tools. Application code then checks the answer's shape, every cited
// extract and quote, the values against their quotes, conflicts, and quotes of instruction-like
// page text. A claim that fails is kept for review, never as a fact; a field without a
// verified fact is unknown. Nothing here decides eligibility, approval, budget or sending.

import type {
  ModelCostEvent,
  ModelProvider,
  ModelResult,
} from '@lead-fennec-ai/integrations';
import {
  SINGLE_VALUED_RESEARCH_FIELDS,
  WEBSITE_RESEARCH_FIELDS,
  websiteResearchInputSchema,
  websiteResearchModelOutputSchema,
  type ResearchConfidence,
  type ResearchExtract,
  type WebsiteResearchField,
  type WebsiteResearchInput,
  type WebsiteResearchModelOutput,
} from '@lead-fennec-ai/shared';
import {
  instructionLikeSentences,
  normalizeForMatch,
  overlapsAny,
  quoteFound,
  valueSupported,
  valueVerbatim,
} from './evidence.js';
import {
  buildResearchInput,
  WEBSITE_RESEARCH_FORMAT_NAME,
  WEBSITE_RESEARCH_INSTRUCTIONS,
  WEBSITE_RESEARCH_JSON_SCHEMA,
  WEBSITE_RESEARCH_PROMPT_SHA256,
  WEBSITE_RESEARCH_PROMPT_VERSION,
  WEBSITE_RESEARCH_SCHEMA_VERSION,
  WEBSITE_RESEARCH_TASK,
} from './prompt.js';
import type {
  ResearchEvidence,
  ResearchHypothesis,
  ResearchUsage,
  ResearchWarning,
  ReviewItem,
  ReviewReason,
  VerifiedFact,
  WebsiteResearchResult,
} from './types.js';

/** Output tokens include reasoning tokens. */
export const RESEARCH_OUTPUT_TOKENS = {
  default: 4000,
  min: 256,
  max: 16_000,
} as const;
/** Instructions and data together; the input contract keeps real inputs well below this. */
export const RESEARCH_MAX_INPUT_CHARS = 60_000;

export interface WebsiteResearchAgentOptions {
  readonly model: ModelProvider;
  readonly maxOutputTokens?: number;
  readonly now?: () => Date;
}

export interface WebsiteResearchRunOptions {
  readonly signal?: AbortSignal;
  /** Every model attempt's cost, as it happens (for the usage ledger). */
  readonly onCost?: (event: ModelCostEvent) => void;
}

const RANK: Readonly<Record<ResearchConfidence, number>> = {
  low: 0,
  medium: 1,
  high: 2,
};

const lower = (a: ResearchConfidence, b: ResearchConfidence) =>
  RANK[a] <= RANK[b] ? a : b;

function totals(events: readonly ModelCostEvent[]): ResearchUsage {
  let cost: number | null = 0;
  for (const event of events) {
    if (event.billing !== 'none') {
      cost =
        cost === null || event.costMicroUsd === null
          ? null
          : cost + event.costMicroUsd;
    }
  }
  return {
    inputTokens: events.reduce(
      (sum, event) => sum + (event.usage?.inputTokens ?? 0),
      0,
    ),
    outputTokens: events.reduce(
      (sum, event) => sum + (event.usage?.outputTokens ?? 0),
      0,
    ),
    costMicroUsd: cost,
    events,
  };
}

const unique = <T>(values: Iterable<T>): T[] => [...new Set(values)];

export class WebsiteResearchAgent {
  readonly #model: ModelProvider;
  readonly #maxOutputTokens: number;
  readonly #now: () => Date;

  constructor(options: WebsiteResearchAgentOptions) {
    const maxOutputTokens =
      options.maxOutputTokens ?? RESEARCH_OUTPUT_TOKENS.default;
    if (
      !Number.isInteger(maxOutputTokens) ||
      maxOutputTokens < RESEARCH_OUTPUT_TOKENS.min ||
      maxOutputTokens > RESEARCH_OUTPUT_TOKENS.max
    ) {
      throw new RangeError('maxOutputTokens is out of bounds.');
    }
    this.#model = options.model;
    this.#maxOutputTokens = maxOutputTokens;
    this.#now = options.now ?? (() => new Date());
  }

  /**
   * Throws a ZodError for input outside the contract, and ProviderError when the model can't be
   * reached (cost events are delivered first). Any problem with the answer itself is a
   * review_required result, never an exception and never a fact.
   */
  async run(
    rawInput: WebsiteResearchInput,
    options: WebsiteResearchRunOptions = {},
  ): Promise<WebsiteResearchResult> {
    const input = websiteResearchInputSchema.parse(rawInput);
    const fields = unique(input.fields ?? WEBSITE_RESEARCH_FIELDS);
    const extracts = input.extracts;
    const suspicious = new Map(
      extracts.map((extract) => [
        extract.id,
        instructionLikeSentences(extract.text),
      ]),
    );
    const warnings: ResearchWarning[] = extracts
      .filter((extract) => (suspicious.get(extract.id) ?? []).length > 0)
      .map((extract) => ({
        code: 'instructions_in_page',
        extractId: extract.id,
      }));
    const events: ModelCostEvent[] = [];
    const base = {
      fields,
      versions: {
        prompt: WEBSITE_RESEARCH_PROMPT_VERSION,
        promptSha256: WEBSITE_RESEARCH_PROMPT_SHA256,
        schema: WEBSITE_RESEARCH_SCHEMA_VERSION,
        provider: this.#model.source,
        model: this.#model.model,
      },
    };

    if (extracts.every((extract) => extract.text.trim() === '')) {
      return {
        ...base,
        status: 'no_content',
        verifiedFacts: [],
        hypotheses: [],
        unknownFields: fields,
        reviewItems: [],
        evidenceIds: [],
        confidence: 'low',
        warnings,
        ignoredInstructions: [],
        usage: totals(events),
        generatedAt: this.#now(),
      };
    }

    const payload = buildResearchInput({
      company: input.company,
      campaign: input.campaign,
      fields,
      extracts,
    });
    if (
      payload.length + WEBSITE_RESEARCH_INSTRUCTIONS.length >
      RESEARCH_MAX_INPUT_CHARS
    ) {
      throw new RangeError('The research input is too long.');
    }
    const result: ModelResult = await this.#model.generate({
      task: WEBSITE_RESEARCH_TASK,
      promptVersion: WEBSITE_RESEARCH_PROMPT_VERSION,
      instructions: WEBSITE_RESEARCH_INSTRUCTIONS,
      input: payload,
      outputSchema: {
        name: WEBSITE_RESEARCH_FORMAT_NAME,
        schema: WEBSITE_RESEARCH_JSON_SCHEMA,
      },
      maxOutputTokens: this.#maxOutputTokens,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      onCost: (event) => {
        events.push(event);
        options.onCost?.(event);
      },
    });
    const answered = {
      ...base,
      versions: { ...base.versions, model: result.model },
    };

    const answerProblem = (reason: ReviewReason): WebsiteResearchResult => ({
      ...answered,
      status: 'review_required',
      verifiedFacts: [],
      hypotheses: [],
      unknownFields: fields,
      reviewItems: [
        { reason, kind: 'answer', field: null, value: null, extractIds: [] },
      ],
      evidenceIds: [],
      confidence: 'low',
      warnings,
      ignoredInstructions: [],
      usage: totals(events),
      generatedAt: this.#now(),
    });

    if (result.kind === 'refusal') {
      return answerProblem('refusal');
    }
    if (result.kind === 'incomplete') {
      return answerProblem(
        result.reason === 'max_output_tokens'
          ? 'output_truncated'
          : result.reason === 'content_filter'
            ? 'content_filtered'
            : 'output_incomplete',
      );
    }
    let json: unknown;
    try {
      json = JSON.parse(result.text);
    } catch {
      return answerProblem('invalid_output');
    }
    const parsed = websiteResearchModelOutputSchema.safeParse(json);
    if (!parsed.success) {
      return answerProblem('invalid_output');
    }
    const checked = check(parsed.data, extracts, fields, suspicious);
    const allWarnings = unique([
      ...warnings.map((warning) => warning.extractId),
      ...checked.ignoredInstructions.map((item) => item.extractId),
    ]).map((extractId): ResearchWarning => ({
      code: 'instructions_in_page',
      extractId,
    }));
    const status =
      checked.reviewItems.length > 0 || allWarnings.length > 0
        ? 'review_required'
        : 'completed';
    const ceiling: ResearchConfidence =
      checked.verifiedFacts.length === 0
        ? 'low'
        : status === 'completed' && checked.verifiedFacts.length >= 3
          ? 'high'
          : 'medium';
    return {
      ...answered,
      status,
      ...checked,
      confidence: ceiling,
      warnings: allWarnings,
      usage: totals(events),
      generatedAt: this.#now(),
    };
  }
}

/** Application code's check of a well-formed answer. */
function check(
  output: WebsiteResearchModelOutput,
  extracts: readonly ResearchExtract[],
  fields: readonly WebsiteResearchField[],
  suspicious: ReadonlyMap<string, readonly string[]>,
): Pick<
  WebsiteResearchResult,
  | 'verifiedFacts'
  | 'hypotheses'
  | 'unknownFields'
  | 'reviewItems'
  | 'evidenceIds'
  | 'ignoredInstructions'
> {
  const byId = new Map(extracts.map((extract) => [extract.id, extract]));
  const reviewItems: ReviewItem[] = [];
  const review = (
    reason: ReviewReason,
    kind: ReviewItem['kind'],
    field: WebsiteResearchField | null,
    value: string | null,
    extractIds: readonly string[],
  ) => {
    reviewItems.push({
      reason,
      kind,
      field,
      value,
      extractIds: unique(extractIds),
    });
  };

  let accepted: VerifiedFact[] = [];
  for (const fact of output.facts) {
    const ids = fact.evidence.map((item) => item.extractId);
    if (!fields.includes(fact.field)) {
      review('field_not_requested', 'fact', fact.field, fact.value, ids);
      continue;
    }
    let failure: ReviewReason | null = null;
    const evidence: ResearchEvidence[] = [];
    for (const item of fact.evidence) {
      const extract = byId.get(item.extractId);
      if (extract === undefined) {
        failure = 'unknown_extract';
        break;
      }
      if (!quoteFound(item.quote, extract.text)) {
        failure = 'evidence_not_found';
        break;
      }
      if (overlapsAny(item.quote, suspicious.get(extract.id) ?? [])) {
        failure = 'suspicious_instructions';
        break;
      }
      evidence.push({
        extractId: extract.id,
        quote: item.quote,
        url: extract.url,
        retrievedAt: extract.retrievedAt,
        contentSha256: extract.contentSha256,
      });
    }
    const quotes = fact.evidence.map((item) => item.quote);
    if (failure === null && !valueSupported(fact.value, quotes)) {
      failure = 'value_not_in_evidence';
    }
    if (failure !== null) {
      review(failure, 'fact', fact.field, fact.value, ids);
      continue;
    }
    // The model's confidence, but "high" only when the value is written out in a quote.
    const confidence = lower(
      fact.confidence,
      valueVerbatim(fact.value, quotes) ? 'high' : 'medium',
    );
    const duplicate = accepted.some(
      (kept) =>
        kept.field === fact.field &&
        normalizeForMatch(kept.value) === normalizeForMatch(fact.value),
    );
    if (!duplicate) {
      accepted.push({
        field: fact.field,
        value: fact.value,
        evidence,
        confidence,
      });
    }
  }

  // A field with one true value and two different supported values: a person decides.
  for (const field of SINGLE_VALUED_RESEARCH_FIELDS) {
    const values = accepted.filter((fact) => fact.field === field);
    if (values.length > 1) {
      for (const fact of values) {
        review(
          'conflicting_evidence',
          'fact',
          field,
          fact.value,
          fact.evidence.map((item) => item.extractId),
        );
      }
      accepted = accepted.filter((fact) => fact.field !== field);
    }
  }

  const hypotheses: ResearchHypothesis[] = [];
  for (const hypothesis of output.hypotheses) {
    if (hypothesis.evidenceIds.some((id) => !byId.has(id))) {
      review(
        'unknown_extract',
        'hypothesis',
        null,
        hypothesis.statement,
        hypothesis.evidenceIds,
      );
      continue;
    }
    if (instructionLikeSentences(hypothesis.statement).length > 0) {
      review(
        'suspicious_instructions',
        'hypothesis',
        null,
        hypothesis.statement,
        hypothesis.evidenceIds,
      );
      continue;
    }
    hypotheses.push({
      statement: hypothesis.statement,
      evidenceIds: unique(hypothesis.evidenceIds),
      confidence: hypothesis.confidence,
    });
  }

  const ignoredInstructions = output.ignoredInstructions
    .filter((item) => {
      const extract = byId.get(item.extractId);
      return extract !== undefined && quoteFound(item.quote, extract.text);
    })
    .map((item) => ({ extractId: item.extractId, quote: item.quote }));

  const known = new Set(accepted.map((fact) => fact.field));
  return {
    verifiedFacts: accepted,
    hypotheses,
    unknownFields: fields.filter((field) => !known.has(field)),
    reviewItems,
    evidenceIds: unique([
      ...accepted.flatMap((fact) =>
        fact.evidence.map((item) => item.extractId),
      ),
      ...hypotheses.flatMap((hypothesis) => hypothesis.evidenceIds),
    ]).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))),
    ignoredInstructions,
  };
}
