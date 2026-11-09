// The website fetcher's limits and access restrictions (task 09A, docs/decisions.md D-09A-03,
// D-09A-04). Every limit has a default and a hard ceiling: configuration can tighten the
// fetcher, never make it unbounded.

import { normalizeDomain } from '@lead-fennec-ai/shared';
import { z } from 'zod';
import type { FetchTarget } from './address.js';
import { WebsiteFetchError } from './errors.js';

const MIB = 1024 * 1024;

/** The crawler's robots.txt product token; the User-Agent must contain it. */
export const ROBOTS_PRODUCT_TOKEN = 'LeadFennecBot';
export const DEFAULT_USER_AGENT = `${ROBOTS_PRODUCT_TOKEN}/0.1`;

/** A blocked or allowed host: a domain name, matching itself and its subdomains. */
export const websiteHostPatternSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .transform((value, context) => {
    try {
      return normalizeDomain(value);
    } catch {
      context.addIssue({ code: 'custom', message: 'must be a domain name' });
      return z.NEVER;
    }
  });

export const websiteFetchPolicySchema = z
  .strictObject({
    /** Redirects followed per fetch (each one is checked like the first URL). */
    maxRedirects: z.int().min(0).max(10).default(5),
    /** The whole fetch: waiting for a slot, DNS, robots.txt, every hop and the body. */
    timeoutMs: z.int().min(100).max(60_000).default(15_000),
    /** Body bytes after decompression (and on the wire). */
    maxBytes: z
      .int()
      .min(1024)
      .max(10 * MIB)
      .default(2 * MIB),
    maxHeaderBytes: z
      .int()
      .min(1024)
      .max(64 * 1024)
      .default(16 * 1024),
    maxTextChars: z.int().min(100).max(500_000).default(100_000),
    maxLinks: z.int().min(0).max(500).default(100),
    /** Requests to one host at the same time, in this process. */
    maxPerHost: z.int().min(1).max(8).default(2),
    allowedPorts: z
      .array(z.int().min(1).max(65_535))
      .min(1)
      .max(16)
      .default([80, 443]),
    /** Never fetched, with their subdomains. */
    blockedHosts: z.array(websiteHostPatternSchema).max(1000).default([]),
    /** When set, only these (and their subdomains) are fetched. */
    allowedHosts: z
      .array(websiteHostPatternSchema)
      .min(1)
      .max(1000)
      .nullable()
      .default(null),
    respectRobots: z.boolean().default(true),
    userAgent: z
      .string()
      .regex(/^[\x20-\x7e]{1,200}$/)
      .default(DEFAULT_USER_AGENT),
    robotsToken: z
      .string()
      .regex(/^[A-Za-z_-]{1,64}$/)
      .default(ROBOTS_PRODUCT_TOKEN),
  })
  .refine(
    (policy) =>
      policy.userAgent.toLowerCase().includes(policy.robotsToken.toLowerCase()),
    {
      message: 'userAgent must contain robotsToken',
      path: ['userAgent'],
    },
  );

export type WebsiteFetchPolicy = z.output<typeof websiteFetchPolicySchema>;
export type WebsiteFetchPolicyInput = z.input<typeof websiteFetchPolicySchema>;

export function parseWebsiteFetchPolicy(
  input: WebsiteFetchPolicyInput = {},
): WebsiteFetchPolicy {
  return websiteFetchPolicySchema.parse(input);
}

const matches = (host: string, pattern: string) =>
  host === pattern || host.endsWith(`.${pattern}`);

/** The configured restrictions, checked for the first URL and every redirect. */
export function checkAccess(
  policy: Pick<WebsiteFetchPolicy, 'blockedHosts' | 'allowedHosts'>,
  target: FetchTarget,
): void {
  const url = target.url.href;
  if (policy.blockedHosts.some((pattern) => matches(target.host, pattern))) {
    throw new WebsiteFetchError('access_restricted', {
      reason: 'blocked_host',
      url,
    });
  }
  if (
    policy.allowedHosts !== null &&
    !policy.allowedHosts.some((pattern) => matches(target.host, pattern))
  ) {
    throw new WebsiteFetchError('access_restricted', {
      reason: 'not_allowed',
      url,
    });
  }
}
