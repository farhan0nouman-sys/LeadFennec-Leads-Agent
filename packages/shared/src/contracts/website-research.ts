// The WebsiteResearchAgent's contract (task 09B, docs/decisions.md D-09B-03 and D-09B-04).
//
// The agent reads bounded extracts of a company's public pages and reports what they state.
// Webpage text is untrusted data: it reaches the model only inside the input data, the model
// has no tools, and everything it returns is checked here (shape) and by the agent (every
// cited quote must be in the cited extract) before anything is kept.

import { z } from 'zod';
import { businessProfileSchema, offerSchema } from './campaigns.js';
import { icpCriteriaSchema } from './lead-discovery.js';
import {
  WEBSITE_RESEARCH_FIELDS,
  type WebsiteResearchField,
} from './research-fields.js';

export { WEBSITE_RESEARCH_FIELDS, type WebsiteResearchField };

/** Shown to the model with each requested field. */
export const WEBSITE_RESEARCH_FIELD_DESCRIPTIONS: Readonly<
  Record<WebsiteResearchField, string>
> = {
  company_summary: 'What the company does, in one or two sentences.',
  products_services: 'A product or service the company offers.',
  industry: 'The industry or sector the company says it is in.',
  target_customers: 'The kind of customers the company says it serves.',
  headquarters: 'Where the company says it is headquartered.',
  founded_year: 'The year the company says it was founded.',
  employee_count: 'How many people the company says it employs.',
  markets_served: 'A country, region or market the company says it serves.',
  notable_customers: 'A customer or partner the company names.',
  recent_news: 'A dated announcement, launch or event on the pages.',
  technologies:
    'A technology or platform the company says it uses or supports.',
  hiring: 'An open role or hiring statement.',
};

/** Fields with one true value: two different supported values are a conflict. */
export const SINGLE_VALUED_RESEARCH_FIELDS: ReadonlySet<WebsiteResearchField> =
  new Set(['headquarters', 'founded_year', 'employee_count']);

export const RESEARCH_CONFIDENCE_LEVELS = ['low', 'medium', 'high'] as const;

/** Why a claim (or a whole answer) was kept for a person instead of used (D-09B-04). */
export const RESEARCH_REVIEW_REASONS = [
  /** A quote isn't in the extract it cites. */
  'evidence_not_found',
  /** It cites an extract that wasn't provided. */
  'unknown_extract',
  /** The quotes exist but don't contain the value's numbers or words. */
  'value_not_in_evidence',
  /** Two supported values for a field that has one. */
  'conflicting_evidence',
  /** It quotes page text that tries to instruct a model. */
  'suspicious_instructions',
  /** A field that wasn't asked for. */
  'field_not_requested',
  /** The answer wasn't valid JSON in the required shape. */
  'invalid_output',
  'refusal',
  /** The answer hit the output token limit. */
  'output_truncated',
  'content_filtered',
  'output_incomplete',
] as const;

export type ResearchReviewReason = (typeof RESEARCH_REVIEW_REASONS)[number];
export type ResearchConfidence = (typeof RESEARCH_CONFIDENCE_LEVELS)[number];

export const WEBSITE_RESEARCH_LIMITS = {
  maxExtracts: 8,
  maxExtractChars: 6000,
  maxTotalExtractChars: 30_000,
  maxFacts: 30,
  maxEvidencePerFact: 3,
  maxQuoteChars: 300,
  maxValueChars: 300,
  maxHypotheses: 5,
  maxStatementChars: 400,
  maxIgnoredInstructions: 5,
} as const;

const L = WEBSITE_RESEARCH_LIMITS;

/** Extract ids are assigned by application code: E1 to E99. */
export const RESEARCH_EXTRACT_ID = /^E[1-9][0-9]?$/;

const extractIdSchema = z.string().regex(RESEARCH_EXTRACT_ID);

const httpUrlSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'must be an http(s) URL');

/** One bounded piece of a fetched page, with where and when it came from. */
export const researchExtractSchema = z.strictObject({
  id: extractIdSchema,
  url: httpUrlSchema,
  title: z.string().max(300).nullable(),
  retrievedAt: z.date(),
  /** The page body's SHA-256 (task 09A), so a fact traces back to one dated version. */
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** Untrusted page text. */
  text: z.string().max(L.maxExtractChars),
});

export type ResearchExtract = z.output<typeof researchExtractSchema>;

/** The campaign the research is for: what is offered, to whom (all optional). */
export const researchCampaignContextSchema = z.strictObject({
  businessProfile: businessProfileSchema.nullable(),
  offer: offerSchema.nullable(),
  icp: icpCriteriaSchema.nullable(),
});

export type ResearchCampaignContext = z.output<
  typeof researchCampaignContextSchema
>;

export const websiteResearchInputSchema = z.strictObject({
  company: z.strictObject({
    name: z.string().trim().min(1).max(200).nullable(),
    domain: z.string().trim().min(1).max(253).nullable(),
  }),
  campaign: researchCampaignContextSchema,
  /** Default: every field. */
  fields: z
    .array(z.enum(WEBSITE_RESEARCH_FIELDS))
    .min(1)
    .max(WEBSITE_RESEARCH_FIELDS.length)
    .optional(),
  extracts: z
    .array(researchExtractSchema)
    .min(1)
    .max(L.maxExtracts)
    .refine(
      (extracts) =>
        new Set(extracts.map((extract) => extract.id)).size === extracts.length,
      'extract ids must be unique',
    )
    .refine(
      (extracts) =>
        extracts.reduce((total, extract) => total + extract.text.length, 0) <=
        L.maxTotalExtractChars,
      `extracts may hold at most ${String(L.maxTotalExtractChars)} characters in all`,
    ),
});

export type WebsiteResearchInput = z.input<typeof websiteResearchInputSchema>;

const quoteSchema = z.strictObject({
  extractId: extractIdSchema,
  quote: z.string().trim().min(1).max(L.maxQuoteChars),
});

/**
 * What the model must answer, checked before anything else happens. A strict object: any
 * other key (a "verified" flag, an eligibility, a tool call, a budget) refuses the answer.
 */
export const websiteResearchModelOutputSchema = z.strictObject({
  facts: z
    .array(
      z.strictObject({
        field: z.enum(WEBSITE_RESEARCH_FIELDS),
        value: z.string().trim().min(1).max(L.maxValueChars),
        evidence: z.array(quoteSchema).min(1).max(L.maxEvidencePerFact),
        confidence: z.enum(RESEARCH_CONFIDENCE_LEVELS),
      }),
    )
    .max(L.maxFacts),
  hypotheses: z
    .array(
      z.strictObject({
        statement: z.string().trim().min(1).max(L.maxStatementChars),
        evidenceIds: z.array(extractIdSchema).max(L.maxExtracts),
        confidence: z.enum(['low', 'medium']),
      }),
    )
    .max(L.maxHypotheses),
  unknownFields: z
    .array(z.enum(WEBSITE_RESEARCH_FIELDS))
    .max(WEBSITE_RESEARCH_FIELDS.length),
  /** Page text that tried to instruct the model, which it ignored. */
  ignoredInstructions: z.array(quoteSchema).max(L.maxIgnoredInstructions),
});

export type WebsiteResearchModelOutput = z.output<
  typeof websiteResearchModelOutputSchema
>;
