// The model of development and tests (task 09B, docs/decisions.md D-09B-06). It never opens a
// connection and costs nothing. Answers come, in order, from a test's script, a responder for
// the task, or a built-in responder: website research (a deterministic reader that quotes
// sentences matching simple patterns, so it cites only what the extracts say) and lead
// qualification (task 10C: ratings that cite only the facts given).

import {
  WEBSITE_RESEARCH_FIELDS,
  type WebsiteResearchField,
  type QualificationModelOutput,
  type WebsiteResearchModelOutput,
} from '@lead-fennec-ai/shared';
import { ProviderError, type ProviderErrorCode } from '../providers.js';
import {
  assertModelRequest,
  type ModelCostEvent,
  type ModelProvider,
  type ModelRequest,
  type ModelResult,
  type ModelUsage,
} from './types.js';

export type FakeModelAnswer =
  | { readonly json: unknown }
  | { readonly text: string }
  | { readonly refusal: string }
  | { readonly incomplete: 'max_output_tokens' | 'content_filter' }
  | { readonly error: ProviderErrorCode };

export type FakeModelResponder = (request: ModelRequest) => FakeModelAnswer;

export interface FakeModelOptions {
  readonly model?: string;
  /** Answers used first, one per request, in order. */
  readonly script?: readonly FakeModelAnswer[];
  /** Answers by task name, after the script. */
  readonly responders?: Readonly<Record<string, FakeModelResponder>>;
  readonly now?: () => Date;
}

const FIXED_TIME = new Date('2026-01-01T00:00:00.000Z');

// ─── The built-in website-research responder ─────────────────────────────────

const FIELD_PATTERNS: readonly [WebsiteResearchField, RegExp][] = [
  ['headquarters', /\b(headquartered|headquarters|head office|based in)\b/i],
  ['founded_year', /\b(founded|established|since)\b.*\b(1[89]\d\d|20\d\d)\b/i],
  ['employee_count', /\b\d[\d,.]*\+?\s+(employees|people|staff)\b/i],
  [
    'products_services',
    /\b(we|our company)\s+(provide|offer|build|make|sell|develop)/i,
  ],
  [
    'target_customers',
    /\b(for|serve|serves|serving)\b.*\b(customers|companies|businesses|teams)\b/i,
  ],
  ['markets_served', /\b(offices? in|operate in|operates in|customers in)\b/i],
  ['notable_customers', /\b(customers include|trusted by|clients include)\b/i],
  ['recent_news', /\b(announced|launched|announces|launches)\b/i],
  ['technologies', /\b(built on|built with|powered by|integrates with)\b/i],
  [
    'hiring',
    /\b(we are hiring|we're hiring|open roles|open positions|join our team)\b/i,
  ],
  ['industry', /\b(industry|sector)\b/i],
];

/** Instruction-like page text the responder reports as ignored, like a careful model would. */
const INSTRUCTION_LIKE =
  /\b(ignore|disregard|forget)\b.*\b(instructions|rules|prompt)\b|\bsystem prompt\b|\byou are now\b/i;

interface FakeExtract {
  readonly id: string;
  readonly text: string;
}

function readResearchInput(input: string): {
  readonly fields: readonly WebsiteResearchField[];
  readonly extracts: readonly FakeExtract[];
} {
  const data = JSON.parse(input) as {
    fields?: { name?: unknown }[];
    extracts?: { id?: unknown; text?: unknown }[];
  };
  const fields = (data.fields ?? [])
    .map((field) => field.name)
    .filter((name): name is WebsiteResearchField =>
      (WEBSITE_RESEARCH_FIELDS as readonly unknown[]).includes(name),
    );
  const extracts = (data.extracts ?? []).flatMap((extract) =>
    typeof extract.id === 'string' && typeof extract.text === 'string'
      ? [{ id: extract.id, text: extract.text }]
      : [],
  );
  return { fields, extracts };
}

/** Sentences as exact substrings of the text (so they are valid quotes). */
function sentences(text: string): string[] {
  return (text.match(/[^.!?\n]+[.!?]?/g) ?? [])
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 3);
}

const clip = (value: string, max: number) =>
  value.length <= max ? value : value.slice(0, max);

/** Deterministic research: the first sentence matching each requested field. */
export function fakeWebsiteResearch(
  request: ModelRequest,
): WebsiteResearchModelOutput {
  const { fields, extracts } = readResearchInput(request.input);
  const facts: WebsiteResearchModelOutput['facts'][number][] = [];
  const ignored: WebsiteResearchModelOutput['ignoredInstructions'][number][] =
    [];
  const found = new Set<WebsiteResearchField>();
  for (const extract of extracts) {
    for (const sentence of sentences(extract.text)) {
      const quote = clip(sentence, 300);
      if (INSTRUCTION_LIKE.test(sentence)) {
        if (ignored.length < 5) {
          ignored.push({ extractId: extract.id, quote });
        }
        continue;
      }
      for (const [field, pattern] of FIELD_PATTERNS) {
        if (
          fields.includes(field) &&
          !found.has(field) &&
          pattern.test(sentence)
        ) {
          found.add(field);
          facts.push({
            field,
            value: quote,
            evidence: [{ extractId: extract.id, quote }],
            confidence: 'medium',
          });
        }
      }
    }
  }
  if (fields.includes('company_summary') && !found.has('company_summary')) {
    const first = extracts
      .flatMap((extract) =>
        sentences(extract.text)
          .filter((sentence) => !INSTRUCTION_LIKE.test(sentence))
          .map((sentence) => ({ extract, sentence })),
      )
      .find(({ sentence }) => sentence.split(/\s+/).length >= 6);
    if (first !== undefined) {
      const quote = clip(first.sentence, 300);
      found.add('company_summary');
      facts.push({
        field: 'company_summary',
        value: quote,
        evidence: [{ extractId: first.extract.id, quote }],
        confidence: 'medium',
      });
    }
  }
  return {
    facts: facts.slice(0, 30),
    hypotheses: [],
    unknownFields: fields.filter((field) => !found.has(field)),
    ignoredInstructions: ignored,
  };
}

// ─── The built-in lead-qualification responder (task 10C) ───────────────────

const NEED_FIELDS = new Set([
  'target_customers',
  'products_services',
  'company_summary',
  'notable_customers',
]);
const TIMING_FIELDS = new Set(['hiring', 'recent_news']);

/**
 * Deterministic ratings that cite only facts it was given: supported need from what the company
 * does and whom it serves (one fact: 2, two: 3, three or more: 4), timing from hiring and news
 * (3). No such fact: null. Fact text that tries to instruct a model is reported as ignored.
 */
export function fakeLeadQualification(
  request: ModelRequest,
): QualificationModelOutput {
  const data = JSON.parse(request.input) as {
    facts?: {
      id?: unknown;
      field?: unknown;
      value?: unknown;
      quotes?: unknown;
    }[];
  };
  const facts = (data.facts ?? []).flatMap((fact) =>
    typeof fact.id === 'string' &&
    typeof fact.field === 'string' &&
    typeof fact.value === 'string'
      ? [
          {
            id: fact.id,
            field: fact.field,
            text: [
              fact.value,
              ...(Array.isArray(fact.quotes)
                ? fact.quotes.filter((q): q is string => typeof q === 'string')
                : []),
            ].join(' '),
          },
        ]
      : [],
  );
  const ignored = facts
    .filter((fact) => INSTRUCTION_LIKE.test(fact.text))
    .slice(0, 5)
    .map((fact) => ({ factId: fact.id, quote: clip(fact.text, 300) }));
  const usable = facts.filter((fact) => !INSTRUCTION_LIKE.test(fact.text));
  const need = usable.filter((fact) => NEED_FIELDS.has(fact.field)).slice(0, 3);
  const timing = usable
    .filter((fact) => TIMING_FIELDS.has(fact.field))
    .slice(0, 3);
  return {
    assessments: [
      need.length === 0
        ? {
            factor: 'supportedNeed',
            level: null,
            factIds: [],
            explanation: 'The facts say nothing about a need for the offer.',
          }
        : {
            factor: 'supportedNeed',
            level: Math.min(4, need.length + 1),
            factIds: need.map((fact) => fact.id),
            explanation:
              'What the company does and whom it serves fit the offer.',
          },
      timing.length === 0
        ? {
            factor: 'timing',
            level: null,
            factIds: [],
            explanation: 'No hiring or news on the pages.',
          }
        : {
            factor: 'timing',
            level: 3,
            factIds: timing.map((fact) => fact.id),
            explanation:
              'The company is hiring or announced something recently.',
          },
    ],
    ignoredInstructions: ignored,
  };
}

// ─── The fake provider ───────────────────────────────────────────────────────

const estimateTokens = (characters: number) => Math.ceil(characters / 4);

export class FakeModelProvider implements ModelProvider {
  readonly source = 'FAKE' as const;
  readonly model: string;
  /** Every request, in order. */
  readonly requests: ModelRequest[] = [];
  readonly #script: FakeModelAnswer[];
  readonly #responders: Readonly<Record<string, FakeModelResponder>>;
  readonly #now: () => Date;

  constructor(options: FakeModelOptions = {}) {
    this.model = options.model ?? 'fake-model-1';
    this.#script = [...(options.script ?? [])];
    this.#responders = {
      website_research: (request) => ({ json: fakeWebsiteResearch(request) }),
      lead_qualification: (request) => ({
        json: fakeLeadQualification(request),
      }),
      ...options.responders,
    };
    this.#now = options.now ?? (() => FIXED_TIME);
  }

  generate(request: ModelRequest): Promise<ModelResult> {
    return new Promise((resolve) => {
      resolve(this.#answer(request));
    });
  }

  #answer(request: ModelRequest): ModelResult {
    assertModelRequest(request);
    this.requests.push(request);
    if (request.signal?.aborted === true) {
      this.#cost(request, 'error', null, 'none');
      throw new ProviderError('canceled');
    }
    const responder = this.#responders[request.task];
    const answer = this.#script.shift() ?? responder?.(request);
    if (answer === undefined) {
      throw new Error(
        `FakeModelProvider: no answer for task "${request.task}"`,
      );
    }
    if ('error' in answer) {
      this.#cost(
        request,
        answer.error === 'timeout' ? 'timeout' : 'error',
        null,
        'none',
      );
      throw new ProviderError(answer.error);
    }
    const text =
      'json' in answer
        ? JSON.stringify(answer.json)
        : 'text' in answer
          ? answer.text
          : '';
    const usage: ModelUsage = {
      inputTokens: estimateTokens(
        request.instructions.length + request.input.length,
      ),
      cachedInputTokens: 0,
      outputTokens: Math.min(
        estimateTokens(text.length),
        request.maxOutputTokens,
      ),
      reasoningTokens: 0,
    };
    const common = {
      provider: this.source,
      model: this.model,
      requestId: `fake-${String(this.requests.length)}`,
      usage,
    };
    if ('refusal' in answer) {
      this.#cost(request, 'refusal', usage, 'reported');
      return { ...common, kind: 'refusal', refusal: answer.refusal };
    }
    if ('incomplete' in answer) {
      this.#cost(request, 'incomplete', usage, 'reported');
      return { ...common, kind: 'incomplete', reason: answer.incomplete };
    }
    if (estimateTokens(text.length) > request.maxOutputTokens) {
      this.#cost(request, 'incomplete', usage, 'reported');
      return { ...common, kind: 'incomplete', reason: 'max_output_tokens' };
    }
    this.#cost(request, 'output', usage, 'reported');
    return { ...common, kind: 'output', text };
  }

  #cost(
    request: ModelRequest,
    outcome: ModelCostEvent['outcome'],
    usage: ModelUsage | null,
    billing: ModelCostEvent['billing'],
  ): void {
    request.onCost?.({
      provider: this.source,
      model: this.model,
      task: request.task,
      promptVersion: request.promptVersion,
      attempt: 1,
      outcome,
      requestId: `fake-${String(this.requests.length)}`,
      clientRequestId: `fake-client-${String(this.requests.length)}`,
      usage,
      billing,
      // The fake costs nothing.
      costMicroUsd: usage === null ? null : 0,
      occurredAt: this.#now(),
    });
  }
}
