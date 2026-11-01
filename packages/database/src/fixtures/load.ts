import type { PrismaClient } from '../generated/prisma/client.js';
import {
  FIXTURE_PERMISSIONS,
  FIXTURE_PLAN_LIMITS,
  FIXTURE_PLANS,
  FIXTURE_TENANTS,
  FIXTURE_USERS,
} from './fixture-data.js';

export interface FixtureTenantSummary {
  readonly slug: string;
  readonly memberships: number;
  readonly invitations: number;
  readonly organizations: number;
  readonly contacts: number;
  readonly leadListMembers: number;
  readonly sourceRecords: number;
  readonly research: number;
  readonly evidence: number;
  readonly scores: number;
  readonly verifications: number;
  readonly emailAccounts: number;
  readonly templates: number;
  readonly campaigns: number;
  readonly sequences: number;
  readonly sequenceSteps: number;
  readonly campaignLeads: number;
  readonly drafts: number;
  readonly approvals: number;
  readonly outboundIntents: number;
  readonly outboundAttempts: number;
  readonly emailThreads: number;
  readonly inboundMessages: number;
  readonly suppressions: number;
  readonly jobSchedules: number;
  readonly jobRuns: number;
  readonly jobTasks: number;
  readonly workerLeases: number;
  readonly outboxEvents: number;
  readonly inboundEvents: number;
  readonly integrationSyncCursors: number;
  readonly subscriptions: number;
  readonly paymentEvents: number;
  readonly limitOverrides: number;
  readonly usageReservations: number;
  readonly usageLedgerEntries: number;
  readonly branding: number;
  readonly auditRecords: number;
  readonly notifications: number;
}

/**
 * Inserts the two fixture tenants and their data in one transaction. Idempotent: rows that
 * already exist (same primary key or unique key) are left unchanged.
 */
export async function loadFixtureTenants(
  prisma: PrismaClient,
): Promise<FixtureTenantSummary[]> {
  await prisma.$transaction(
    async (tx) => {
      await tx.permission.createMany({
        data: [...FIXTURE_PERMISSIONS],
        skipDuplicates: true,
      });
      await tx.user.createMany({
        data: Object.values(FIXTURE_USERS),
        skipDuplicates: true,
      });
      await tx.billingPlan.createMany({
        data: Object.values(FIXTURE_PLANS),
        skipDuplicates: true,
      });
      await tx.planLimit.createMany({
        data: [...FIXTURE_PLAN_LIMITS],
        skipDuplicates: true,
      });
      for (const f of FIXTURE_TENANTS) {
        const opts = { skipDuplicates: true } as const;
        await tx.tenant.createMany({ data: [f.tenant], ...opts });
        await tx.tenantSettings.createMany({ data: [f.settings], ...opts });
        await tx.role.createMany({ data: f.roles, ...opts });
        await tx.rolePermission.createMany({
          data: f.rolePermissions,
          ...opts,
        });
        await tx.membership.createMany({ data: f.memberships, ...opts });
        await tx.invitation.createMany({ data: f.invitations, ...opts });
        await tx.icp.createMany({ data: f.icps, ...opts });
        await tx.organization.createMany({ data: f.organizations, ...opts });
        await tx.contact.createMany({ data: f.contacts, ...opts });
        await tx.leadList.createMany({ data: f.leadLists, ...opts });
        await tx.leadListMember.createMany({
          data: f.leadListMembers,
          ...opts,
        });
        await tx.import.createMany({ data: f.imports, ...opts });
        await tx.sourceRecord.createMany({ data: f.sourceRecords, ...opts });
        await tx.research.createMany({ data: f.research, ...opts });
        await tx.evidence.createMany({ data: f.evidence, ...opts });
        await tx.score.createMany({ data: f.scores, ...opts });
        await tx.verification.createMany({ data: f.verifications, ...opts });
        // Outreach and background jobs, in foreign-key order.
        await tx.emailAccount.createMany({ data: f.emailAccounts, ...opts });
        await tx.template.createMany({ data: f.templates, ...opts });
        await tx.campaign.createMany({ data: f.campaigns, ...opts });
        await tx.sequence.createMany({ data: f.sequences, ...opts });
        await tx.sequenceStep.createMany({ data: f.sequenceSteps, ...opts });
        await tx.campaignLead.createMany({ data: f.campaignLeads, ...opts });
        await tx.draft.createMany({ data: f.drafts, ...opts });
        await tx.approval.createMany({ data: f.approvals, ...opts });
        await tx.outboundIntent.createMany({
          data: f.outboundIntents,
          ...opts,
        });
        await tx.emailThread.createMany({ data: f.emailThreads, ...opts });
        await tx.outboundAttempt.createMany({
          data: f.outboundAttempts,
          ...opts,
        });
        await tx.inboundMessage.createMany({
          data: f.inboundMessages,
          ...opts,
        });
        await tx.suppression.createMany({ data: f.suppressions, ...opts });
        await tx.jobSchedule.createMany({ data: f.jobSchedules, ...opts });
        await tx.jobRun.createMany({ data: f.jobRuns, ...opts });
        await tx.jobTask.createMany({ data: f.jobTasks, ...opts });
        await tx.workerLease.createMany({ data: f.workerLeases, ...opts });
        await tx.outboxEvent.createMany({ data: f.outboxEvents, ...opts });
        await tx.inboundEvent.createMany({ data: f.inboundEvents, ...opts });
        await tx.integrationSyncCursor.createMany({
          data: f.integrationSyncCursors,
          ...opts,
        });
        // Billing, usage, branding, audit and notifications.
        await tx.subscription.createMany({ data: f.subscriptions, ...opts });
        await tx.paymentEvent.createMany({ data: f.paymentEvents, ...opts });
        await tx.tenantLimitOverride.createMany({
          data: f.limitOverrides,
          ...opts,
        });
        await tx.usageReservation.createMany({
          data: f.usageReservations,
          ...opts,
        });
        await tx.usageLedgerEntry.createMany({
          data: f.usageLedgerEntries,
          ...opts,
        });
        await tx.tenantBranding.createMany({ data: f.branding, ...opts });
        await tx.auditRecord.createMany({ data: f.auditRecords, ...opts });
        await tx.notification.createMany({ data: f.notifications, ...opts });
      }
    },
    { timeout: 30_000 },
  );
  return summarizeFixtureTenants(prisma);
}

/**
 * Deletes ONLY the two fixture tenants (all their rows cascade), the fixture users and the
 * fixture plans, identified by their fixed ids. Other tenants, users and plans are never
 * touched. Platform audit records are kept: they outlive tenants by design.
 */
export async function deleteFixtureTenants(
  prisma: PrismaClient,
): Promise<void> {
  await prisma.$transaction([
    prisma.tenant.deleteMany({
      where: { id: { in: FIXTURE_TENANTS.map((f) => f.tenant.id) } },
    }),
    prisma.user.deleteMany({
      where: { id: { in: Object.values(FIXTURE_USERS).map((u) => u.id) } },
    }),
    prisma.billingPlan.deleteMany({
      where: { id: { in: Object.values(FIXTURE_PLANS).map((p) => p.id) } },
    }),
  ]);
}

/** Row counts per fixture tenant, every query scoped by tenant_id. */
export async function summarizeFixtureTenants(
  prisma: PrismaClient,
): Promise<FixtureTenantSummary[]> {
  const summaries: FixtureTenantSummary[] = [];
  for (const f of FIXTURE_TENANTS) {
    const where = { tenantId: f.tenant.id };
    summaries.push({
      slug: f.tenant.slug,
      memberships: await prisma.membership.count({ where }),
      invitations: await prisma.invitation.count({ where }),
      organizations: await prisma.organization.count({ where }),
      contacts: await prisma.contact.count({ where }),
      leadListMembers: await prisma.leadListMember.count({ where }),
      sourceRecords: await prisma.sourceRecord.count({ where }),
      research: await prisma.research.count({ where }),
      evidence: await prisma.evidence.count({ where }),
      scores: await prisma.score.count({ where }),
      verifications: await prisma.verification.count({ where }),
      emailAccounts: await prisma.emailAccount.count({ where }),
      templates: await prisma.template.count({ where }),
      campaigns: await prisma.campaign.count({ where }),
      sequences: await prisma.sequence.count({ where }),
      sequenceSteps: await prisma.sequenceStep.count({ where }),
      campaignLeads: await prisma.campaignLead.count({ where }),
      drafts: await prisma.draft.count({ where }),
      approvals: await prisma.approval.count({ where }),
      outboundIntents: await prisma.outboundIntent.count({ where }),
      outboundAttempts: await prisma.outboundAttempt.count({ where }),
      emailThreads: await prisma.emailThread.count({ where }),
      inboundMessages: await prisma.inboundMessage.count({ where }),
      suppressions: await prisma.suppression.count({ where }),
      jobSchedules: await prisma.jobSchedule.count({ where }),
      jobRuns: await prisma.jobRun.count({ where }),
      jobTasks: await prisma.jobTask.count({ where }),
      workerLeases: await prisma.workerLease.count({ where }),
      outboxEvents: await prisma.outboxEvent.count({ where }),
      inboundEvents: await prisma.inboundEvent.count({ where }),
      integrationSyncCursors: await prisma.integrationSyncCursor.count({
        where,
      }),
      subscriptions: await prisma.subscription.count({ where }),
      paymentEvents: await prisma.paymentEvent.count({ where }),
      limitOverrides: await prisma.tenantLimitOverride.count({ where }),
      usageReservations: await prisma.usageReservation.count({ where }),
      usageLedgerEntries: await prisma.usageLedgerEntry.count({ where }),
      branding: await prisma.tenantBranding.count({ where }),
      auditRecords: await prisma.auditRecord.count({ where }),
      notifications: await prisma.notification.count({ where }),
    });
  }
  return summaries;
}
