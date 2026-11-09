// The LeadQualificationAgent (task 10C, docs/decisions.md D-10C-01).
//
// Verified research facts and the campaign's offer in; for supported need and timing, a proposed
// level with the facts it rests on and an explanation out. The model gets fixed instructions,
// the data and a strict output schema, and no tools. Application code then checks the answer's
// shape, that every factor is answered once, that every cited fact exists, that a level cites
// facts, that timing rests on dated signals, and that nothing cited or written tries to
// instruct a model. A proposal that fails is dropped (its factor stays missing) and the result
// needs review; an answer that fails as a whole drops everything. The agent never scores, never
// decides a state and never touches eligibility: application code does.

import type {
  ModelCostEvent,
  ModelProvider,
  ModelProviderName,
  ModelResult,
} from '@lead-fennec-ai/integrations';
import {
  QUALIFICATION_MODEL_FACTORS,
  QUALIFICATION_TIMING_FIELDS,
  qualificationInputSchema,
  qualificationModelOutputSchema,
  type QualificationInput,
  type QualificationModelFactor,
  type QualificationReviewReason,
} from '@lead-fennec-ai/shared';
import { instructionLikeSentences } from '../website-research/evidence.js';
import {
  buildQualificationInput,
  LEAD_QUALIFICATION_FORMAT_NAME,
  LEAD_QUALIFICATION_INSTRUCTIONS,
  LEAD_QUALIFICATION_JSON_SCHEMA,
  LEAD_QUALIFICATION_PROMPT_SHA256,
  LEAD_QUALIFICATION_PROMPT_VERSION,
  LEAD_QUALIFICATION_SCHEMA_VERSION,
  LEAD_QUALIFICATION_TASK,
} from './prompt.js';

/** Output tokens include reasoning tokens. */
export const QUALIFICATION_OUTPUT_TOKENS = {
  default: 2000,
  min: 256,
  max: 8000,
} as const;
/** Instructions and data together; the input contract keeps real inputs well below this. */
export const QUALIFICATION_MAX_INPUT_CHARS = 40_000;

/** An accepted proposal. level null: the facts say nothing about it (the factor is missing). */
export interface QualificationProposal {
  readonly factor: QualificationModelFactor;
  readonly level: number | null;
  /** The cited facts (none when level is null). */
  readonly factIds: readonly string[];
  /** The model's words (untrusted text, escaped when shown). */
  readonly explanation: string;
}

export interface QualificationReviewItem {
  readonly reason: QualificationReviewReason;
  /** null: about the whole answer. */
  readonly factor: QualificationModelFactor | null;
}

export interface LeadQualificationResult {
  /**
   * completed: every proposal checked out. review_required: something was refused or flagged
   * (see reviewItems); refused factors have no proposal. no_facts: nothing to read, no model call.
   */
  readonly status: 'completed' | 'review_required' | 'no_facts';
  readonly versions: {
    readonly prompt: string;
    readonly promptSha256: string;
    readonly schema: string;
    readonly provider: ModelProviderName;
    readonly model: string;
  };
  /** Accepted proposals only, in QUALIFICATION_MODEL_FACTORS order. */
  readonly proposals: readonly QualificationProposal[];
  readonly reviewItems: readonly QualificationReviewItem[];
  /** Fact text the model reported ignoring, when the fact exists. */
  readonly ignoredInstructions: readonly {
    readonly factId: string;
    readonly quote: string;
  }[];
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    /** Null when any attempt's cost is unknown. */
    readonly costMicroUsd: number | null;
    readonly events: readonly ModelCostEvent[];
  };
  readonly generatedAt: Date;
}

export interface LeadQualificationAgentOptions {
  readonly model: ModelProvider;
  readonly maxOutputTokens?: number;
  readonly now?: () => Date;
}

export interface LeadQualificationRunOptions {
  readonly signal?: AbortSignal;
  /** Every model attempt's cost, as it happens (for the usage ledger). */
  readonly onCost?: (event: ModelCostEvent) => void;
}

function totals(
  events: readonly ModelCostEvent[],
): LeadQualificationResult['usage'] {
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

export class LeadQualificationAgent {
  readonly #model: ModelProvider;
  readonly #maxOutputTokens: number;
  readonly #now: () => Date;

  constructor(options: LeadQualificationAgentOptions) {
    const maxOutputTokens =
      options.maxOutputTokens ?? QUALIFICATION_OUTPUT_TOKENS.default;
    if (
      !Number.isInteger(maxOutputTokens) ||
      maxOutputTokens < QUALIFICATION_OUTPUT_TOKENS.min ||
      maxOutputTokens > QUALIFICATION_OUTPUT_TOKENS.max
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
   * review_required result, never an exception and never an accepted proposal.
   */
  async run(
    rawInput: QualificationInput,
    options: LeadQualificationRunOptions = {},
  ): Promise<LeadQualificationResult> {
    const input = qualificationInputSchema.parse(rawInput);
    const events: ModelCostEvent[] = [];
    const versions = {
      prompt: LEAD_QUALIFICATION_PROMPT_VERSION,
      promptSha256: LEAD_QUALIFICATION_PROMPT_SHA256,
      schema: LEAD_QUALIFICATION_SCHEMA_VERSION,
      provider: this.#model.source,
      model: this.#model.model,
    };
    if (input.facts.length === 0) {
      return {
        status: 'no_facts',
        versions,
        proposals: [],
        reviewItems: [],
        ignoredInstructions: [],
        usage: totals(events),
        generatedAt: this.#now(),
      };
    }
    const payload = buildQualificationInput(input);
    if (
      payload.length + LEAD_QUALIFICATION_INSTRUCTIONS.length >
      QUALIFICATION_MAX_INPUT_CHARS
    ) {
      throw new RangeError('The qualification input is too long.');
    }
    const result: ModelResult = await this.#model.generate({
      task: LEAD_QUALIFICATION_TASK,
      promptVersion: LEAD_QUALIFICATION_PROMPT_VERSION,
      instructions: LEAD_QUALIFICATION_INSTRUCTIONS,
      input: payload,
      outputSchema: {
        name: LEAD_QUALIFICATION_FORMAT_NAME,
        schema: LEAD_QUALIFICATION_JSON_SCHEMA,
      },
      maxOutputTokens: this.#maxOutputTokens,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      onCost: (event) => {
        events.push(event);
        options.onCost?.(event);
      },
    });
    const answered = { ...versions, model: result.model };
    const refused = (
      reason: QualificationReviewReason,
    ): LeadQualificationResult => ({
      status: 'review_required',
      versions: answered,
      proposals: [],
      reviewItems: [{ reason, factor: null }],
      ignoredInstructions: [],
      usage: totals(events),
      generatedAt: this.#now(),
    });
    if (result.kind === 'refusal') {
      return refused('refusal');
    }
    if (result.kind === 'incomplete') {
      return refused(
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
      return refused('invalid_output');
    }
    const parsed = qualificationModelOutputSchema.safeParse(json);
    if (!parsed.success) {
      return refused('invalid_output');
    }

    const facts = new Map(input.facts.map((fact) => [fact.id, fact]));
    const suspicious = new Set(
      input.facts
        .filter(
          (fact) =>
            instructionLikeSentences([fact.value, ...fact.quotes].join('\n'))
              .length > 0,
        )
        .map((fact) => fact.id),
    );
    const proposals: QualificationProposal[] = [];
    const reviewItems: QualificationReviewItem[] = [];
    for (const factor of QUALIFICATION_MODEL_FACTORS) {
      const answers = parsed.data.assessments.filter(
        (item) => item.factor === factor,
      );
      const answer = answers[0];
      if (answers.length !== 1 || answer === undefined) {
        reviewItems.push({ reason: 'factor_missing', factor });
        continue;
      }
      const factIds = [...new Set(answer.factIds)];
      const problem: QualificationReviewReason | null = factIds.some(
        (id) => !facts.has(id),
      )
        ? 'unknown_fact'
        : answer.level !== null && factIds.length === 0
          ? 'level_without_evidence'
          : factor === 'timing' &&
              answer.level !== null &&
              factIds.some(
                (id) =>
                  !(QUALIFICATION_TIMING_FIELDS as readonly string[]).includes(
                    facts.get(id)?.field ?? '',
                  ),
              )
            ? 'timing_without_signal'
            : factIds.some((id) => suspicious.has(id)) ||
                instructionLikeSentences(answer.explanation).length > 0
              ? 'suspicious_instructions'
              : null;
      if (problem !== null) {
        reviewItems.push({ reason: problem, factor });
        continue;
      }
      proposals.push({
        factor,
        level: answer.level,
        // A null level rests on nothing: whatever it cited is left out.
        factIds: answer.level === null ? [] : factIds,
        explanation: answer.explanation,
      });
    }
    const ignoredInstructions = parsed.data.ignoredInstructions.filter((item) =>
      facts.has(item.factId),
    );
    if (ignoredInstructions.length > 0) {
      // Facts that try to instruct a model are worth a person's look, even when ignored.
      reviewItems.push({ reason: 'suspicious_instructions', factor: null });
    }
    return {
      status: reviewItems.length > 0 ? 'review_required' : 'completed',
      versions: answered,
      proposals,
      reviewItems,
      ignoredInstructions,
      usage: totals(events),
      generatedAt: this.#now(),
    };
  }
}
