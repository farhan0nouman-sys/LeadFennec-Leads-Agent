// The OpenAI adapter (task 09B, docs/decisions.md D-09B-02), built from OpenAI's official
// documentation checked 2026-11-07: the Responses API (POST /v1/responses), Structured Outputs,
// error codes and the API overview (authentication, x-request-id, X-Client-Request-Id).
//
// What it sends: the model from configuration, the caller's fixed instructions, the data as one
// user message, a strict JSON schema for the answer, a token ceiling, `store: false`,
// `truncation: "disabled"`, and no tools of any kind. What it returns: the answer text (still
// untrusted), a refusal or an incomplete answer, with usage. A cost event is emitted for every
// attempt, failed ones included. Errors are ours; OpenAI's message or body never travels.

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ProviderError } from '../providers.js';
import {
  assertModelRequest,
  costMicroUsd,
  type ModelCostEvent,
  type ModelPrices,
  type ModelProvider,
  type ModelRequest,
  type ModelResult,
  type ModelUsage,
} from './types.js';

export const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

/** The documented reasoning efforts; sent only when configured (models differ). */
export const OPENAI_REASONING_EFFORTS = [
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const;

export type OpenAiReasoningEffort = (typeof OPENAI_REASONING_EFFORTS)[number];

/** The fetch the adapter needs; tests pass a fake (no network in tests). */
export type OpenAiFetch = (
  url: string,
  init: {
    readonly method: 'POST';
    readonly headers: Readonly<Record<string, string>>;
    readonly body: string;
    readonly redirect: 'error';
    readonly signal: AbortSignal;
  },
) => Promise<Response>;

export interface OpenAiOptions {
  /** OPENAI_API_KEY. Never logged, stored, returned or put in a prompt. */
  readonly apiKey: string;
  /** OPENAI_MODEL, e.g. "gpt-6-luna" (D-09B-02). */
  readonly model: string;
  /** OPENAI_REASONING_EFFORT; omitted from requests when unset. */
  readonly reasoningEffort?: OpenAiReasoningEffort | undefined;
  /** OPENAI_INPUT_USD_PER_MTOK and OPENAI_OUTPUT_USD_PER_MTOK; cost is null without them. */
  readonly prices?: ModelPrices | null;
  readonly fetch?: OpenAiFetch;
  readonly now?: () => Date;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  readonly newRequestId?: () => string;
  /** Per attempt, reading the answer included. Default 60 s, 1 to 180 s. */
  readonly timeoutMs?: number;
  /** Attempts per request. Default 2, at most 3. Timeouts are never retried. */
  readonly maxAttempts?: number;
  /** A retry that would wait longer than this is not made. Default 20 s. */
  readonly maxRetryDelaySeconds?: number;
}

const apiKeySchema = z
  .string()
  .min(20)
  .max(512)
  .regex(/^[\x21-\x7e]+$/);

/** A model id as OpenAI writes them ("gpt-6-luna", dated snapshots, fine-tune ids). */
export const openAiModelIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/);

/** 429 codes and types that retrying won't fix (credits, spend or usage limits). */
const QUOTA_CODES = new Set([
  'insufficient_quota',
  'credit_balance_exhausted',
  'organization_spend_limit_exceeded',
  'project_spend_limit_exceeded',
  'organization_usage_limit_exceeded',
]);

const MAX_ANSWER_CHARS = 2_000_000;

const errorBodySchema = z.object({
  error: z
    .object({
      type: z.string().nullable().optional(),
      code: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
});

const usageSchema = z.object({
  input_tokens: z.int().min(0),
  input_tokens_details: z
    .object({ cached_tokens: z.int().min(0).optional() })
    .nullable()
    .optional(),
  output_tokens: z.int().min(0),
  output_tokens_details: z
    .object({ reasoning_tokens: z.int().min(0).optional() })
    .nullable()
    .optional(),
});

const responseSchema = z.object({
  status: z.string(),
  model: z.string().max(200).optional(),
  error: z
    .object({ code: z.string().nullable().optional() })
    .nullable()
    .optional(),
  incomplete_details: z
    .object({ reason: z.string().nullable().optional() })
    .nullable()
    .optional(),
  output: z
    .array(
      z.object({
        type: z.string(),
        content: z
          .array(
            z.object({
              type: z.string(),
              text: z.string().optional(),
              refusal: z.string().optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
  usage: usageSchema.nullable().optional(),
});

const REQUEST_ID = /^[A-Za-z0-9_.:-]{1,200}$/;

function retryAfterSeconds(headers: Headers): number | null {
  const value = headers.get('retry-after')?.trim() ?? '';
  return /^\d{1,6}$/.test(value) ? Number(value) : null;
}

/** The request body: no tools, nothing stored, never silently truncated. */
export function buildOpenAiRequestBody(
  request: ModelRequest,
  model: string,
  reasoningEffort?: OpenAiReasoningEffort,
): Record<string, unknown> {
  return {
    model,
    instructions: request.instructions,
    input: [{ role: 'user', content: request.input }],
    max_output_tokens: request.maxOutputTokens,
    text: {
      format: {
        type: 'json_schema',
        name: request.outputSchema.name,
        schema: request.outputSchema.schema,
        strict: true,
      },
    },
    store: false,
    truncation: 'disabled',
    ...(reasoningEffort === undefined
      ? {}
      : { reasoning: { effort: reasoningEffort } }),
  };
}

/** OpenAI's error type and code, if the body has them (the message is never read). */
function errorDetails(body: string): z.output<typeof errorBodySchema>['error'] {
  try {
    return errorBodySchema.safeParse(JSON.parse(body)).data?.error ?? null;
  } catch {
    return null;
  }
}

/** A refused HTTP request → our error, and whether the provider may have charged for it. */
function httpError(
  status: number,
  headers: Headers,
  body: string,
): { readonly error: ProviderError; readonly billing: 'none' | 'unknown' } {
  if (status >= 500) {
    return {
      error: new ProviderError('unavailable', retryAfterSeconds(headers)),
      billing: 'unknown',
    };
  }
  if (status === 401) {
    return { error: new ProviderError('unauthorized'), billing: 'none' };
  }
  if (status === 403) {
    return { error: new ProviderError('forbidden'), billing: 'none' };
  }
  if (status === 429) {
    const details = errorDetails(body);
    const quota =
      QUOTA_CODES.has(details?.code ?? '') ||
      QUOTA_CODES.has(details?.type ?? '');
    return {
      error: new ProviderError(
        quota ? 'quota_exceeded' : 'rate_limited',
        retryAfterSeconds(headers),
      ),
      billing: 'none',
    };
  }
  if (status === 408 || status === 409) {
    return { error: new ProviderError('unavailable'), billing: 'none' };
  }
  return { error: new ProviderError('invalid_request'), billing: 'none' };
}

type Attempt =
  | { readonly result: ModelResult }
  | {
      readonly error: ProviderError;
      readonly outcome: 'error' | 'timeout';
      readonly billing: ModelCostEvent['billing'];
      readonly usage: ModelUsage | null;
      readonly requestId: string | null;
      readonly model: string;
    };

const defaultSleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class OpenAiResponsesProvider implements ModelProvider {
  readonly source = 'OPENAI' as const;
  readonly model: string;
  readonly #apiKey: string;
  readonly #effort: OpenAiReasoningEffort | undefined;
  readonly #prices: ModelPrices | null;
  readonly #fetch: OpenAiFetch;
  readonly #now: () => Date;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #newRequestId: () => string;
  readonly #timeoutMs: number;
  readonly #maxAttempts: number;
  readonly #maxRetryDelaySeconds: number;

  constructor(options: OpenAiOptions) {
    // Checked without echoing it: a malformed key could also inject a header.
    if (!apiKeySchema.safeParse(options.apiKey).success) {
      throw new Error('The OpenAI API key is missing or malformed.');
    }
    if (!openAiModelIdSchema.safeParse(options.model).success) {
      throw new Error('The OpenAI model id is missing or malformed.');
    }
    this.#apiKey = options.apiKey;
    this.model = options.model;
    this.#effort = options.reasoningEffort;
    this.#prices = options.prices ?? null;
    this.#fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.#now = options.now ?? (() => new Date());
    this.#sleep = options.sleep ?? defaultSleep;
    this.#newRequestId = options.newRequestId ?? randomUUID;
    this.#timeoutMs = Math.min(
      Math.max(options.timeoutMs ?? 60_000, 1_000),
      180_000,
    );
    this.#maxAttempts = Math.min(Math.max(options.maxAttempts ?? 2, 1), 3);
    this.#maxRetryDelaySeconds = options.maxRetryDelaySeconds ?? 20;
  }

  async generate(request: ModelRequest): Promise<ModelResult> {
    assertModelRequest(request);
    const body = JSON.stringify(
      buildOpenAiRequestBody(request, this.model, this.#effort),
    );
    for (let attempt = 1; ; attempt += 1) {
      const clientRequestId = this.#newRequestId();
      const outcome = await this.#attempt(
        body,
        clientRequestId,
        request.signal,
      );
      const base = {
        provider: this.source,
        task: request.task,
        promptVersion: request.promptVersion,
        attempt,
        clientRequestId,
        occurredAt: this.#now(),
      };
      if ('result' in outcome) {
        const { result } = outcome;
        request.onCost?.({
          ...base,
          model: result.model,
          outcome: result.kind,
          requestId: result.requestId,
          usage: result.usage,
          billing: result.usage === null ? 'unknown' : 'reported',
          costMicroUsd: costMicroUsd(result.usage, this.#prices),
        });
        return result;
      }
      request.onCost?.({
        ...base,
        model: outcome.model,
        outcome: outcome.outcome,
        requestId: outcome.requestId,
        usage: outcome.usage,
        billing: outcome.billing,
        costMicroUsd: costMicroUsd(outcome.usage, this.#prices),
      });
      const { error } = outcome;
      const wait = error.retryAfterSeconds ?? 2 ** (attempt - 1);
      if (
        !error.retryable ||
        error.code === 'timeout' ||
        attempt >= this.#maxAttempts ||
        wait > this.#maxRetryDelaySeconds
      ) {
        throw error;
      }
      await this.#sleep(wait * 1000);
    }
  }

  async #attempt(
    body: string,
    clientRequestId: string,
    signal: AbortSignal | undefined,
  ): Promise<Attempt> {
    const failed = (
      error: ProviderError,
      outcome: 'error' | 'timeout',
      billing: ModelCostEvent['billing'],
      requestId: string | null = null,
      usage: ModelUsage | null = null,
    ): Attempt => ({
      error,
      outcome,
      billing,
      usage,
      requestId,
      model: this.model,
    });
    if (signal?.aborted === true) {
      return failed(new ProviderError('canceled'), 'error', 'none');
    }
    const controller = new AbortController();
    // Set by the timer and the caller's signal (an object, so the checks below aren't narrowed).
    const state = { timedOut: false, canceled: false };
    const onCallerAbort = () => {
      state.canceled = true;
      controller.abort();
    };
    signal?.addEventListener('abort', onCallerAbort, { once: true });
    const timer = setTimeout(() => {
      state.timedOut = true;
      controller.abort();
    }, this.#timeoutMs);
    // Settles the attempt at the deadline even if the fetch ignores the abort.
    const deadline = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener(
        'abort',
        () => {
          reject(new Error('aborted'));
        },
        { once: true },
      );
    });
    const exchange = (async () => {
      const response = await this.#fetch(OPENAI_RESPONSES_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.#apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
          'x-client-request-id': clientRequestId,
        },
        body,
        redirect: 'error',
        signal: controller.signal,
      });
      return { response, text: await response.text() };
    })();
    // The losing side of the race must not become an unhandled rejection.
    exchange.catch(() => undefined);
    deadline.catch(() => undefined);
    try {
      const { response, text } = await Promise.race([exchange, deadline]);
      const requestHeader = response.headers.get('x-request-id') ?? '';
      const requestId = REQUEST_ID.test(requestHeader) ? requestHeader : null;
      if (!response.ok) {
        const { error, billing } = httpError(
          response.status,
          response.headers,
          text,
        );
        return failed(error, 'error', billing, requestId);
      }
      if (text.length > MAX_ANSWER_CHARS) {
        return failed(
          new ProviderError('bad_response'),
          'error',
          'unknown',
          requestId,
        );
      }
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return failed(
          new ProviderError('bad_response'),
          'error',
          'unknown',
          requestId,
        );
      }
      return this.#interpret(json, requestId, failed);
    } catch {
      if (state.timedOut) {
        return failed(new ProviderError('timeout'), 'timeout', 'unknown');
      }
      if (state.canceled) {
        return failed(new ProviderError('canceled'), 'error', 'unknown');
      }
      // No answer (connection refused or reset, DNS, a redirect): it may have been processed.
      return failed(new ProviderError('unavailable'), 'error', 'unknown');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onCallerAbort);
    }
  }

  #interpret(
    json: unknown,
    requestId: string | null,
    failed: (
      error: ProviderError,
      outcome: 'error' | 'timeout',
      billing: ModelCostEvent['billing'],
      requestId?: string | null,
      usage?: ModelUsage | null,
    ) => Attempt,
  ): Attempt {
    const parsed = responseSchema.safeParse(json);
    if (!parsed.success) {
      return failed(
        new ProviderError('bad_response'),
        'error',
        'unknown',
        requestId,
      );
    }
    const answer = parsed.data;
    const usage: ModelUsage | null =
      answer.usage === null || answer.usage === undefined
        ? null
        : {
            inputTokens: answer.usage.input_tokens,
            cachedInputTokens:
              answer.usage.input_tokens_details?.cached_tokens ?? 0,
            outputTokens: answer.usage.output_tokens,
            reasoningTokens:
              answer.usage.output_tokens_details?.reasoning_tokens ?? 0,
          };
    const billing = usage === null ? 'unknown' : 'reported';
    const texts: string[] = [];
    const refusals: string[] = [];
    for (const item of answer.output ?? []) {
      if (item.type === 'reasoning') {
        continue;
      }
      if (item.type !== 'message') {
        // A tool call or anything else: no tools were offered, so it is never acted on.
        return failed(
          new ProviderError('bad_response'),
          'error',
          billing,
          requestId,
          usage,
        );
      }
      for (const part of item.content ?? []) {
        if (part.type === 'output_text' && part.text !== undefined) {
          texts.push(part.text);
        } else if (part.type === 'refusal' && part.refusal !== undefined) {
          refusals.push(part.refusal);
        }
      }
    }
    const common = {
      provider: this.source,
      model: answer.model ?? this.model,
      requestId,
      usage,
    };
    if (answer.status === 'completed') {
      if (refusals.length > 0) {
        return {
          result: { ...common, kind: 'refusal', refusal: refusals.join('\n') },
        };
      }
      if (texts.length === 0) {
        return failed(
          new ProviderError('bad_response'),
          'error',
          billing,
          requestId,
          usage,
        );
      }
      return { result: { ...common, kind: 'output', text: texts.join('') } };
    }
    if (answer.status === 'incomplete') {
      const reason = answer.incomplete_details?.reason;
      return {
        result: {
          ...common,
          kind: 'incomplete',
          reason:
            reason === 'max_output_tokens' || reason === 'content_filter'
              ? reason
              : 'other',
        },
      };
    }
    if (answer.status === 'failed') {
      const code = answer.error?.code;
      const error =
        code === 'rate_limit_exceeded'
          ? new ProviderError('rate_limited')
          : code === 'server_error'
            ? new ProviderError('unavailable')
            : new ProviderError('invalid_request');
      return failed(error, 'error', billing, requestId, usage);
    }
    // queued, in_progress, cancelled: never asked for (no background mode).
    return failed(
      new ProviderError('bad_response'),
      'error',
      billing,
      requestId,
      usage,
    );
  }
}
