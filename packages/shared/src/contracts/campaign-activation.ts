// Campaign readiness and activation (task 06C, docs/decisions.md D-06C-*). A campaign starts only
// through the explicit activation endpoint, and only when every check below passes. The checks
// are decided here, by application code, from facts the database layer gathers for one
// workspace; services that aren't built yet always block ("fail closed"), with a reason a
// person can read. Pure: safe for web, API and worker.
import { z } from 'zod';
import { normalizeTimeZone } from '../time-zone.js';
import type { Campaign } from './campaigns.js';
import { CAMPAIGN_STATUSES } from './dashboard.js';

/** The setup wizard's stages (apps/web/lib/campaign-wizard.ts uses the same keys). */
export const CAMPAIGN_SETUP_STAGES = [
  'business-profile',
  'audience',
  'offer',
  'filters',
  'mailbox',
  'sequence',
  'schedule',
  'review',
] as const;

export type CampaignSetupStage = (typeof CAMPAIGN_SETUP_STAGES)[number];

/**
 * setting: something the campaign's own setup fixes; workspace: something an admin of the
 * workspace (or of the platform) must change; service: a part of Lead Fennec that isn't built
 * yet, which blocks until it is.
 */
export const ACTIVATION_CHECKS = [
  {
    key: 'business_profile',
    label: 'Business profile',
    kind: 'setting',
    stage: 'business-profile',
  },
  { key: 'offer', label: 'Offer', kind: 'setting', stage: 'offer' },
  {
    key: 'audience',
    label: 'Target audience',
    kind: 'setting',
    stage: 'audience',
  },
  {
    key: 'eligibility',
    label: 'Lead eligibility',
    kind: 'setting',
    stage: 'audience',
  },
  { key: 'limits', label: 'Lead limits', kind: 'setting', stage: 'filters' },
  {
    key: 'sender',
    label: 'Sending mailbox',
    kind: 'setting',
    stage: 'mailbox',
  },
  { key: 'sequence', label: 'Sequence', kind: 'setting', stage: 'sequence' },
  { key: 'schedule', label: 'Schedule', kind: 'setting', stage: 'schedule' },
  { key: 'approval', label: 'Approval', kind: 'setting', stage: 'review' },
  {
    key: 'workspace',
    label: 'Workspace plan and sending',
    kind: 'workspace',
    stage: null,
  },
  {
    key: 'eligibility_service',
    label: 'Checking leads before they join',
    kind: 'service',
    stage: null,
  },
  {
    key: 'drafting_service',
    label: 'Preparing the emails',
    kind: 'service',
    stage: null,
  },
  {
    key: 'sending_service',
    label: 'Sending email',
    kind: 'service',
    stage: null,
  },
] as const satisfies readonly {
  key: string;
  label: string;
  kind: 'setting' | 'workspace' | 'service';
  stage: CampaignSetupStage | null;
}[];

export type ActivationCheckKey = (typeof ACTIVATION_CHECKS)[number]['key'];

const CHECK_KEYS = ACTIVATION_CHECKS.map((check) => check.key) as [
  ActivationCheckKey,
  ...ActivationCheckKey[],
];

/**
 * Later services a running campaign needs. Each is false until it is built; the API passes
 * BUILT_SERVICES, and only tests pass anything else.
 */
export interface CampaignServices {
  /** Checks each lead against suppressions and email verification before it joins. */
  readonly eligibility: boolean;
  /** Prepares each email (from its template) for each lead. */
  readonly drafting: boolean;
  /** Sends through the connected Gmail or Microsoft 365 mailbox. */
  readonly sending: boolean;
}

/** None of them is built yet (task 06C): activation always fails closed in production. */
export const BUILT_SERVICES: CampaignServices = Object.freeze({
  eligibility: false,
  drafting: false,
  sending: false,
});

/** What the checks look at, gathered by the database layer for one workspace. */
export interface ActivationFacts {
  readonly campaign: Pick<
    Campaign,
    | 'businessProfile'
    | 'offer'
    | 'audience'
    | 'leadLimits'
    | 'sender'
    | 'sequence'
    | 'timezone'
    | 'schedule'
    | 'approvalMode'
  >;
  readonly icp: { readonly status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED' } | null;
  readonly leadList: {
    readonly status: 'ACTIVE' | 'ARCHIVED';
    /** Active contacts on the list with an email address. */
    readonly contactsWithEmail: number;
  } | null;
  readonly mailbox: {
    readonly status: 'PENDING' | 'ACTIVE' | 'PAUSED' | 'DISCONNECTED' | 'ERROR';
    readonly hasCredentials: boolean;
    readonly dailySendLimit: number;
    readonly failingSyncs: number;
  } | null;
  /** Status of every template the steps name that still exists in the workspace. */
  readonly templates: Readonly<Record<string, 'ACTIVE' | 'ARCHIVED'>>;
  /** Active members whose role grants drafts.approve. */
  readonly approvers: number;
  readonly workspace: {
    readonly requireSendApproval: boolean;
    readonly outboundSendingEnabled: boolean;
  };
  /** The current subscription; null when there is none. */
  readonly plan: {
    readonly entitled: boolean;
    /** EMAILS_SENT allowed per period (override, else the plan's). */
    readonly emailsPerPeriod: number;
  } | null;
}

export const activationCheckSchema = z
  .object({
    key: z.enum(CHECK_KEYS),
    label: z.string(),
    kind: z.enum(['setting', 'workspace', 'service']),
    /** The wizard stage that fixes it, if the campaign's setup can. */
    stage: z.enum(CAMPAIGN_SETUP_STAGES).nullable(),
    passed: z.boolean(),
    /** Why it is blocked, in words; empty when it passes. */
    reasons: z.array(z.string()),
  })
  .strict();

/** Every check, in the order of ACTIVATION_CHECKS. */
export const activationReportSchema = z
  .object({
    campaignId: z.uuid(),
    /** The version the report was made for (activation must name it). */
    version: z.number().int().min(1),
    status: z.enum(CAMPAIGN_STATUSES),
    ready: z.boolean(),
    checks: z.array(activationCheckSchema),
  })
  .strict();

export type ActivationCheck = z.output<typeof activationCheckSchema>;
export type ActivationReport = z.output<typeof activationReportSchema>;

/** Starting a campaign names the version the person reviewed. */
export const activateCampaignRequestSchema = z
  .object({ version: z.number().int().min(1) })
  .strict();

const MAILBOX_PROBLEMS = {
  PENDING: "The mailbox hasn't been authorized yet.",
  PAUSED: 'The mailbox is paused.',
  DISCONNECTED: 'The mailbox is disconnected.',
  ERROR: 'The mailbox needs reconnecting.',
} as const;

function validTimeZone(zone: string): boolean {
  try {
    return normalizeTimeZone(zone) === zone;
  } catch {
    return false;
  }
}

/** The reasons each check is blocked (empty when it passes). */
function reasonsFor(
  facts: ActivationFacts,
  services: CampaignServices,
): Record<ActivationCheckKey, string[]> {
  const { campaign } = facts;
  const reasons: Record<ActivationCheckKey, string[]> = {
    business_profile: [],
    offer: [],
    audience: [],
    eligibility: [],
    limits: [],
    sender: [],
    sequence: [],
    schedule: [],
    approval: [],
    workspace: [],
    eligibility_service: [],
    drafting_service: [],
    sending_service: [],
  };

  if (campaign.businessProfile?.companyName === undefined) {
    reasons.business_profile.push('Add your company name.');
  }
  if (campaign.businessProfile?.description === undefined) {
    reasons.business_profile.push('Describe what your company does.');
  }

  if (campaign.offer?.name === undefined) {
    reasons.offer.push('Name the offer.');
  }
  if (campaign.offer?.description === undefined) {
    reasons.offer.push('Describe what the offer includes.');
  }

  const { icpId, leadListId } = campaign.audience;
  if (icpId === null && leadListId === null) {
    reasons.audience.push('Choose an ideal customer profile or a lead list.');
  }
  if (
    icpId !== null &&
    (facts.icp === null || facts.icp.status === 'ARCHIVED')
  ) {
    reasons.audience.push(
      'The ideal customer profile is archived or no longer available.',
    );
  }
  if (
    leadListId !== null &&
    (facts.leadList === null || facts.leadList.status === 'ARCHIVED')
  ) {
    reasons.audience.push('The lead list is archived or no longer available.');
  }

  // Eligibility policy: who may be contacted. Leads come only from a lead list for now.
  if (leadListId === null) {
    reasons.eligibility.push(
      "Finding leads from an ideal customer profile alone isn't available yet. Choose a lead list.",
    );
  } else if (
    facts.leadList !== null &&
    facts.leadList.contactsWithEmail === 0
  ) {
    reasons.eligibility.push('Nobody on the lead list has an email address.');
  }

  const { dailyNewLeads, maxLeads } = campaign.leadLimits;
  if (dailyNewLeads === null) {
    reasons.limits.push('Set how many new leads join per day.');
  }
  if (maxLeads === null) {
    reasons.limits.push('Set how many leads join in total.');
  }
  if (dailyNewLeads !== null && maxLeads !== null && dailyNewLeads > maxLeads) {
    reasons.limits.push('The daily number is larger than the total.');
  }
  if (
    dailyNewLeads !== null &&
    facts.mailbox !== null &&
    dailyNewLeads > facts.mailbox.dailySendLimit
  ) {
    reasons.limits.push(
      `The mailbox sends at most ${String(facts.mailbox.dailySendLimit)} emails a day. Lower the new leads per day to that or fewer.`,
    );
  }

  if (campaign.sender.emailAccountId === null) {
    reasons.sender.push('Choose the mailbox the campaign sends from.');
  } else if (facts.mailbox === null) {
    reasons.sender.push('The mailbox is no longer in this workspace.');
  } else {
    const { status } = facts.mailbox;
    if (status !== 'ACTIVE') {
      reasons.sender.push(MAILBOX_PROBLEMS[status]);
    } else if (!facts.mailbox.hasCredentials) {
      reasons.sender.push('The mailbox has no stored authorization.');
    }
    if (facts.mailbox.failingSyncs > 0) {
      reasons.sender.push("The mailbox's last sync failed.");
    }
  }

  const steps = campaign.sequence.steps;
  if (steps.length === 0) {
    reasons.sequence.push('Add at least one step.');
  }
  steps.forEach((step, index) => {
    const number = String(index + 1);
    if (step.templateId === null) {
      reasons.sequence.push(`Step ${number} has no template.`);
    } else if (facts.templates[step.templateId] !== 'ACTIVE') {
      reasons.sequence.push(
        `The template of step ${number} is archived or no longer available.`,
      );
    }
  });

  const { weekdays, windowStartMinute, windowEndMinute } = campaign.schedule;
  if (weekdays.length === 0) {
    reasons.schedule.push('Choose at least one day to send on.');
  }
  if (windowStartMinute >= windowEndMinute) {
    reasons.schedule.push('End the sending window after it starts.');
  }
  if (!validTimeZone(campaign.timezone)) {
    reasons.schedule.push('Choose a valid time zone.');
  }

  if (campaign.approvalMode === 'HUMAN' && facts.approvers === 0) {
    reasons.approval.push(
      'Nobody in this workspace can approve emails. Give someone a role that can.',
    );
  }
  if (
    campaign.approvalMode === 'AUTOMATIC' &&
    facts.workspace.requireSendApproval
  ) {
    reasons.approval.push(
      "This workspace requires a person to approve every email, so automatic approval can't be used.",
    );
  }

  if (!facts.plan?.entitled) {
    reasons.workspace.push('This workspace has no active plan.');
  } else if (facts.plan.emailsPerPeriod <= 0) {
    reasons.workspace.push(
      "The workspace's plan doesn't include sending email.",
    );
  }
  if (!facts.workspace.outboundSendingEnabled) {
    reasons.workspace.push('Sending is turned off for this workspace.');
  }

  if (!services.eligibility) {
    reasons.eligibility_service.push(
      "Checking each lead against the do-not-contact list and email verification isn't available yet.",
    );
  }
  if (!services.drafting) {
    reasons.drafting_service.push(
      "Preparing each email from its template isn't available yet.",
    );
  }
  if (!services.sending) {
    reasons.sending_service.push(
      "Sending email through Gmail or Microsoft 365 isn't available yet.",
    );
  }
  return reasons;
}

/**
 * Every check for a campaign, in order. `ready` only when all pass and the campaign is a draft
 * (a running one is already started; any other status can't be started).
 */
export function evaluateActivation(
  subject: {
    readonly id: string;
    readonly version: number;
    readonly status: Campaign['status'];
  },
  facts: ActivationFacts,
  services: CampaignServices,
): ActivationReport {
  const reasons = reasonsFor(facts, services);
  const checks = ACTIVATION_CHECKS.map((check) => ({
    key: check.key,
    label: check.label,
    kind: check.kind,
    stage: check.stage,
    passed: reasons[check.key].length === 0,
    reasons: reasons[check.key],
  }));
  return {
    campaignId: subject.id,
    version: subject.version,
    status: subject.status,
    ready: subject.status === 'DRAFT' && checks.every((check) => check.passed),
    checks,
  };
}
