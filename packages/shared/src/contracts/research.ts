// Website research of a company (task 09C, docs/decisions.md D-09C-*): requesting a run,
// reading the current version and its history with the dated evidence, and correcting a field
// by hand. Every run, refresh and correction is a new version; earlier versions never change.
// Everything a page or a model wrote is untrusted text: escape it when it is shown.

import { z } from 'zod';
import {
  RESEARCH_CONFIDENCE_LEVELS,
  RESEARCH_EXTRACT_ID,
  RESEARCH_REVIEW_REASONS,
  WEBSITE_RESEARCH_FIELDS,
  researchCampaignContextSchema,
} from './website-research.js';

export const RESEARCH_ROUTES = {
  organization: (workspaceId: string, organizationId: string) =>
    `/workspaces/${workspaceId}/organizations/${organizationId}/research`,
  version: (workspaceId: string, organizationId: string, researchId: string) =>
    `/workspaces/${workspaceId}/organizations/${organizationId}/research/${researchId}`,
  corrections: (workspaceId: string, organizationId: string) =>
    `/workspaces/${workspaceId}/organizations/${organizationId}/research/corrections`,
} as const;

/**
 * Freshness (D-09C-03): a stored page is read again after 7 days, and a request without refresh
 * answers with research completed in the last 30 days instead of queuing a run.
 */
export const RESEARCH_FRESHNESS = {
  pageMaxAgeDays: 7,
  researchFreshDays: 30,
} as const;

/** The home page and at most three pages it links to on the same site. */
export const RESEARCH_MAX_PAGES = 4;

export const RESEARCH_ERROR_CODES = [
  /** 409: the company has no website or domain to read. */
  'research_not_possible',
] as const;

const iso = z.iso.datetime();
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const label = z.string().regex(RESEARCH_EXTRACT_ID);
const field = z.enum(WEBSITE_RESEARCH_FIELDS);
const confidence = z.enum(RESEARCH_CONFIDENCE_LEVELS);
const errorCode = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);

// ─── Requests ────────────────────────────────────────────────────────────────

export const researchRequestSchema = z.strictObject({
  /** Read the pages again and run even if fresh research exists. */
  refresh: z.boolean().optional(),
  /** A campaign of the workspace whose offer and audience give the research its context. */
  campaignId: z.uuid().nullable().optional(),
});

export const researchAcceptedSchema = z.strictObject({
  researchId: z.uuid(),
  /** queued: a new run; running: one was already queued or running; fresh: recent enough. */
  state: z.enum(['queued', 'running', 'fresh']),
});

export type ResearchAccepted = z.output<typeof researchAcceptedSchema>;

export const RESEARCH_CORRECTION_ACTIONS = [
  'set',
  'reject',
  'restore',
] as const;

/**
 * A person's correction of one field, on the version they looked at (compare-and-set):
 * "set" gives the value, "reject" says the pages' value is wrong (the field becomes unknown),
 * "restore" removes an earlier correction of the field.
 */
export const researchCorrectionRequestSchema = z
  .strictObject({
    baseResearchId: z.uuid(),
    field,
    action: z.enum(RESEARCH_CORRECTION_ACTIONS),
    value: z.string().trim().min(1).max(300).nullable().optional(),
    note: z.string().trim().min(1, 'Say why.').max(500),
  })
  .superRefine((input, context) => {
    const hasValue = input.value !== undefined && input.value !== null;
    if (input.action === 'set' && !hasValue) {
      context.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Give the correct value.',
      });
    }
    if (input.action !== 'set' && hasValue) {
      context.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Only a "set" correction has a value.',
      });
    }
  });

export type ResearchCorrectionRequest = z.input<
  typeof researchCorrectionRequestSchema
>;

// ─── What is stored with a version (research.findings) ───────────────────────

export const researchPageSchema = z.strictObject({
  url: z.string().max(2048),
  /** fetched: read now; reused: a copy read within 7 days; failed: not read (errorCode). */
  outcome: z.enum(['fetched', 'reused', 'failed']),
  errorCode: errorCode.nullable(),
  sourceRecordId: z.uuid().nullable(),
  retrievedAt: iso.nullable(),
  contentSha256: sha256.nullable(),
});

export type ResearchPage = z.output<typeof researchPageSchema>;

const correctionSchema = z.strictObject({
  field,
  action: z.enum(['set', 'reject']),
  value: z.string().max(300).nullable(),
  note: z.string().max(500),
  /** The MANUAL_NOTE evidence row holding the note. */
  evidenceId: z.uuid(),
  /** The version the correction created. */
  researchId: z.uuid(),
  membershipId: z.uuid(),
  correctedAt: iso,
});

export type ResearchCorrection = z.output<typeof correctionSchema>;

/**
 * research.findings of a version (D-09C-02): validated before every write. Facts here are the
 * agent's verified facts; corrections are applied on top when a version is read.
 */
export const researchFindingsSchema = z.strictObject({
  v: z.literal(1),
  fields: z.array(field).max(WEBSITE_RESEARCH_FIELDS.length),
  context: z.strictObject({
    campaignId: z.uuid().nullable(),
    campaign: researchCampaignContextSchema,
  }),
  pages: z.array(researchPageSchema).max(10),
  extracts: z
    .array(
      z.strictObject({
        label,
        evidenceId: z.uuid(),
        url: z.string().max(2048),
        retrievedAt: iso,
        contentSha256: sha256,
        textSha256: sha256,
      }),
    )
    .max(8),
  facts: z
    .array(
      z.strictObject({
        field,
        value: z.string().max(300),
        confidence,
        evidence: z
          .array(
            z.strictObject({
              label,
              evidenceId: z.uuid(),
              quote: z.string().max(300),
            }),
          )
          .min(1)
          .max(3),
      }),
    )
    .max(30),
  hypotheses: z
    .array(
      z.strictObject({
        statement: z.string().max(400),
        labels: z.array(label).max(8),
        confidence: z.enum(['low', 'medium']),
      }),
    )
    .max(5),
  unknownFields: z.array(field).max(WEBSITE_RESEARCH_FIELDS.length),
  reviewItems: z
    .array(
      z.strictObject({
        reason: z.enum(RESEARCH_REVIEW_REASONS),
        kind: z.enum(['fact', 'hypothesis', 'answer']),
        field: field.nullable(),
        value: z.string().max(400).nullable(),
        labels: z.array(label).max(8),
      }),
    )
    .max(50),
  warnings: z
    .array(z.strictObject({ code: z.literal('instructions_in_page'), label }))
    .max(8),
  ignoredInstructions: z
    .array(z.strictObject({ label, quote: z.string().max(300) }))
    .max(5),
  confidence,
  corrections: z.array(correctionSchema).max(WEBSITE_RESEARCH_FIELDS.length),
  usage: z.strictObject({
    inputTokens: z.int().min(0),
    outputTokens: z.int().min(0),
    costMicroUsd: z.int().min(0).nullable(),
    modelCalls: z.int().min(0),
  }),
  model: z
    .strictObject({
      prompt: z.string().max(100),
      promptSha256: sha256,
      schema: z.string().max(100),
      provider: z.enum(['OPENAI', 'FAKE']),
      model: z.string().max(200),
    })
    .nullable(),
});

export type ResearchFindings = z.output<typeof researchFindingsSchema>;

// ─── What the API answers ────────────────────────────────────────────────────

export const RESEARCH_ORIGINS = ['MODEL', 'REUSED', 'CORRECTION'] as const;
export const RESEARCH_STATUSES = [
  'PENDING',
  'RUNNING',
  'COMPLETED',
  'FAILED',
] as const;
export const RESEARCH_RESULT_STATUSES = [
  'COMPLETED',
  'REVIEW_REQUIRED',
  'NO_CONTENT',
] as const;

export const researchEvidenceSchema = z.strictObject({
  id: z.uuid(),
  kind: z.enum(['WEBSITE_EXCERPT', 'MANUAL_NOTE']),
  /** E1, E2 ... for page extracts; null for a correction's note. */
  label: label.nullable(),
  url: z.string().nullable(),
  /** When the page was read (or the note written). */
  capturedAt: iso,
  contentSha256: sha256.nullable(),
  /** Untrusted page text (or the corrector's note). */
  excerpt: z.string(),
});

export type ResearchEvidence = z.output<typeof researchEvidenceSchema>;

export const researchFactSchema = z.strictObject({
  field,
  value: z.string(),
  /** page: quoted from the pages and checked; person: a correction. */
  source: z.enum(['page', 'person']),
  confidence: confidence.nullable(),
  evidence: z.array(
    z.strictObject({
      evidenceId: z.uuid(),
      label: label.nullable(),
      quote: z.string().nullable(),
    }),
  ),
  /** For a correction: why. */
  note: z.string().nullable(),
});

export type ResearchFact = z.output<typeof researchFactSchema>;

export const researchVersionSchema = z.strictObject({
  id: z.uuid(),
  /** 1, 2, 3 ... per company; null until completed. */
  version: z.int().min(1).nullable(),
  organizationId: z.uuid(),
  origin: z.enum(RESEARCH_ORIGINS).nullable(),
  status: z.enum(RESEARCH_STATUSES),
  resultStatus: z.enum(RESEARCH_RESULT_STATUSES).nullable(),
  basedOnId: z.uuid().nullable(),
  refresh: z.boolean(),
  requestedAt: iso,
  completedAt: iso.nullable(),
  errorCode: errorCode.nullable(),
  confidence: confidence.nullable(),
  /** The facts after corrections. */
  facts: z.array(researchFactSchema),
  hypotheses: researchFindingsSchema.shape.hypotheses,
  /** Requested fields without a fact (after corrections). */
  unknownFields: z.array(field),
  /** Fields a person rejected. */
  rejectedFields: z.array(field),
  reviewItems: researchFindingsSchema.shape.reviewItems,
  warnings: researchFindingsSchema.shape.warnings,
  ignoredInstructions: researchFindingsSchema.shape.ignoredInstructions,
  corrections: researchFindingsSchema.shape.corrections,
  pages: z.array(researchPageSchema),
  evidence: z.array(researchEvidenceSchema),
  usage: researchFindingsSchema.shape.usage.nullable(),
  model: researchFindingsSchema.shape.model,
});

export type ResearchVersion = z.output<typeof researchVersionSchema>;

export const researchHistoryItemSchema = z.strictObject({
  id: z.uuid(),
  version: z.int().min(1).nullable(),
  origin: z.enum(RESEARCH_ORIGINS).nullable(),
  status: z.enum(RESEARCH_STATUSES),
  resultStatus: z.enum(RESEARCH_RESULT_STATUSES).nullable(),
  basedOnId: z.uuid().nullable(),
  refresh: z.boolean(),
  requestedAt: iso,
  completedAt: iso.nullable(),
  errorCode: errorCode.nullable(),
  model: z.string().nullable(),
  promptVersion: z.string().nullable(),
});

export type ResearchHistoryItem = z.output<typeof researchHistoryItemSchema>;

export const organizationResearchSchema = z.strictObject({
  organization: z.strictObject({
    id: z.uuid(),
    /** Untrusted (from imports and providers). */
    name: z.string(),
    domain: z.string().nullable(),
    websiteUrl: z.string().nullable(),
  }),
  /** A queued or running run, if any. */
  active: researchHistoryItemSchema.nullable(),
  /** The newest completed version. */
  current: researchVersionSchema.nullable(),
  /** Newest first, at most 20. */
  history: z.array(researchHistoryItemSchema),
  /** Whether the current version is recent enough to be answered without a new run. */
  fresh: z.boolean(),
});

export type OrganizationResearch = z.output<typeof organizationResearchSchema>;
