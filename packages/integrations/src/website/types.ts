// The website fetcher's interface (task 09A, docs/decisions.md D-09A-06). Everything a page
// returns is untrusted data: text to validate and escape, links to fetch only through a
// fetcher, never instructions.

import type { PageLink } from './text.js';

export type WebsiteSource = 'LIVE' | 'FAKE';

export const WEBSITE_PAGE_TYPES = [
  'text/html',
  'application/xhtml+xml',
  'text/plain',
] as const;

export type WebsitePageType = (typeof WEBSITE_PAGE_TYPES)[number];

export interface WebsiteRedirect {
  readonly url: string;
  readonly status: number;
}

export interface WebsitePage {
  readonly source: WebsiteSource;
  /** The URL asked for, without its fragment. */
  readonly requestedUrl: string;
  /** Where the page was found, after redirects. */
  readonly finalUrl: string;
  readonly redirects: readonly WebsiteRedirect[];
  readonly status: number;
  readonly contentType: WebsitePageType;
  /** The encoding the body was decoded with. */
  readonly charset: string;
  /** When the body was received (the fetcher's clock). */
  readonly retrievedAt: Date;
  /** Body bytes after decompression. */
  readonly byteLength: number;
  /** SHA-256 (hex) of the body bytes after decompression: detects changes and duplicates. */
  readonly contentSha256: string;
  readonly title: string | null;
  readonly description: string | null;
  /** The page's declared language (html lang), if well formed. */
  readonly language: string | null;
  /** Readable text without scripts, styles or navigation. */
  readonly text: string;
  readonly textTruncated: boolean;
  /** SHA-256 (hex) of `text`, UTF-8. */
  readonly textSha256: string;
  readonly links: readonly PageLink[];
}

export interface WebsiteFetchRequest {
  readonly url: string;
  /**
   * The workspace (tenant id) the fetch is for: the robots.txt cache is kept per scope, so
   * no cached state is shared between workspaces.
   */
  readonly cacheScope: string;
  /** Cancels the fetch (it fails with "canceled"). */
  readonly signal?: AbortSignal;
}

export interface WebsiteFetcher {
  readonly source: WebsiteSource;
  /** Throws WebsiteFetchError; never a site's own message or body. */
  fetchPage(request: WebsiteFetchRequest): Promise<WebsitePage>;
}
