// Campaign configuration API contract (task 06A, docs/decisions.md D-06A-*): routes, request and
// response shapes, bounds and error codes shared by the API and the web app. A campaign is
// configured incrementally while it is a DRAFT: each save sends only the sections it changes,
// together with the version it started from. Requests normalize what they can (time zone,
// domains, addresses); responses describe what is stored. Pure zod: safe for web, API and worker.
import { z } from 'zod';
import { normalizeDomain, normalizeEmail } from '../identity.js';
import { normalizeTimeZone } from '../time-zone.js';
import { CAMPAIGN_STATUSES } from './dashboard.js';

export const CAMPAIGN_ROUTES = {
  campaigns: (workspaceId: string) => `/workspaces/${workspaceId}/campaigns`,
  options: (workspaceId: string) =>
    `/workspaces/${workspaceId}/campaigns/options`,
  campaign: (workspaceId: string, campaignId: string) =>
    `/workspaces/${workspaceId}/campaigns/${campaignId}`,
  duplicate: (workspaceId: string, campaignId: string) =>
    `/workspaces/${workspaceId}/campaigns/${campaignId}/duplicate`,
  readiness: (workspaceId: string, campaignId: string) =>
    `/workspaces/${workspaceId}/campaigns/${campaignId}/readiness`,
  activate: (workspaceId: string, campaignId: string) =>
    `/workspaces/${workspaceId}/campaigns/${campaignId}/activate`,
} as const;

/** Upper bounds of every configurable value (the database checks the same numeric ones). */
export const CAMPAIGN_BOUNDS = {
  name: 120,
  description: 2000,
  longText: 2000,
  shortText: 200,
  listItems: 50,
  listItem: 100,
  proofPoints: 10,
  proofPoint: 300,
  /** Per list; longer lists belong on the workspace's do-not-contact list. */
  excludedEntries: 100,
  excludedLeadLists: 20,
  employeeCount: 10_000_000,
  dailyNewLeads: 500,
  maxLeads: 50_000,
  steps: 10,
  /** One year, as the database allows. */
  stepDelayMinutes: 525_600,
} as const;

const B = CAMPAIGN_BOUNDS;
const iso = z.iso.datetime();

/** Trimmed, non-empty text of at most `max` characters. */
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1, 'Enter some text, or leave this out.')
    .max(max, `Use at most ${String(max)} characters.`);

const list = <T extends z.ZodType>(item: T, max: number) =>
  z.array(item).max(max, `Use at most ${String(max)} entries.`);

/** Required, unlike the other texts. */
export const campaignNameSchema = z
  .string()
  .trim()
  .min(1, 'Enter a name for the campaign.')
  .max(B.name, `Use at most ${String(B.name)} characters.`);
export const campaignDescriptionSchema = text(B.description);

const websiteSchema = z
  .string()
  .trim()
  .max(2048, 'Use at most 2048 characters.')
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        url.hostname.includes('.')
      );
    } catch {
      return false;
    }
  }, 'Enter a web address starting with http:// or https://.');

/** Who is sending. Every field is optional while the campaign is a draft. */
export const businessProfileSchema = z
  .object({
    companyName: text(B.shortText).optional(),
    website: websiteSchema.optional(),
    description: text(B.longText).optional(),
    valueProposition: text(B.longText).optional(),
  })
  .strict();

/** What is offered. */
export const offerSchema = z
  .object({
    name: text(B.shortText).optional(),
    description: text(B.longText).optional(),
    callToAction: text(B.shortText).optional(),
    proofPoints: list(text(B.proofPoint), B.proofPoints).optional(),
  })
  .strict();

const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'Use two-letter country codes, such as US.');

const WHOLE = 'Use a whole number.';

const employeeCountSchema = z
  .number(WHOLE)
  .int(WHOLE)
  .min(1, 'Use at least 1.')
  .max(B.employeeCount, `Use at most ${String(B.employeeCount)}.`);

/** Narrows the audience beyond the ICP and the lead list. */
export const audienceFiltersSchema = z
  .object({
    countries: list(countryCodeSchema, B.listItems).optional(),
    industries: list(text(B.listItem), B.listItems).optional(),
    titles: list(text(B.listItem), B.listItems).optional(),
    employeeCountMin: employeeCountSchema.optional(),
    employeeCountMax: employeeCountSchema.optional(),
  })
  .strict()
  .refine(
    (filters) =>
      filters.employeeCountMin === undefined ||
      filters.employeeCountMax === undefined ||
      filters.employeeCountMin <= filters.employeeCountMax,
    {
      path: ['employeeCountMax'],
      message: 'Use a maximum at least as large as the minimum.',
    },
  );

/** Who to contact: an ICP and a lead list of this workspace, and filters. */
export const audienceSchema = z
  .object({
    icpId: z.uuid().nullable().optional(),
    leadListId: z.uuid().nullable().optional(),
    filters: audienceFiltersSchema.optional(),
  })
  .strict();

const unique = <T>(values: readonly T[]): T[] => [...new Set(values)].sort();

const domainInputSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .transform((value, ctx) => {
    try {
      return normalizeDomain(value);
    } catch {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter a domain such as example.com.',
      });
      return z.NEVER;
    }
  });

const emailInputSchema = z
  .string()
  .trim()
  .min(3)
  .max(254)
  .transform((value, ctx) => {
    try {
      return normalizeEmail(value).email;
    } catch {
      ctx.addIssue({ code: 'custom', message: 'Enter an email address.' });
      return z.NEVER;
    }
  });

/** Exclusions as a save sends them; domains and addresses are normalized and deduplicated. */
export const exclusionsInputSchema = z
  .object({
    domains: list(domainInputSchema, B.excludedEntries)
      .transform(unique)
      .optional(),
    emails: list(emailInputSchema, B.excludedEntries)
      .transform(unique)
      .optional(),
    leadListIds: list(z.uuid(), B.excludedLeadLists)
      .transform(unique)
      .optional(),
    /** Leave out contacts already enrolled in another campaign (default true). */
    skipContactsInOtherCampaigns: z.boolean().optional(),
  })
  .strict();

/** Exclusions as stored: never empty of meaning, every list present. */
export const exclusionsSchema = z
  .object({
    domains: z.array(z.string()),
    emails: z.array(z.string()),
    leadListIds: z.array(z.uuid()),
    skipContactsInOtherCampaigns: z.boolean(),
  })
  .strict();

export const leadLimitsSchema = z
  .object({
    /** Most leads enrolled per day. */
    dailyNewLeads: z
      .number(WHOLE)
      .int(WHOLE)
      .min(1, 'Enroll at least 1 lead a day.')
      .max(B.dailyNewLeads, `Use at most ${String(B.dailyNewLeads)} a day.`)
      .nullable()
      .optional(),
    /** Most leads in the campaign in total. */
    maxLeads: z
      .number(WHOLE)
      .int(WHOLE)
      .min(1, 'Allow at least 1 lead.')
      .max(B.maxLeads, `Use at most ${String(B.maxLeads)}.`)
      .nullable()
      .optional(),
  })
  .strict()
  .refine(
    (limits) =>
      limits.dailyNewLeads == null ||
      limits.maxLeads == null ||
      limits.dailyNewLeads <= limits.maxLeads,
    {
      path: ['dailyNewLeads'],
      message: 'Use a daily limit no larger than the total.',
    },
  );

/** An IANA time zone (normalizeTimeZone), e.g. "Europe/Berlin". */
export const timeZoneInputSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .transform((value, ctx) => {
    try {
      return normalizeTimeZone(value);
    } catch {
      ctx.addIssue({
        code: 'custom',
        message: 'Choose a time zone such as Europe/Berlin.',
      });
      return z.NEVER;
    }
  });

const DAYS = 'Choose days from Monday to Sunday.';
const START = 'Choose a start time.';
const END = 'Choose an end time.';

/** When messages may be sent, in the campaign's time zone. */
export const scheduleSchema = z
  .object({
    /** ISO weekdays: 1 = Monday … 7 = Sunday. */
    weekdays: z
      .array(z.number(DAYS).int(DAYS).min(1, DAYS).max(7, DAYS))
      .min(1, 'Choose at least one day.')
      .max(7)
      .refine(
        (days) => new Set(days).size === days.length,
        'Choose each day once.',
      ),
    /** Minutes after local midnight, [start, end). */
    windowStartMinute: z
      .number(START)
      .int(START)
      .min(0, START)
      .max(1439, START),
    windowEndMinute: z.number(END).int(END).min(1, END).max(1440, END),
  })
  .strict()
  .refine((schedule) => schedule.windowStartMinute < schedule.windowEndMinute, {
    path: ['windowEndMinute'],
    message: 'End the sending window after it starts.',
  });

/** The mailbox the campaign sends from (one of the workspace's). */
export const senderSchema = z
  .object({ emailAccountId: z.uuid().nullable() })
  .strict();

/** The steps of the campaign's sequence, in order; a save replaces them all. */
export const sequenceInputSchema = z
  .object({
    steps: list(
      z
        .object({
          /** After enrollment for the first step, else after the previous step was sent. */
          delayMinutes: z
            .number('Enter a delay.')
            .int('Use whole minutes.')
            .min(0, 'Use a delay of zero or more.')
            .max(B.stepDelayMinutes, 'Use a delay of at most one year.'),
          /** An active template of this workspace, or none yet. */
          templateId: z.uuid().nullable().optional(),
        })
        .strict(),
      B.steps,
    ),
  })
  .strict();

export const CAMPAIGN_APPROVAL_MODES = ['HUMAN', 'AUTOMATIC'] as const;
export const approvalModeSchema = z.enum(CAMPAIGN_APPROVAL_MODES);

/** The sections a save may change; each one sent replaces that section entirely. */
export const CAMPAIGN_SECTIONS = [
  'name',
  'description',
  'businessProfile',
  'offer',
  'audience',
  'exclusions',
  'leadLimits',
  'timezone',
  'schedule',
  'sender',
  'sequence',
  'approvalMode',
] as const;

export type CampaignSection = (typeof CAMPAIGN_SECTIONS)[number];

export const createCampaignRequestSchema = z
  .object({
    name: campaignNameSchema,
    description: campaignDescriptionSchema.optional(),
  })
  .strict();

/**
 * An incremental save: the version it started from and the sections it changes. A null
 * description, business profile or offer clears it.
 */
export const updateCampaignRequestSchema = z
  .object({
    version: z.number().int().min(1),
    name: campaignNameSchema.optional(),
    description: campaignDescriptionSchema.nullable().optional(),
    businessProfile: businessProfileSchema.nullable().optional(),
    offer: offerSchema.nullable().optional(),
    audience: audienceSchema.optional(),
    exclusions: exclusionsInputSchema.optional(),
    leadLimits: leadLimitsSchema.optional(),
    timezone: timeZoneInputSchema.optional(),
    schedule: scheduleSchema.optional(),
    sender: senderSchema.optional(),
    sequence: sequenceInputSchema.optional(),
    approvalMode: approvalModeSchema.optional(),
  })
  .strict()
  .refine(
    (body) => CAMPAIGN_SECTIONS.some((section) => body[section] !== undefined),
    'Change at least one section.',
  );

/** A copy of the configuration under a new name (default: "<name> (copy)"). */
export const duplicateCampaignRequestSchema = z
  .object({ name: campaignNameSchema.optional() })
  .strict();

/** Sections a campaign needs before it can be started; checked by campaignReadiness. */
export const CAMPAIGN_READINESS_SECTIONS = [
  'businessProfile',
  'offer',
  'audience',
  'leadLimits',
  'sender',
  'sequence',
] as const;

export const campaignReadinessSchema = z
  .object({
    complete: z.boolean(),
    missing: z.array(z.enum(CAMPAIGN_READINESS_SECTIONS)),
  })
  .strict();

const stepSchema = z
  .object({
    id: z.uuid(),
    position: z.number().int().min(1),
    delayMinutes: z.number().int().min(0),
    templateId: z.uuid().nullable(),
  })
  .strict();

/** A campaign's configuration as stored. */
export const campaignSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    status: z.enum(CAMPAIGN_STATUSES),
    version: z.number().int().min(1),
    approvalMode: approvalModeSchema,
    businessProfile: businessProfileSchema.nullable(),
    offer: offerSchema.nullable(),
    audience: z
      .object({
        icpId: z.uuid().nullable(),
        leadListId: z.uuid().nullable(),
        filters: audienceFiltersSchema,
      })
      .strict(),
    exclusions: exclusionsSchema,
    leadLimits: z
      .object({
        dailyNewLeads: z.number().int().nullable(),
        maxLeads: z.number().int().nullable(),
      })
      .strict(),
    timezone: z.string(),
    schedule: scheduleSchema,
    sender: senderSchema,
    sequence: z.object({ steps: z.array(stepSchema) }).strict(),
    readiness: campaignReadinessSchema,
    createdAt: iso,
    updatedAt: iso,
  })
  .strict();

export const campaignListItemSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    status: z.enum(CAMPAIGN_STATUSES),
    version: z.number().int().min(1),
    approvalMode: approvalModeSchema,
    readiness: campaignReadinessSchema,
    updatedAt: iso,
  })
  .strict();

export const campaignPageSchema = z
  .object({
    items: z.array(campaignListItemSchema),
    nextCursor: z.string().nullable(),
  })
  .strict();

export type Campaign = z.output<typeof campaignSchema>;
export type CampaignListItem = z.output<typeof campaignListItemSchema>;
export type CampaignReadiness = z.output<typeof campaignReadinessSchema>;
export type BusinessProfile = z.output<typeof businessProfileSchema>;
export type Offer = z.output<typeof offerSchema>;
export type AudienceFilters = z.output<typeof audienceFiltersSchema>;
export type CampaignExclusions = z.output<typeof exclusionsSchema>;

export const DEFAULT_EXCLUSIONS: CampaignExclusions = Object.freeze({
  domains: [],
  emails: [],
  leadListIds: [],
  skipContactsInOtherCampaigns: true,
});

/**
 * What a campaign still needs before it can be started. A draft may be saved without any of
 * it; application code (not this list) decides whether a campaign may start.
 */
export function campaignReadiness(campaign: {
  readonly businessProfile: BusinessProfile | null;
  readonly offer: Offer | null;
  readonly audience: {
    readonly icpId: string | null;
    readonly leadListId: string | null;
  };
  readonly leadLimits: {
    readonly dailyNewLeads: number | null;
    readonly maxLeads: number | null;
  };
  readonly sender: { readonly emailAccountId: string | null };
  readonly stepCount: number;
}): CampaignReadiness {
  const missing: (typeof CAMPAIGN_READINESS_SECTIONS)[number][] = [];
  const profile = campaign.businessProfile;
  if (profile?.companyName === undefined || profile.description === undefined) {
    missing.push('businessProfile');
  }
  if (
    campaign.offer?.name === undefined ||
    campaign.offer.description === undefined
  ) {
    missing.push('offer');
  }
  if (
    campaign.audience.icpId === null &&
    campaign.audience.leadListId === null
  ) {
    missing.push('audience');
  }
  if (
    campaign.leadLimits.dailyNewLeads === null ||
    campaign.leadLimits.maxLeads === null
  ) {
    missing.push('leadLimits');
  }
  if (campaign.sender.emailAccountId === null) {
    missing.push('sender');
  }
  if (campaign.stepCount === 0) {
    missing.push('sequence');
  }
  return { complete: missing.length === 0, missing };
}

/** Most choices of each kind the options endpoint returns (by name). */
export const CAMPAIGN_OPTIONS_LIMIT = 200;

const optionSchema = z.object({ id: z.uuid(), name: z.string() }).strict();

/**
 * What a campaign may reference, for the setup screens: the workspace's usable ICPs, lead lists,
 * mailboxes and templates (the same records a save accepts), each sorted by name.
 */
export const campaignOptionsSchema = z
  .object({
    icps: z.array(optionSchema),
    leadLists: z.array(optionSchema),
    mailboxes: z.array(
      z
        .object({
          id: z.uuid(),
          email: z.string(),
          provider: z.enum(['GMAIL', 'MICROSOFT_GRAPH']),
          /** Stored status: only ACTIVE is a working connection. */
          status: z.enum(['PENDING', 'ACTIVE', 'PAUSED', 'ERROR']),
        })
        .strict(),
    ),
    templates: z.array(optionSchema),
  })
  .strict();

export type CampaignOptions = z.output<typeof campaignOptionsSchema>;

export const CAMPAIGN_ERROR_CODES = [
  /** 409: the campaign changed since the version the save started from. */
  'version_conflict',
  /** 409: only DRAFT campaigns can be configured. */
  'campaign_not_editable',
  /** 409: another campaign of the workspace has this name. */
  'campaign_name_taken',
  /** 409: a check blocks starting the campaign (issues: one per reason, path = check key). */
  'campaign_not_ready',
] as const;
