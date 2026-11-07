// Which pages research reads, and when two runs would show the model the same thing (task 09C,
// docs/decisions.md D-09C-01 and D-09C-03). Application code chooses the pages, never a model or
// a page: only links to the same site, by what their path says, at most three.

import { createHash } from 'node:crypto';
import type {
  ResearchCampaignContext,
  ResearchExtract,
  WebsiteResearchField,
} from '@lead-fennec-ai/shared';
import {
  WEBSITE_RESEARCH_PROMPT_SHA256,
  WEBSITE_RESEARCH_SCHEMA_VERSION,
} from './prompt.js';

/** Path words and their priority (lower first). */
const PAGE_KINDS: readonly [RegExp, number][] = [
  [/(^|[/_-])(about|about-us|company|who-we-are|our-story)([/_.-]|$)/i, 0],
  [
    /(^|[/_-])(products?|services?|solutions?|platform|what-we-do)([/_.-]|$)/i,
    1,
  ],
  [/(^|[/_-])(team|leadership|people|management)([/_.-]|$)/i, 2],
  [/(^|[/_-])(customers?|clients?|case-studies)([/_.-]|$)/i, 3],
  [/(^|[/_-])(careers?|jobs|join-us|hiring)([/_.-]|$)/i, 4],
  [/(^|[/_-])(news|press|newsroom|announcements)([/_.-]|$)/i, 5],
  [/(^|[/_-])(contact|contact-us|locations?|offices?)([/_.-]|$)/i, 6],
];

/** Files and app pages that are no use to read. */
const SKIPPED =
  /\.(pdf|jpe?g|png|gif|svg|webp|zip|docx?|xlsx?|pptx?|mp4|mp3)$|(^|\/)(login|signin|sign-in|signup|register|cart|checkout|account|privacy|terms|cookies?|legal)(\/|$)/i;

const hostOf = (url: URL) =>
  url.hostname.startsWith('www.') ? url.hostname.slice(4) : url.hostname;

/**
 * Up to `max` links of the start page worth reading: same site (ignoring "www."), http(s),
 * not the start page itself, not files or account pages, ranked by what the path says. A link
 * whose path says nothing useful is not followed.
 */
export function pickResearchLinks(
  links: readonly { readonly url: string; readonly sameSite: boolean }[],
  startUrl: string,
  max: number,
): string[] {
  const start = new URL(startUrl);
  const startKey = `${hostOf(start)}${start.pathname.replace(/\/$/, '')}`;
  const ranked: {
    readonly url: string;
    readonly rank: number;
    readonly order: number;
  }[] = [];
  const seen = new Set<string>();
  links.forEach((link, order) => {
    if (!link.sameSite) {
      return;
    }
    let url: URL;
    try {
      url = new URL(link.url);
    } catch {
      return;
    }
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      hostOf(url) !== hostOf(start)
    ) {
      return;
    }
    url.hash = '';
    url.search = '';
    const key = `${hostOf(url)}${url.pathname.replace(/\/$/, '')}`;
    if (key === startKey || seen.has(key) || SKIPPED.test(url.pathname)) {
      return;
    }
    const rank = PAGE_KINDS.find(([pattern]) =>
      pattern.test(url.pathname),
    )?.[1];
    if (rank === undefined) {
      return;
    }
    seen.add(key);
    ranked.push({ url: url.href, rank, order });
  });
  return ranked
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .slice(0, Math.max(0, max))
    .map((item) => item.url);
}

const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item as Record<string, unknown>).sort(([a], [b]) =>
            a < b ? -1 : a > b ? 1 : 0,
          ),
        )
      : item,
  );

/**
 * SHA-256 of what the model would be asked: the prompt and schema versions, the provider and
 * model, the fields, the company, the campaign context and every extract's id, URL, title and
 * text. When it equals an earlier version's, that version is reused without a model call.
 * Retrieval times are left out: reading the same text again doesn't change what it says.
 */
export function researchInputSha256(input: {
  readonly provider: string;
  readonly model: string;
  readonly fields: readonly WebsiteResearchField[];
  readonly company: {
    readonly name: string | null;
    readonly domain: string | null;
  };
  readonly campaign: ResearchCampaignContext;
  readonly extracts: readonly ResearchExtract[];
}): string {
  return createHash('sha256')
    .update(
      canonical({
        promptSha256: WEBSITE_RESEARCH_PROMPT_SHA256,
        schema: WEBSITE_RESEARCH_SCHEMA_VERSION,
        provider: input.provider,
        model: input.model,
        fields: [...input.fields],
        company: input.company,
        campaign: input.campaign,
        extracts: input.extracts.map((extract) => ({
          id: extract.id,
          url: extract.url,
          title: extract.title,
          text: extract.text,
        })),
      }),
    )
    .digest('hex');
}
