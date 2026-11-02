import { createHash, randomUUID } from 'node:crypto';
import { SYSTEM_ROLES } from '@lead-fennec-ai/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { createPrismaClient } from './client.js';
import {
  createFixtureFactory,
  type FixtureFactory,
} from './fixtures/factories.js';
import type { PrismaClient } from './generated/prisma/client.js';
import {
  memberScope,
  platformAdminScope,
  systemScope,
} from './tenancy/access.js';
import { ActorNotAllowedError } from './tenancy/actors.js';
import { PermissionDeniedError } from './tenancy/authorization.js';
import { MigratedSchema, testDatabaseUrl } from './testing/migrated-schema.js';

// Dashboard aggregates (task 05C, docs/decisions.md D-05C-02) on real PostgreSQL: counts of one
// workspace only, the section permission on each method, actor names in the activity feed and
// the health of integrations. The HTTP routes are tested in apps/api. Runs only when
// TEST_DATABASE_URL is set; otherwise it is reported as skipped, never passed.
const db = new MigratedSchema('t05c');
const NOW = new Date('2026-11-02T09:00:00Z');
const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * 86_400_000 - 60_000);
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const REASON = 'Support request FIX-0505: dashboard check';

describe.runIf(testDatabaseUrl !== undefined)(
  'dashboard aggregates on PostgreSQL',
  () => {
    let prisma: PrismaClient;
    let factory: FixtureFactory;
    // `mine` gets data in every table; `other` gets the same kinds of rows, which must never
    // show up in `mine`'s counts.
    let mine: Awaited<ReturnType<FixtureFactory['workspace']>>;
    let other: Awaited<ReturnType<FixtureFactory['workspace']>>;

    const scopeOf = (
      workspace: Awaited<ReturnType<FixtureFactory['workspace']>>,
    ) =>
      memberScope(
        prisma,
        { tenantId: workspace.tenant.id, userId: workspace.admin.id },
        { now: () => NOW },
      );

    /** Contacts, companies, campaigns and their leads in `tenantId`. */
    async function seedLeadsAndCampaigns(tenantId: string, scale: number) {
      for (let i = 0; i < 2 * scale; i += 1) {
        await prisma.organization.create({
          data: { tenantId, name: `Company ${String(i)}` },
        });
      }
      const recent = await factory.contact({
        tenantId,
        createdAt: daysAgo(3),
      });
      const older = await factory.contact({
        tenantId,
        createdAt: daysAgo(45),
      });
      await prisma.contact.create({
        data: { tenantId, firstName: 'No', lastName: 'Email' },
      });
      await factory.contact({
        tenantId,
        status: 'ARCHIVED',
        createdAt: daysAgo(1),
      });
      const extra = [];
      for (let i = 1; i < scale; i += 1) {
        extra.push(await factory.contact({ tenantId, createdAt: daysAgo(2) }));
      }
      const active = await prisma.campaign.create({
        data: {
          tenantId,
          name: 'Running',
          status: 'ACTIVE',
          activatedAt: daysAgo(10),
        },
      });
      await prisma.campaign.create({ data: { tenantId, name: 'Draft' } });
      await prisma.campaign.create({
        data: {
          tenantId,
          name: 'Paused',
          status: 'PAUSED',
          activatedAt: daysAgo(10),
          pausedAt: daysAgo(1),
        },
      });
      const sequence = await prisma.sequence.create({
        data: { tenantId, campaignId: active.id, name: 'Main' },
      });
      const lead = (contactId: string, status: 'PENDING' | 'ACTIVE') =>
        prisma.campaignLead.create({
          data: {
            tenantId,
            campaignId: active.id,
            sequenceId: sequence.id,
            contactId,
            status,
            timezone: 'UTC',
          },
        });
      await lead(recent.id, 'ACTIVE');
      await lead(older.id, 'PENDING');
      for (const contact of extra) {
        await lead(contact.id, 'ACTIVE');
      }
    }

    beforeAll(async () => {
      await db.create();
      prisma = createPrismaClient({
        databaseUrl: db.databaseUrl,
        schema: db.name,
        maxConnections: 1,
      });
      factory = createFixtureFactory(prisma);
      mine = await factory.workspace();
      other = await factory.workspace();
      await seedLeadsAndCampaigns(mine.tenant.id, 1);
      await seedLeadsAndCampaigns(other.tenant.id, 3);
    }, 60_000);

    afterAll(async () => {
      await prisma.$disconnect();
      await db.drop();
    });

    it("counts the workspace's own contacts and companies", async () => {
      const scope = await scopeOf(mine);
      expect(await scope.dashboard.leadSummary()).toEqual({
        generatedAt: NOW,
        // Recent, older and the one without email; not the archived one.
        contacts: 3,
        companies: 2,
        contactsWithEmail: 2,
        contactsAddedLast30Days: 2,
      });
      const theirs = await (await scopeOf(other)).dashboard.leadSummary();
      expect(theirs.contacts).toBe(5);
      expect(theirs.companies).toBe(6);
    });

    it('counts campaigns and their leads by status', async () => {
      const scope = await scopeOf(mine);
      expect(await scope.dashboard.campaignSummary()).toEqual({
        generatedAt: NOW,
        campaigns: 3,
        activeCampaigns: 1,
        leadsInProgress: 2,
        campaignsByStatus: {
          DRAFT: 1,
          ACTIVE: 1,
          PAUSED: 1,
          COMPLETED: 0,
          CANCELLED: 0,
        },
        leadsByStatus: { PENDING: 1, ACTIVE: 1, COMPLETED: 0, STOPPED: 0 },
      });
      const theirs = await (await scopeOf(other)).dashboard.campaignSummary();
      expect(theirs.leadsInProgress).toBe(4);
    });

    it('asks for the permission of the section that owns each aggregate', async () => {
      const user = await factory.user();
      await factory.membership({
        tenantId: mine.tenant.id,
        userId: user.id,
        roleId: mine.memberRole.id,
      });
      // The factory's member role grants nothing.
      const none = await memberScope(prisma, {
        tenantId: mine.tenant.id,
        userId: user.id,
      });
      await expect(none.dashboard.leadSummary()).rejects.toThrow(
        PermissionDeniedError,
      );
      await expect(none.dashboard.campaignSummary()).rejects.toThrow(
        PermissionDeniedError,
      );
      await expect(none.dashboard.activity(5)).rejects.toThrow(
        PermissionDeniedError,
      );
      await expect(none.dashboard.integrationHealth()).rejects.toThrow(
        PermissionDeniedError,
      );

      // The system Client Team Member grants contacts and campaigns, not the audit log or
      // integrations.
      for (const key of SYSTEM_ROLES.client_member.permissions) {
        await prisma.rolePermission.create({
          data: {
            tenantId: mine.tenant.id,
            roleId: mine.memberRole.id,
            permissionKey: key,
          },
        });
      }
      const member = await memberScope(prisma, {
        tenantId: mine.tenant.id,
        userId: user.id,
      });
      await expect(member.dashboard.leadSummary()).resolves.toMatchObject({
        contacts: 3,
      });
      await expect(member.dashboard.campaignSummary()).resolves.toMatchObject({
        campaigns: 3,
      });
      await expect(member.dashboard.activity(5)).rejects.toThrow(
        PermissionDeniedError,
      );
      await expect(member.dashboard.integrationHealth()).rejects.toThrow(
        PermissionDeniedError,
      );

      // Workers don't read through these repositories.
      const worker = systemScope(prisma, {
        tenantId: mine.tenant.id,
        name: 'dashboard_test',
      });
      await expect(worker.dashboard.leadSummary()).rejects.toThrow(
        ActorNotAllowedError,
      );
    });

    it('lists recent activity newest first, naming only current members', async () => {
      const tenantId = mine.tenant.id;
      const named = await factory.user({ displayName: null });
      const namedMembership = await factory.membership({
        tenantId,
        userId: named.id,
        roleId: mine.adminRole.id,
      });
      const record = (
        minutesAgo: number,
        fields: {
          actorType: 'MEMBER' | 'PLATFORM_ADMIN' | 'SYSTEM';
          actorUserId?: string;
          actorMembershipId?: string;
          actorName?: string;
          action: string;
          targetType?: string;
          targetId?: string;
          reason?: string;
        },
      ) =>
        prisma.auditRecord.create({
          data: {
            tenantId,
            occurredAt: new Date(NOW.getTime() - minutesAgo * 60_000),
            ...fields,
          },
        });
      // Created oldest first, so the ids (UUIDv7) sort the same way as the times.
      await record(40 * 24 * 60, {
        actorType: 'SYSTEM',
        actorName: 'billing_sync',
        action: 'subscription.synced',
      });
      await record(5 * 24 * 60, {
        actorType: 'MEMBER',
        // A membership of another workspace (as if this one's had been deleted): even if the
        // id were in a record, its member is not named here.
        actorUserId: other.admin.id,
        actorMembershipId: other.adminMembership.id,
        action: 'invitation.created',
        targetType: 'invitation',
        targetId: randomUUID(),
      });
      await record(60, {
        actorType: 'PLATFORM_ADMIN',
        actorUserId: randomUUID(),
        action: 'platform_admin.access_opened',
        reason: REASON,
      });
      await record(5, {
        actorType: 'MEMBER',
        actorUserId: named.id,
        actorMembershipId: namedMembership.id,
        action: 'membership.role_changed',
        targetType: 'membership',
        targetId: randomUUID(),
      });
      await record(1, {
        actorType: 'MEMBER',
        actorUserId: mine.admin.id,
        actorMembershipId: mine.adminMembership.id,
        action: 'invitation.revoked',
      });
      // Another workspace's records never appear.
      await prisma.auditRecord.create({
        data: {
          tenantId: other.tenant.id,
          actorType: 'MEMBER',
          actorUserId: other.admin.id,
          actorMembershipId: other.adminMembership.id,
          action: 'invitation.created',
          occurredAt: NOW,
        },
      });

      const scope = await scopeOf(mine);
      const activity = await scope.dashboard.activity(4);
      expect(activity.generatedAt).toEqual(NOW);
      expect(activity.counts).toEqual({
        last24Hours: 3,
        last7Days: 4,
        last30Days: 4,
      });
      expect(activity.items).toEqual([
        expect.objectContaining({
          action: 'invitation.revoked',
          actor: { kind: 'member', name: 'Factory User' },
          targetType: null,
        }),
        expect.objectContaining({
          action: 'membership.role_changed',
          // No display name: the member's email address.
          actor: { kind: 'member', name: named.email },
          targetType: 'membership',
        }),
        expect.objectContaining({
          action: 'platform_admin.access_opened',
          actor: { kind: 'platform_admin', name: null },
          reason: REASON,
        }),
        expect.objectContaining({
          action: 'invitation.created',
          actor: { kind: 'former_member', name: null },
        }),
      ]);
      // Ids of the records changed are never part of an item.
      expect(Object.keys(activity.items[0] ?? {}).sort()).toEqual(
        ['action', 'actor', 'id', 'occurredAt', 'reason', 'targetType'].sort(),
      );
      const all = await scope.dashboard.activity(25);
      expect(all.items.at(-1)).toMatchObject({
        actor: { kind: 'system', name: 'billing_sync' },
      });
      await expect(scope.dashboard.activity(0)).rejects.toThrow(ZodError);
      await expect(scope.dashboard.activity(26)).rejects.toThrow(ZodError);
    });

    it('reports the health of each integration from its own rows', async () => {
      const tenantId = mine.tenant.id;
      const mailbox = (
        email: string,
        provider: 'GMAIL' | 'MICROSOFT_GRAPH',
        status: 'ACTIVE' | 'PENDING' | 'ERROR' | 'DISCONNECTED',
      ) =>
        prisma.emailAccount.create({
          data: {
            tenantId,
            provider,
            email,
            normalizedEmail: email,
            status,
            ...(status === 'ACTIVE' || status === 'ERROR'
              ? { secretRef: `fake://mailboxes/${email.split('@')[0] ?? ''}` }
              : {}),
          },
        });
      const gmail = await mailbox('sender@factory.test', 'GMAIL', 'ACTIVE');
      await mailbox('old@factory.test', 'GMAIL', 'DISCONNECTED');
      await mailbox('new@factory.test', 'MICROSOFT_GRAPH', 'PENDING');
      await prisma.integrationSyncCursor.create({
        data: {
          tenantId,
          provider: 'GMAIL',
          resource: 'gmail.history',
          scopeKey: gmail.id,
          emailAccountId: gmail.id,
          lastSyncedAt: daysAgo(0),
        },
      });
      await prisma.integrationSyncCursor.create({
        data: {
          tenantId,
          provider: 'GOHIGHLEVEL',
          resource: 'gohighlevel.contacts',
          scopeKey: 'location-1',
          consecutiveFailures: 2,
          lastErrorCode: 'unauthorized',
        },
      });
      const event = (
        provider: 'APOLLO' | 'GMAIL' | 'STRIPE',
        status: 'FAILED' | 'PROCESSED',
        receivedAt: Date,
      ) => {
        const payload = { id: randomUUID() };
        return prisma.inboundEvent.create({
          data: {
            tenantId,
            provider,
            eventKey: payload.id,
            payload,
            payloadSha256: sha(JSON.stringify(payload)),
            status,
            receivedAt,
            ...(status === 'PROCESSED' ? { processedAt: receivedAt } : {}),
          },
        });
      };
      // An old failure no longer counts; a recent one does. Stripe is not listed here.
      await event('GMAIL', 'FAILED', daysAgo(2));
      await event('GMAIL', 'PROCESSED', daysAgo(0));
      await event('APOLLO', 'FAILED', daysAgo(0));
      await event('STRIPE', 'FAILED', daysAgo(0));
      // Another workspace's broken mailbox never shows up.
      await prisma.emailAccount.create({
        data: {
          tenantId: other.tenant.id,
          provider: 'MICROSOFT_GRAPH',
          email: 'broken@factory.test',
          normalizedEmail: 'broken@factory.test',
          status: 'ERROR',
        },
      });

      const scope = await scopeOf(mine);
      const health = await scope.dashboard.integrationHealth();
      expect(health.generatedAt).toEqual(NOW);
      expect(health.items.map((item) => [item.provider, item.state])).toEqual([
        ['GMAIL', 'healthy'],
        ['MICROSOFT_GRAPH', 'connecting'],
        ['GOHIGHLEVEL', 'attention'],
        ['APOLLO', 'attention'],
      ]);
      expect(health.items[0]).toMatchObject({
        mailboxes: {
          ACTIVE: 1,
          PAUSED: 0,
          PENDING: 0,
          ERROR: 0,
          DISCONNECTED: 1,
        },
        syncs: 1,
        failingSyncs: 0,
        failedEventsLast24Hours: 0,
      });
      expect(health.items[0]?.lastEventAt).toEqual(daysAgo(0));
      expect(health.items[1]?.mailboxes?.ERROR).toBe(0);
      expect(health.items[2]).toMatchObject({
        mailboxes: null,
        syncs: 1,
        failingSyncs: 1,
        lastSyncedAt: null,
      });
      expect(health.items[3]).toMatchObject({
        syncs: 0,
        failedEventsLast24Hours: 1,
      });
    });

    it('lets a platform admin read the aggregates only in an audited scope', async () => {
      const admin = await factory.user({ isPlatformAdmin: true });
      const scope = await platformAdminScope(
        prisma,
        { tenantId: mine.tenant.id, userId: admin.id, reason: REASON },
        { now: () => NOW },
      );
      await expect(scope.dashboard.leadSummary()).resolves.toMatchObject({
        contacts: 3,
      });
      // Opening the scope was recorded in the workspace's audit records.
      const opened = await prisma.auditRecord.count({
        where: {
          tenantId: mine.tenant.id,
          action: 'platform_admin.access_opened',
          actorUserId: admin.id,
        },
      });
      expect(opened).toBe(1);
    });
  },
);
