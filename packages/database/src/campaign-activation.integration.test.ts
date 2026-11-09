import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from './client.js';
import { FIXTURE_USERS, fixtureIds } from './fixtures/fixture-data.js';
import { loadFixtureTenants } from './fixtures/load.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { memberScope, systemScope } from './tenancy/access.js';
import { ActorNotAllowedError } from './tenancy/actors.js';
import { PermissionDeniedError } from './tenancy/authorization.js';
import {
  CampaignNotEditableError,
  CampaignNotReadyError,
  CampaignVersionConflictError,
  type CampaignConfig,
} from './tenancy/campaigns.js';
import { MigratedSchema, testDatabaseUrl } from './testing/migrated-schema.js';

// Campaign readiness and activation (task 06C, docs/decisions.md D-06C-*) on real PostgreSQL,
// with the deterministic fixture tenants: every blocker named, later services failing closed,
// saving never starting a campaign, stale versions conflicting and repeated activation changing
// nothing. Runs only when TEST_DATABASE_URL is set; otherwise it is reported as skipped.
const db = new MigratedSchema('t06c');
const alpha = fixtureIds('alpha');
const NOW = new Date('2026-11-04T09:00:00Z');
const ALL_BUILT = { eligibility: true, drafting: true, sending: true } as const;

describe.runIf(testDatabaseUrl !== undefined)(
  'campaign readiness and activation on PostgreSQL',
  () => {
    let prisma: PrismaClient;

    const admin = () =>
      memberScope(
        prisma,
        { tenantId: alpha.tenant, userId: FIXTURE_USERS.alphaAdmin.id },
        { now: () => NOW },
      );
    const member = () =>
      memberScope(prisma, {
        tenantId: alpha.tenant,
        userId: FIXTURE_USERS.sharedMember.id,
      });

    /** A draft with every setting filled in from alpha's fixture records. */
    async function completeDraft(name: string): Promise<CampaignConfig> {
      const scope = await admin();
      const draft = await scope.campaigns.create({ name });
      return scope.campaigns.update(draft.id, {
        version: 1,
        businessProfile: {
          companyName: 'Alpha Co',
          description: 'Fixture company.',
        },
        offer: { name: 'Audit', description: 'A free audit.' },
        audience: { icpId: alpha.icp, leadListId: alpha.leadList },
        leadLimits: { dailyNewLeads: 20, maxLeads: 200 },
        sender: { emailAccountId: alpha.emailAccount },
        sequence: {
          steps: [
            { delayMinutes: 0, templateId: alpha.templateIntro },
            { delayMinutes: 4320, templateId: alpha.templateFollowUp },
          ],
        },
      });
    }

    const setSending = (enabled: boolean) =>
      prisma.tenantSettings.update({
        where: { tenantId: alpha.tenant },
        data: { outboundSendingEnabled: enabled },
      });

    const blockedKeys = (report: {
      checks: { key: string; passed: boolean }[];
    }) => report.checks.filter((c) => !c.passed).map((c) => c.key);

    beforeAll(async () => {
      await db.create();
      prisma = createPrismaClient({
        databaseUrl: db.databaseUrl,
        schema: db.name,
        maxConnections: 1,
      });
      await loadFixtureTenants(prisma);
    }, 60_000);

    afterAll(async () => {
      await prisma.$disconnect();
      await db.drop();
    });

    it('names every blocker of a new draft, and the later services fail closed', async () => {
      const scope = await admin();
      const draft = await scope.campaigns.create({ name: 'Blank' });
      const report = await scope.campaigns.readiness(draft.id);
      expect(report).toMatchObject({
        campaignId: draft.id,
        version: 1,
        status: 'DRAFT',
        ready: false,
      });
      const reasons = Object.fromEntries(
        report.checks.filter((c) => !c.passed).map((c) => [c.key, c.reasons]),
      );
      expect(reasons).toEqual({
        business_profile: [
          'Add your company name.',
          'Describe what your company does.',
        ],
        offer: ['Name the offer.', 'Describe what the offer includes.'],
        audience: ['Choose an ideal customer profile or a lead list.'],
        eligibility: [
          "Finding leads from an ideal customer profile alone isn't available yet. Choose a lead list.",
        ],
        limits: [
          'Set how many new leads join per day.',
          'Set how many leads join in total.',
        ],
        sender: ['Choose the mailbox the campaign sends from.'],
        sequence: ['Add at least one step.'],
        // The fixture workspace has an active plan with email, but sending is off (default).
        workspace: ['Sending is turned off for this workspace.'],
        eligibility_service: [
          "Checking each lead against the do-not-contact list and email verification isn't available yet.",
        ],
        drafting_service: [
          "Preparing each email from its template isn't available yet.",
        ],
        sending_service: [
          "Sending email through Gmail or Microsoft 365 isn't available yet.",
        ],
      });
      // Schedule (defaults) and approval (alpha's admin can approve) pass.
      expect(report.checks.find((c) => c.key === 'schedule')?.passed).toBe(
        true,
      );
      expect(report.checks.find((c) => c.key === 'approval')?.passed).toBe(
        true,
      );
    });

    it('passes a complete campaign only when the workspace and the later services allow it', async () => {
      const scope = await admin();
      const draft = await completeDraft('Complete');
      // From the fixture records: 2 contacts with email on the list, a healthy mailbox
      // (40 a day), active templates, an approver, an active plan with email.
      expect(blockedKeys(await scope.campaigns.readiness(draft.id))).toEqual([
        'workspace',
        'eligibility_service',
        'drafting_service',
        'sending_service',
      ]);
      await setSending(true);
      try {
        expect(blockedKeys(await scope.campaigns.readiness(draft.id))).toEqual([
          'eligibility_service',
          'drafting_service',
          'sending_service',
        ]);
        const ready = await scope.campaigns.readiness(draft.id, ALL_BUILT);
        expect(ready.ready).toBe(true);
        // A mailbox that can't send that many a day blocks again.
        const tooMany = await scope.campaigns.update(draft.id, {
          version: draft.version,
          leadLimits: { dailyNewLeads: 41, maxLeads: 200 },
        });
        expect(
          (await scope.campaigns.readiness(draft.id, ALL_BUILT)).checks.find(
            (c) => c.key === 'limits',
          )?.reasons,
        ).toEqual([
          'The mailbox sends at most 40 emails a day. Lower the new leads per day to that or fewer.',
        ]);
        // Saving, even a campaign every check passes for, never starts it.
        expect(tooMany.status).toBe('DRAFT');
      } finally {
        await setSending(false);
      }
    });

    it('starts only through activation: stale versions conflict, repeating changes nothing', async () => {
      const scope = await admin();
      const draft = await completeDraft('Launch');
      expect(draft.status).toBe('DRAFT');
      await setSending(true);
      try {
        // A stale version conflicts before anything else is looked at.
        await expect(
          scope.campaigns.activate(
            draft.id,
            { version: draft.version - 1 },
            ALL_BUILT,
          ),
        ).rejects.toThrow(CampaignVersionConflictError);
        // In production the later services don't exist: it fails closed, with the report.
        const refused = await scope.campaigns
          .activate(draft.id, { version: draft.version })
          .catch((e: unknown) => e);
        expect(refused).toBeInstanceOf(CampaignNotReadyError);
        expect(blockedKeys((refused as CampaignNotReadyError).report)).toEqual([
          'eligibility_service',
          'drafting_service',
          'sending_service',
        ]);
        expect((await scope.campaigns.get(draft.id)).status).toBe('DRAFT');

        const started = await scope.campaigns.activate(
          draft.id,
          { version: draft.version },
          ALL_BUILT,
        );
        expect(started).toMatchObject({
          status: 'ACTIVE',
          version: draft.version,
        });
        const row = await prisma.campaign.findUniqueOrThrow({
          where: { tenantId_id: { tenantId: alpha.tenant, id: draft.id } },
          select: { activatedAt: true },
        });
        expect(row.activatedAt).toEqual(NOW);
        // The same request again: the same answer, no second change or audit record.
        const again = await scope.campaigns.activate(
          draft.id,
          { version: draft.version },
          ALL_BUILT,
        );
        expect(again).toEqual(started);
        // Even when the services would now refuse: it is already started from this version.
        expect(
          (await scope.campaigns.activate(draft.id, { version: draft.version }))
            .status,
        ).toBe('ACTIVE');
        expect(
          await prisma.auditRecord.count({
            where: {
              tenantId: alpha.tenant,
              action: 'campaign.activated',
              targetId: draft.id,
            },
          }),
        ).toBe(1);
        await expect(
          scope.campaigns.activate(
            draft.id,
            { version: draft.version - 1 },
            ALL_BUILT,
          ),
        ).rejects.toThrow(CampaignVersionConflictError);
        // Running: no more configuration changes.
        await expect(
          scope.campaigns.update(draft.id, {
            version: draft.version,
            name: 'Renamed',
          }),
        ).rejects.toThrow(CampaignNotEditableError);
        // A paused (or completed, cancelled) campaign isn't started this way.
        await prisma.campaign.update({
          where: { tenantId_id: { tenantId: alpha.tenant, id: draft.id } },
          data: { status: 'PAUSED', pausedAt: NOW },
        });
        await expect(
          scope.campaigns.activate(
            draft.id,
            { version: draft.version },
            ALL_BUILT,
          ),
        ).rejects.toThrow(CampaignNotEditableError);
      } finally {
        await setSending(false);
      }
    });

    it('needs someone who may approve to start a campaign without human approval', async () => {
      await prisma.tenantSettings.update({
        where: { tenantId: alpha.tenant },
        data: { requireSendApproval: false, outboundSendingEnabled: true },
      });
      try {
        const scope = await admin();
        const draft = await completeDraft('Automatic');
        const automatic = await scope.campaigns.update(draft.id, {
          version: draft.version,
          approvalMode: 'AUTOMATIC',
        });
        // A Client Team Member may change campaigns but not approve, so may not start this one.
        const teamMember = await member();
        await expect(
          teamMember.campaigns.activate(
            draft.id,
            { version: automatic.version },
            ALL_BUILT,
          ),
        ).rejects.toThrow(PermissionDeniedError);
        expect(
          (
            await scope.campaigns.activate(
              draft.id,
              { version: automatic.version },
              ALL_BUILT,
            )
          ).status,
        ).toBe('ACTIVE');
      } finally {
        await prisma.tenantSettings.update({
          where: { tenantId: alpha.tenant },
          data: { requireSendApproval: true, outboundSendingEnabled: false },
        });
      }
    });

    it('keeps readiness to those who may see campaigns', async () => {
      const draft = await completeDraft('Permissions');
      const worker = systemScope(prisma, {
        tenantId: alpha.tenant,
        name: 'campaign_test',
      });
      await expect(worker.campaigns.readiness(draft.id)).rejects.toThrow(
        ActorNotAllowedError,
      );
      await expect(
        worker.campaigns.activate(draft.id, { version: draft.version }),
      ).rejects.toThrow(ActorNotAllowedError);
      // A team member sees the same checks.
      expect(
        blockedKeys(await (await member()).campaigns.readiness(draft.id)),
      ).toEqual([
        'workspace',
        'eligibility_service',
        'drafting_service',
        'sending_service',
      ]);
    });
  },
);
