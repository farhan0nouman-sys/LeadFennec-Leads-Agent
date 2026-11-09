import { randomUUID } from 'node:crypto';
import {
  createFixtureFactory,
  createPrismaClient,
  DISCOVERY_TASK_TYPE,
  ImportNotCancellableError,
  JobRejectedError,
  memberScope,
  type DiscoveryProviderInfo,
  type FixtureFactory,
  type PrismaClient,
} from '@lead-fennec-ai/database';
import {
  MigratedSchema,
  testDatabaseUrl,
} from '@lead-fennec-ai/database/testing';
import {
  FAKE_ORGANIZATION_SEARCH_CAPABILITIES,
  FakeOrganizationSearchProvider,
  type OrganizationSearchProvider,
} from '@lead-fennec-ai/integrations';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { relayDueTasks } from '../queue.js';
import { LEAD_DISCOVERY_WORKER, runDiscoveryTask } from './lead-discovery.js';

// The organization search job (task 07C, docs/decisions.md D-07C-01 and D-07C-02) on real
// PostgreSQL, with the deterministic fake provider: companies saved per workspace with their
// source, suppressed domains excluded, repeats matched rather than duplicated, interrupted runs
// resumed, cancellation, failures, budgets for paid providers and the relay. Runs only when
// TEST_DATABASE_URL is set; otherwise it is reported as skipped, never passed.
const db = new MigratedSchema('twrk');
const FAKE: DiscoveryProviderInfo = {
  source: 'FAKE',
  capabilities: FAKE_ORGANIZATION_SEARCH_CAPABILITIES,
};
const SOFTWARE = { industries: ['software'] };
const later = (seconds: number) => () => new Date(Date.now() + seconds * 1000);

describe.runIf(testDatabaseUrl !== undefined)(
  'organization search job on PostgreSQL',
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

    const adminOf = (ws: Workspace) =>
      memberScope(prisma, { tenantId: ws.tenant.id, userId: ws.admin.id });

    async function requestSearch(
      ws: Workspace,
      criteria: object = SOFTWARE,
      maxResults = 30,
      provider: DiscoveryProviderInfo = FAKE,
    ) {
      const icp = await prisma.icp.create({
        data: {
          tenantId: ws.tenant.id,
          name: `ICP ${randomUUID()}`,
          criteria,
          status: 'ACTIVE',
        },
      });
      const scope = await adminOf(ws);
      const run = await scope.discovery.request(
        { icpId: icp.id, maxResults },
        provider,
      );
      const task = await prisma.jobTask.findUniqueOrThrow({
        where: {
          tenantId_taskType_idempotencyKey: {
            tenantId: ws.tenant.id,
            taskType: DISCOVERY_TASK_TYPE,
            idempotencyKey: `import:${run.id}`,
          },
        },
      });
      return { run, scope, task, message: { v: 1, taskId: task.id } };
    }

    const organizations = (ws: Workspace) =>
      prisma.organization.count({ where: { tenantId: ws.tenant.id } });

    const allResults = async (
      scope: Awaited<ReturnType<typeof adminOf>>,
      runId: string,
    ) => {
      const items = [];
      let cursor: string | undefined;
      do {
        const page = await scope.discovery.results(runId, {
          limit: 100,
          ...(cursor === undefined ? {} : { cursor }),
        });
        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);
      return items;
    };

    it('saves the companies a search finds, with their source and counts', async () => {
      const ws = await factory.workspace();
      const other = await factory.workspace();
      const provider = new FakeOrganizationSearchProvider();
      const { run, scope, message, task } = await requestSearch(ws);
      expect(
        await runDiscoveryTask(prisma, message, { provider: () => provider }),
      ).toBe('completed');

      const done = await scope.discovery.get(run.id);
      expect(done).toMatchObject({
        status: 'COMPLETED',
        counts: {
          found: 30,
          saved: 30,
          created: 30,
          excluded: 0,
          failed: 0,
          repeated: 0,
        },
        pagesFetched: 2,
        errorCode: null,
      });
      expect(done.startedAt).not.toBeNull();
      expect(done.completedAt).not.toBeNull();
      expect(await organizations(ws)).toBe(30);
      expect(await organizations(other)).toBe(0);
      expect(provider.requests.map((r) => r.pageSize)).toEqual([25, 5]);

      // Each company keeps where it came from.
      const results = await allResults(scope, run.id);
      expect(results).toHaveLength(30);
      expect(results.map((r) => r.position)).toEqual(
        Array.from({ length: 30 }, (_, i) => i + 1),
      );
      expect(results.every((r) => r.outcome === 'CREATED')).toBe(true);
      const record = await prisma.sourceRecord.findFirstOrThrow({
        where: { tenantId: ws.tenant.id, importId: run.id },
        orderBy: { importRowNumber: 'asc' },
      });
      expect(record).toMatchObject({
        provider: 'FAKE',
        outcome: 'CREATED',
        importRowNumber: 1,
      });
      expect(record.externalId).toMatch(/^fake-org-/);
      expect(record.payload).toMatchObject({ received: { synthetic: true } });
      expect(
        (
          await prisma.jobTask.findUniqueOrThrow({
            where: { tenantId_id: { tenantId: ws.tenant.id, id: task.id } },
          })
        ).status,
      ).toBe('SUCCEEDED');
      expect(
        await prisma.auditRecord.count({
          where: {
            tenantId: ws.tenant.id,
            action: 'lead_discovery.completed',
            targetId: run.id,
          },
        }),
      ).toBe(1);
    });

    it('matches companies already saved instead of duplicating them, and excludes suppressed domains', async () => {
      const ws = await factory.workspace();
      const first = await requestSearch(ws);
      await runDiscoveryTask(prisma, first.message, {
        provider: () => new FakeOrganizationSearchProvider(),
      });
      const before = await organizations(ws);
      const results = await allResults(first.scope, first.run.id);
      const target = results.find((r) => r.domain !== null);
      if (target?.domain == null) {
        throw new Error('no company with a domain');
      }
      // A parent-domain suppression excludes the company (and stays in the results).
      const parent = target.domain;
      await prisma.suppression.create({
        data: {
          tenantId: ws.tenant.id,
          normalizedDomain: parent,
          reason: 'MANUAL',
          source: 'MANUAL',
        },
      });

      const again = await requestSearch(ws);
      expect(
        await runDiscoveryTask(prisma, again.message, {
          provider: () => new FakeOrganizationSearchProvider(),
        }),
      ).toBe('completed');
      expect(await organizations(ws)).toBe(before);
      const repeat = await again.scope.discovery.get(again.run.id);
      expect(repeat.counts).toEqual({
        found: 30,
        saved: 29,
        created: 0,
        excluded: 1,
        failed: 0,
        repeated: 0,
      });
      const excluded = await again.scope.discovery.results(again.run.id, {
        outcome: 'EXCLUDED',
      });
      expect(excluded.items).toEqual([
        expect.objectContaining({
          domain: parent,
          organizationId: null,
          issues: [
            {
              field: 'domain',
              message: `The domain ${parent} is on this workspace's suppression list.`,
            },
          ],
        }),
      ]);
    });

    it('resumes an interrupted run from its last saved page, without duplicates', async () => {
      const reference = await factory.workspace();
      const ref = await requestSearch(reference, SOFTWARE, 40);
      await runDiscoveryTask(prisma, ref.message, {
        provider: () => new FakeOrganizationSearchProvider(),
      });
      const expected = (await allResults(ref.scope, ref.run.id)).map(
        (r) => r.externalId,
      );

      const ws = await factory.workspace();
      const { run, scope, message, task } = await requestSearch(
        ws,
        SOFTWARE,
        40,
      );
      // The provider times out on its second page.
      expect(
        await runDiscoveryTask(prisma, message, {
          provider: () =>
            new FakeOrganizationSearchProvider({ failures: { 2: 'timeout' } }),
        }),
      ).toBe('retrying');
      const paused = await prisma.import.findUniqueOrThrow({
        where: { tenantId_id: { tenantId: ws.tenant.id, id: run.id } },
      });
      expect(paused).toMatchObject({
        status: 'PROCESSING',
        pagesFetched: 1,
        cursor: 'p:25',
        errorCode: 'timeout',
        importedRows: 25,
      });
      const retry = await prisma.jobTask.findUniqueOrThrow({
        where: { tenantId_id: { tenantId: ws.tenant.id, id: task.id } },
      });
      expect(retry).toMatchObject({
        status: 'PENDING',
        lastErrorCode: 'timeout',
      });
      // Not due yet: the relay leaves it, and claiming it now is refused.
      const published: string[] = [];
      await relayDueTasks(
        prisma,
        (envelope) => {
          published.push(envelope.taskId);
          return Promise.resolve();
        },
        { worker: LEAD_DISCOVERY_WORKER, now: new Date() },
      );
      expect(published).not.toContain(task.id);

      // Later: it resumes at the saved token and finishes as an uninterrupted run would.
      const resumed = new FakeOrganizationSearchProvider();
      expect(
        await runDiscoveryTask(prisma, message, {
          provider: () => resumed,
          now: later(120),
        }),
      ).toBe('completed');
      expect(resumed.requests.map((r) => r.pageToken)).toEqual(['p:25']);
      expect(
        (await allResults(scope, run.id)).map((r) => r.externalId),
      ).toEqual(expected);
      expect(await organizations(ws)).toBe(40);
      expect((await scope.discovery.get(run.id)).counts).toMatchObject({
        found: 40,
        saved: 40,
        created: 40,
      });
    });

    it('stops at a cancellation and keeps what was saved', async () => {
      const ws = await factory.workspace();
      const { run, scope, message } = await requestSearch(ws, SOFTWARE, 40);
      const fake = new FakeOrganizationSearchProvider();
      let calls = 0;
      // The member cancels while the second page is being fetched.
      const provider: OrganizationSearchProvider = {
        source: fake.source,
        capabilities: fake.capabilities,
        searchOrganizations: async (request) => {
          calls += 1;
          if (calls === 2) {
            await scope.discovery.cancel(run.id);
          }
          return fake.searchOrganizations(request);
        },
      };
      expect(
        await runDiscoveryTask(prisma, message, { provider: () => provider }),
      ).toBe('cancelled');
      const cancelled = await scope.discovery.get(run.id);
      expect(cancelled).toMatchObject({
        status: 'CANCELLED',
        pagesFetched: 1,
        counts: { saved: 25 },
      });
      expect(await organizations(ws)).toBe(25);
      // Repeating it changes nothing; a finished run can't be cancelled.
      await expect(scope.discovery.cancel(run.id)).resolves.toMatchObject({
        status: 'CANCELLED',
      });
      const finished = await requestSearch(ws, SOFTWARE, 5);
      await runDiscoveryTask(prisma, finished.message, {
        provider: () => new FakeOrganizationSearchProvider(),
      });
      await expect(scope.discovery.cancel(finished.run.id)).rejects.toThrow(
        ImportNotCancellableError,
      );
      // A run cancelled before it started is skipped by the job.
      const queued = await requestSearch(ws, SOFTWARE, 5);
      await scope.discovery.cancel(queued.run.id);
      const untouched = new FakeOrganizationSearchProvider();
      expect(
        await runDiscoveryTask(prisma, queued.message, {
          provider: () => untouched,
        }),
      ).toBe('cancelled');
      expect(untouched.requests).toEqual([]);
    });

    it('ends the run with the error code when the provider refuses or keeps failing', async () => {
      const ws = await factory.workspace();
      const refused = await requestSearch(ws);
      expect(
        await runDiscoveryTask(prisma, refused.message, {
          provider: () =>
            new FakeOrganizationSearchProvider({
              failures: { 1: 'unauthorized' },
            }),
        }),
      ).toBe('failed');
      expect(await refused.scope.discovery.get(refused.run.id)).toMatchObject({
        status: 'FAILED',
        errorCode: 'unauthorized',
      });
      expect(
        (
          await prisma.jobTask.findUniqueOrThrow({
            where: {
              tenantId_id: { tenantId: ws.tenant.id, id: refused.task.id },
            },
          })
        ).status,
      ).toBe('FAILED');

      // Out of attempts: a retryable error fails the run too.
      const tired = await requestSearch(ws);
      await prisma.jobTask.update({
        where: { tenantId_id: { tenantId: ws.tenant.id, id: tired.task.id } },
        data: { maxAttempts: 1 },
      });
      expect(
        await runDiscoveryTask(prisma, tired.message, {
          provider: () =>
            new FakeOrganizationSearchProvider({ failures: { 1: 'timeout' } }),
        }),
      ).toBe('failed');
      expect(await tired.scope.discovery.get(tired.run.id)).toMatchObject({
        status: 'FAILED',
        errorCode: 'timeout',
      });

      // A search asked of one provider never runs on another.
      const mismatch = await requestSearch(ws);
      const fake = new FakeOrganizationSearchProvider();
      expect(
        await runDiscoveryTask(prisma, mismatch.message, {
          provider: () => ({
            source: 'APOLLO',
            capabilities: fake.capabilities,
            searchOrganizations: (request) => fake.searchOrganizations(request),
          }),
        }),
      ).toBe('failed');
      expect(fake.requests).toEqual([]);
      expect(
        (await mismatch.scope.discovery.get(mismatch.run.id)).errorCode,
      ).toBe('provider_mismatch');
    });

    it('pays for every page of a paid provider before asking it', async () => {
      const APOLLO: DiscoveryProviderInfo = {
        source: 'APOLLO',
        capabilities: FAKE_ORGANIZATION_SEARCH_CAPABILITIES,
      };
      const paidFake = () => {
        const fake = new FakeOrganizationSearchProvider();
        return {
          fake,
          provider: {
            source: 'APOLLO' as const,
            capabilities: fake.capabilities,
            searchOrganizations: (
              request: Parameters<typeof fake.searchOrganizations>[0],
            ) => fake.searchOrganizations(request),
          },
        };
      };
      // No search credits in the plan: refused before any request.
      const none = await factory.workspace();
      const broke = await requestSearch(none, SOFTWARE, 50, APOLLO);
      const first = paidFake();
      expect(
        await runDiscoveryTask(prisma, broke.message, {
          provider: () => first.provider,
        }),
      ).toBe('failed');
      expect(first.fake.requests).toEqual([]);
      expect((await broke.scope.discovery.get(broke.run.id)).errorCode).toBe(
        'usage_limit_reached',
      );

      // One credit: one page, then the budget stops the run with what it saved.
      const one = await factory.workspace({ ORGANIZATION_SEARCH_CREDITS: 1n });
      const paid = await requestSearch(one, SOFTWARE, 50, APOLLO);
      const second = paidFake();
      expect(
        await runDiscoveryTask(prisma, paid.message, {
          provider: () => second.provider,
        }),
      ).toBe('failed');
      expect(second.fake.requests).toHaveLength(1);
      expect(await paid.scope.discovery.get(paid.run.id)).toMatchObject({
        status: 'FAILED',
        errorCode: 'usage_limit_reached',
        pagesFetched: 1,
        counts: { saved: 25 },
      });
      const committed = await prisma.usageReservation.findMany({
        where: {
          tenantId: one.tenant.id,
          metric: 'ORGANIZATION_SEARCH_CREDITS',
        },
      });
      expect(committed.map((r) => r.status)).toEqual(['COMMITTED']);
    });

    it('publishes only due tasks of active workspaces, and drops forged messages', async () => {
      const ws = await factory.workspace();
      const due = await requestSearch(ws);
      const suspended = await factory.workspace();
      const hidden = await requestSearch(suspended);
      await prisma.tenant.update({
        where: { id: suspended.tenant.id },
        data: { status: 'SUSPENDED' },
      });
      const published: string[] = [];
      await relayDueTasks(
        prisma,
        (envelope) => {
          expect(Object.keys(envelope).sort()).toEqual(['taskId', 'v']);
          published.push(envelope.taskId);
          return Promise.resolve();
        },
        { worker: LEAD_DISCOVERY_WORKER, now: later(5)() },
      );
      expect(published).toContain(due.task.id);
      expect(published).not.toContain(hidden.task.id);

      for (const forged of [
        { v: 1, taskId: due.task.id, tenantId: suspended.tenant.id },
        { v: 1, taskId: randomUUID() },
        'not a message',
      ]) {
        await expect(
          runDiscoveryTask(prisma, forged, {
            provider: () => new FakeOrganizationSearchProvider(),
          }),
        ).rejects.toThrow(JobRejectedError);
      }
      // A message for a suspended workspace's task is refused too.
      await expect(
        runDiscoveryTask(prisma, hidden.message, {
          provider: () => new FakeOrganizationSearchProvider(),
        }),
      ).rejects.toThrow(JobRejectedError);
    });
  },
);
