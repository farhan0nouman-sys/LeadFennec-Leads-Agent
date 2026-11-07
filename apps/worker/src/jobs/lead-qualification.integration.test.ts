import {
  createFixtureFactory,
  createPrismaClient,
  memberScope,
  QUALIFICATION_TASK_TYPE,
  RESEARCH_TASK_TYPE,
  type FixtureFactory,
  type PrismaClient,
} from '@lead-fennec-ai/database';
import {
  MigratedSchema,
  testDatabaseUrl,
} from '@lead-fennec-ai/database/testing';
import {
  FakeModelProvider,
  FakeWebsiteFetcher,
  LiveProvidersUnavailableError,
  type FakeModelAnswer,
  type ModelProvider,
} from '@lead-fennec-ai/integrations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runQualificationTask } from './lead-qualification.js';
import { runResearchTask } from './website-research.js';

// The lead qualification job (task 10C, docs/decisions.md D-10C-*) on real PostgreSQL, with the
// fake fetcher and the fake model: the company is researched first (09C), then the job asks the
// agent about supported need and timing, scores the lead in application code and records the
// automatic decision. Invalid model output and a missing model go to review; a paid model pays
// from the AI token budget; a temporary model error retries. Runs only when TEST_DATABASE_URL is
// set; otherwise it is reported as skipped, never passed.
const db = new MigratedSchema('tlq0');
const SITE = 'https://acme-widgets.example/';
const HOME = `<html><head><title>Acme Widgets</title></head><body>
<nav><a href="/careers">Careers</a></nav>
<main><p>Acme Widgets makes synthetic widgets for testing teams.</p></main>
</body></html>`;
const CAREERS = "<main><p>We're hiring a synthetic widget engineer.</p></main>";

describe.runIf(testDatabaseUrl !== undefined)(
  'lead qualification job on PostgreSQL',
  () => {
    let prisma: PrismaClient;
    let factory: FixtureFactory;

    beforeAll(async () => {
      await db.create();
      prisma = createPrismaClient({
        databaseUrl: db.databaseUrl,
        schema: db.name,
        maxConnections: 1,
      });
      factory = createFixtureFactory(prisma);
    }, 60_000);

    afterAll(async () => {
      await prisma.$disconnect();
      await db.drop();
    });

    type Workspace = Awaited<ReturnType<FixtureFactory['workspace']>>;
    const scopeOf = (ws: Workspace) =>
      memberScope(prisma, { tenantId: ws.tenant.id, userId: ws.admin.id });

    /** A researched software company, a VP Sales with a checked address, and a campaign. */
    async function setup(
      limits: Parameters<FixtureFactory['workspace']>[0] = {},
    ) {
      const ws = await factory.workspace(limits);
      const tenantId = ws.tenant.id;
      const icp = await prisma.icp.create({
        data: {
          tenantId,
          name: 'Software teams',
          criteria: {
            industries: ['software'],
            employees: { min: 50, max: 500 },
            titles: ['VP Sales'],
          },
          status: 'ACTIVE',
        },
      });
      const org = await prisma.organization.create({
        data: {
          tenantId,
          name: 'Acme Widgets (synthetic)',
          websiteUrl: SITE,
          industry: 'software',
          employeeCount: 120,
          countryCode: 'US',
        },
      });
      const address = 'pat@acme-widgets.example';
      const contact = await prisma.contact.create({
        data: {
          tenantId,
          organizationId: org.id,
          firstName: 'Pat',
          title: 'VP Sales',
          email: address,
          normalizedEmail: address,
          emailDomain: 'acme-widgets.example',
          countryCode: 'US',
        },
      });
      await prisma.verification.create({
        data: {
          tenantId,
          contactId: contact.id,
          normalizedEmail: address,
          provider: 'fake',
          status: 'VALID',
          checkedAt: new Date(),
        },
      });
      const scope = await scopeOf(ws);
      const created = await scope.campaigns.create({ name: 'Widgets' });
      await scope.campaigns.update(created.id, {
        version: created.version,
        audience: { icpId: icp.id },
      });
      // The company's research, by the real job (fake pages, fake model).
      const accepted = await scope.research.request(org.id, {});
      const researchTask = await prisma.jobTask.findUniqueOrThrow({
        where: {
          tenantId_taskType_idempotencyKey: {
            tenantId,
            taskType: RESEARCH_TASK_TYPE,
            idempotencyKey: `research:${accepted.researchId}`,
          },
        },
      });
      const fetcher = new FakeWebsiteFetcher({
        pages: {
          [SITE]: { body: HOME },
          [`${SITE}careers`]: { body: CAREERS },
        },
        now: () => new Date(),
      });
      expect(
        await runResearchTask(
          prisma,
          { v: 1, taskId: researchTask.id },
          { fetcher: () => fetcher, model: () => new FakeModelProvider() },
        ),
      ).toBe('completed');
      return { ws, org, contact, campaignId: created.id };
    }

    async function qualify(
      ws: Workspace,
      campaignId: string,
      contactId: string,
    ) {
      expect(
        await (await scopeOf(ws)).qualification.request(campaignId, contactId),
      ).toEqual({ state: 'queued' });
      const task = await prisma.jobTask.findFirstOrThrow({
        where: {
          tenantId: ws.tenant.id,
          taskType: QUALIFICATION_TASK_TYPE,
          status: 'PENDING',
        },
      });
      return { v: 1, taskId: task.id };
    }

    it('lets the agent propose, scores in application code and records an explained decision', async () => {
      const { ws, contact, campaignId } = await setup();
      const message = await qualify(ws, campaignId, contact.id);
      const model = new FakeModelProvider();
      expect(
        await runQualificationTask(prisma, message, { model: () => model }),
      ).toBe('qualified');
      expect(model.requests.map((request) => request.task)).toEqual([
        'lead_qualification',
      ]);
      const view = await (
        await scopeOf(ws)
      ).qualification.view(campaignId, contact.id);
      expect(view.fit).toMatchObject({
        method: 'AI',
        agent: {
          status: 'completed',
          prompt: 'lead-qualification/1',
          provider: 'FAKE',
        },
      });
      const need = view.fit?.factors.find(
        (item) => item.factor === 'supportedNeed',
      );
      const timing = view.fit?.factors.find((item) => item.factor === 'timing');
      expect(need).toMatchObject({ status: 'assessed', assessedBy: 'model' });
      expect(need?.evidence[0]).toMatchObject({ kind: 'research_fact' });
      expect(timing).toMatchObject({
        status: 'assessed',
        level: 3,
        assessedBy: 'model',
      });
      expect(timing?.evidence[0]?.excerpt).toContain('hiring');
      // High Priority, but the workspace has no send policy: a person must look.
      expect(view.fit?.band).toBe('HIGH_PRIORITY');
      expect(view.qualification).toMatchObject({
        state: 'REVIEW',
        origin: 'AUTOMATIC',
        reasons: [
          {
            code: 'eligibility_review',
            details: ['source_unknown', 'region_policy_unknown'],
          },
          { code: 'score_high_priority' },
        ],
      });
      expect(view.pending).toBe(false);
      expect(
        await prisma.jobTask.findUniqueOrThrow({
          where: { id: message.taskId },
        }),
      ).toMatchObject({
        status: 'SUCCEEDED',
      });
    });

    it('sends invalid model output and a missing model to review, scoring with the rules alone', async () => {
      const { ws, contact, campaignId } = await setup();
      const scripted = (answer: FakeModelAnswer) => () =>
        new FakeModelProvider({ script: [answer] });
      for (const [model, status] of [
        [scripted({ text: 'not json' }), 'review_required'],
        [
          scripted({
            json: { assessments: [], ignoredInstructions: [], qualified: true },
          }),
          'review_required',
        ],
        [
          () => {
            throw new LiveProvidersUnavailableError(
              'synthetic: no model configured',
            );
          },
          'unavailable',
        ],
      ] as const) {
        const message = await qualify(ws, campaignId, contact.id);
        expect(await runQualificationTask(prisma, message, { model })).toBe(
          'qualified',
        );
        const view = await (
          await scopeOf(ws)
        ).qualification.view(campaignId, contact.id);
        // Supported need and timing are missing: 70, Review, and the reason says why.
        expect(view.fit).toMatchObject({
          value: 70,
          band: 'REVIEW',
          method: 'RULES',
        });
        expect(
          view.fit?.factors
            .filter((item) => item.status === 'missing')
            .map((item) => item.factor),
        ).toEqual(['supportedNeed', 'timing']);
        expect(view.qualification?.state).toBe('REVIEW');
        expect(view.qualification?.reasons[0]?.code).toBe(
          status === 'unavailable' ? 'agent_unavailable' : 'agent_review',
        );
        if (status === 'review_required') {
          expect(view.fit?.agent).toMatchObject({
            status: 'review_required',
            reviewItems: [{ reason: 'invalid_output', factor: null }],
          });
        } else {
          expect(view.fit?.agent).toBeNull();
        }
      }
    });

    it('pays for a paid model from the AI token budget, and retries a temporary model error', async () => {
      const { ws, contact, campaignId } = await setup({
        AI_TOKENS: 1_000_000n,
      });
      const fake = new FakeModelProvider();
      const paid: ModelProvider = {
        source: 'OPENAI',
        model: 'gpt-synthetic',
        generate: (request) => fake.generate(request),
      };
      const message = await qualify(ws, campaignId, contact.id);
      expect(
        await runQualificationTask(prisma, message, { model: () => paid }),
      ).toBe('qualified');
      const reservation = await prisma.usageReservation.findFirstOrThrow({
        where: {
          tenantId: ws.tenant.id,
          metric: 'AI_TOKENS',
          purpose: 'lead_qualification.run',
        },
      });
      expect(reservation.status).toBe('COMMITTED');
      expect(reservation.committedQuantity).toBeGreaterThan(0n);

      const busy = await qualify(ws, campaignId, contact.id);
      expect(
        await runQualificationTask(prisma, busy, {
          model: () =>
            new FakeModelProvider({ script: [{ error: 'rate_limited' }] }),
        }),
      ).toBe('retrying');
      expect(
        await prisma.jobTask.findUniqueOrThrow({ where: { id: busy.taskId } }),
      ).toMatchObject({
        status: 'PENDING',
        lastErrorCode: 'rate_limited',
      });
      // While it waits, the lead shows a run pending.
      expect(
        (await (await scopeOf(ws)).qualification.view(campaignId, contact.id))
          .pending,
      ).toBe(true);
    });
  },
);
