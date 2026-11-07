// The model-provider abstraction (task 09B, docs/decisions.md D-09B-01). A model only answers:
// a request carries fixed instructions, data and an output schema, never tools, so nothing a
// model reads can make it act. Its answer is untrusted text for the caller to validate.

export const MODEL_PROVIDERS = ['OPENAI', 'FAKE'] as const;
export type ModelProviderName = (typeof MODEL_PROVIDERS)[number];

export interface ModelOutputSchema {
  /** a-z, A-Z, 0-9, _ and -; at most 64 characters (OpenAI's rule for format names). */
  readonly name: string;
  /** JSON Schema in the strict subset: every object closed, every property required. */
  readonly schema: Readonly<Record<string, unknown>>;
}

export interface ModelRequest {
  /** Names the work in cost events, e.g. "website_research". */
  readonly task: string;
  /** The caller's versioned prompt; recorded with every cost event. */
  readonly promptVersion: string;
  /** Fixed instructions written by the application. Never untrusted text. */
  readonly instructions: string;
  /** The data, as JSON text. Untrusted content (web pages, emails) belongs here only. */
  readonly input: string;
  readonly outputSchema: ModelOutputSchema;
  /** Includes any reasoning tokens. */
  readonly maxOutputTokens: number;
  readonly signal?: AbortSignal;
  /** Called once per attempt, also for failed ones, before the result or error returns. */
  readonly onCost?: (event: ModelCostEvent) => void;
}

export interface ModelUsage {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  /** Includes reasoning tokens (they are billed as output). */
  readonly outputTokens: number;
  readonly reasoningTokens: number;
}

interface ModelAnswer {
  readonly provider: ModelProviderName;
  /** The model that answered, as the provider reports it. */
  readonly model: string;
  /** The provider's request id (safe to log), or null. */
  readonly requestId: string | null;
  readonly usage: ModelUsage | null;
}

export type ModelResult =
  /** Text in the requested schema's shape, still unvalidated. */
  | (ModelAnswer & { readonly kind: 'output'; readonly text: string })
  /** The model declined; its explanation is untrusted text. */
  | (ModelAnswer & { readonly kind: 'refusal'; readonly refusal: string })
  /** Stopped early: the output, if any, is cut off and is not returned. */
  | (ModelAnswer & {
      readonly kind: 'incomplete';
      readonly reason: 'max_output_tokens' | 'content_filter' | 'other';
    });

/**
 * One attempt's cost, for the usage ledger (AI_TOKENS) and audit. `billing` says whether the
 * provider may charge for it: "reported" (usage known), "unknown" (a timeout or a server error
 * after the request was sent: it may have been processed), "none" (refused before any work).
 */
export interface ModelCostEvent {
  readonly provider: ModelProviderName;
  readonly model: string;
  readonly task: string;
  readonly promptVersion: string;
  readonly attempt: number;
  readonly outcome: 'output' | 'refusal' | 'incomplete' | 'error' | 'timeout';
  readonly requestId: string | null;
  /** Our own id for the request, sent as X-Client-Request-Id where supported. */
  readonly clientRequestId: string;
  readonly usage: ModelUsage | null;
  readonly billing: 'reported' | 'unknown' | 'none';
  /** Estimated from configured prices, in millionths of a US dollar; null when unknown. */
  readonly costMicroUsd: number | null;
  readonly occurredAt: Date;
}

export interface ModelProvider {
  readonly source: ModelProviderName;
  /** The configured model id. */
  readonly model: string;
  /** Throws ProviderError (never a provider's own message). */
  generate(request: ModelRequest): Promise<ModelResult>;
}

/** Prices per million tokens in US dollars (so also millionths of a dollar per token). */
export interface ModelPrices {
  readonly inputUsdPerMTok: number;
  readonly outputUsdPerMTok: number;
}

/**
 * Cached input tokens are priced as ordinary input: an over-estimate, never an under-estimate
 * (D-09B-05).
 */
export function costMicroUsd(
  usage: ModelUsage | null,
  prices: ModelPrices | null,
): number | null {
  if (usage === null || prices === null) {
    return null;
  }
  return Math.round(
    usage.inputTokens * prices.inputUsdPerMTok +
      usage.outputTokens * prices.outputUsdPerMTok,
  );
}

export const OUTPUT_SCHEMA_NAME = /^[A-Za-z0-9_-]{1,64}$/;

export const MODEL_REQUEST_LIMITS = {
  minOutputTokens: 16,
  maxOutputTokens: 32_000,
  maxInstructionChars: 20_000,
  maxInputChars: 200_000,
} as const;

/** Checks a request's bounds before anything is sent; throws RangeError (a programming error). */
export function assertModelRequest(request: ModelRequest): void {
  const limits = MODEL_REQUEST_LIMITS;
  if (
    !Number.isInteger(request.maxOutputTokens) ||
    request.maxOutputTokens < limits.minOutputTokens ||
    request.maxOutputTokens > limits.maxOutputTokens
  ) {
    throw new RangeError('maxOutputTokens is out of bounds.');
  }
  if (
    request.instructions.length === 0 ||
    request.instructions.length > limits.maxInstructionChars
  ) {
    throw new RangeError('instructions are empty or too long.');
  }
  if (request.input.length > limits.maxInputChars) {
    throw new RangeError('input is too long.');
  }
  if (!OUTPUT_SCHEMA_NAME.test(request.outputSchema.name)) {
    throw new RangeError('The output schema name is not allowed.');
  }
  if (!/^[a-z][a-z0-9_]{0,63}$/.test(request.task)) {
    throw new RangeError('The task name is not allowed.');
  }
}
