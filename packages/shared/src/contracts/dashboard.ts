// Dashboard aggregates (task 05C, docs/decisions.md D-05C-*): counts of the leads, campaigns and
// workspace activity that exist today, the recent activity feed and the health of connected
// integrations. Each endpoint lives under the section that owns its data and needs that
// section's permission (packages/shared/src/navigation.ts), so the dashboard shows a member only
// what their role already lets them open. Pure zod and data: safe for web, API and worker.
import { z } from 'zod';

export const DASHBOARD_ROUTES = {
  leadSummary: (workspaceId: string) =>
    `/workspaces/${workspaceId}/leads/summary`,
  campaignSummary: (workspaceId: string) =>
    `/workspaces/${workspaceId}/campaigns/summary`,
  activity: (workspaceId: string) => `/workspaces/${workspaceId}/activity`,
  integrationHealth: (workspaceId: string) =>
    `/workspaces/${workspaceId}/integrations/health`,
} as const;

const iso = z.iso.datetime();
const count = z.number().int().min(0);

/** `{ KEY: count, … }` for every value of a status enum. */
function countsByStatus<const K extends string>(keys: readonly K[]) {
  const shape = Object.fromEntries(keys.map((key) => [key, count])) as Record<
    K,
    typeof count
  >;
  return z.object(shape).strict();
}

/** Lead counts (contacts.read). Contacts are people; companies are organizations. */
export const leadSummarySchema = z
  .object({
    /** When the counts were taken (server clock). */
    generatedAt: iso,
    /** Active (not archived) contacts. */
    contacts: count,
    companies: count,
    /** Active contacts with an email address. */
    contactsWithEmail: count,
    /** Active contacts created in the 30 days before generatedAt. */
    contactsAddedLast30Days: count,
  })
  .strict();

export const CAMPAIGN_STATUSES = [
  'DRAFT',
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'CANCELLED',
] as const;

export const CAMPAIGN_LEAD_STATUSES = [
  'PENDING',
  'ACTIVE',
  'COMPLETED',
  'STOPPED',
] as const;

/** Campaign counts (campaigns.read). */
export const campaignSummarySchema = z
  .object({
    generatedAt: iso,
    campaigns: count,
    activeCampaigns: count,
    /** Leads enrolled in a campaign that have neither finished nor stopped. */
    leadsInProgress: count,
    campaignsByStatus: countsByStatus(CAMPAIGN_STATUSES),
    leadsByStatus: countsByStatus(CAMPAIGN_LEAD_STATUSES),
  })
  .strict();

export const ACTIVITY_DEFAULT_LIMIT = 10;
export const ACTIVITY_MAX_LIMIT = 25;

export const activityQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(ACTIVITY_MAX_LIMIT).optional(),
  })
  .strict();

/**
 * Who acted. `member`: a current member (name: display name, else email address);
 * `former_member`: no longer a member (no name); `platform_admin`: Lead Fennec staff with a
 * stated reason (never named); `system`: an automatic process (name: its key).
 */
export const ACTIVITY_ACTOR_KINDS = [
  'member',
  'former_member',
  'platform_admin',
  'system',
] as const;

export const activityItemSchema = z
  .object({
    id: z.uuid(),
    /** Dotted key, e.g. "invitation.created" (activityLabel gives the words). */
    action: z.string(),
    actor: z
      .object({
        kind: z.enum(ACTIVITY_ACTOR_KINDS),
        name: z.string().nullable(),
      })
      .strict(),
    /** Snake-case kind of record changed, e.g. "invitation"; never its id. */
    targetType: z.string().nullable(),
    /** The stated reason (always present for platform admins). Plain text, untrusted. */
    reason: z.string().nullable(),
    occurredAt: iso,
  })
  .strict();

/** Recent workspace activity from the audit records (audit.read), newest first. */
export const activityResponseSchema = z
  .object({
    generatedAt: iso,
    counts: z
      .object({ last24Hours: count, last7Days: count, last30Days: count })
      .strict(),
    items: z.array(activityItemSchema),
  })
  .strict();

/** What each recorded action means, as a phrase that follows the actor's name. */
export const ACTIVITY_LABELS: Readonly<Record<string, string>> = {
  'workspace.created': 'created the workspace',
  'invitation.created': 'invited someone to join',
  'invitation.revoked': 'revoked an invitation',
  'invitation.accepted': 'joined the workspace',
  'membership.role_changed': "changed a member's role",
  'platform_admin.access_opened': 'opened read-only access for support',
  'limit_override.set': 'changed a plan limit',
  'subscription.synced': 'updated the subscription',
  'approval.decided': 'reviewed a draft',
  'campaign.created': 'created a campaign',
  'campaign.updated': 'changed a campaign',
  'campaign.duplicated': 'duplicated a campaign',
  'campaign.activated': 'started a campaign',
};

export function activityLabel(action: string): string {
  return ACTIVITY_LABELS[action] ?? 'made a change';
}

/**
 * Integrations a workspace connects itself, in display order. Stripe (billing) is shown on the
 * Billing page; OpenAI and email verification are run by the platform, not connected per
 * workspace (docs/decisions.md D-05C-03).
 */
export const HEALTH_PROVIDERS = [
  { provider: 'GMAIL', label: 'Gmail', kind: 'mailbox' },
  { provider: 'MICROSOFT_GRAPH', label: 'Microsoft 365', kind: 'mailbox' },
  { provider: 'GOHIGHLEVEL', label: 'GoHighLevel', kind: 'sync' },
  { provider: 'APOLLO', label: 'Apollo', kind: 'sync' },
] as const;

export type HealthProvider = (typeof HEALTH_PROVIDERS)[number]['provider'];

export const HEALTH_PROVIDER_KEYS = HEALTH_PROVIDERS.map(
  (entry) => entry.provider,
) as [HealthProvider, ...HealthProvider[]];

export const INTEGRATION_HEALTH_STATES = [
  'not_connected',
  'connecting',
  'healthy',
  'attention',
] as const;

export type IntegrationHealthState = (typeof INTEGRATION_HEALTH_STATES)[number];

export const MAILBOX_STATUSES = [
  'PENDING',
  'ACTIVE',
  'PAUSED',
  'DISCONNECTED',
  'ERROR',
] as const;

export const integrationHealthItemSchema = z
  .object({
    provider: z.enum(HEALTH_PROVIDER_KEYS),
    state: z.enum(INTEGRATION_HEALTH_STATES),
    /** Mailbox providers only: connected mailboxes by status. */
    mailboxes: countsByStatus(MAILBOX_STATUSES).nullable(),
    /** Incremental syncs with this provider. */
    syncs: count,
    /** Syncs whose last run failed. */
    failingSyncs: count,
    lastSyncedAt: iso.nullable(),
    /** Provider notifications that could not be processed, in the last 24 hours. */
    failedEventsLast24Hours: count,
    lastEventAt: iso.nullable(),
  })
  .strict();

/** Health of the workspace's integrations (settings.manage), one item per HEALTH_PROVIDERS. */
export const integrationHealthResponseSchema = z
  .object({
    generatedAt: iso,
    items: z.array(integrationHealthItemSchema),
  })
  .strict();

export type LeadSummary = z.output<typeof leadSummarySchema>;
export type CampaignSummary = z.output<typeof campaignSummarySchema>;
export type ActivityItem = z.output<typeof activityItemSchema>;
export type ActivityResponse = z.output<typeof activityResponseSchema>;
export type IntegrationHealthItem = z.output<
  typeof integrationHealthItemSchema
>;

/**
 * The health state, decided by application code from the counts: anything failing needs
 * attention; otherwise a working connection is healthy; a mailbox whose authorization isn't
 * finished is connecting; nothing at all is not connected.
 */
export function integrationHealthState(input: {
  readonly mailboxes: Readonly<
    Record<(typeof MAILBOX_STATUSES)[number], number>
  > | null;
  readonly syncs: number;
  readonly failingSyncs: number;
  readonly failedEventsLast24Hours: number;
  readonly lastEventAt: Date | string | null;
}): IntegrationHealthState {
  const mailboxes = input.mailboxes;
  if (
    input.failingSyncs > 0 ||
    input.failedEventsLast24Hours > 0 ||
    (mailboxes !== null && mailboxes.ERROR > 0)
  ) {
    return 'attention';
  }
  if (mailboxes !== null) {
    if (mailboxes.ACTIVE + mailboxes.PAUSED > 0) {
      return 'healthy';
    }
    return mailboxes.PENDING > 0 ? 'connecting' : 'not_connected';
  }
  return input.syncs > 0 || input.lastEventAt !== null
    ? 'healthy'
    : 'not_connected';
}

/**
 * The dashboard's metrics. `available`: counted from the database now, read from the group's
 * summary under `key`. `unavailable`: needs a feature that isn't built yet; the dashboard says
 * so instead of showing a number.
 */
export interface DashboardMetric {
  readonly key: string;
  readonly label: string;
  readonly group: 'leads' | 'campaigns';
  readonly status: 'available' | 'unavailable';
  readonly description: string;
}

export const DASHBOARD_METRICS = [
  {
    key: 'contacts',
    label: 'Contacts',
    group: 'leads',
    status: 'available',
    description: 'People in this workspace, not counting archived ones.',
  },
  {
    key: 'companies',
    label: 'Companies',
    group: 'leads',
    status: 'available',
    description: 'Organizations your contacts belong to.',
  },
  {
    key: 'contactsWithEmail',
    label: 'Contacts with email',
    group: 'leads',
    status: 'available',
    description: 'Contacts that have an email address.',
  },
  {
    key: 'contactsAddedLast30Days',
    label: 'Added in 30 days',
    group: 'leads',
    status: 'available',
    description: 'Contacts added in the last 30 days.',
  },
  {
    key: 'verifiedEmails',
    label: 'Verified emails',
    group: 'leads',
    status: 'unavailable',
    description: 'Available once email verification is built.',
  },
  {
    key: 'scoredLeads',
    label: 'Scored leads',
    group: 'leads',
    status: 'unavailable',
    description: 'Available once lead research and scoring are built.',
  },
  {
    key: 'activeCampaigns',
    label: 'Active campaigns',
    group: 'campaigns',
    status: 'available',
    description: 'Campaigns that are running now.',
  },
  {
    key: 'campaigns',
    label: 'All campaigns',
    group: 'campaigns',
    status: 'available',
    description: 'Campaigns in any status, drafts included.',
  },
  {
    key: 'leadsInProgress',
    label: 'Leads in progress',
    group: 'campaigns',
    status: 'available',
    description: 'Leads in a campaign that have not finished or stopped.',
  },
  {
    key: 'emailsSent',
    label: 'Emails sent',
    group: 'campaigns',
    status: 'unavailable',
    description: 'Available once sending from connected mailboxes is built.',
  },
  {
    key: 'replyRate',
    label: 'Reply rate',
    group: 'campaigns',
    status: 'unavailable',
    description: 'Available once replies are read from connected mailboxes.',
  },
  {
    key: 'meetingsBooked',
    label: 'Meetings booked',
    group: 'campaigns',
    status: 'unavailable',
    description: 'Available once meetings are tracked.',
  },
] as const satisfies readonly DashboardMetric[];
