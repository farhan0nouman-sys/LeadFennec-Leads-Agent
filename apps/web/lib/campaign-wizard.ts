// The campaign setup wizard's rules (task 06B, docs/decisions.md D-06B-*). Pure: no React, no
// fetch. Each stage turns the stored campaign into form values and the form values back into
// the sections of a save; the save is checked with the shared request schema (the one the API
// uses), and every issue path, from the page or from the API, is mapped to the field it belongs
// to. So the page and the API always agree on what is valid and say it with the same words.
import {
  CAMPAIGN_READINESS_SECTIONS,
  updateCampaignRequestSchema,
  type Campaign,
} from '@lead-fennec-ai/shared';
import type { z } from 'zod';

/** The sections a stage saves (any of a save's sections, without the version). */
export type CampaignChange = Omit<
  z.input<typeof updateCampaignRequestSchema>,
  'version'
>;

type ReadinessSection = (typeof CAMPAIGN_READINESS_SECTIONS)[number];

export const WIZARD_STAGES = [
  {
    key: 'business-profile',
    label: 'Business profile',
    title: 'Your business',
    description:
      'Who the emails come from: your company, what it does and why customers choose it.',
    readiness: 'businessProfile',
  },
  {
    key: 'audience',
    label: 'Target audience',
    title: 'Who you want to reach',
    description:
      'The ideal customer profile and the lead list this campaign draws its leads from.',
    readiness: 'audience',
  },
  {
    key: 'offer',
    label: 'Offer',
    title: 'What you offer',
    description: 'What the emails propose, and what you ask the reader to do.',
    readiness: 'offer',
  },
  {
    key: 'filters',
    label: 'Lead filters',
    title: 'Which leads to include',
    description:
      'Narrow the audience, leave people out, and set how many leads join the campaign.',
    readiness: 'leadLimits',
  },
  {
    key: 'mailbox',
    label: 'Mailbox',
    title: 'Who sends the emails',
    description: 'The Gmail or Microsoft 365 mailbox the campaign sends from.',
    readiness: 'sender',
  },
  {
    key: 'sequence',
    label: 'Sequence',
    title: 'The emails in order',
    description:
      'The steps of the campaign: when each email is sent, and which template it uses.',
    readiness: 'sequence',
  },
  {
    key: 'schedule',
    label: 'Schedule',
    title: 'When emails go out',
    description:
      'The days and hours emails may be sent, in the time zone of your leads.',
    readiness: null,
  },
  {
    key: 'review',
    label: 'Review',
    title: 'Review your campaign',
    description:
      'Check every step, name the campaign, and see what is still needed before it can start.',
    readiness: null,
  },
] as const satisfies readonly {
  key: string;
  label: string;
  title: string;
  description: string;
  readiness: ReadinessSection | null;
}[];

export type StageKey = (typeof WIZARD_STAGES)[number]['key'];
export type WizardStage = (typeof WIZARD_STAGES)[number];

export const FIRST_STAGE: StageKey = 'business-profile';

/** The stage named in the address bar; anything else is the first stage. */
export function stageFromParam(value: string | null | undefined): StageKey {
  return WIZARD_STAGES.find((stage) => stage.key === value)?.key ?? FIRST_STAGE;
}

export function stageIndex(key: StageKey): number {
  return WIZARD_STAGES.findIndex((stage) => stage.key === key);
}

/**
 * done: everything the stage asks for is there; todo: still needed before starting;
 * optional: has sensible defaults (schedule) or summarizes (review, done when all is).
 */
export function stageState(
  stage: WizardStage,
  campaign: Campaign,
): 'done' | 'todo' {
  if (stage.readiness === null) {
    return stage.key === 'review' && !campaign.readiness.complete
      ? 'todo'
      : 'done';
  }
  return campaign.readiness.missing.includes(stage.readiness) ? 'todo' : 'done';
}

// ─── Values ──────────────────────────────────────────────────────────────────

/** Text a field holds, or undefined when it is blank (blank means "not set"). */
const textOf = (value: string): string | undefined =>
  value.trim() === '' ? undefined : value;

/** Non-blank lines, trimmed. */
export const linesOf = (value: string): string[] =>
  value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '');

/** Entries separated by commas, semicolons or spaces. */
export const entriesOf = (value: string): string[] =>
  value
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');

/**
 * A number field: undefined when blank, otherwise its number. Anything else (NaN, a fraction)
 * is passed on, so the shared schema refuses it with its own words.
 */
export const numberOf = (value: string): number | undefined =>
  value.trim() === '' ? undefined : Number(value);

const numberText = (value: number | null | undefined): string =>
  value === null || value === undefined ? '' : String(value);

/** Only the keys whose value is defined (the schemas are strict about undefined). */
function defined<T extends Record<string, unknown>>(
  object: T,
): { [K in keyof T]?: Exclude<T[K], undefined> } {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined),
  ) as { [K in keyof T]?: Exclude<T[K], undefined> };
}

const nonEmpty = <T>(values: T[]): T[] | undefined =>
  values.length === 0 ? undefined : values;

// ─── Stages ──────────────────────────────────────────────────────────────────

/** Where an issue path's messages are shown; `list` adds "Line n" or "Entry n". */
interface FieldRule {
  readonly path: string;
  readonly field: string;
  readonly list?: 'Line' | 'Entry';
}

export interface StageForm<V> {
  readonly initial: (campaign: Campaign) => V;
  /** The sections of the save; unchanged values give the stored sections back. */
  readonly toChange: (values: V, campaign: Campaign) => CampaignChange;
  readonly rules: readonly FieldRule[];
}

export interface BusinessProfileValues {
  readonly companyName: string;
  readonly website: string;
  readonly description: string;
  readonly valueProposition: string;
}

export const businessProfileForm: StageForm<BusinessProfileValues> = {
  initial: (campaign) => ({
    companyName: campaign.businessProfile?.companyName ?? '',
    website: campaign.businessProfile?.website ?? '',
    description: campaign.businessProfile?.description ?? '',
    valueProposition: campaign.businessProfile?.valueProposition ?? '',
  }),
  toChange: (values) => {
    const profile = defined({
      companyName: textOf(values.companyName),
      website: textOf(values.website),
      description: textOf(values.description),
      valueProposition: textOf(values.valueProposition),
    });
    return {
      businessProfile: Object.keys(profile).length === 0 ? null : profile,
    };
  },
  rules: [
    { path: 'businessProfile.companyName', field: 'companyName' },
    { path: 'businessProfile.website', field: 'website' },
    { path: 'businessProfile.description', field: 'description' },
    { path: 'businessProfile.valueProposition', field: 'valueProposition' },
  ],
};

export interface AudienceValues {
  /** '' for none. */
  readonly icpId: string;
  readonly leadListId: string;
}

export const audienceForm: StageForm<AudienceValues> = {
  initial: (campaign) => ({
    icpId: campaign.audience.icpId ?? '',
    leadListId: campaign.audience.leadListId ?? '',
  }),
  toChange: (values, campaign) => ({
    audience: {
      icpId: values.icpId === '' ? null : values.icpId,
      leadListId: values.leadListId === '' ? null : values.leadListId,
      // Saved on the Lead filters stage; kept as stored.
      filters: campaign.audience.filters,
    },
  }),
  rules: [
    { path: 'audience.icpId', field: 'icpId' },
    { path: 'audience.leadListId', field: 'leadListId' },
  ],
};

export interface OfferValues {
  readonly name: string;
  readonly description: string;
  readonly callToAction: string;
  /** One per line. */
  readonly proofPoints: string;
}

export const offerForm: StageForm<OfferValues> = {
  initial: (campaign) => ({
    name: campaign.offer?.name ?? '',
    description: campaign.offer?.description ?? '',
    callToAction: campaign.offer?.callToAction ?? '',
    proofPoints: (campaign.offer?.proofPoints ?? []).join('\n'),
  }),
  toChange: (values) => {
    const offer = defined({
      name: textOf(values.name),
      description: textOf(values.description),
      callToAction: textOf(values.callToAction),
      proofPoints: nonEmpty(linesOf(values.proofPoints)),
    });
    return { offer: Object.keys(offer).length === 0 ? null : offer };
  },
  rules: [
    { path: 'offer.name', field: 'name' },
    { path: 'offer.description', field: 'description' },
    { path: 'offer.callToAction', field: 'callToAction' },
    { path: 'offer.proofPoints', field: 'proofPoints', list: 'Line' },
  ],
};

export interface FilterValues {
  readonly countries: string;
  readonly industries: string;
  readonly titles: string;
  readonly employeeCountMin: string;
  readonly employeeCountMax: string;
  readonly excludedDomains: string;
  readonly excludedEmails: string;
  readonly excludedLeadListIds: readonly string[];
  readonly skipContactsInOtherCampaigns: boolean;
  readonly dailyNewLeads: string;
  readonly maxLeads: string;
}

export const filtersForm: StageForm<FilterValues> = {
  initial: (campaign) => {
    const { filters } = campaign.audience;
    return {
      countries: (filters.countries ?? []).join(', '),
      industries: (filters.industries ?? []).join('\n'),
      titles: (filters.titles ?? []).join('\n'),
      employeeCountMin: numberText(filters.employeeCountMin),
      employeeCountMax: numberText(filters.employeeCountMax),
      excludedDomains: campaign.exclusions.domains.join('\n'),
      excludedEmails: campaign.exclusions.emails.join('\n'),
      excludedLeadListIds: campaign.exclusions.leadListIds,
      skipContactsInOtherCampaigns:
        campaign.exclusions.skipContactsInOtherCampaigns,
      dailyNewLeads: numberText(campaign.leadLimits.dailyNewLeads),
      maxLeads: numberText(campaign.leadLimits.maxLeads),
    };
  },
  toChange: (values, campaign) => ({
    audience: {
      // Chosen on the Target audience stage; kept as stored.
      icpId: campaign.audience.icpId,
      leadListId: campaign.audience.leadListId,
      filters: defined({
        countries: nonEmpty(entriesOf(values.countries)),
        industries: nonEmpty(linesOf(values.industries)),
        titles: nonEmpty(linesOf(values.titles)),
        employeeCountMin: numberOf(values.employeeCountMin),
        employeeCountMax: numberOf(values.employeeCountMax),
      }),
    },
    exclusions: {
      domains: linesOf(values.excludedDomains),
      emails: linesOf(values.excludedEmails),
      leadListIds: [...values.excludedLeadListIds],
      skipContactsInOtherCampaigns: values.skipContactsInOtherCampaigns,
    },
    leadLimits: {
      dailyNewLeads: numberOf(values.dailyNewLeads) ?? null,
      maxLeads: numberOf(values.maxLeads) ?? null,
    },
  }),
  rules: [
    { path: 'audience.filters.countries', field: 'countries', list: 'Entry' },
    { path: 'audience.filters.industries', field: 'industries', list: 'Line' },
    { path: 'audience.filters.titles', field: 'titles', list: 'Line' },
    { path: 'audience.filters.employeeCountMin', field: 'employeeCountMin' },
    { path: 'audience.filters.employeeCountMax', field: 'employeeCountMax' },
    { path: 'exclusions.domains', field: 'excludedDomains', list: 'Line' },
    { path: 'exclusions.emails', field: 'excludedEmails', list: 'Line' },
    {
      path: 'exclusions.leadListIds',
      field: 'excludedLeadListIds',
      list: 'Entry',
    },
    {
      path: 'exclusions.skipContactsInOtherCampaigns',
      field: 'skipContactsInOtherCampaigns',
    },
    { path: 'leadLimits.dailyNewLeads', field: 'dailyNewLeads' },
    { path: 'leadLimits.maxLeads', field: 'maxLeads' },
  ],
};

export interface MailboxValues {
  /** '' for none. */
  readonly emailAccountId: string;
}

export const mailboxForm: StageForm<MailboxValues> = {
  initial: (campaign) => ({
    emailAccountId: campaign.sender.emailAccountId ?? '',
  }),
  toChange: (values) => ({
    sender: {
      emailAccountId:
        values.emailAccountId === '' ? null : values.emailAccountId,
    },
  }),
  rules: [{ path: 'sender.emailAccountId', field: 'emailAccountId' }],
};

export interface StepValues {
  /** Stable key for React while steps move; the stored id or a new one. */
  readonly key: string;
  readonly days: string;
  readonly hours: string;
  /** '' for none. */
  readonly templateId: string;
}

export interface SequenceValues {
  readonly steps: readonly StepValues[];
}

/** Days and hours as minutes; blank counts as 0. Rounded to remove float noise only. */
export function minutesOf(step: Pick<StepValues, 'days' | 'hours'>): number {
  const days = numberOf(step.days) ?? 0;
  const hours = numberOf(step.hours) ?? 0;
  return Math.round((days * 1440 + hours * 60) * 1000) / 1000;
}

export const sequenceForm: StageForm<SequenceValues> = {
  initial: (campaign) => ({
    steps: campaign.sequence.steps.map((step) => ({
      key: step.id,
      days: String(Math.floor(step.delayMinutes / 1440)),
      hours: String((step.delayMinutes % 1440) / 60),
      templateId: step.templateId ?? '',
    })),
  }),
  toChange: (values) => ({
    sequence: {
      steps: values.steps.map((step) => ({
        delayMinutes: minutesOf(step),
        templateId: step.templateId === '' ? null : step.templateId,
      })),
    },
  }),
  rules: [
    // sequence.steps.<n>.delayMinutes and .templateId: see fieldOf.
    { path: 'sequence.steps', field: 'steps' },
  ],
};

export interface ScheduleValues {
  readonly timezone: string;
  readonly weekdays: readonly number[];
  /** Minutes after midnight, as the select's value. */
  readonly windowStartMinute: string;
  readonly windowEndMinute: string;
}

export const scheduleForm: StageForm<ScheduleValues> = {
  initial: (campaign) => ({
    timezone: campaign.timezone,
    weekdays: campaign.schedule.weekdays,
    windowStartMinute: String(campaign.schedule.windowStartMinute),
    windowEndMinute: String(campaign.schedule.windowEndMinute),
  }),
  toChange: (values) => ({
    timezone: values.timezone,
    schedule: {
      weekdays: [...values.weekdays].sort((a, b) => a - b),
      windowStartMinute: Number(values.windowStartMinute),
      windowEndMinute: Number(values.windowEndMinute),
    },
  }),
  rules: [
    { path: 'timezone', field: 'timezone' },
    { path: 'schedule.weekdays', field: 'weekdays' },
    { path: 'schedule.windowStartMinute', field: 'windowStartMinute' },
    { path: 'schedule.windowEndMinute', field: 'windowEndMinute' },
  ],
};

export interface ReviewValues {
  readonly name: string;
  readonly description: string;
}

export const reviewForm: StageForm<ReviewValues> = {
  initial: (campaign) => ({
    name: campaign.name,
    description: campaign.description ?? '',
  }),
  toChange: (values) => ({
    name: values.name,
    description: textOf(values.description) ?? null,
  }),
  rules: [
    { path: 'name', field: 'name' },
    { path: 'description', field: 'description' },
  ],
};

// ─── Checking and mapping ────────────────────────────────────────────────────

export interface Issue {
  readonly path: string;
  readonly message: string;
}

/** The field an issue belongs to, and its message (with the line or entry for lists). */
export function fieldOf(
  rules: readonly FieldRule[],
  path: string,
  message: string,
): { readonly field: string; readonly message: string } | null {
  const step = /^sequence\.steps\.(\d+)\.(delayMinutes|templateId)$/.exec(path);
  if (step !== null) {
    const field = step[2] === 'delayMinutes' ? 'delay' : 'template';
    return { field: `steps.${step[1] ?? '0'}.${field}`, message };
  }
  for (const rule of rules) {
    if (path === rule.path) {
      return { field: rule.field, message };
    }
    if (path.startsWith(`${rule.path}.`)) {
      const index = Number(path.slice(rule.path.length + 1).split('.')[0]);
      return {
        field: rule.field,
        message:
          rule.list !== undefined && Number.isInteger(index)
            ? `${rule.list} ${String(index + 1)}: ${message}`
            : message,
      };
    }
  }
  return null;
}

export interface MappedIssues {
  /** The first message per field. */
  readonly fields: Readonly<Record<string, string>>;
  /** Issues that belong to no field of the stage (e.g. a section saved on another stage). */
  readonly other: readonly string[];
}

export function mapIssues(
  rules: readonly FieldRule[],
  issues: readonly Issue[],
): MappedIssues {
  const fields: Record<string, string> = {};
  const other: string[] = [];
  for (const issue of issues) {
    const mapped = fieldOf(rules, issue.path, issue.message);
    if (mapped === null) {
      other.push(issue.message);
    } else if (!(mapped.field in fields)) {
      fields[mapped.field] = mapped.message;
    }
  }
  return { fields, other };
}

/**
 * The save a stage would send, checked with the API's own schema: the body, or the issues the
 * API would answer with (same paths, same words).
 */
export function checkSave(
  version: number,
  change: CampaignChange,
):
  | {
      readonly ok: true;
      readonly body: z.input<typeof updateCampaignRequestSchema>;
    }
  | { readonly ok: false; readonly issues: readonly Issue[] } {
  const body = { version, ...change };
  const result = updateCampaignRequestSchema.safeParse(body);
  return result.success
    ? { ok: true, body }
    : {
        ok: false,
        issues: result.error.issues.map((issue) => ({
          path: issue.path.map(String).join('.'),
          message: issue.message,
        })),
      };
}

/** Whether the values would change anything compared with what is stored. */
export function isDirty<V>(
  form: StageForm<V>,
  values: V,
  campaign: Campaign,
): boolean {
  return (
    JSON.stringify(form.toChange(values, campaign)) !==
    JSON.stringify(form.toChange(form.initial(campaign), campaign))
  );
}

// ─── Schedule choices ─────────────────────────────────────────────────────────

export const WEEKDAYS = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 7, label: 'Sunday' },
] as const;

/** "09:30" for 570; "24:00 (midnight)" for 1440. */
export function timeLabel(minutes: number): string {
  if (minutes === 1440) {
    return '24:00 (midnight)';
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/** Every half hour; starts from 00:00 to 23:30, ends from 00:30 to 24:00. */
export const HALF_HOURS = Array.from({ length: 49 }, (_, i) => i * 30);
