// Lead profile changes (task 11B, docs/decisions.md D-11B-*): a person's corrections, tags, notes
// and assignment to a campaign. Every change but a note names the version of the lead it started
// from (compare-and-set: 409 version_conflict otherwise). A material correction (name, title,
// address, country) makes what was decided or written for the old data stale: drafts are
// invalidated and every campaign's decision goes back to Review. Pure zod. Safe for web, API and
// worker.
import { z } from 'zod';
import { normalizeEmail, normalizeLinkedinUrl } from '../identity.js';

export const LEAD_PROFILE_ROUTES = {
  /** PATCH: correct the lead's data. */
  lead: (workspaceId: string, contactId: string) =>
    `/workspaces/${workspaceId}/leads/${contactId}`,
  /** PATCH: replace the lead's tags. */
  tags: (workspaceId: string, contactId: string) =>
    `/workspaces/${workspaceId}/leads/${contactId}/tags`,
  /** POST: add a note. */
  notes: (workspaceId: string, contactId: string) =>
    `/workspaces/${workspaceId}/leads/${contactId}/notes`,
  /** POST: add the lead to a campaign (its lead list). */
  campaigns: (workspaceId: string, contactId: string) =>
    `/workspaces/${workspaceId}/leads/${contactId}/campaigns`,
} as const;

export const LEAD_PROFILE_LIMITS = {
  noteChars: 2000,
  reasonChars: 500,
  tags: 20,
  tagChars: 40,
} as const;

/** Fields whose change makes drafts and decisions stale. */
export const MATERIAL_LEAD_FIELDS = [
  'firstName',
  'lastName',
  'title',
  'email',
  'countryCode',
] as const;
export const LEAD_CORRECTION_FIELDS = [
  ...MATERIAL_LEAD_FIELDS,
  'linkedinUrl',
] as const;
export type LeadCorrectionField = (typeof LEAD_CORRECTION_FIELDS)[number];

const version = z
  .int('Reload the lead, then try again.')
  .min(1, 'Reload the lead, then try again.');

const validEmail = (value: string) => {
  try {
    normalizeEmail(value);
    return true;
  } catch {
    return false;
  }
};
const validLinkedin = (value: string) => {
  try {
    normalizeLinkedinUrl(value);
    return true;
  } catch {
    return false;
  }
};

/** A correction: the fields changed (null clears one), why, and the version it started from. */
export const leadCorrectionRequestSchema = z.strictObject({
  version,
  changes: z
    .strictObject({
      firstName: z
        .string()
        .trim()
        .min(1, 'Enter a first name.')
        .max(100, 'Use at most 100 characters.')
        .optional(),
      lastName: z
        .string()
        .trim()
        .min(1, 'Enter a last name.')
        .max(100, 'Use at most 100 characters.')
        .optional(),
      title: z
        .string()
        .trim()
        .min(1, 'Enter a title, or clear it.')
        .max(200, 'Use at most 200 characters.')
        .nullable()
        .optional(),
      email: z
        .string()
        .trim()
        .max(254, 'Use at most 254 characters.')
        .refine(validEmail, 'Enter an email address, such as name@example.com.')
        .nullable()
        .optional(),
      countryCode: z
        .string()
        .trim()
        .toUpperCase()
        .regex(/^[A-Z]{2}$/, 'Use a two-letter country code, such as US.')
        .nullable()
        .optional(),
      linkedinUrl: z
        .string()
        .trim()
        .max(500, 'Use at most 500 characters.')
        .refine(validLinkedin, 'Use a LinkedIn profile address.')
        .nullable()
        .optional(),
    })
    .refine((changes) => Object.keys(changes).length > 0, {
      message: 'Change at least one field.',
    }),
  /** Why (kept as a note on the lead; never in the audit record). */
  reason: z
    .string()
    .trim()
    .min(1, 'Say why the data is being corrected.')
    .max(
      LEAD_PROFILE_LIMITS.reasonChars,
      `Use at most ${String(LEAD_PROFILE_LIMITS.reasonChars)} characters.`,
    ),
});
export type LeadCorrectionRequest = z.input<typeof leadCorrectionRequestSchema>;

const tag = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9][a-z0-9 _-]{0,39}$/,
    'Use 1–40 letters, digits, spaces, hyphens or underscores.',
  );

/** The lead's whole set of tags (replaces the current one). */
export const leadTagsRequestSchema = z.strictObject({
  version,
  tags: z
    .array(tag)
    .max(
      LEAD_PROFILE_LIMITS.tags,
      `Use at most ${String(LEAD_PROFILE_LIMITS.tags)} tags.`,
    )
    .transform((tags) => [...new Set(tags)].sort()),
});

export const leadNoteRequestSchema = z.strictObject({
  /** Untrusted text: escaped when shown. */
  body: z
    .string()
    .trim()
    .min(1, 'Write a note.')
    .max(
      LEAD_PROFILE_LIMITS.noteChars,
      `Use at most ${String(LEAD_PROFILE_LIMITS.noteChars)} characters.`,
    ),
});

/** Adds the lead to a campaign's lead list. */
export const leadAssignmentRequestSchema = z.strictObject({
  version,
  campaignId: z.uuid('Not found in this workspace.'),
});

export const LEAD_PROFILE_ERROR_CODES = [
  /** 409: another lead of the workspace has this address. */
  'email_taken',
  /** 409: the lead can't be added to this campaign; issues say why. */
  'assignment_not_possible',
] as const;
