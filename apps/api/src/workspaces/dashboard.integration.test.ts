import {
  MigratedSchema,
  testDatabaseUrl,
} from '@lead-fennec-ai/database/testing';
import {
  activityResponseSchema,
  campaignSummarySchema,
  DASHBOARD_ROUTES as D,
  integrationHealthResponseSchema,
  invitationSchema,
  leadSummarySchema,
  normalizeEmail,
  roleListResponseSchema,
  userWorkspaceSchema,
  WORKSPACE_ROUTES as R,
} from '@lead-fennec-ai/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  call,
  clock,
  expectError,
  expectNoSecretsLogged,
  lastMail,
  signedInUser,
  startApi,
  type Harness,
  type Session,
} from '../testing/api-harness.js';

// Dashboard aggregates over HTTP (task 05C, docs/decisions.md D-05C-01): real Nest app, real
// PostgreSQL (its own schema), the harness clock. Each route needs its section's permission,
// answers 404 outside the user's workspaces and counts only the workspace's own rows. Runs only
// when TEST_DATABASE_URL is set; otherwise it is reported as skipped, never as passed.
const db = new MigratedSchema('tdash');

describe.runIf(testDatabaseUrl !== undefined)(
  'dashboard routes on PostgreSQL',
  () => {
    let api: Harness;
    let admin: Session;
    let member: Session;
    let outsider: Session;
    let workspaceId: string;
    let otherWorkspaceId: string;

    async function newWorkspace(owner: Session, name: string) {
      const result = await call(api, R.workspaces, {
        body: { name },
        session: owner,
      });
      expect(result.status, result.text).toBe(201);
      return userWorkspaceSchema.parse(result.json).workspace.id;
    }

    /** Contacts, companies and a running campaign with `leads` leads in `tenantId`. */
    async function seed(tenantId: string, leads: number) {
      const prisma = api.prisma;
      const campaign = await prisma.campaign.create({
        data: {
          tenantId,
          name: 'Autumn outreach',
          status: 'ACTIVE',
          activatedAt: clock.now,
        },
      });
      const sequence = await prisma.sequence.create({
        data: { tenantId, campaignId: campaign.id, name: 'Main' },
      });
      await prisma.organization.create({
        data: { tenantId, name: 'Example Corp' },
      });
      for (let i = 0; i < leads; i += 1) {
        const identity = normalizeEmail(`lead${String(i)}@example.com`);
        const contact = await prisma.contact.create({
          data: {
            tenantId,
            email: identity.email,
            normalizedEmail: identity.email,
            emailDomain: identity.domain,
            createdAt: clock.now,
          },
        });
        await prisma.campaignLead.create({
          data: {
            tenantId,
            campaignId: campaign.id,
            sequenceId: sequence.id,
            contactId: contact.id,
            timezone: 'UTC',
          },
        });
      }
    }

    beforeAll(async () => {
      await db.create();
      api = await startApi(db);
      admin = await signedInUser(api, 'dash-admin');
      member = await signedInUser(api, 'dash-member');
      outsider = await signedInUser(api, 'dash-outsider');
      workspaceId = await newWorkspace(admin, 'Dashboard team');
      otherWorkspaceId = await newWorkspace(outsider, 'Other team');
      const roles = roleListResponseSchema.parse(
        (await call(api, R.roles(workspaceId), { session: admin })).json,
      ).items;
      const invited = await call(api, R.invitations(workspaceId), {
        body: {
          email: member.email,
          roleId: roles.find((r) => r.key === 'client_member')?.id,
        },
        session: admin,
      });
      expect(invited.status, invited.text).toBe(201);
      invitationSchema.parse(invited.json);
      const { token } = lastMail(api, member.email, 'workspace.invitation');
      const accepted = await call(api, R.acceptInvitation, {
        body: { token, workspaceId },
        session: member,
      });
      expect(accepted.status, accepted.text).toBe(200);
      await seed(workspaceId, 2);
      await seed(otherWorkspaceId, 5);
      await api.prisma.emailAccount.create({
        data: {
          tenantId: otherWorkspaceId,
          provider: 'GMAIL',
          email: 'sender@example.com',
          normalizedEmail: 'sender@example.com',
          status: 'ERROR',
        },
      });
    }, 120_000);

    afterAll(async () => {
      await api.app.close();
      await db.drop();
      expectNoSecretsLogged();
    }, 60_000);

    it("gives an admin the workspace's own counts, activity and integration health", async () => {
      const leads = await call(api, D.leadSummary(workspaceId), {
        session: admin,
      });
      expect(leads.status, leads.text).toBe(200);
      expect(leads.headers.get('cache-control')).toBe('no-store');
      expect(leadSummarySchema.parse(leads.json)).toEqual({
        generatedAt: clock.now.toISOString(),
        contacts: 2,
        companies: 1,
        contactsWithEmail: 2,
        contactsAddedLast30Days: 2,
      });

      const campaigns = campaignSummarySchema.parse(
        (await call(api, D.campaignSummary(workspaceId), { session: admin }))
          .json,
      );
      expect(campaigns).toMatchObject({
        campaigns: 1,
        activeCampaigns: 1,
        leadsInProgress: 2,
        leadsByStatus: { PENDING: 2, ACTIVE: 0, COMPLETED: 0, STOPPED: 0 },
      });

      const activity = activityResponseSchema.parse(
        (await call(api, D.activity(workspaceId), { session: admin })).json,
      );
      // Created, invited, joined: only this workspace's records, newest first.
      expect(activity.counts).toEqual({
        last24Hours: 3,
        last7Days: 3,
        last30Days: 3,
      });
      expect(
        activity.items.map((item) => [item.action, item.actor.kind]),
      ).toEqual([
        ['invitation.accepted', 'member'],
        ['invitation.created', 'member'],
        ['workspace.created', 'member'],
      ]);

      const health = integrationHealthResponseSchema.parse(
        (await call(api, D.integrationHealth(workspaceId), { session: admin }))
          .json,
      );
      // The other workspace's broken mailbox doesn't count here.
      expect(health.items.map((item) => item.state)).toEqual([
        'not_connected',
        'not_connected',
        'not_connected',
        'not_connected',
      ]);
    });

    it("asks for each section's permission", async () => {
      // A Client Team Member reads leads and campaigns, not the audit log or integrations.
      for (const path of [
        D.leadSummary(workspaceId),
        D.campaignSummary(workspaceId),
      ]) {
        expect((await call(api, path, { session: member })).status).toBe(200);
      }
      for (const path of [
        D.activity(workspaceId),
        D.integrationHealth(workspaceId),
      ]) {
        expectError(
          await call(api, path, { session: member }),
          403,
          'forbidden',
        );
      }
    });

    it('answers 404 outside the user’s workspaces and 401 without a session', async () => {
      for (const route of Object.values(D)) {
        expectError(
          await call(api, route(workspaceId), { session: outsider }),
          404,
          'not_found',
        );
        expectError(
          await call(api, route(workspaceId)),
          401,
          'unauthenticated',
        );
        expectError(
          await call(api, route('not-a-workspace'), { session: admin }),
          404,
          'not_found',
        );
      }
    });

    it('bounds the activity page and validates the limit', async () => {
      const page = activityResponseSchema.parse(
        (
          await call(api, `${D.activity(workspaceId)}?limit=1`, {
            session: admin,
          })
        ).json,
      );
      expect(page.items).toHaveLength(1);
      expect(page.counts.last30Days).toBe(3);
      for (const limit of ['0', '26', 'many']) {
        expectError(
          await call(api, `${D.activity(workspaceId)}?limit=${limit}`, {
            session: admin,
          }),
          400,
          'validation_failed',
        );
      }
      expectError(
        await call(api, `${D.activity(workspaceId)}?since=yesterday`, {
          session: admin,
        }),
        400,
        'validation_failed',
      );
    });

    it('never names people from outside the workspace or exposes record ids', async () => {
      const text = (
        await call(api, D.activity(workspaceId), { session: admin })
      ).text;
      expect(text).not.toContain(outsider.email);
      expect(text).not.toContain(otherWorkspaceId);
      expect(text).not.toContain('targetId');
    });
  },
);
