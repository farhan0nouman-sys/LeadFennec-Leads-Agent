// The do-not-contact list and deletion requests (task 11C, docs/decisions.md D-11C-*,
// docs/security/data-retention.md). A suppression keeps only what is needed to honor it: the
// normalized address or domain, why, where it came from and when (a member's note is optional,
// and a deletion request's suppression has none). A deletion request erases a person's data from
// the workspace and keeps their address on the list, so they are never imported or contacted
// again. Pure zod: safe for web, API and worker.
import { z } from 'zod';
import {
  IdentityNormalizationError,
  normalizeDomain,
  normalizeEmail,
} from '../identity.js';

export const SUPPRESSION_ROUTES = {
  suppressions: (workspaceId: string) =>
    `/workspaces/${workspaceId}/suppressions`,
  suppression: (workspaceId: string, suppressionId: string) =>
    `/workspaces/${workspaceId}/suppressions/${suppressionId}`,
  deletionRequests: (workspaceId: string) =>
    `/workspaces/${workspaceId}/suppressions/deletion-requests`,
  suppressLead: (workspaceId: string, contactId: string) =>
    `/workspaces/${workspaceId}/leads/${contactId}/suppress`,
  deleteLead: (workspaceId: string, contactId: string) =>
    `/workspaces/${workspaceId}/leads/${contactId}/deletion-request`,
} as const;

export const SUPPRESSION_KINDS = ['email', 'domain'] as const;
export type SuppressionKind = (typeof SUPPRESSION_KINDS)[number];

export const SUPPRESSION_REASONS = [
  /** The person asked not to be contacted. */
  'OPT_OUT',
  'HARD_BOUNCE',
  'COMPLAINT',
  /** A member added it. */
  'MANUAL',
  /** The person's data was erased on their request; only the address is kept (task 11C). */
  'DELETION_REQUEST',
] as const;
export type SuppressionReason = (typeof SUPPRESSION_REASONS)[number];

export const SUPPRESSION_SOURCES = [
  'MANUAL',
  'INBOUND_MESSAGE',
  'PROVIDER_EVENT',
  'IMPORT',
] as const;

/** Reasons a member may give; the others come from messages, providers or deletion requests. */
export const MEMBER_SUPPRESSION_REASONS = [
  'MANUAL',
  'OPT_OUT',
  'COMPLAINT',
] as const;

export const SUPPRESSION_REASON_LABELS: Readonly<
  Record<SuppressionReason, string>
> = {
  OPT_OUT: 'Asked not to be contacted',
  HARD_BOUNCE: 'Address bounced',
  COMPLAINT: 'Complaint',
  MANUAL: 'Added by a member',
  DELETION_REQUEST: 'Data deleted on request',
};

export const SUPPRESSION_LIMITS = {
  noteChars: 500,
  pageSize: 50,
  maxPageSize: 100,
  /** Leads one new suppression may reopen (their drafts, sends and decisions). */
  staleLeads: 1000,
} as const;

const note = z
  .string()
  .trim()
  .max(
    SUPPRESSION_LIMITS.noteChars,
    `Use at most ${String(SUPPRESSION_LIMITS.noteChars)} characters.`,
  )
  .optional()
  .transform((value) => (value === '' ? undefined : value));

/** The normalized address or domain, or a refusal (never the input echoed back). */
export function normalizeSuppressionValue(
  kind: SuppressionKind,
  value: string,
): string | null {
  try {
    return kind === 'email'
      ? normalizeEmail(value).email
      : normalizeDomain(value);
  } catch (error) {
    if (error instanceof IdentityNormalizationError) {
      return null;
    }
    throw error;
  }
}

/** Adding an address or a whole domain (and its subdomains). Repeating it changes nothing. */
export const addSuppressionRequestSchema = z
  .strictObject({
    kind: z.enum(SUPPRESSION_KINDS, {
      error: 'Choose an address or a domain.',
    }),
    value: z
      .string('Enter an address or a domain.')
      .trim()
      .min(1, 'Enter an address or a domain.')
      .max(320, 'Use at most 320 characters.'),
    reason: z
      .enum(MEMBER_SUPPRESSION_REASONS, { error: 'Choose a reason.' })
      .optional(),
    note,
  })
  .superRefine((request, ctx) => {
    if (normalizeSuppressionValue(request.kind, request.value) === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message:
          request.kind === 'email'
            ? 'This is not an email address.'
            : 'This is not a domain, such as example.com.',
      });
    }
  });

const iso = z.iso.datetime();
const count = z.number().int().min(0);

export const suppressionSchema = z
  .object({
    id: z.uuid(),
    kind: z.enum(SUPPRESSION_KINDS),
    /** The normalized address or domain. */
    value: z.string(),
    reason: z.enum(SUPPRESSION_REASONS),
    source: z.enum(SUPPRESSION_SOURCES),
    /** A member's note (untrusted text: escape it when shown). */
    note: z.string().nullable(),
    createdAt: iso,
    /** Only entries a member added by hand can be removed. */
    removable: z.boolean(),
  })
  .strict();

export type Suppression = z.output<typeof suppressionSchema>;

export const suppressionPageSchema = z
  .object({
    items: z.array(suppressionSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();

export const suppressionListQuerySchema = z.strictObject({
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(SUPPRESSION_LIMITS.maxPageSize)
    .optional(),
  cursor: z.string().max(200).optional(),
  /** The address or domain contains this. */
  q: z
    .string()
    .trim()
    .min(1, 'Type at least 1 character.')
    .max(100, 'Use at most 100 characters.')
    .optional(),
  kind: z.enum(SUPPRESSION_KINDS).optional(),
});

export const addSuppressionResponseSchema = z
  .object({
    suppression: suppressionSchema,
    /** False when the list already had it (nothing changed). */
    created: z.boolean(),
    /** Leads whose drafts, scheduled sends and decisions were reopened. */
    reopenedLeads: count,
  })
  .strict();

/** A lead's own address on the list (their profile's action). */
export const leadSuppressRequestSchema = z.strictObject({
  reason: z.enum(MEMBER_SUPPRESSION_REASONS, { error: 'Choose a reason.' }),
  note,
});

/** Erasing a person's data by their address (the do-not-contact page's action). */
export const deletionRequestSchema = z
  .strictObject({
    email: z
      .string('Enter the email address.')
      .trim()
      .min(1, 'Enter the email address.')
      .max(320, 'Use at most 320 characters.'),
  })
  .superRefine((request, ctx) => {
    if (normalizeSuppressionValue('email', request.email) === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['email'],
        message: 'This is not an email address.',
      });
    }
  });

/** Erasing a lead's data from their profile, at the version the member saw. */
export const leadDeletionRequestSchema = z.strictObject({
  version: z.number().int().min(1),
});

export const deletionResultSchema = z
  .object({
    /** The address kept on the do-not-contact list; null when the person had none. */
    suppressionId: z.uuid().nullable(),
    deleted: z
      .object({
        /** People (0 or 1) and everything that belonged to them. */
        contacts: count,
        /** Import and search records that named them, beyond their own. */
        sourceRecords: count,
      })
      .strict(),
  })
  .strict();

export type DeletionResult = z.output<typeof deletionResultSchema>;

export const SUPPRESSION_ERROR_CODES = [
  /** 409: the entry came from a person's request, a bounce or a complaint: it stays. */
  'suppression_not_removable',
  /** 409: the lead has no address to put on the list. */
  'no_address',
] as const;
