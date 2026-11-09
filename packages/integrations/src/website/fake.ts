// The website fetcher of development and tests (task 09A, docs/decisions.md D-09A-07). It never
// opens a connection: pages are synthetic (or scripted by a test), built from the host name
// alone. URLs go through the same checks as the live fetcher (schemes, ports, credentials,
// internal names and addresses, the access policy, redirects), so unsafe input fails the
// same way in development; only the reserved example names (.example, .test) are served.

import {
  parseFetchTarget,
  type FetchTarget,
  type TargetOptions,
} from './address.js';
import { WebsiteFetchError, type WebsiteFetchErrorCode } from './errors.js';
import {
  assertCacheScope,
  parseContentType,
  toWebsitePage,
} from './fetcher.js';
import {
  checkAccess,
  parseWebsiteFetchPolicy,
  type WebsiteFetchPolicy,
  type WebsiteFetchPolicyInput,
} from './policy.js';
import {
  WEBSITE_PAGE_TYPES,
  type WebsiteFetcher,
  type WebsiteFetchRequest,
  type WebsitePage,
  type WebsitePageType,
  type WebsiteRedirect,
} from './types.js';

export interface FakeWebsiteResponse {
  /** Default 200. A 3xx status needs `redirectTo`. */
  readonly status?: number;
  /** Default "text/html; charset=utf-8". */
  readonly contentType?: string;
  readonly body?: string;
  readonly redirectTo?: string;
}

export interface FakeWebsiteFetcherOptions {
  readonly now?: () => Date;
  /** Scripted answers by URL (without fragment); other URLs get a synthetic page. */
  readonly pages?: Readonly<Record<string, FakeWebsiteResponse>>;
  /** URLs that fail with the given code. */
  readonly failures?: Readonly<Record<string, WebsiteFetchErrorCode>>;
  readonly policy?: WebsiteFetchPolicyInput;
}

const FIXED_TIME = new Date('2026-01-01T00:00:00.000Z');

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** A deterministic page for a host: its name, a menu and one paragraph, all synthetic. */
export function syntheticWebsiteHtml(target: FetchTarget): string {
  const label = target.hostKey.split('.')[0] ?? target.hostKey;
  const name = label
    .split(/[-_]/)
    .filter((part) => part.length > 0)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
  const host = escapeHtml(target.host);
  const path = escapeHtml(target.url.pathname);
  const title = escapeHtml(name);
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    `<title>${title} (synthetic)</title>`,
    `<meta name="description" content="Synthetic page for ${host}: no real business.">`,
    '</head><body>',
    '<header><nav><a href="/">Home</a> <a href="/about">About</a> <a href="/contact">Contact</a></nav></header>',
    `<main><h1>${title}</h1>`,
    `<p>This synthetic page stands for ${host}${path}. It describes no real business, person or address.</p>`,
    '</main>',
    `<footer>Synthetic footer of ${title}</footer>`,
    '</body></html>',
  ].join('\n');
}

const REDIRECTS = new Set([301, 302, 303, 307, 308]);

export class FakeWebsiteFetcher implements WebsiteFetcher {
  readonly source = 'FAKE' as const;
  readonly policy: WebsiteFetchPolicy;
  /** Every URL asked for, in order (redirect targets included). */
  readonly requests: string[] = [];
  private readonly now: () => Date;
  private readonly pages: Readonly<Record<string, FakeWebsiteResponse>>;
  private readonly failures: Readonly<Record<string, WebsiteFetchErrorCode>>;
  private readonly targetOptions: TargetOptions;

  constructor(options: FakeWebsiteFetcherOptions = {}) {
    this.policy = parseWebsiteFetchPolicy(options.policy ?? {});
    this.now = options.now ?? (() => FIXED_TIME);
    this.pages = options.pages ?? {};
    this.failures = options.failures ?? {};
    this.targetOptions = {
      allowedPorts: this.policy.allowedPorts,
      synthetic: true,
    };
  }

  fetchPage(request: WebsiteFetchRequest): Promise<WebsitePage> {
    // A throw inside the executor rejects the promise.
    return new Promise((resolve) => {
      resolve(this.fetchNow(request));
    });
  }

  private fetchNow(request: WebsiteFetchRequest): WebsitePage {
    assertCacheScope(request.cacheScope);
    if (request.signal?.aborted === true) {
      throw new WebsiteFetchError('canceled', { url: request.url });
    }
    const start = parseFetchTarget(request.url, this.targetOptions);
    const redirects: WebsiteRedirect[] = [];
    let target = start;
    for (;;) {
      checkAccess(this.policy, target);
      const url = target.url.href;
      this.requests.push(url);
      const failure = this.failures[url];
      if (failure !== undefined) {
        throw new WebsiteFetchError(failure, { url });
      }
      const scripted = this.pages[url];
      const status = scripted?.status ?? 200;
      if (REDIRECTS.has(status)) {
        if (redirects.length >= this.policy.maxRedirects) {
          throw new WebsiteFetchError('too_many_redirects', { url });
        }
        if (scripted?.redirectTo === undefined) {
          throw new WebsiteFetchError('bad_redirect', { url });
        }
        const next = parseFetchTarget(
          new URL(scripted.redirectTo, target.url),
          this.targetOptions,
        );
        redirects.push({ url, status });
        target = next;
        continue;
      }
      if (status < 200 || status >= 300) {
        throw new WebsiteFetchError('http_error', { status, url });
      }
      const contentType = parseContentType(
        scripted?.contentType ?? 'text/html; charset=utf-8',
      );
      const essence = contentType?.essence;
      if (
        contentType === null ||
        essence === undefined ||
        !(WEBSITE_PAGE_TYPES as readonly string[]).includes(essence)
      ) {
        throw new WebsiteFetchError('unsupported_content_type', { url });
      }
      const body = Buffer.from(
        scripted?.body ?? syntheticWebsiteHtml(target),
        'utf8',
      );
      if (body.byteLength > this.policy.maxBytes) {
        throw new WebsiteFetchError('too_large', { url });
      }
      return toWebsitePage(
        {
          source: this.source,
          requestedUrl: start.url.href,
          finalUrl: target.url,
          redirects,
          status,
          contentType: {
            essence: essence as WebsitePageType,
            charset: contentType.charset,
          },
          bytes: body,
          retrievedAt: this.now(),
        },
        this.policy,
      );
    }
  }
}
