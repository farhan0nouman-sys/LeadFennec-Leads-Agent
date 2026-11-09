// Bounded page extracts for the WebsiteResearchAgent (task 09B, docs/decisions.md D-09B-03): the
// only form in which page text reaches a model. Ids are assigned here (E1, E2 ...), in order.

import {
  WEBSITE_RESEARCH_LIMITS,
  type ResearchExtract,
} from '@lead-fennec-ai/shared';

/** What a fetched page (task 09A's WebsitePage) contributes to an extract. */
export interface ExtractablePage {
  readonly finalUrl: string;
  readonly title: string | null;
  readonly retrievedAt: Date;
  readonly contentSha256: string;
  readonly text: string;
}

export interface ExtractOptions {
  readonly maxExtracts?: number;
  readonly maxExtractChars?: number;
  readonly maxTotalChars?: number;
}

const L = WEBSITE_RESEARCH_LIMITS;

/** Cuts at a line or word boundary near the limit, never inside a surrogate pair. */
function cut(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  let end = max;
  const boundary = Math.max(
    text.lastIndexOf('\n', max),
    text.lastIndexOf(' ', max),
  );
  if (boundary > max * 0.8) {
    end = boundary;
  }
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) {
    end -= 1;
  }
  return text.slice(0, end).trimEnd();
}

/**
 * One extract per page with text, in the pages' order, within the limits (at most 8 extracts,
 * 6000 characters each and 30,000 in all by default; never more than the contract allows).
 */
export function pageExtracts(
  pages: readonly ExtractablePage[],
  options: ExtractOptions = {},
): ResearchExtract[] {
  const maxExtracts = Math.min(
    options.maxExtracts ?? L.maxExtracts,
    L.maxExtracts,
  );
  const maxChars = Math.min(
    options.maxExtractChars ?? L.maxExtractChars,
    L.maxExtractChars,
  );
  let budget = Math.min(
    options.maxTotalChars ?? L.maxTotalExtractChars,
    L.maxTotalExtractChars,
  );
  const extracts: ResearchExtract[] = [];
  for (const page of pages) {
    if (extracts.length >= maxExtracts || budget <= 0) {
      break;
    }
    const text = cut(page.text.trim(), Math.min(maxChars, budget));
    if (text === '') {
      continue;
    }
    budget -= text.length;
    extracts.push({
      id: `E${String(extracts.length + 1)}`,
      url: page.finalUrl,
      title: page.title === null ? null : page.title.slice(0, 300),
      retrievedAt: page.retrievedAt,
      contentSha256: page.contentSha256,
      text,
    });
  }
  return extracts;
}
