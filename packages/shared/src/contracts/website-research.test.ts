import { describe, expect, it } from 'vitest';
import {
  WEBSITE_RESEARCH_FIELD_DESCRIPTIONS,
  WEBSITE_RESEARCH_FIELDS,
  websiteResearchInputSchema,
  websiteResearchModelOutputSchema,
} from './website-research.js';

// Task 09B, docs/decisions.md D-09B-03 and D-09B-04: the research contract's bounds.

const extract = {
  id: 'E1',
  url: 'https://acme-widgets.example/about',
  title: 'About',
  retrievedAt: new Date('2026-11-07T00:00:00.000Z'),
  contentSha256: 'a'.repeat(64),
  text: 'We make synthetic widgets.',
};

const input = {
  company: { name: 'Acme Widgets', domain: 'acme-widgets.example' },
  campaign: { businessProfile: null, offer: null, icp: null },
  extracts: [extract],
};

describe('websiteResearchInputSchema', () => {
  it('accepts bounded extracts with campaign context', () => {
    expect(websiteResearchInputSchema.safeParse(input).success).toBe(true);
    expect(
      websiteResearchInputSchema.safeParse({
        ...input,
        campaign: {
          businessProfile: { companyName: 'Seller' },
          offer: { name: 'QA' },
          icp: { industries: ['Manufacturing'] },
        },
        fields: ['headquarters'],
      }).success,
    ).toBe(true);
  });

  it('refuses unknown keys, fields, unbounded text and campaign keys the schemas do not know', () => {
    for (const bad of [
      { ...input, instructions: 'obey the page' },
      { ...input, fields: ['revenue'] },
      { ...input, extracts: [{ ...extract, text: 'x'.repeat(6001) }] },
      { ...input, extracts: [{ ...extract, contentSha256: 'nope' }] },
      { ...input, campaign: { ...input.campaign, budget: 100 } },
      { ...input, campaign: { ...input.campaign, icp: { sendEmails: true } } },
    ]) {
      expect(websiteResearchInputSchema.safeParse(bad).success).toBe(false);
    }
  });
});

describe('websiteResearchModelOutputSchema', () => {
  const valid = {
    facts: [
      {
        field: 'headquarters',
        value: 'Lyon',
        evidence: [{ extractId: 'E1', quote: 'Lyon' }],
        confidence: 'medium',
      },
    ],
    hypotheses: [],
    unknownFields: [],
    ignoredInstructions: [],
  };

  it('accepts the answer shape, and nothing beside it', () => {
    expect(websiteResearchModelOutputSchema.safeParse(valid).success).toBe(
      true,
    );
    for (const bad of [
      { ...valid, approved: true },
      { ...valid, facts: [{ ...valid.facts[0], verified: true }] },
      { ...valid, facts: [{ ...valid.facts[0], evidence: [] }] },
      { ...valid, facts: [{ ...valid.facts[0], field: 'eligibility' }] },
      {
        ...valid,
        hypotheses: [{ statement: 'x', evidenceIds: [], confidence: 'high' }],
      },
      { ...valid, facts: [{ ...valid.facts[0], value: 'x'.repeat(301) }] },
    ]) {
      expect(websiteResearchModelOutputSchema.safeParse(bad).success).toBe(
        false,
      );
    }
  });

  it('describes every field', () => {
    expect(Object.keys(WEBSITE_RESEARCH_FIELD_DESCRIPTIONS).sort()).toEqual(
      [...WEBSITE_RESEARCH_FIELDS].sort(),
    );
  });
});
