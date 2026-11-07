// The server-side website fetcher (task 09A, docs/decisions.md D-09A-01 to D-09A-06).
//
// Per hop (the first URL and every redirect): parse and check the URL, apply the access
// policy, resolve the name and check every address, check robots.txt, wait for a per-host
// slot, then connect to the checked address only. Redirects are followed by this code, never
// by the HTTP client, and each one starts again from the top. One time budget covers it all.

import { createHash } from 'node:crypto';
import { lookup as dnsLookup } from 'node:dns/promises';
import type { IncomingHttpHeaders } from 'node:http';
import { pipeline, Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import {
  parseFetchTarget,
  pickPublicAddress,
  type AddressFamily,
  type FetchTarget,
  type TargetOptions,
} from './address.js';
import { WebsiteFetchError } from './errors.js';
import { HostConcurrencyLimiter } from './limiter.js';
import {
  checkAccess,
  parseWebsiteFetchPolicy,
  type WebsiteFetchPolicy,
  type WebsiteFetchPolicyInput,
} from './policy.js';
import {
  parseRobotsTxt,
  robotsAllows,
  ROBOTS_MAX_BYTES,
  type RobotsTxt,
} from './robots.js';
import { decodeBody, extractHtml, extractPlainText } from './text.js';
import {
  NodeHttpTransport,
  type TransportResponse,
  type WebsiteTransport,
} from './transport.js';
import {
  WEBSITE_PAGE_TYPES,
  type WebsiteFetcher,
  type WebsiteFetchRequest,
  type WebsitePage,
  type WebsitePageType,
  type WebsiteRedirect,
  type WebsiteSource,
} from './types.js';

// ─── DNS ─────────────────────────────────────────────────────────────────────

export interface ResolvedAddress {
  readonly address: string;
  readonly family: number;
}

/** Name to addresses. Every address returned is checked; tests replace it with a fake. */
export interface HostResolver {
  lookup(hostname: string): Promise<readonly ResolvedAddress[]>;
}

/** The operating system's resolver (getaddrinfo), all addresses, IPv4 first. */
export const systemResolver: HostResolver = {
  lookup: (hostname) => dnsLookup(hostname, { all: true, order: 'ipv4first' }),
};

const NOT_FOUND = new Set(['ENOTFOUND', 'ENODATA', 'EAI_NONAME', 'EAI_NODATA']);

const errorCode = (error: unknown): string =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  typeof error.code === 'string'
    ? error.code
    : '';

/** Rejects as soon as the signal aborts (a lookup itself can't be cancelled). */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(signal.reason as Error);
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(signal.reason as Error);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

// ─── Responses ───────────────────────────────────────────────────────────────

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const single = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export interface ContentType {
  readonly essence: string;
  readonly charset: string | null;
}

const MEDIA_TYPE = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/;

export function parseContentType(
  value: string | undefined,
): ContentType | null {
  if (value === undefined) {
    return null;
  }
  const [type = '', ...parameters] = value.split(';');
  const essence = type.trim().toLowerCase();
  if (!MEDIA_TYPE.test(essence)) {
    return null;
  }
  let charset: string | null = null;
  for (const parameter of parameters) {
    const [key = '', ...rest] = parameter.split('=');
    if (key.trim().toLowerCase() === 'charset') {
      const raw = rest
        .join('=')
        .trim()
        .replace(/^"(.*)"$/, '$1');
      charset = raw === '' ? null : raw;
    }
  }
  return { essence, charset };
}

export type ContentEncoding = 'identity' | 'gzip' | 'deflate' | 'br';

/** One coding only; a list of codings (or an unknown one) is refused. */
export function parseContentEncoding(
  value: string | undefined,
): ContentEncoding | null {
  const coding = (value ?? '').trim().toLowerCase();
  if (coding === '' || coding === 'identity') {
    return 'identity';
  }
  if (coding === 'gzip' || coding === 'x-gzip') {
    return 'gzip';
  }
  if (coding === 'deflate' || coding === 'br') {
    return coding;
  }
  return null;
}

const isPageType = (essence: string): essence is WebsitePageType =>
  (WEBSITE_PAGE_TYPES as readonly string[]).includes(essence);

/**
 * Reads at most `limit` bytes after decompression (and `limit` on the wire). Over the limit a
 * page fails with too_large ("fail") as soon as the limit is passed, without reading on;
 * robots.txt keeps the first `limit` bytes ("truncate"). Decompression is streamed, so a small
 * compressed body that inflates to gigabytes stops at the limit.
 */
export async function readBody(
  response: Pick<TransportResponse, 'body' | 'close'>,
  encoding: ContentEncoding,
  limit: number,
  overflow: 'fail' | 'truncate',
  url: string,
): Promise<{ readonly bytes: Buffer; readonly truncated: boolean }> {
  let wire = 0;
  async function* counted(): AsyncGenerator<Uint8Array> {
    for await (const chunk of response.body) {
      wire += chunk.byteLength;
      if (wire > limit && overflow === 'fail') {
        throw new WebsiteFetchError('too_large', { url });
      }
      yield chunk;
    }
  }
  let source: AsyncIterable<Uint8Array> = counted();
  if (encoding !== 'identity') {
    const decompressor =
      encoding === 'br'
        ? createBrotliDecompress()
        : encoding === 'deflate'
          ? createInflate()
          : createGunzip();
    source = pipeline(Readable.from(source), decompressor, () => {
      // Errors reach the reader through the decompressor.
    });
  }
  const parts: Buffer[] = [];
  let total = 0;
  try {
    for await (const chunk of source) {
      const buffer = Buffer.from(chunk);
      if (total + buffer.length > limit) {
        if (overflow === 'fail') {
          throw new WebsiteFetchError('too_large', { url });
        }
        parts.push(buffer.subarray(0, limit - total));
        total = limit;
        return { bytes: Buffer.concat(parts, total), truncated: true };
      }
      parts.push(buffer);
      total += buffer.length;
    }
  } finally {
    response.close();
  }
  return { bytes: Buffer.concat(parts, total), truncated: false };
}

/** Maps a Node.js network, HTTP parser, TLS or zlib error to our codes. */
export function networkError(error: unknown, url: string): WebsiteFetchError {
  if (error instanceof WebsiteFetchError) {
    return error;
  }
  const code = errorCode(error);
  if (code === 'HPE_HEADER_OVERFLOW') {
    return new WebsiteFetchError('too_large', { url, reason: 'headers' });
  }
  if (code.startsWith('HPE_')) {
    return new WebsiteFetchError('bad_response', { url, reason: 'http' });
  }
  if (
    code.startsWith('Z_') ||
    code.includes('BROTLI') ||
    code.startsWith('ERR__')
  ) {
    return new WebsiteFetchError('bad_response', { url, reason: 'encoding' });
  }
  // EPROTO: OpenSSL refused the handshake (e.g. the server does not speak TLS).
  if (
    code === 'EPROTO' ||
    /^(ERR_TLS|ERR_SSL|ERR_OSSL)/.test(code) ||
    /CERT|SELF_SIGNED|UNABLE_TO_|DEPTH_ZERO|HOSTNAME_MISMATCH/.test(code)
  ) {
    return new WebsiteFetchError('tls_failed', { url });
  }
  return new WebsiteFetchError('connection_failed', { url });
}

const sha256 = (data: string | Uint8Array) =>
  createHash('sha256').update(data).digest('hex');

export interface ReceivedPage {
  readonly source: WebsiteSource;
  readonly requestedUrl: string;
  readonly finalUrl: URL;
  readonly redirects: readonly WebsiteRedirect[];
  readonly status: number;
  readonly contentType: ContentType & { readonly essence: WebsitePageType };
  readonly bytes: Uint8Array;
  readonly retrievedAt: Date;
}

/** Decodes, extracts and hashes a received body (shared by the live fetcher and the fake). */
export function toWebsitePage(
  received: ReceivedPage,
  policy: Pick<WebsiteFetchPolicy, 'maxTextChars' | 'maxLinks'>,
): WebsitePage {
  const isHtml = received.contentType.essence !== 'text/plain';
  const decoded = decodeBody(
    received.bytes,
    received.contentType.charset,
    isHtml,
  );
  const extracted = isHtml
    ? extractHtml(decoded.text, {
        baseUrl: received.finalUrl,
        maxTextChars: policy.maxTextChars,
        maxLinks: policy.maxLinks,
      })
    : extractPlainText(decoded.text, { maxTextChars: policy.maxTextChars });
  return {
    source: received.source,
    requestedUrl: received.requestedUrl,
    finalUrl: received.finalUrl.href,
    redirects: received.redirects,
    status: received.status,
    contentType: received.contentType.essence,
    charset: decoded.charset,
    retrievedAt: received.retrievedAt,
    byteLength: received.bytes.byteLength,
    contentSha256: sha256(received.bytes),
    title: extracted.title,
    description: extracted.description,
    language: extracted.language,
    text: extracted.text,
    textTruncated: extracted.textTruncated,
    textSha256: sha256(extracted.text),
    links: extracted.links,
  };
}

export function assertCacheScope(scope: unknown): asserts scope is string {
  if (typeof scope !== 'string' || scope.length === 0 || scope.length > 200) {
    throw new TypeError('A fetch needs its cacheScope (the workspace id).');
  }
}

// ─── The fetcher ─────────────────────────────────────────────────────────────

/** RFC 9309: a cached robots.txt is used for 24 hours at most. */
export const ROBOTS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** An unreadable robots.txt is tried again after 15 minutes. */
export const ROBOTS_RETRY_MS = 15 * 60 * 1000;
const ROBOTS_CACHE_ENTRIES = 1000;

type RobotsEntry =
  | { readonly kind: 'rules'; readonly robots: RobotsTxt }
  | { readonly kind: 'allow_all' }
  | { readonly kind: 'unreachable' };

interface Exchange {
  readonly target: FetchTarget;
  readonly status: number;
  readonly headers: IncomingHttpHeaders;
  readonly contentType: ContentType | null;
  readonly bytes: Buffer;
  readonly redirects: readonly WebsiteRedirect[];
}

export interface SafeWebsiteFetcherOptions {
  readonly policy?: WebsiteFetchPolicyInput;
  readonly resolver?: HostResolver;
  readonly transport?: WebsiteTransport;
  /** Share one limiter between fetchers to limit per host across them. */
  readonly limiter?: HostConcurrencyLimiter;
  readonly now?: () => Date;
}

export class SafeWebsiteFetcher implements WebsiteFetcher {
  readonly source = 'LIVE' as const;
  readonly policy: WebsiteFetchPolicy;
  private readonly resolver: HostResolver;
  private readonly transport: WebsiteTransport;
  private readonly limiter: HostConcurrencyLimiter;
  private readonly now: () => Date;
  private readonly targetOptions: TargetOptions;
  /** Keyed by cache scope and origin: nothing cached is shared between workspaces. */
  private readonly robotsCache = new Map<
    string,
    { readonly entry: RobotsEntry; readonly expiresAt: number }
  >();

  constructor(options: SafeWebsiteFetcherOptions = {}) {
    this.policy = parseWebsiteFetchPolicy(options.policy ?? {});
    this.resolver = options.resolver ?? systemResolver;
    this.transport = options.transport ?? new NodeHttpTransport();
    this.limiter =
      options.limiter ?? new HostConcurrencyLimiter(this.policy.maxPerHost);
    this.now = options.now ?? (() => new Date());
    this.targetOptions = { allowedPorts: this.policy.allowedPorts };
  }

  async fetchPage(request: WebsiteFetchRequest): Promise<WebsitePage> {
    assertCacheScope(request.cacheScope);
    const timeout = AbortSignal.timeout(this.policy.timeoutMs);
    const signal =
      request.signal === undefined
        ? timeout
        : AbortSignal.any([timeout, request.signal]);
    try {
      const start = parseFetchTarget(request.url, this.targetOptions);
      const exchange = await this.follow(
        start,
        'page',
        signal,
        request.cacheScope,
      );
      const contentType = exchange.contentType;
      if (contentType === null || !isPageType(contentType.essence)) {
        throw new WebsiteFetchError('unsupported_content_type');
      }
      return toWebsitePage(
        {
          source: this.source,
          requestedUrl: start.url.href,
          finalUrl: exchange.target.url,
          redirects: exchange.redirects,
          status: exchange.status,
          contentType: { ...contentType, essence: contentType.essence },
          bytes: exchange.bytes,
          retrievedAt: this.now(),
        },
        this.policy,
      );
    } catch (error) {
      if (error instanceof WebsiteFetchError) {
        throw error;
      }
      if (request.signal?.aborted === true) {
        throw new WebsiteFetchError('canceled', { url: request.url });
      }
      if (timeout.aborted) {
        throw new WebsiteFetchError('timeout', { url: request.url });
      }
      throw networkError(error, request.url);
    }
  }

  /** Follows redirects itself: every hop is checked as if it were the first URL. */
  private async follow(
    start: FetchTarget,
    kind: 'page' | 'robots',
    signal: AbortSignal,
    cacheScope: string,
  ): Promise<Exchange> {
    const redirects: WebsiteRedirect[] = [];
    const visited = new Set<string>([start.url.href]);
    let target = start;
    for (;;) {
      checkAccess(this.policy, target);
      const destination = await this.destination(target, signal);
      if (kind === 'page' && this.policy.respectRobots) {
        await this.checkRobots(target, cacheScope, signal);
      }
      const release = await this.limiter.acquire(target.hostKey, signal);
      try {
        const response = await this.transport.request({
          url: target.url,
          address: destination.address,
          family: destination.family,
          headers: this.headers(kind),
          signal,
          maxHeaderBytes: this.policy.maxHeaderBytes,
        });
        if (!REDIRECT_STATUSES.has(response.status)) {
          return await this.receive(target, response, kind, redirects);
        }
        response.close();
        const next = this.redirectTarget(target, response, redirects.length);
        if (visited.has(next.url.href)) {
          throw new WebsiteFetchError('redirect_loop', { url: next.url.href });
        }
        redirects.push({ url: target.url.href, status: response.status });
        visited.add(next.url.href);
        target = next;
      } finally {
        release();
      }
    }
  }

  /** A literal is used as is (checked when parsed); a name is resolved and every answer checked. */
  private async destination(
    target: FetchTarget,
    signal: AbortSignal,
  ): Promise<{ readonly address: string; readonly family: AddressFamily }> {
    if (target.literal !== null) {
      return target.literal;
    }
    let answers: readonly ResolvedAddress[];
    try {
      answers = await untilAborted(this.resolver.lookup(target.host), signal);
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      throw new WebsiteFetchError(
        NOT_FOUND.has(errorCode(error)) ? 'host_not_found' : 'dns_failed',
        { url: target.url.href },
      );
    }
    return pickPublicAddress(answers, target.url.href);
  }

  private redirectTarget(
    from: FetchTarget,
    response: TransportResponse,
    followed: number,
  ): FetchTarget {
    const location = single(response.headers.location)?.trim();
    if (location === undefined || location === '') {
      throw new WebsiteFetchError('bad_redirect', { url: from.url.href });
    }
    if (followed >= this.policy.maxRedirects) {
      throw new WebsiteFetchError('too_many_redirects', { url: from.url.href });
    }
    let resolved: URL;
    try {
      resolved = new URL(location, from.url);
    } catch {
      throw new WebsiteFetchError('bad_redirect', { url: from.url.href });
    }
    return parseFetchTarget(resolved, this.targetOptions);
  }

  private async receive(
    target: FetchTarget,
    response: TransportResponse,
    kind: 'page' | 'robots',
    redirects: readonly WebsiteRedirect[],
  ): Promise<Exchange> {
    const url = target.url.href;
    const status = response.status;
    const ok = status >= 200 && status < 300;
    const contentType = parseContentType(
      single(response.headers['content-type']),
    );
    const done = (bytes: Buffer): Exchange => ({
      target,
      status,
      headers: response.headers,
      contentType,
      bytes,
      redirects,
    });
    if (!ok) {
      response.close();
      if (kind === 'robots') {
        return done(Buffer.alloc(0));
      }
      throw new WebsiteFetchError('http_error', { status, url });
    }
    if (
      kind === 'page' &&
      (contentType === null || !isPageType(contentType.essence))
    ) {
      response.close();
      throw new WebsiteFetchError('unsupported_content_type', {
        reason: contentType?.essence ?? 'missing',
        url,
      });
    }
    const encoding = parseContentEncoding(
      single(response.headers['content-encoding']),
    );
    if (encoding === null) {
      response.close();
      throw new WebsiteFetchError('unsupported_encoding', { url });
    }
    const limit = kind === 'robots' ? ROBOTS_MAX_BYTES : this.policy.maxBytes;
    const declared = single(response.headers['content-length']);
    if (
      kind === 'page' &&
      declared !== undefined &&
      /^\d+$/.test(declared) &&
      Number(declared) > limit
    ) {
      response.close();
      throw new WebsiteFetchError('too_large', { url });
    }
    const body = await readBody(
      response,
      encoding,
      limit,
      kind === 'robots' ? 'truncate' : 'fail',
      url,
    );
    return done(body.bytes);
  }

  private headers(kind: 'page' | 'robots'): Record<string, string> {
    return {
      'user-agent': this.policy.userAgent,
      accept:
        kind === 'robots'
          ? 'text/plain, */*;q=0.1'
          : 'text/html, application/xhtml+xml;q=0.9, text/plain;q=0.8',
      'accept-encoding': 'gzip, deflate, br',
      connection: 'close',
    };
  }

  private async checkRobots(
    target: FetchTarget,
    cacheScope: string,
    signal: AbortSignal,
  ): Promise<void> {
    if (target.url.pathname === '/robots.txt') {
      return;
    }
    const entry = await this.robotsFor(target.url.origin, cacheScope, signal);
    if (entry.kind === 'unreachable') {
      throw new WebsiteFetchError('robots_unreachable', {
        url: target.url.href,
      });
    }
    if (
      entry.kind === 'rules' &&
      !robotsAllows(
        entry.robots,
        this.policy.robotsToken,
        `${target.url.pathname}${target.url.search}`,
      )
    ) {
      throw new WebsiteFetchError('robots_disallowed', {
        url: target.url.href,
      });
    }
  }

  private async robotsFor(
    origin: string,
    cacheScope: string,
    signal: AbortSignal,
  ): Promise<RobotsEntry> {
    const key = `${cacheScope}\u0000${origin}`;
    const now = this.now().getTime();
    const cached = this.robotsCache.get(key);
    if (cached !== undefined && cached.expiresAt > now) {
      return cached.entry;
    }
    const entry = await this.loadRobots(origin, cacheScope, signal);
    this.robotsCache.delete(key);
    this.robotsCache.set(key, {
      entry,
      expiresAt:
        now +
        (entry.kind === 'unreachable' ? ROBOTS_RETRY_MS : ROBOTS_CACHE_TTL_MS),
    });
    for (const oldest of this.robotsCache.keys()) {
      if (this.robotsCache.size <= ROBOTS_CACHE_ENTRIES) {
        break;
      }
      this.robotsCache.delete(oldest);
    }
    return entry;
  }

  /**
   * RFC 9309: 2xx is parsed; 4xx means no rules (allowed); 5xx or no answer means "assume
   * complete disallow" (here: unreachable, try later). More than the allowed redirects is
   * treated as unavailable. The fetch's own timeout or cancellation passes through.
   */
  private async loadRobots(
    origin: string,
    cacheScope: string,
    signal: AbortSignal,
  ): Promise<RobotsEntry> {
    try {
      const target = parseFetchTarget(
        new URL('/robots.txt', origin),
        this.targetOptions,
      );
      const exchange = await this.follow(target, 'robots', signal, cacheScope);
      if (exchange.status >= 200 && exchange.status < 300) {
        const text = decodeBody(
          exchange.bytes,
          exchange.contentType?.charset ?? null,
          false,
        ).text;
        return { kind: 'rules', robots: parseRobotsTxt(text) };
      }
      if (exchange.status >= 400 && exchange.status < 500) {
        return { kind: 'allow_all' };
      }
      return { kind: 'unreachable' };
    } catch (error) {
      if (signal.aborted) {
        throw error;
      }
      if (
        error instanceof WebsiteFetchError &&
        error.code === 'too_many_redirects'
      ) {
        return { kind: 'allow_all' };
      }
      return { kind: 'unreachable' };
    }
  }
}
