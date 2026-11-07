// Words and helpers for a company's website research (task 09C, docs/decisions.md D-09C-05).
// Everything a page, a provider or a model wrote is untrusted text: it is only ever rendered as
// text (React escapes it), and a URL becomes a link only when it is http(s).
import type {
  ResearchReviewReason,
  WebsiteResearchField,
} from '@lead-fennec-ai/shared';

export const FIELD_LABELS: Readonly<Record<WebsiteResearchField, string>> = {
  company_summary: 'What they do',
  products_services: 'Products and services',
  industry: 'Industry',
  target_customers: 'Customers they serve',
  headquarters: 'Headquarters',
  founded_year: 'Founded',
  employee_count: 'Employees',
  markets_served: 'Markets',
  notable_customers: 'Named customers',
  recent_news: 'Recent news',
  technologies: 'Technologies',
  hiring: 'Hiring',
};

export const REVIEW_REASON_TEXT: Readonly<
  Record<ResearchReviewReason, string>
> = {
  evidence_not_found: 'Its quote is not on the page it cites',
  unknown_extract: 'It cites a page that was not read',
  value_not_in_evidence: 'Its quote does not contain this value',
  conflicting_evidence: 'The pages give different values',
  suspicious_instructions: 'It quotes text that tries to instruct an AI',
  field_not_requested: 'It answers something that was not asked',
  invalid_output: "The AI's answer was not in the expected form",
  refusal: 'The AI declined to answer',
  output_truncated: "The AI's answer was cut off",
  content_filtered: "The AI's answer was filtered",
  output_incomplete: "The AI's answer was incomplete",
};

export const ORIGIN_TEXT = {
  MODEL: 'Pages read by the AI',
  REUSED: 'Pages unchanged: earlier findings reused, no AI call',
  CORRECTION: 'Corrected by a person',
} as const;

export const PAGE_OUTCOME_TEXT = {
  fetched: 'Read',
  reused: 'Copy from the last 7 days',
  failed: 'Not read',
} as const;

/** Why a page or a run didn't work, in words; the code itself for anything unexpected. */
const ERROR_TEXT: Readonly<Record<string, string>> = {
  robots_disallowed: "The site's robots.txt does not allow it",
  robots_unreachable: "The site's robots.txt could not be read",
  access_restricted: 'The access settings do not allow this site',
  blocked_address: 'The address is not public',
  blocked_host: 'The address is internal',
  blocked_scheme: 'Not a web address',
  blocked_port: 'That port is not allowed',
  host_not_found: 'The site does not exist',
  dns_failed: 'The site could not be found right now',
  timeout: 'The site did not answer in time',
  connection_failed: 'The site could not be reached',
  tls_failed: 'The secure connection failed',
  http_error: 'The site answered with an error',
  too_large: 'The page is too large',
  too_complex: 'The page is too complex to read',
  unsupported_content_type: 'Not an HTML or text page',
  unsupported_encoding: 'The page uses an unsupported compression',
  too_many_redirects: 'The page redirects too often',
  redirect_loop: 'The page redirects in a loop',
  bad_redirect: 'The page redirects nowhere',
  bad_response: "The site's answer could not be read",
  model_unavailable: 'No AI model is configured',
  usage_limit_reached: "The workspace's AI allowance is used up",
  no_entitled_plan: "The workspace's plan does not include research",
  quota_exceeded: "The AI provider's quota is used up",
  rate_limited: 'The AI provider asked to slow down',
  unavailable: 'The AI provider is not reachable',
  internal_error: 'Something went wrong',
};

export function errorText(code: string | null): string | null {
  return code === null ? null : (ERROR_TEXT[code] ?? `Stopped (${code})`);
}

export function companyProfileHref(
  workspaceId: string,
  organizationId: string,
): string {
  return `/workspaces/${workspaceId}/leads/organizations/${organizationId}`;
}

/** An http(s) URL to link to, or null (anything else is shown as text only). */
export function safeLinkUrl(value: string | null): string | null {
  if (value === null) {
    return null;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:'
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export const shortHash = (sha256: string | null) =>
  sha256 === null ? null : sha256.slice(0, 12);

/**
 * Where a quote sits in an excerpt, to mark it: an exact match first, then ignoring case.
 * Null when it isn't found (the excerpt is then shown unmarked).
 */
export function quoteParts(
  excerpt: string,
  quote: string | null,
): {
  readonly before: string;
  readonly match: string;
  readonly after: string;
} | null {
  if (quote === null || quote.trim() === '') {
    return null;
  }
  let index = excerpt.indexOf(quote);
  if (index === -1) {
    index = excerpt.toLowerCase().indexOf(quote.toLowerCase());
  }
  if (index === -1) {
    return null;
  }
  return {
    before: excerpt.slice(0, index),
    match: excerpt.slice(index, index + quote.length),
    after: excerpt.slice(index + quote.length),
  };
}
