// Dashboard aggregates (task 05C, docs/decisions.md D-05C-02): counts of one workspace's leads
// and campaigns, its latest audit records and the health of its integrations. Every query
// filters by tenantId; each method first checks the permission of the section that owns the
// data (packages/shared/src/navigation.ts), so the dashboard can't show more than those pages.
import {
  ACTIVITY_MAX_LIMIT,
  CAMPAIGN_LEAD_STATUSES,
  CAMPAIGN_STATUSES,
  HEALTH_PROVIDERS,
  MAILBOX_STATUSES,
  integrationHealthState,
  type HealthProvider,
  type IntegrationHealthState,
} from '@lead-fennec-ai/shared';
import { z } from 'zod';
import type {
  IntegrationProvider,
  PrismaClient,
} from '../generated/prisma/client.js';
import type { TenantActor } from './actors.js';
import { createAuditRepository } from './audit.js';
import { requireReadPermission } from './authorization.js';

const DAY_MS = 86_400_000;

export interface LeadCounts {
  readonly generatedAt: Date;
  readonly contacts: number;
  readonly companies: number;
  readonly contactsWithEmail: number;
  readonly contactsAddedLast30Days: number;
}

type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];
type CampaignLeadStatus = (typeof CAMPAIGN_LEAD_STATUSES)[number];
type MailboxStatus = (typeof MAILBOX_STATUSES)[number];

export interface CampaignCounts {
  readonly generatedAt: Date;
  readonly campaigns: number;
  readonly activeCampaigns: number;
  readonly leadsInProgress: number;
  readonly campaignsByStatus: Readonly<Record<CampaignStatus, number>>;
  readonly leadsByStatus: Readonly<Record<CampaignLeadStatus, number>>;
}

export interface ActivityEntry {
  readonly id: string;
  readonly action: string;
  readonly actor: {
    readonly kind: 'member' | 'former_member' | 'platform_admin' | 'system';
    readonly name: string | null;
  };
  readonly targetType: string | null;
  readonly reason: string | null;
  readonly occurredAt: Date;
}

export interface Activity {
  readonly generatedAt: Date;
  readonly counts: {
    readonly last24Hours: number;
    readonly last7Days: number;
    readonly last30Days: number;
  };
  readonly items: ActivityEntry[];
}

export interface IntegrationHealthEntry {
  readonly provider: HealthProvider;
  readonly state: IntegrationHealthState;
  readonly mailboxes: Readonly<Record<MailboxStatus, number>> | null;
  readonly syncs: number;
  readonly failingSyncs: number;
  readonly lastSyncedAt: Date | null;
  readonly failedEventsLast24Hours: number;
  readonly lastEventAt: Date | null;
}

export interface IntegrationHealth {
  readonly generatedAt: Date;
  readonly items: IntegrationHealthEntry[];
}

export interface DashboardRepository {
  /** Contacts and companies (contacts.read). */
  leadSummary(): Promise<LeadCounts>;
  /** Campaigns and their leads by status (campaigns.read). */
  campaignSummary(): Promise<CampaignCounts>;
  /** The latest `limit` audit records, newest first, and recent counts (audit.read). */
  activity(limit: number): Promise<Activity>;
  /** One entry per HEALTH_PROVIDERS, in that order (settings.manage). */
  integrationHealth(): Promise<IntegrationHealth>;
}

/** `{ KEY: n }` for every key, adding up `rows` and ignoring keys outside the list. */
function tally<const K extends string>(
  keys: readonly K[],
  rows: readonly (readonly [string, number])[],
): Record<K, number> {
  const result = Object.fromEntries(keys.map((key) => [key, 0])) as Record<
    K,
    number
  >;
  for (const [key, value] of rows) {
    if ((keys as readonly string[]).includes(key)) {
      result[key as K] += value;
    }
  }
  return result;
}

const limitSchema = z.number().int().min(1).max(ACTIVITY_MAX_LIMIT);

export function createDashboardRepository(
  prisma: PrismaClient,
  tenantId: string,
  actor: TenantActor,
  now: () => Date,
): DashboardRepository {
  const audit = createAuditRepository(prisma, tenantId, actor);
  const daysBefore = (at: Date, days: number) =>
    new Date(at.getTime() - days * DAY_MS);

  return {
    async leadSummary() {
      requireReadPermission(actor, 'contacts.read');
      const generatedAt = now();
      const active = { tenantId, status: 'ACTIVE' as const };
      // One snapshot, so the counts agree with each other.
      const [contacts, companies, contactsWithEmail, contactsAddedLast30Days] =
        await prisma.$transaction(
          [
            prisma.contact.count({ where: active }),
            prisma.organization.count({ where: { tenantId } }),
            prisma.contact.count({
              where: { ...active, normalizedEmail: { not: null } },
            }),
            prisma.contact.count({
              where: {
                ...active,
                createdAt: { gte: daysBefore(generatedAt, 30) },
              },
            }),
          ],
          { isolationLevel: 'RepeatableRead' },
        );
      return {
        generatedAt,
        contacts,
        companies,
        contactsWithEmail,
        contactsAddedLast30Days,
      };
    },

    async campaignSummary() {
      requireReadPermission(actor, 'campaigns.read');
      const generatedAt = now();
      const [campaignGroups, leadGroups] = await prisma.$transaction(
        [
          prisma.campaign.groupBy({
            by: ['status'],
            where: { tenantId },
            orderBy: { status: 'asc' },
            _count: { _all: true },
          }),
          prisma.campaignLead.groupBy({
            by: ['status'],
            where: { tenantId },
            orderBy: { status: 'asc' },
            _count: { _all: true },
          }),
        ],
        { isolationLevel: 'RepeatableRead' },
      );
      const campaignsByStatus = tally(
        CAMPAIGN_STATUSES,
        campaignGroups.map((group) => [group.status, group._count._all]),
      );
      const leadsByStatus = tally(
        CAMPAIGN_LEAD_STATUSES,
        leadGroups.map((group) => [group.status, group._count._all]),
      );
      return {
        generatedAt,
        campaigns: Object.values<number>(campaignsByStatus).reduce(
          (sum, n) => sum + n,
          0,
        ),
        activeCampaigns: campaignsByStatus.ACTIVE,
        leadsInProgress: leadsByStatus.PENDING + leadsByStatus.ACTIVE,
        campaignsByStatus,
        leadsByStatus,
      };
    },

    async activity(rawLimit) {
      const limit = limitSchema.parse(rawLimit);
      // The audit repository checks audit.read and pages newest first.
      const page = await audit.list({ limit });
      const generatedAt = now();
      const since = (days: number) => ({
        tenantId,
        occurredAt: { gte: daysBefore(generatedAt, days) },
      });
      const [last24Hours, last7Days, last30Days] = await prisma.$transaction(
        [
          prisma.auditRecord.count({ where: since(1) }),
          prisma.auditRecord.count({ where: since(7) }),
          prisma.auditRecord.count({ where: since(30) }),
        ],
        { isolationLevel: 'RepeatableRead' },
      );
      // Names of the members who acted, by the membership recorded with the action. Only
      // memberships of this workspace are read, so nobody outside it is ever named.
      const membershipIds = [
        ...new Set(
          page.items.flatMap((record) =>
            record.actorType === 'MEMBER' && record.actorMembershipId !== null
              ? [record.actorMembershipId]
              : [],
          ),
        ),
      ];
      const members =
        membershipIds.length === 0
          ? []
          : await prisma.membership.findMany({
              where: { tenantId, id: { in: membershipIds } },
              select: {
                id: true,
                user: { select: { displayName: true, email: true } },
              },
            });
      const names = new Map(
        members.map((member) => [
          member.id,
          member.user.displayName ?? member.user.email,
        ]),
      );
      const actorOf = (record: (typeof page.items)[number]) => {
        switch (record.actorType) {
          case 'PLATFORM_ADMIN':
            return { kind: 'platform_admin' as const, name: null };
          case 'SYSTEM':
            return { kind: 'system' as const, name: record.actorName };
          // USER actions are recorded at platform level only (task 04C); unnamed if found here.
          case 'MEMBER':
          case 'USER': {
            const name =
              record.actorMembershipId === null
                ? undefined
                : names.get(record.actorMembershipId);
            return name === undefined
              ? { kind: 'former_member' as const, name: null }
              : { kind: 'member' as const, name };
          }
        }
      };
      return {
        generatedAt,
        counts: { last24Hours, last7Days, last30Days },
        items: page.items.map((record) => ({
          id: record.id,
          action: record.action,
          actor: actorOf(record),
          targetType: record.targetType,
          reason: record.reason,
          occurredAt: record.occurredAt,
        })),
      };
    },

    async integrationHealth() {
      requireReadPermission(actor, 'settings.manage');
      const generatedAt = now();
      const providers = HEALTH_PROVIDERS.map(
        (entry) => entry.provider,
      ) as IntegrationProvider[];
      const scoped = { tenantId, provider: { in: providers } };
      const [mailboxGroups, syncGroups, failingGroups, failedGroups, events] =
        await prisma.$transaction(
          [
            prisma.emailAccount.groupBy({
              by: ['provider', 'status'],
              where: { tenantId },
              orderBy: [{ provider: 'asc' }, { status: 'asc' }],
              _count: { _all: true },
            }),
            prisma.integrationSyncCursor.groupBy({
              by: ['provider'],
              where: scoped,
              orderBy: { provider: 'asc' },
              _count: { _all: true },
              _max: { lastSyncedAt: true },
            }),
            prisma.integrationSyncCursor.groupBy({
              by: ['provider'],
              where: { ...scoped, consecutiveFailures: { gt: 0 } },
              orderBy: { provider: 'asc' },
              _count: { _all: true },
            }),
            prisma.inboundEvent.groupBy({
              by: ['provider'],
              where: {
                ...scoped,
                status: 'FAILED',
                receivedAt: { gte: daysBefore(generatedAt, 1) },
              },
              orderBy: { provider: 'asc' },
              _count: { _all: true },
            }),
            prisma.inboundEvent.groupBy({
              by: ['provider'],
              where: scoped,
              orderBy: { provider: 'asc' },
              _max: { receivedAt: true },
            }),
          ],
          { isolationLevel: 'RepeatableRead' },
        );
      return {
        generatedAt,
        items: HEALTH_PROVIDERS.map(({ provider, kind }) => {
          const mailboxes =
            kind === 'mailbox'
              ? tally(
                  MAILBOX_STATUSES,
                  mailboxGroups
                    .filter((group) => group.provider === provider)
                    .map((group) => [group.status, group._count._all]),
                )
              : null;
          const sync = syncGroups.find((group) => group.provider === provider);
          const counts = {
            mailboxes,
            syncs: sync?._count._all ?? 0,
            failingSyncs:
              failingGroups.find((group) => group.provider === provider)?._count
                ._all ?? 0,
            failedEventsLast24Hours:
              failedGroups.find((group) => group.provider === provider)?._count
                ._all ?? 0,
            lastEventAt:
              events.find((group) => group.provider === provider)?._max
                .receivedAt ?? null,
          };
          return {
            provider,
            state: integrationHealthState(counts),
            ...counts,
            lastSyncedAt: sync?._max.lastSyncedAt ?? null,
          };
        }),
      };
    },
  };
}
