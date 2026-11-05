import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { createPrismaClient } from './client.js';
import {
  createFixtureFactory,
  type FixtureFactory,
} from './fixtures/factories.js';
import { FIXTURE_USERS, fixtureIds } from './fixtures/fixture-data.js';
import { loadFixtureTenants } from './fixtures/load.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { memberScope, systemScope } from './tenancy/access.js';
import { ActorNotAllowedError } from './tenancy/actors.js';
import {
  PermissionDeniedError,
  RecordNotFoundError,
} from './tenancy/authorization.js';
import {
  CampaignConfigurationError,
  CampaignNameTakenError,
  CampaignNotEditableError,
  CampaignVersionConflictError,
} from './tenancy/campaigns.js';
import { MigratedSchema, testDatabaseUrl } from './testing/migrated-schema.js';

// Campaign configuration (task 06A, docs/decisions.md D-06A-*) on real PostgreSQL: inactive
// drafts with human approval, incremental saves with a version check, references only to the
// workspace's own records, and duplication without enrollments, sends or approvals. The HTTP
// routes are tested in apps/api. Runs only when TEST_DATABASE_URL is set; otherwise it is
// reported as skipped, never passed.
const db = new MigratedSchema('t06a');
const alpha = fixtureIds('alpha');
const beta = fixtureIds('beta');
const NOW = new Date('2026-11-02T09:00:00Z');

describe.runIf(testDatabaseUrl !== undefined)(
  'campaign configuration on PostgreSQL',
  () => {
    let prisma: PrismaClient;
    let factory: FixtureFactory;

    const adminOf = (client: PrismaClient = prisma) =>
      memberScope(
        client,
        { tenantId: alpha.tenant, userId: FIXTURE_USERS.alphaAdmin.id },
        { now: () => NOW },
      );
    const memberOf = () =>
      memberScope(prisma, {
        tenantId: alpha.tenant,
        userId: FIXTURE_USERS.sharedMember.id,
      });

    beforeAll(async () => {
      await db.create();
      prisma = createPrismaClient({
        databaseUrl: db.databaseUrl,
        schema: db.name,
        maxConnections: 1,
      });
      await loadFixtureTenants(prisma);
      factory = createFixtureFactory(prisma);
    }, 60_000);

    afterAll(async () => {
      await prisma.$disconnect();
      await db.drop();
    });

    it('creates an inactive draft with human approval and the workspace time zone', async () => {
      const admin = await adminOf();
      const created = await admin.campaigns.create({ name: 'Spring outreach' });
      expect(created).toMatchObject({
        name: 'Spring outreach',
        description: null,
        status: 'DRAFT',
        version: 1,
        approvalMode: 'HUMAN',
        timezone: 'UTC',
        businessProfile: null,
        offer: null,
        audience: { icpId: null, leadListId: null, filters: {} },
        exclusions: {
          domains: [],
          emails: [],
          leadListIds: [],
          skipContactsInOtherCampaigns: true,
        },
        leadLimits: { dailyNewLeads: null, maxLeads: null },
        sender: { emailAccountId: null },
        sequence: { steps: [] },
        readiness: {
          complete: false,
          missing: [
            'businessProfile',
            'offer',
            'audience',
            'leadLimits',
            'sender',
            'sequence',
          ],
        },
      });
      const betaAdmin = await memberScope(prisma, {
        tenantId: beta.tenant,
        userId: FIXTURE_USERS.betaAdmin.id,
      });
      // Beta's workspace time zone, and the same name is free in another workspace.
      expect(
        (await betaAdmin.campaigns.create({ name: 'Spring outreach' }))
          .timezone,
      ).toBe('Europe/London');
      await expect(
        admin.campaigns.create({ name: 'Spring outreach' }),
      ).rejects.toThrow(CampaignNameTakenError);
      const audit = await prisma.auditRecord.count({
        where: {
          tenantId: alpha.tenant,
          action: 'campaign.created',
          targetId: created.id,
        },
      });
      expect(audit).toBe(1);
    });

    it('saves sections incrementally, and the draft survives a reload', async () => {
      const admin = await adminOf();
      const draft = await admin.campaigns.create({ name: 'Incremental' });
      const first = await admin.campaigns.update(draft.id, {
        version: 1,
        businessProfile: {
          companyName: '  Example Co ',
          website: 'https://example.com',
          description: 'We build examples.',
        },
      });
      expect(first.version).toBe(2);
      expect(first.businessProfile?.companyName).toBe('Example Co');
      const second = await admin.campaigns.update(draft.id, {
        version: 2,
        offer: { name: 'Audit', description: 'A free audit.' },
        timezone: 'europe/berlin',
        schedule: {
          weekdays: [5, 1, 3],
          windowStartMinute: 480,
          windowEndMinute: 960,
        },
        exclusions: {
          domains: ['WWW.Example.ORG', 'example.org', 'sample.net'],
          emails: ['Someone@Example.NET'],
        },
        leadLimits: { dailyNewLeads: 20, maxLeads: 400 },
      });
      expect(second).toMatchObject({
        version: 3,
        // The first save's section is still there.
        businessProfile: { companyName: 'Example Co' },
        offer: { name: 'Audit' },
        timezone: 'Europe/Berlin',
        schedule: { weekdays: [1, 3, 5] },
        exclusions: {
          domains: ['example.org', 'sample.net'],
          emails: ['someone@example.net'],
          leadListIds: [],
          skipContactsInOtherCampaigns: true,
        },
        leadLimits: { dailyNewLeads: 20, maxLeads: 400 },
      });
      expect(second.readiness.missing).toEqual([
        'audience',
        'sender',
        'sequence',
      ]);

      // A reload: another connection, a new scope, the same draft.
      const other = createPrismaClient({
        databaseUrl: db.databaseUrl,
        schema: db.name,
        maxConnections: 1,
      });
      try {
        const reloaded = await (await adminOf(other)).campaigns.get(draft.id);
        expect(reloaded).toEqual(second);
      } finally {
        await other.$disconnect();
      }
      const audit = await prisma.auditRecord.findMany({
        where: {
          tenantId: alpha.tenant,
          action: 'campaign.updated',
          targetId: draft.id,
        },
        orderBy: { id: 'asc' },
        select: { metadata: true },
      });
      expect(audit.map((record) => record.metadata)).toEqual([
        { sections: ['businessProfile'], version: 2 },
        {
          sections: [
            'offer',
            'exclusions',
            'leadLimits',
            'timezone',
            'schedule',
          ],
          version: 3,
        },
      ]);
    });

    it('refuses a save from a stale version and changes nothing', async () => {
      const admin = await adminOf();
      const draft = await admin.campaigns.create({ name: 'Two tabs' });
      // Two editors loaded version 1; the first save wins.
      await admin.campaigns.update(draft.id, {
        version: 1,
        name: 'Two tabs (first)',
      });
      await expect(
        admin.campaigns.update(draft.id, {
          version: 1,
          name: 'Two tabs (second)',
        }),
      ).rejects.toThrow(CampaignVersionConflictError);
      const stored = await admin.campaigns.get(draft.id);
      expect(stored).toMatchObject({ version: 2, name: 'Two tabs (first)' });
      // A version from the future is just as stale.
      await expect(
        admin.campaigns.update(draft.id, { version: 9, name: 'Ahead' }),
      ).rejects.toThrow(CampaignVersionConflictError);
    });

    it("rejects another workspace's records, even while the draft is incomplete", async () => {
      const admin = await adminOf();
      const draft = await admin.campaigns.create({ name: 'References' });
      const attempt = admin.campaigns.update(draft.id, {
        version: 1,
        audience: { icpId: beta.icp, leadListId: beta.leadList },
        exclusions: { leadListIds: [alpha.leadList, beta.leadList] },
        sender: { emailAccountId: beta.emailAccount },
        sequence: {
          steps: [
            { delayMinutes: 0, templateId: alpha.templateIntro },
            { delayMinutes: 2880, templateId: beta.templateFollowUp },
          ],
        },
      });
      await expect(attempt).rejects.toThrow(CampaignConfigurationError);
      const error = (await attempt.catch((e: unknown) => e)) as
        CampaignConfigurationError | undefined;
      expect(error?.issues).toEqual([
        { path: 'audience.icpId', message: 'Not found in this workspace.' },
        {
          path: 'audience.leadListId',
          message: 'Not found in this workspace.',
        },
        {
          path: 'exclusions.leadListIds.1',
          message: 'Not found in this workspace.',
        },
        {
          path: 'sender.emailAccountId',
          message: 'Not found in this workspace.',
        },
        {
          path: 'sequence.steps.1.templateId',
          message: 'Not found in this workspace.',
        },
      ]);
      // An id that exists nowhere reads exactly like another workspace's.
      const unknown = await admin.campaigns
        .update(draft.id, {
          version: 1,
          sender: { emailAccountId: randomUUID() },
        })
        .catch((e: unknown) => e);
      expect((unknown as CampaignConfigurationError).issues).toEqual([
        {
          path: 'sender.emailAccountId',
          message: 'Not found in this workspace.',
        },
      ]);
      // Nothing was saved.
      expect(await admin.campaigns.get(draft.id)).toMatchObject({
        version: 1,
        audience: { icpId: null, leadListId: null },
        sequence: { steps: [] },
      });

      // The workspace's own records are accepted.
      const saved = await admin.campaigns.update(draft.id, {
        version: 1,
        audience: { icpId: alpha.icp, leadListId: alpha.leadList },
        sender: { emailAccountId: alpha.emailAccount },
        sequence: {
          steps: [
            { delayMinutes: 0, templateId: alpha.templateIntro },
            { delayMinutes: 2880, templateId: alpha.templateFollowUp },
          ],
        },
      });
      expect(saved.sequence.steps).toEqual([
        expect.objectContaining({
          position: 1,
          delayMinutes: 0,
          templateId: alpha.templateIntro,
        }),
        expect.objectContaining({
          position: 2,
          delayMinutes: 2880,
          templateId: alpha.templateFollowUp,
        }),
      ]);
      expect(saved.readiness.missing).toEqual([
        'businessProfile',
        'offer',
        'leadLimits',
      ]);
      // A shorter sequence replaces the steps.
      const shorter = await admin.campaigns.update(draft.id, {
        version: 2,
        sequence: { steps: [{ delayMinutes: 60 }] },
      });
      expect(shorter.sequence.steps).toEqual([
        expect.objectContaining({
          position: 1,
          delayMinutes: 60,
          templateId: null,
        }),
      ]);
      // Another workspace's campaign is not found at all.
      await expect(admin.campaigns.get(beta.campaign)).rejects.toThrow(
        RecordNotFoundError,
      );
      await expect(
        admin.campaigns.update(beta.campaign, { version: 1, name: 'Mine' }),
      ).rejects.toThrow(RecordNotFoundError);
      await expect(admin.campaigns.get('not-a-campaign')).rejects.toThrow(
        RecordNotFoundError,
      );
    });

    it('validates bounds in the repository too', async () => {
      const admin = await adminOf();
      const draft = await admin.campaigns.create({ name: 'Bounds' });
      for (const change of [
        { leadLimits: { dailyNewLeads: 501 } },
        { leadLimits: { dailyNewLeads: 50, maxLeads: 10 } },
        {
          schedule: {
            weekdays: [1],
            windowStartMinute: 600,
            windowEndMinute: 600,
          },
        },
        { sequence: { steps: [{ delayMinutes: 525_601 }] } },
        {
          sequence: {
            steps: Array.from({ length: 11 }, () => ({ delayMinutes: 0 })),
          },
        },
        { businessProfile: { website: 'javascript:alert(1)' } },
        { timezone: 'Mars/Olympus' },
      ]) {
        await expect(
          admin.campaigns.update(draft.id, { version: 1, ...change }),
        ).rejects.toThrow(ZodError);
      }
      expect((await admin.campaigns.get(draft.id)).version).toBe(1);
    });

    it('changes drafts only, and keeps human approval unless allowed', async () => {
      const admin = await adminOf();
      // The fixture campaign is running.
      await expect(
        admin.campaigns.update(alpha.campaign, { version: 1, name: 'Renamed' }),
      ).rejects.toThrow(CampaignNotEditableError);

      const draft = await admin.campaigns.create({ name: 'Approval' });
      // A member without drafts.approve may not waive approval.
      const member = await memberOf();
      await expect(
        member.campaigns.update(draft.id, {
          version: 1,
          approvalMode: 'AUTOMATIC',
        }),
      ).rejects.toThrow(PermissionDeniedError);
      // The workspace requires approval (its default), so nobody may waive it.
      const refused = await admin.campaigns
        .update(draft.id, { version: 1, approvalMode: 'AUTOMATIC' })
        .catch((e: unknown) => e);
      expect(refused).toBeInstanceOf(CampaignConfigurationError);
      expect((refused as CampaignConfigurationError).issues[0]?.path).toBe(
        'approvalMode',
      );
      await prisma.tenantSettings.update({
        where: { tenantId: alpha.tenant },
        data: { requireSendApproval: false },
      });
      try {
        const automatic = await admin.campaigns.update(draft.id, {
          version: 1,
          approvalMode: 'AUTOMATIC',
        });
        expect(automatic.approvalMode).toBe('AUTOMATIC');
        // A member may still edit other sections of the draft.
        const edited = await member.campaigns.update(draft.id, {
          version: 2,
          description: 'Edited by a member',
        });
        expect(edited.approvalMode).toBe('AUTOMATIC');
      } finally {
        await prisma.tenantSettings.update({
          where: { tenantId: alpha.tenant },
          data: { requireSendApproval: true },
        });
      }
    });

    it('duplicates the configuration, never enrollments, pending sends or approvals', async () => {
      const admin = await adminOf();
      // The running fixture campaign has leads, drafts, an approval, sends and a schedule.
      // Make its approval automatic to show that a copy starts over with human approval.
      await prisma.campaign.update({
        where: { tenantId_id: { tenantId: alpha.tenant, id: alpha.campaign } },
        data: { approvalMode: 'AUTOMATIC' },
      });
      const counts = async (campaignId: string) => ({
        leads: await prisma.campaignLead.count({ where: { campaignId } }),
        drafts: await prisma.draft.count({
          where: { campaignLead: { campaignId } },
        }),
        approvals: await prisma.approval.count({
          where: { draft: { campaignLead: { campaignId } } },
        }),
        intents: await prisma.outboundIntent.count({
          where: { campaignLead: { campaignId } },
        }),
        schedules: await prisma.jobSchedule.count({ where: { campaignId } }),
      });
      const before = await counts(alpha.campaign);
      expect(before.leads).toBeGreaterThan(0);
      expect(before.drafts).toBeGreaterThan(0);
      expect(before.approvals).toBeGreaterThan(0);
      expect(before.intents).toBeGreaterThan(0);
      expect(before.schedules).toBeGreaterThan(0);

      const source = await admin.campaigns.get(alpha.campaign);
      const copy = await admin.campaigns.duplicate(alpha.campaign, {});
      expect(copy).toMatchObject({
        name: 'Q4 outreach (copy)',
        description: source.description,
        status: 'DRAFT',
        version: 1,
        approvalMode: 'HUMAN',
        audience: source.audience,
        sender: source.sender,
        timezone: source.timezone,
        schedule: source.schedule,
      });
      expect(copy.id).not.toBe(source.id);
      // The sequence and its steps, as new rows with the same settings.
      expect(
        copy.sequence.steps.map(({ position, delayMinutes, templateId }) => ({
          position,
          delayMinutes,
          templateId,
        })),
      ).toEqual(
        source.sequence.steps.map(({ position, delayMinutes, templateId }) => ({
          position,
          delayMinutes,
          templateId,
        })),
      );
      expect(copy.sequence.steps.map((s) => s.id)).not.toEqual(
        source.sequence.steps.map((s) => s.id),
      );
      expect(await counts(copy.id)).toEqual({
        leads: 0,
        drafts: 0,
        approvals: 0,
        intents: 0,
        schedules: 0,
      });
      const row = await prisma.campaign.findUniqueOrThrow({
        where: { tenantId_id: { tenantId: alpha.tenant, id: copy.id } },
      });
      expect([row.activatedAt, row.pausedAt, row.completedAt]).toEqual([
        null,
        null,
        null,
      ]);
      // The source is untouched.
      expect(await counts(alpha.campaign)).toEqual(before);
      // Names stay unique; an explicit one may be given.
      expect((await admin.campaigns.duplicate(alpha.campaign, {})).name).toBe(
        'Q4 outreach (copy 2)',
      );
      expect(
        (
          await admin.campaigns.duplicate(alpha.campaign, {
            name: 'Q1 restart',
          })
        ).name,
      ).toBe('Q1 restart');
      await expect(
        admin.campaigns.duplicate(alpha.campaign, { name: 'Q1 restart' }),
      ).rejects.toThrow(CampaignNameTakenError);
      // The copy is a draft that can be edited at once.
      expect(
        (await admin.campaigns.update(copy.id, { version: 1, name: 'Q1 run' }))
          .version,
      ).toBe(2);
      // Another workspace's campaign can't be copied.
      await expect(
        admin.campaigns.duplicate(beta.campaign, {}),
      ).rejects.toThrow(RecordNotFoundError);
      const audit = await prisma.auditRecord.findFirst({
        where: {
          tenantId: alpha.tenant,
          action: 'campaign.duplicated',
          targetId: copy.id,
        },
        select: { metadata: true },
      });
      expect(audit?.metadata).toEqual({ sourceCampaignId: alpha.campaign });
    });

    it('lists only the workspace’s campaigns, to those allowed', async () => {
      const admin = await adminOf();
      const page = await admin.campaigns.list({ limit: 100 });
      expect(page.items.length).toBeGreaterThan(1);
      const ids = new Set(page.items.map((item) => item.id));
      expect(ids.has(alpha.campaign)).toBe(true);
      expect(ids.has(beta.campaign)).toBe(false);
      expect(page.items[0]).toEqual({
        id: expect.any(String) as string,
        name: expect.any(String) as string,
        status: expect.any(String) as string,
        version: expect.any(Number) as number,
        approvalMode: expect.any(String) as string,
        readiness: expect.anything() as object,
        updatedAt: expect.any(Date) as Date,
      });

      // A role without campaign permissions, and a worker, are refused.
      const nobody = await factory.user();
      const role = await prisma.role.create({
        data: { tenantId: alpha.tenant, key: 'viewer', name: 'Viewer' },
      });
      await factory.membership({
        tenantId: alpha.tenant,
        userId: nobody.id,
        roleId: role.id,
      });
      const viewer = await memberScope(prisma, {
        tenantId: alpha.tenant,
        userId: nobody.id,
      });
      await expect(viewer.campaigns.list({})).rejects.toThrow(
        PermissionDeniedError,
      );
      await expect(viewer.campaigns.create({ name: 'Nope' })).rejects.toThrow(
        PermissionDeniedError,
      );
      const worker = systemScope(prisma, {
        tenantId: alpha.tenant,
        name: 'campaign_test',
      });
      await expect(
        worker.campaigns.duplicate(alpha.campaign, {}),
      ).rejects.toThrow(ActorNotAllowedError);
    });

    it('offers only the usable records of the workspace as choices (task 06B)', async () => {
      const admin = await adminOf();
      // An archived lead list and a disconnected mailbox are never offered.
      await prisma.leadList.create({
        data: { tenantId: alpha.tenant, name: 'Old list', status: 'ARCHIVED' },
      });
      await prisma.emailAccount.create({
        data: {
          tenantId: alpha.tenant,
          provider: 'GMAIL',
          email: 'gone@fixture-alpha.test',
          normalizedEmail: 'gone@fixture-alpha.test',
          status: 'DISCONNECTED',
        },
      });
      const options = await admin.campaigns.options();
      expect(options.icps.map((icp) => icp.id)).toEqual([alpha.icp]);
      expect(options.leadLists.map((list) => list.id)).toEqual([
        alpha.leadList,
      ]);
      expect(options.mailboxes).toEqual([
        expect.objectContaining({ id: alpha.emailAccount, status: 'ACTIVE' }),
      ]);
      expect(options.templates.map((t) => t.id).sort()).toEqual(
        [alpha.templateIntro, alpha.templateFollowUp].sort(),
      );
      // Nothing of another workspace.
      for (const id of [beta.icp, beta.leadList, beta.emailAccount]) {
        expect(JSON.stringify(options)).not.toContain(id);
      }
      const worker = systemScope(prisma, {
        tenantId: alpha.tenant,
        name: 'campaign_test',
      });
      await expect(worker.campaigns.options()).rejects.toThrow(
        ActorNotAllowedError,
      );
    });
  },
);
