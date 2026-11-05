import { randomUUID } from 'node:crypto';
import type { OrganizationSearchCapabilities } from '@lead-fennec-ai/shared';
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
import {
  memberScope,
  platformAdminScope,
  systemScope,
} from './tenancy/access.js';
import { ActorNotAllowedError } from './tenancy/actors.js';
import {
  PermissionDeniedError,
  RecordNotFoundError,
} from './tenancy/authorization.js';
import {
  DISCOVERY_TASK_TYPE,
  DiscoveryRequestError,
  type DiscoveryProviderInfo,
} from './tenancy/discovery.js';
import { MigratedSchema, testDatabaseUrl } from './testing/migrated-schema.js';

// Lead discovery requests (task 07A, docs/decisions.md D-07A-*) on real PostgreSQL: an ICP
// becomes a tenant-owned organization-search import with its inputs, source metadata and a
// durable job task; unsupported filters, excessive limits and other workspaces' ICPs are
// refused before anything is written; the database keeps search inputs complete and
// immutable. The HTTP routes are tested in apps/api. Runs only when TEST_DATABASE_URL is set;
// otherwise it is reported as skipped, never passed.
const db = new MigratedSchema('t07a');
const alpha = fixtureIds('alpha');
const beta = fixtureIds('beta');
const NOW = new Date('2026-11-05T09:00:00Z');
const REASON = 'Support request FIX-0701: discovery check';

/** The fake provider's declaration (packages/integrations), as the API passes it. */
const CAPABILITIES: OrganizationSearchCapabilities = {
  supportedFilters: ['industries', 'countries', 'employees', 'keywords'],
  maxPageSize: 25,
  maxResultsPerSearch: 500,
  attribution:
    'Synthetic companies from the Lead Fennec test directory, not real businesses.',
};
const FAKE: DiscoveryProviderInfo = {
  source: 'FAKE',
  capabilities: CAPABILITIES,
};

const issuesOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof DiscoveryRequestError) {
      return error.issues;
    }
    throw error;
  }
  throw new Error('expected a DiscoveryRequestError');
};

describe.runIf(testDatabaseUrl !== undefined)(
  'lead discovery requests on PostgreSQL',
  () => {
    let prisma: PrismaClient;
    let factory: FixtureFactory;

    const adminOf = (tenant: 'alpha' | 'beta' = 'alpha') =>
      memberScope(
        prisma,
        tenant === 'alpha'
          ? { tenantId: alpha.tenant, userId: FIXTURE_USERS.alphaAdmin.id }
          : { tenantId: beta.tenant, userId: FIXTURE_USERS.betaAdmin.id },
        { now: () => NOW },
      );
    const icp = (criteria: unknown, status: 'ACTIVE' | 'ARCHIVED' = 'ACTIVE') =>
      prisma.icp.create({
        data: {
          tenantId: alpha.tenant,
          name: `ICP ${randomUUID()}`,
          criteria: criteria as object,
          status,
        },
      });
    const counts = async () => ({
      imports: await prisma.import.count({
        where: { tenantId: alpha.tenant, source: 'ORGANIZATION_SEARCH' },
      }),
      tasks: await prisma.jobTask.count({
        where: { tenantId: alpha.tenant, taskType: DISCOVERY_TASK_TYPE },
      }),
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

    it('turns an ICP into a pending, tenant-owned search with its inputs and a queued task', async () => {
      const admin = await adminOf();
      const run = await admin.discovery.request({ icpId: alpha.icp }, FAKE);
      expect(run).toMatchObject({
        source: 'ORGANIZATION_SEARCH',
        status: 'PENDING',
        search: {
          icpId: alpha.icp,
          provider: 'FAKE',
          // Company filters only; the people criteria wait for contact discovery (08A).
          filters: {
            industries: ['software'],
            employees: { min: 50, max: 500 },
          },
          maxResults: 100,
          ignoredCriteria: ['titles'],
          attribution: CAPABILITIES.attribution,
        },
        counts: { found: 0, saved: 0, skipped: 0, failed: 0 },
        errorCode: null,
        startedAt: null,
        completedAt: null,
      });

      const row = await prisma.import.findUniqueOrThrow({
        where: { tenantId_id: { tenantId: alpha.tenant, id: run.id } },
      });
      expect(row).toMatchObject({
        tenantId: alpha.tenant,
        icpId: alpha.icp,
        searchProvider: 'FAKE',
        resultLimit: 100,
        sourceMetadata: {
          attribution: CAPABILITIES.attribution,
          ignoredCriteria: ['titles'],
          capabilities: {
            supportedFilters: CAPABILITIES.supportedFilters,
            maxPageSize: 25,
            maxResultsPerSearch: 500,
          },
        },
      });
      expect(row.querySha256).toMatch(/^[0-9a-f]{64}$/);

      // The task names only the import; the worker reads the rest from the row.
      const task = await prisma.jobTask.findUniqueOrThrow({
        where: {
          tenantId_taskType_idempotencyKey: {
            tenantId: alpha.tenant,
            taskType: DISCOVERY_TASK_TYPE,
            idempotencyKey: `import:${run.id}`,
          },
        },
      });
      expect(task).toMatchObject({
        status: 'PENDING',
        payload: { importId: run.id },
      });

      const audit = await prisma.auditRecord.findFirstOrThrow({
        where: { tenantId: alpha.tenant, action: 'lead_discovery.requested' },
      });
      expect(audit).toMatchObject({
        targetType: 'import',
        targetId: run.id,
        actorUserId: FIXTURE_USERS.alphaAdmin.id,
        metadata: { icpId: alpha.icp, provider: 'FAKE', maxResults: 100 },
      });

      await expect(admin.discovery.get(run.id)).resolves.toEqual(run);

      // The same search again is a new run with the same query hash.
      const again = await admin.discovery.request(
        { icpId: alpha.icp, maxResults: 100 },
        FAKE,
      );
      expect(again.id).not.toBe(run.id);
      const againRow = await prisma.import.findUniqueOrThrow({
        where: { tenantId_id: { tenantId: alpha.tenant, id: again.id } },
      });
      expect(againRow.querySha256).toBe(row.querySha256);
      const bigger = await admin.discovery.request(
        { icpId: alpha.icp, maxResults: 200 },
        FAKE,
      );
      const biggerRow = await prisma.import.findUniqueOrThrow({
        where: { tenantId_id: { tenantId: alpha.tenant, id: bigger.id } },
      });
      expect(biggerRow.querySha256).not.toBe(row.querySha256);
    });

    it('refuses unsupported filters and excessive limits clearly, writing nothing', async () => {
      const admin = await adminOf();
      const before = await counts();
      const technologies = await icp({
        industries: ['software'],
        technologies: ['CRM'],
      });
      expect(
        await issuesOf(
          admin.discovery.request({ icpId: technologies.id }, FAKE),
        ),
      ).toEqual([
        {
          path: 'criteria.technologies',
          message:
            "Company search can't filter by technologies yet. Remove it from the profile to search.",
        },
      ]);
      const unknown = await icp({ industries: ['software'], sector: 'saas' });
      expect(
        await issuesOf(admin.discovery.request({ icpId: unknown.id }, FAKE)),
      ).toEqual([
        {
          path: 'criteria',
          message: 'Lead Fennec doesn\'t recognize the filter "sector".',
        },
      ]);
      const peopleOnly = await icp({ titles: ['CEO'] });
      const [noCompany] = await issuesOf(
        admin.discovery.request({ icpId: peopleOnly.id }, FAKE),
      );
      expect(noCompany?.path).toBe('criteria');
      expect(noCompany?.message).toMatch(/no company filters/);

      // Over the provider's cap (500): a clear message with the real limit.
      expect(
        await issuesOf(
          admin.discovery.request({ icpId: alpha.icp, maxResults: 600 }, FAKE),
        ),
      ).toEqual([
        {
          path: 'maxResults',
          message: 'Ask for at most 500 companies in one search.',
        },
      ]);
      // Over the platform cap, or not a number of companies: rejected by the request schema.
      for (const maxResults of [1001, 0, 2.5]) {
        await expect(
          admin.discovery.request({ icpId: alpha.icp, maxResults }, FAKE),
        ).rejects.toThrow(ZodError);
      }
      await expect(
        admin.discovery.request(
          { icpId: alpha.icp, filters: { industries: ['x'] } } as never,
          FAKE,
        ),
      ).rejects.toThrow(ZodError);

      const archived = await icp({ industries: ['software'] }, 'ARCHIVED');
      expect(
        await issuesOf(admin.discovery.request({ icpId: archived.id }, FAKE)),
      ).toEqual([
        { path: 'icpId', message: 'This ideal customer profile is archived.' },
      ]);
      expect(await counts()).toEqual(before);
    });

    it('keeps each workspace to its own ICPs and runs', async () => {
      const mine = await (
        await adminOf()
      ).discovery.request({ icpId: alpha.icp }, FAKE);
      const betaAdmin = await adminOf('beta');
      // Alpha's ICP from beta reads exactly like one that doesn't exist.
      expect(
        await issuesOf(betaAdmin.discovery.request({ icpId: alpha.icp }, FAKE)),
      ).toEqual([{ path: 'icpId', message: 'Not found in this workspace.' }]);
      expect(
        await issuesOf(
          betaAdmin.discovery.request({ icpId: randomUUID() }, FAKE),
        ),
      ).toEqual([{ path: 'icpId', message: 'Not found in this workspace.' }]);
      await expect(betaAdmin.discovery.get(mine.id)).rejects.toThrow(
        RecordNotFoundError,
      );
      await expect(betaAdmin.discovery.get('not-a-uuid')).rejects.toThrow(
        RecordNotFoundError,
      );
      // Beta's own ICP works in beta, and the run belongs to beta.
      const theirs = await betaAdmin.discovery.request(
        { icpId: beta.icp },
        FAKE,
      );
      expect(theirs.search?.filters).toEqual({
        industries: ['dental'],
        employees: { min: 5, max: 50 },
      });
      await expect((await adminOf()).discovery.get(theirs.id)).rejects.toThrow(
        RecordNotFoundError,
      );
    });

    it('needs imports.create, and only members may request', async () => {
      const workspace = await factory.workspace();
      const viewer = await factory.user();
      // The factory's member role has no permissions at all.
      await factory.membership({
        tenantId: workspace.tenant.id,
        userId: viewer.id,
        roleId: workspace.memberRole.id,
      });
      const scope = await memberScope(prisma, {
        tenantId: workspace.tenant.id,
        userId: viewer.id,
      });
      await expect(
        scope.discovery.request({ icpId: randomUUID() }, FAKE),
      ).rejects.toThrow(PermissionDeniedError);
      await expect(scope.discovery.get(randomUUID())).rejects.toThrow(
        PermissionDeniedError,
      );

      const worker = systemScope(prisma, {
        tenantId: alpha.tenant,
        name: 'discovery_test',
      });
      await expect(
        worker.discovery.request({ icpId: alpha.icp }, FAKE),
      ).rejects.toThrow(ActorNotAllowedError);

      // A platform admin reads (stated reason) but never requests a search.
      const run = await (
        await adminOf()
      ).discovery.request({ icpId: alpha.icp }, FAKE);
      const support = await platformAdminScope(prisma, {
        tenantId: alpha.tenant,
        userId: FIXTURE_USERS.platformAdmin.id,
        reason: REASON,
      });
      await expect(support.discovery.get(run.id)).resolves.toMatchObject({
        id: run.id,
      });
      await expect(
        support.discovery.request({ icpId: alpha.icp }, FAKE),
      ).rejects.toThrow(ActorNotAllowedError);
    });

    it('keeps search inputs complete and immutable in the database', async () => {
      const run = await (
        await adminOf()
      ).discovery.request({ icpId: alpha.icp }, FAKE);
      // A search without its inputs, or a CSV import with them, is refused.
      await expect(
        prisma.import.create({
          data: { tenantId: alpha.tenant, source: 'ORGANIZATION_SEARCH' },
        }),
      ).rejects.toThrow(/imports_search_check/);
      await expect(
        prisma.import.create({
          data: { tenantId: alpha.tenant, source: 'CSV', icpId: alpha.icp },
        }),
      ).rejects.toThrow(/imports_search_check/);
      // Inputs can't change after the request; progress and status can.
      await expect(
        prisma.import.update({
          where: { tenantId_id: { tenantId: alpha.tenant, id: run.id } },
          data: { searchFilters: { industries: ['retail'] } },
        }),
      ).rejects.toThrow(/search_filters/);
      await expect(
        prisma.import.update({
          where: { tenantId_id: { tenantId: alpha.tenant, id: run.id } },
          data: { resultLimit: 900 },
        }),
      ).rejects.toThrow(/result_limit/);
      await expect(
        prisma.import.update({
          where: { tenantId_id: { tenantId: alpha.tenant, id: run.id } },
          data: { status: 'PROCESSING', startedAt: NOW, totalRows: 3 },
        }),
      ).resolves.toMatchObject({ status: 'PROCESSING', totalRows: 3 });
      await expect(
        prisma.import.update({
          where: { tenantId_id: { tenantId: alpha.tenant, id: run.id } },
          data: { errorCode: 'Provider said: secret' },
        }),
      ).rejects.toThrow(/imports_error_code_check/);
      // The ICP can't be deleted while searches made from it exist.
      await expect(
        prisma.icp.delete({
          where: { tenantId_id: { tenantId: alpha.tenant, id: alpha.icp } },
        }),
      ).rejects.toThrow();
    });
  },
);
