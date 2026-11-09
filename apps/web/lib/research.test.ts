import {
  RESEARCH_REVIEW_REASONS,
  WEBSITE_RESEARCH_FIELDS,
} from '@lead-fennec-ai/shared';
import { describe, expect, it } from 'vitest';
import {
  companyProfileHref,
  errorText,
  FIELD_LABELS,
  quoteParts,
  REVIEW_REASON_TEXT,
  safeLinkUrl,
  shortHash,
} from './research';

// Task 09C: the words and helpers of the company research view.

describe('research words', () => {
  it('labels every field and review reason', () => {
    expect(Object.keys(FIELD_LABELS).sort()).toEqual(
      [...WEBSITE_RESEARCH_FIELDS].sort(),
    );
    expect(Object.keys(REVIEW_REASON_TEXT).sort()).toEqual(
      [...RESEARCH_REVIEW_REASONS].sort(),
    );
  });

  it('explains error codes, and shows an unknown one as is', () => {
    expect(errorText('robots_disallowed')).toBe(
      "The site's robots.txt does not allow it",
    );
    expect(errorText('something_new')).toBe('Stopped (something_new)');
    expect(errorText(null)).toBeNull();
  });
});

describe('research helpers', () => {
  it('links only to http(s) addresses', () => {
    expect(safeLinkUrl('https://acme-widgets.example/about')).toBe(
      'https://acme-widgets.example/about',
    );
    expect(safeLinkUrl('javascript:alert(1)')).toBeNull();
    expect(safeLinkUrl('data:text/html,hi')).toBeNull();
    expect(safeLinkUrl('not a url')).toBeNull();
    expect(safeLinkUrl(null)).toBeNull();
  });

  it('marks a quote in its excerpt, ignoring case when needed', () => {
    expect(
      quoteParts('We are headquartered in Lyon.', 'headquartered in Lyon'),
    ).toEqual({
      before: 'We are ',
      match: 'headquartered in Lyon',
      after: '.',
    });
    expect(quoteParts('WE ARE IN LYON.', 'in lyon')?.match).toBe('IN LYON');
    expect(quoteParts('We are in Lyon.', 'Porto')).toBeNull();
    expect(quoteParts('We are in Lyon.', null)).toBeNull();
  });

  it('builds the profile link and short hashes', () => {
    expect(companyProfileHref('w1', 'o1')).toBe(
      '/workspaces/w1/leads/organizations/o1',
    );
    expect(shortHash('a'.repeat(64))).toBe('aaaaaaaaaaaa');
    expect(shortHash(null)).toBeNull();
  });
});
