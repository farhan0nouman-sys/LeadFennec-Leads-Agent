import {
  MigratedSchema,
  testDatabaseUrl,
} from '@lead-fennec-ai/database/testing';
import {
  activationReportSchema,
  activityResponseSchema,
  CAMPAIGN_ROUTES as C,
  campaignSchema,
  DASHBOARD_ROUTES as D,
  normalizeEmail,
  userWorkspaceSchema,
  WORKSPACE_ROUTES as R,
  type CampaignServices,
} from '@lead-fennec-ai/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  call,
  clock,
  expectError,
  expectNoSecretsLogged,
  signedInUser,
  startApi,
  type Harness,
  type Session,
} from '../testing/api-harness.js';

// Campaign readiness and activation over HTTP (task 06C, docs/api/campaigns.md): first as in
// production (no later service is built, so activation fails closed with every reason), then
// with the services marked built, to show a real start, an idempotent repeat and conflicts.
// Real Nest app, real PostgreSQL (its own schema). Runs only when TEST_DATABASE_URL is set.
const db = new MigratedSchema('tact');
const ALL_BUILT: CampaignServices = {
  eligibility: true,
  drafting: true,
  sending: true,
};

describe.runIf(testDatabaseUrl !== undefined)(
  'campaign activation routes on PostgreSQL',
  () => {
    beforeAll(async () => {
      await db.create();
    }, 60_000);

    afterAll(async () => {
      await db.drop();
      expectNoSecretsLogged();
    }, 60_000);

    /** A workspace whose records let every setting pass; returns its id and records. */
    async function readyWorkspace(api: Harness, owner: Session, label: string) {
      const created = await call(api, R.workspaces, {
        body: { name: `${label} team` },
        session: owner,
      });
      expect(created.status, created.text).toBe(201);
      const tenantId = userWorkspaceSchema.parse(created.json).workspace.id;
      const prisma = api.prisma;
      const list = await prisma.leadList.create({
        data: { tenantId, name: `${label} list` },
      });
      const identity = normalizeEmail(`lead.${label}@example.com`);
      const contact = await prisma.contact.create({
        data: {
          tenantId,
          email: identity.email,
          normalizedEmail: identity.email,
          emailDomain: identity.domain,
        },
      });
      await prisma.leadListMember.create({
        data: { tenantId, leadListId: list.id, contactId: contact.id },
      });
      const address = normalizeEmail(`${label}.sender@example.com`).email;
      const mailbox = await prisma.emailAccount.create({
        data: {
          tenantId,
          provider: 'GMAIL',
          email: address,
          normalizedEmail: address,
          status: 'ACTIVE',
          secretRef: `fake://mailboxes/${label}`,
        },
      });
      const template = await prisma.template.create({
        data: { tenantId, name: 'Intro', subject: 'Hello', body: 'Hello' },
      });
      const plan = await prisma.billingPlan.create({
        data: {
          key: `plan_${label}`,
          name: `Plan ${label}`,
          currency: 'USD',
          amountMinor: 1_000n,
          interval: 'MONTH',
          limits: {
            create: [{ metric: 'EMAILS_SENT', quantityPerPeriod: 1_000n }],
          },
        },
      });
      const start = new Date(Date.UTC(2026, 10, 1));
      await prisma.subscription.create({
        data: {
          tenantId,
          planId: plan.id,
          provider: 'MANUAL',
          status: 'ACTIVE',
          currentPeriodStart: start,
          currentPeriodEnd: new Date(Date.UTC(2026, 11, 1)),
        },
      });
      await prisma.tenantSettings.update({
        where: { tenantId },
        data: { outboundSendingEnabled: true },
      });
      return {
        tenantId,
        list: list.id,
        mailbox: mailbox.id,
        template: template.id,
      };
    }

    /** A campaign with every setting filled in. */
    async function completeCampaign(
      api: Harness,
      owner: Session,
      records: Awaited<ReturnType<typeof readyWorkspace>>,
    ) {
      const created = await call(api, C.campaigns(records.tenantId), {
        body: { name: 'Launch' },
        session: owner,
      });
      const draft = campaignSchema.parse(created.json);
      const saved = await call(api, C.campaign(records.tenantId, draft.id), {
        method: 'PATCH',
        body: {
          version: 1,
          businessProfile: {
            companyName: 'Example Co',
            description: 'Examples.',
          },
          offer: { name: 'Audit', description: 'A free audit.' },
          audience: { leadListId: records.list },
          leadLimits: { dailyNewLeads: 10, maxLeads: 100 },
          sender: { emailAccountId: records.mailbox },
          sequence: {
            steps: [{ delayMinutes: 0, templateId: records.template }],
          },
        },
        session: owner,
      });
      expect(saved.status, saved.text).toBe(200);
      return campaignSchema.parse(saved.json);
    }

    describe('as in production: no later service is built', () => {
      let api: Harness;
      let owner: Session;
      let outsider: Session;

      beforeAll(async () => {
        api = await startApi(db);
        owner = await signedInUser(api, 'act-owner');
        outsider = await signedInUser(api, 'act-outsider');
      }, 60_000);

      afterAll(async () => {
        await api.app.close();
      }, 60_000);

      it('reports every check, and activation fails closed with each reason', async () => {
        const records = await readyWorkspace(api, owner, 'prod');
        const campaign = await completeCampaign(api, owner, records);
        // Saving a complete campaign never starts it.
        expect(campaign.status).toBe('DRAFT');

        const readiness = await call(
          api,
          C.readiness(records.tenantId, campaign.id),
          { session: owner },
        );
        expect(readiness.status, readiness.text).toBe(200);
        expect(readiness.headers.get('cache-control')).toBe('no-store');
        const report = activationReportSchema.parse(readiness.json);
        expect(report).toMatchObject({
          ready: false,
          version: campaign.version,
        });
        expect(
          report.checks.filter((c) => !c.passed).map((c) => c.key),
        ).toEqual([
          'eligibility_service',
          'drafting_service',
          'sending_service',
        ]);

        // A stale version conflicts first.
        expectError(
          await call(api, C.activate(records.tenantId, campaign.id), {
            body: { version: campaign.version - 1 },
            session: owner,
          }),
          409,
          'version_conflict',
        );
        // The current one is refused with every reason, twice the same way.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          const refused = expectError(
            await call(api, C.activate(records.tenantId, campaign.id), {
              body: { version: campaign.version },
              session: owner,
            }),
            409,
            'campaign_not_ready',
          );
          expect(refused.error.issues).toEqual([
            {
              path: 'eligibility_service',
              message:
                "Checking each lead against the do-not-contact list and email verification isn't available yet.",
            },
            {
              path: 'drafting_service',
              message:
                "Preparing each email from its template isn't available yet.",
            },
            {
              path: 'sending_service',
              message:
                "Sending email through Gmail or Microsoft 365 isn't available yet.",
            },
          ]);
        }
        const after = campaignSchema.parse(
          (
            await call(api, C.campaign(records.tenantId, campaign.id), {
              session: owner,
            })
          ).json,
        );
        expect(after).toMatchObject({
          status: 'DRAFT',
          version: campaign.version,
        });
      });

      it('is guarded like every other change', async () => {
        const records = await readyWorkspace(api, owner, 'guard');
        const campaign = await completeCampaign(api, owner, records);
        expectError(
          await call(api, C.activate(records.tenantId, campaign.id), {
            body: { version: campaign.version },
            session: owner,
            withoutCsrf: true,
          }),
          403,
          'csrf_failed',
        );
        for (const route of [
          C.readiness(records.tenantId, campaign.id),
          C.activate(records.tenantId, campaign.id),
        ]) {
          const result = await call(api, route, {
            session: outsider,
            ...(route.endsWith('/activate')
              ? { body: { version: campaign.version } }
              : {}),
          });
          expectError(result, 404, 'not_found');
        }
        // A save can't set the status.
        expectError(
          await call(api, C.campaign(records.tenantId, campaign.id), {
            method: 'PATCH',
            body: { version: campaign.version, status: 'ACTIVE' },
            session: owner,
          }),
          400,
          'validation_failed',
        );
        expectError(
          await call(api, C.activate(records.tenantId, campaign.id), {
            body: { version: 'latest' },
            session: owner,
          }),
          400,
          'validation_failed',
        );
      });
    });

    describe('with the later services built', () => {
      let api: Harness;
      let owner: Session;

      beforeAll(async () => {
        api = await startApi(db, {}, ALL_BUILT);
        owner = await signedInUser(api, 'act-built');
      }, 60_000);

      afterAll(async () => {
        await api.app.close();
      }, 60_000);

      it('starts once; repeating changes nothing; stale versions conflict', async () => {
        const records = await readyWorkspace(api, owner, 'built');
        const campaign = await completeCampaign(api, owner, records);
        const report = activationReportSchema.parse(
          (
            await call(api, C.readiness(records.tenantId, campaign.id), {
              session: owner,
            })
          ).json,
        );
        expect(report.ready).toBe(true);
        expect(
          campaignSchema.parse(
            (
              await call(api, C.campaign(records.tenantId, campaign.id), {
                session: owner,
              })
            ).json,
          ).status,
        ).toBe('DRAFT');

        const started = await call(
          api,
          C.activate(records.tenantId, campaign.id),
          {
            body: { version: campaign.version },
            session: owner,
          },
        );
        expect(started.status, started.text).toBe(200);
        const running = campaignSchema.parse(started.json);
        expect(running).toMatchObject({
          status: 'ACTIVE',
          version: campaign.version,
        });

        const repeated = await call(
          api,
          C.activate(records.tenantId, campaign.id),
          {
            body: { version: campaign.version },
            session: owner,
          },
        );
        expect(repeated.status).toBe(200);
        expect(campaignSchema.parse(repeated.json)).toEqual(running);
        expectError(
          await call(api, C.activate(records.tenantId, campaign.id), {
            body: { version: campaign.version - 1 },
            session: owner,
          }),
          409,
          'version_conflict',
        );
        const activated = await api.prisma.auditRecord.findMany({
          where: {
            tenantId: records.tenantId,
            action: 'campaign.activated',
            targetId: campaign.id,
          },
        });
        expect(activated).toHaveLength(1);
        const row = await api.prisma.campaign.findUniqueOrThrow({
          where: {
            tenantId_id: { tenantId: records.tenantId, id: campaign.id },
          },
          select: { activatedAt: true },
        });
        expect(row.activatedAt).toEqual(clock.now);
        const activity = activityResponseSchema.parse(
          (await call(api, D.activity(records.tenantId), { session: owner }))
            .json,
        );
        expect(activity.items[0]?.action).toBe('campaign.activated');
      });
    });
  },
);
