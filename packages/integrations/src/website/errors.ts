// Why a website fetch failed (task 09A, docs/decisions.md D-09A-06), in our words only: a
// site's own error text, headers or body never travel with the error.

export const WEBSITE_FETCH_ERROR_CODES = [
  /** Not an absolute http(s) URL, or one this service won't parse (length, syntax). */
  'invalid_url',
  /** A scheme other than http or https (file:, ftp:, data:, gopher: ...). */
  'blocked_scheme',
  /** A port outside the policy's allowed ports. */
  'blocked_port',
  /** A user name or password in the URL. */
  'credentials_in_url',
  /** A name that is internal by definition (localhost, *.internal, a single label, metadata). */
  'blocked_host',
  /** The URL or its DNS answer is a non-public address (loopback, private, metadata ...). */
  'blocked_address',
  /** The policy's blocked or allowed hosts refuse it. */
  'access_restricted',
  /** The site's robots.txt disallows the page for this crawler. */
  'robots_disallowed',
  /** The site's robots.txt could not be read (server error, unreachable): try later. */
  'robots_unreachable',
  /** The name does not exist. */
  'host_not_found',
  /** DNS failed for another reason (timeout, server failure). */
  'dns_failed',
  'too_many_redirects',
  'redirect_loop',
  /** A redirect without a usable Location. */
  'bad_redirect',
  /** The time budget (all hops, waiting included) ran out. */
  'timeout',
  /** The caller cancelled the fetch. */
  'canceled',
  /** The body (or its headers) is larger than the policy allows. */
  'too_large',
  /** The markup nests too deeply or has too many elements to parse safely. */
  'too_complex',
  'unsupported_content_type',
  /** A Content-Encoding other than identity, gzip, deflate or br. */
  'unsupported_encoding',
  /** The site answered with an error status; `status` says which. */
  'http_error',
  'connection_failed',
  /** The TLS handshake or the certificate check failed. */
  'tls_failed',
  /** The answer could not be read (malformed HTTP, corrupt compression). */
  'bad_response',
] as const;

export type WebsiteFetchErrorCode = (typeof WEBSITE_FETCH_ERROR_CODES)[number];

const TEXT: Readonly<Record<WebsiteFetchErrorCode, string>> = {
  invalid_url: 'The address is not a valid web address.',
  blocked_scheme: 'Only http and https addresses can be fetched.',
  blocked_port: 'That port is not allowed.',
  credentials_in_url: 'Addresses with a user name or password are not fetched.',
  blocked_host: 'That host is internal and is never fetched.',
  blocked_address: 'That address is not public and is never fetched.',
  access_restricted: 'The access policy does not allow that host.',
  robots_disallowed: "The site's robots.txt does not allow this page.",
  robots_unreachable: "The site's robots.txt could not be read.",
  host_not_found: 'The host name does not exist.',
  dns_failed: 'The host name could not be resolved.',
  too_many_redirects: 'The page redirects too many times.',
  redirect_loop: 'The page redirects in a loop.',
  bad_redirect: 'The page redirects without a usable address.',
  timeout: 'The site did not answer in time.',
  canceled: 'The fetch was cancelled.',
  too_large: 'The page is larger than allowed.',
  too_complex: "The page's markup is too complex to read.",
  unsupported_content_type: 'The page is not HTML or plain text.',
  unsupported_encoding: 'The page uses an unsupported compression.',
  http_error: 'The site answered with an error.',
  connection_failed: 'The site could not be reached.',
  tls_failed: 'The secure connection to the site failed.',
  bad_response: "The site's answer could not be read.",
};

/** Retrying later can help; the others won't change by themselves. */
const RETRYABLE: ReadonlySet<WebsiteFetchErrorCode> = new Set([
  'robots_unreachable',
  'dns_failed',
  'timeout',
  'connection_failed',
]);

/** HTTP statuses worth retrying: request timeout, too early, too many requests, 5xx. */
export const isRetryableStatus = (status: number): boolean =>
  status === 408 || status === 425 || status === 429 || status >= 500;

export interface WebsiteFetchErrorDetails {
  /** For http_error: the status the site answered with. */
  readonly status?: number;
  /** For blocked_address and blocked_host: which rule refused it (e.g. "loopback"). */
  readonly reason?: string;
  /** The URL of the hop that failed (never sent anywhere; for the caller's records). */
  readonly url?: string;
}

export class WebsiteFetchError extends Error {
  override readonly name = 'WebsiteFetchError';
  readonly retryable: boolean;
  readonly status: number | null;
  readonly reason: string | null;
  readonly url: string | null;

  constructor(
    readonly code: WebsiteFetchErrorCode,
    details: WebsiteFetchErrorDetails = {},
  ) {
    super(TEXT[code]);
    this.status = details.status ?? null;
    this.reason = details.reason ?? null;
    this.url = details.url ?? null;
    this.retryable =
      code === 'http_error'
        ? this.status !== null && isRetryableStatus(this.status)
        : RETRYABLE.has(code);
  }
}

export const isWebsiteFetchError = (
  value: unknown,
): value is WebsiteFetchError => value instanceof WebsiteFetchError;
