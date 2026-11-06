// The Apollo REST client every Apollo adapter shares (tasks 07B and 08B, docs/decisions.md
// D-07B-04 and D-08B-*): the key in the x-api-key header only, redirects refused, a deadline per
// attempt, bounded retries of retryable errors only, and errors in our words (a provider's
// message or body never travels). Built from Apollo's official documentation, checked
// 2026-11-06 (authentication, rate limits, status codes).
import { z } from 'zod';
import { ProviderError, type ProviderQuota } from './providers.js';

/** The fetch Apollo adapters need; tests pass a fake (no network in tests). */
export type ApolloFetch = (
  url: string,
  init: {
    readonly method: 'POST';
    readonly headers: Readonly<Record<string, string>>;
    readonly redirect: 'error';
    readonly signal: AbortSignal;
    readonly body?: string;
  },
) => Promise<Response>;

export interface ApolloClientOptions {
  /** From the environment (APOLLO_API_KEY). Never logged, stored or returned. */
  readonly apiKey: string;
  readonly fetch?: ApolloFetch;
  readonly now?: () => Date;
  readonly sleep?: (milliseconds: number) => Promise<void>;
  /** Per attempt, including reading the answer. Default 15 s. */
  readonly timeoutMs?: number;
  /** Attempts per request, the first included. Default 3, at most 5. */
  readonly maxAttempts?: number;
  /** A retry that would wait longer than this is not made; the error says when to retry. */
  readonly maxRetryDelaySeconds?: number;
}

const apiKeySchema = z
  .string()
  .min(8)
  .max(200)
  .regex(/^[\x21-\x7e]+$/);

const errorBodySchema = z.object({
  error_details: z
    .object({
      code: z.string().optional(),
      suggestions: z
        .array(
          z.object({ retry_after_seconds: z.number().int().min(0).optional() }),
        )
        .optional(),
      context: z
        .object({ window: z.object({ value: z.string() }).optional() })
        .optional(),
    })
    .optional(),
});

/** Whole seconds from a Retry-After header; null when absent or not a number of seconds. */
function retryAfterHeader(headers: Headers): number | null {
  const value = headers.get('retry-after');
  return value !== null && /^\d{1,6}$/.test(value.trim())
    ? Number(value.trim())
    : null;
}

/** The fewest requests left in any window the headers report (documented headers). */
export function quotaFrom(headers: Headers): ProviderQuota | null {
  const left = [
    'x-minute-requests-left',
    'x-hourly-requests-left',
    'x-24-hour-requests-left',
  ]
    .map((name) => headers.get(name)?.trim() ?? '')
    .filter((value) => /^\d{1,9}$/.test(value))
    .map(Number);
  // Windows open with the first request and aren't aligned to the clock: no reset time.
  return left.length === 0
    ? null
    : { remaining: Math.min(...left), resetAt: null };
}

/** A refused request → our error. The provider's own message never travels (D-07B-04). */
function errorFor(
  status: number,
  headers: Headers,
  body: string,
): ProviderError {
  if (status === 401) {
    return new ProviderError('unauthorized');
  }
  if (status === 403) {
    // A plan without API access, or a key not scoped to this endpoint.
    return new ProviderError('forbidden');
  }
  if (status === 429) {
    let details: z.output<typeof errorBodySchema>['error_details'];
    try {
      details = errorBodySchema.safeParse(JSON.parse(body)).data?.error_details;
    } catch {
      details = undefined;
    }
    if (details?.code === 'USAGE.RATE_LIMIT.PLATFORM_RATE_LIMIT') {
      // Platform load: no Retry-After; the suggestion says when (documented as 60 s).
      const suggested = details.suggestions?.find(
        (s) => s.retry_after_seconds !== undefined,
      )?.retry_after_seconds;
      return new ProviderError('rate_limited', suggested ?? 60);
    }
    const retryAfter = retryAfterHeader(headers);
    if (details?.context?.window?.value === 'day') {
      // The team's daily allowance for this endpoint is used up.
      return new ProviderError('quota_exceeded', retryAfter);
    }
    return new ProviderError('rate_limited', retryAfter);
  }
  if (status >= 500) {
    return new ProviderError('unavailable');
  }
  return new ProviderError('invalid_request');
}

const defaultSleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export class ApolloClient {
  readonly #apiKey: string;
  readonly #fetch: ApolloFetch;
  readonly #now: () => Date;
  readonly #sleep: (milliseconds: number) => Promise<void>;
  readonly #timeoutMs: number;
  readonly #maxAttempts: number;
  readonly #maxRetryDelaySeconds: number;

  constructor(options: ApolloClientOptions) {
    // Checked without echoing it: a malformed key could also inject a header.
    if (!apiKeySchema.safeParse(options.apiKey).success) {
      throw new Error('The Apollo API key is missing or malformed.');
    }
    this.#apiKey = options.apiKey;
    this.#fetch = options.fetch ?? ((url, init) => fetch(url, init));
    this.#now = options.now ?? (() => new Date());
    this.#sleep = options.sleep ?? defaultSleep;
    this.#timeoutMs = options.timeoutMs ?? 15_000;
    this.#maxAttempts = Math.min(Math.max(options.maxAttempts ?? 3, 1), 5);
    this.#maxRetryDelaySeconds = options.maxRetryDelaySeconds ?? 30;
  }

  now(): Date {
    return this.#now();
  }

  /**
   * POSTs to a documented Apollo URL (query string included), with a JSON body when given.
   * Bounded retries: retryable errors only, at most maxAttempts, never a long wait.
   */
  async post(
    url: string,
    body?: unknown,
  ): Promise<{ body: unknown; headers: Headers }> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.#attempt(url, body);
      } catch (error) {
        if (
          !(error instanceof ProviderError) ||
          !error.retryable ||
          attempt >= this.#maxAttempts
        ) {
          throw error;
        }
        const waitSeconds = error.retryAfterSeconds ?? 2 ** (attempt - 1);
        if (waitSeconds > this.#maxRetryDelaySeconds) {
          throw error;
        }
        await this.#sleep(waitSeconds * 1000);
      }
    }
  }

  async #attempt(
    url: string,
    body: unknown,
  ): Promise<{ body: unknown; headers: Headers }> {
    const controller = new AbortController();
    // Settles the attempt at the deadline even if the fetch ignores the abort.
    const deadline = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener(
        'abort',
        () => {
          reject(new ProviderError('timeout'));
        },
        { once: true },
      );
    });
    const timer = setTimeout(() => {
      controller.abort();
    }, this.#timeoutMs);
    try {
      const exchange = (async () => {
        const response = await this.#fetch(url, {
          method: 'POST',
          headers: {
            'x-api-key': this.#apiKey,
            accept: 'application/json',
            ...(body === undefined
              ? {}
              : { 'content-type': 'application/json' }),
          },
          // A redirect could carry the key to another host: refused.
          redirect: 'error',
          signal: controller.signal,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        return { response, text: await response.text() };
      })();
      const { response, text } = await Promise.race([exchange, deadline]);
      if (!response.ok) {
        throw errorFor(response.status, response.headers, text);
      }
      try {
        return { body: JSON.parse(text) as unknown, headers: response.headers };
      } catch {
        throw new ProviderError('bad_response');
      }
    } catch (error) {
      if (error instanceof ProviderError) {
        throw error;
      }
      // The cause (a network error or the abort) is dropped: it may name the request.
      throw new ProviderError(
        controller.signal.aborted ? 'timeout' : 'unavailable',
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
