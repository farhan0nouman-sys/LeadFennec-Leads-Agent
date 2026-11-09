import { ORGANIZATION_IMPORT_LIMITS, toCsv } from '@lead-fennec-ai/shared';
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
import { CsvImportError } from './tenancy/discovery.js';
import { MigratedSchema, testDatabaseUrl } from './testing/migrated-schema.js';

// CSV imports of companies (task 07C, docs/decisions.md D-07C-03 and D-07C-04) on real
// PostgreSQL: column mapping, safe normalization, suppression checks, an error report per row,
// no duplicates when a file is imported again, limits, and tenancy. Runs only when
// TEST_DATABASE_URL is set; otherwise it is reported as skipped, never passed.
const db = new MigratedSchema('t07c');
const alpha = fixtureIds('alpha');
const beta = fixtureIds('beta');
const REASON = 'Support request FIX-0702: import check';

const FILE = [
  'Company,Website,Domain,Employees,Country,Notes',
  'Acme Analytics GmbH,https://www.acme-analytics.example,,120,DE,private note',
  '"Beta, Inc.",,beta.example,"1,200",us,',
  'Gamma Partners,,,,,',
  '"=HYPERLINK(""http://evil.example"",""x"")",,evil.example,,,',
  'Rival EU,,eu.competitor.test,,,',
  ',,nameless.example,,,',
  'Bad Size,,bad.example,lots,Germany,',
  'Acme Analytics,,acme-analytics.example,,,',
  'Shared Prospect,,shared-prospect.test,,,',
  '',
].join('\n');

const MAPPING = {
  name: 'Company',
  website: 'website',
  domain: 'Domain',
  employees: 'Employees',
  country: 'Country',
};

const issuesOf = async (promise: Promise<unknown>) => {
  try {
    await promise;
  } catch (error) {
    if (error instanceof CsvImportError) {
      return error.issues;
    }
    throw error;
  }
  throw new Error('expected a CsvImportError');
};

describe.runIf(testDatabaseUrl !== undefined)(
  'CSV imports of companies on PostgreSQL',
  () => {
    let prisma: PrismaClient;
    let factory: FixtureFactory;

    const adminOf = (tenant: 'alpha' | 'beta' = 'alpha') =>
      memberScope(
        prisma,
        tenant === 'alpha'
          ? { tenantId: alpha.tenant, userId: FIXTURE_USERS.alphaAdmin.id }
          : { tenantId: beta.tenant, userId: FIXTURE_USERS.betaAdmin.id },
      );
    const organizations = (tenantId: string) =>
      prisma.organization.count({ where: { tenantId } });

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

    it('saves each row as created, matched, excluded or failed, with the reasons', async () => {
      const admin = await adminOf();
      const before = await organizations(alpha.tenant);
      const run = await admin.discovery.importCsv({
        fileName: 'prospects.csv',
        content: FILE,
        mapping: MAPPING,
      });
      expect(run).toMatchObject({
        source: 'CSV',
        status: 'COMPLETED',
        fileName: 'prospects.csv',
        search: null,
        counts: {
          found: 9,
          saved: 6,
          created: 4,
          excluded: 1,
          failed: 2,
          repeated: 0,
        },
      });
      expect(await organizations(alpha.tenant)).toBe(before + 4);
      expect(await organizations(beta.tenant)).toBe(2);

      const results = await admin.discovery.results(run.id, { limit: 100 });
      expect(
        results.items.map((r) => [r.position, r.outcome, r.name, r.domain]),
      ).toEqual([
        [2, 'CREATED', 'Acme Analytics GmbH', 'acme-analytics.example'],
        [3, 'CREATED', 'Beta, Inc.', 'beta.example'],
        [4, 'CREATED', 'Gamma Partners', null],
        [5, 'CREATED', '=HYPERLINK("http://evil.example","x")', 'evil.example'],
        [6, 'EXCLUDED', 'Rival EU', 'eu.competitor.test'],
        [7, 'FAILED', '', 'nameless.example'],
        [8, 'FAILED', 'Bad Size', 'bad.example'],
        // The same company again in the file, and one the workspace already had.
        [9, 'MATCHED', 'Acme Analytics', 'acme-analytics.example'],
        [10, 'MATCHED', 'Shared Prospect', 'shared-prospect.test'],
      ]);
      expect(results.items[4]?.issues).toEqual([
        {
          field: 'domain',
          message:
            "The domain competitor.test is on this workspace's suppression list.",
        },
      ]);
      expect(results.items[6]?.issues).toEqual([
        {
          field: 'employees',
          message: 'Use a whole number of employees, such as 120.',
        },
        {
          field: 'country',
          message: 'Use a two-letter country code, such as US.',
        },
      ]);
      const failedOnly = await admin.discovery.results(run.id, {
        outcome: 'FAILED',
      });
      expect(failedOnly.items.map((r) => r.position)).toEqual([7, 8]);

      // Cleaned and normalized; the formula is only text; unmapped columns are not kept.
      const acme = await prisma.organization.findFirstOrThrow({
        where: {
          tenantId: alpha.tenant,
          normalizedDomain: 'acme-analytics.example',
        },
      });
      expect(acme).toMatchObject({
        name: 'Acme Analytics GmbH',
        nameKey: 'acme analytics',
        websiteUrl: 'https://www.acme-analytics.example/',
        employeeCount: 120,
        countryCode: 'DE',
      });
      const beta2 = await prisma.organization.findFirstOrThrow({
        where: { tenantId: alpha.tenant, normalizedDomain: 'beta.example' },
      });
      expect(beta2).toMatchObject({ employeeCount: 1200, countryCode: 'US' });
      const records = await prisma.sourceRecord.findMany({
        where: { tenantId: alpha.tenant, importId: run.id },
      });
      expect(JSON.stringify(records.map((r) => r.payload))).not.toContain(
        'private note',
      );
      // The error report a person downloads keeps the formula as text.
      expect(
        toCsv([
          ['Row', 'Company'],
          [5, '=HYPERLINK("http://evil.example","x")'],
        ]),
      ).toContain(`'=HYPERLINK`);
      expect(
        await prisma.auditRecord.count({
          where: {
            tenantId: alpha.tenant,
            action: 'organization_import.completed',
            targetId: run.id,
          },
        }),
      ).toBe(1);
    });

    it('imports the same file again without duplicating a company', async () => {
      const admin = await adminOf();
      const before = await organizations(alpha.tenant);
      const again = await admin.discovery.importCsv({
        fileName: 'prospects.csv',
        content: FILE,
        mapping: MAPPING,
      });
      expect(again.counts).toEqual({
        found: 9,
        saved: 6,
        created: 0,
        excluded: 1,
        failed: 2,
        repeated: 0,
      });
      expect(await organizations(alpha.tenant)).toBe(before);
      const list = await admin.discovery.list({ limit: 5 });
      expect(list.items[0]?.id).toBe(again.id);
    });

    it('refuses a file it cannot read, or a mapping it cannot apply', async () => {
      const admin = await adminOf();
      const before = await prisma.import.count({
        where: { tenantId: alpha.tenant, source: 'CSV' },
      });
      expect(
        await issuesOf(
          admin.discovery.importCsv({
            fileName: 'a.csv',
            content: 'Company\n"open',
            mapping: { name: 'Company' },
          }),
        ),
      ).toEqual([
        { path: 'content', message: 'A quoted cell is not closed. (line 2)' },
      ]);
      expect(
        await issuesOf(
          admin.discovery.importCsv({
            fileName: 'a.csv',
            content: 'Company,Domain\nAcme,acme.example',
            mapping: { name: 'Company', domain: 'Site', country: 'Land' },
          }),
        ),
      ).toEqual([
        { path: 'mapping.domain', message: 'The file has no column "Site".' },
        { path: 'mapping.country', message: 'The file has no column "Land".' },
      ]);
      expect(
        await issuesOf(
          admin.discovery.importCsv({
            fileName: 'a.csv',
            content: 'Company\n',
            mapping: { name: 'Company' },
          }),
        ),
      ).toEqual([
        { path: 'content', message: 'The file has no rows below the header.' },
      ]);
      const tooMany = [
        'Company',
        ...Array.from(
          { length: ORGANIZATION_IMPORT_LIMITS.maxRows + 1 },
          (_, i) => `C${String(i)}`,
        ),
      ].join('\n');
      expect(
        (
          await issuesOf(
            admin.discovery.importCsv({
              fileName: 'a.csv',
              content: tooMany,
              mapping: { name: 'Company' },
            }),
          )
        )[0]?.message,
      ).toMatch(/^The file has too many rows\./);
      await expect(
        admin.discovery.importCsv({
          fileName: 'a.csv',
          content: 'x'.repeat(ORGANIZATION_IMPORT_LIMITS.maxChars + 1),
          mapping: { name: 'Company' },
        }),
      ).rejects.toThrow(ZodError);
      expect(
        await prisma.import.count({
          where: { tenantId: alpha.tenant, source: 'CSV' },
        }),
      ).toBe(before);
    });

    it('keeps imports to their workspace and to members who may import', async () => {
      const mine = await (
        await adminOf()
      ).discovery.importCsv({
        fileName: 'one.csv',
        content: 'Company\nSolo Co',
        mapping: { name: 'Company' },
      });
      const betaAdmin = await adminOf('beta');
      await expect(betaAdmin.discovery.get(mine.id)).rejects.toThrow(
        RecordNotFoundError,
      );
      await expect(betaAdmin.discovery.results(mine.id, {})).rejects.toThrow(
        RecordNotFoundError,
      );
      await expect(betaAdmin.discovery.cancel(mine.id)).rejects.toThrow(
        RecordNotFoundError,
      );

      const workspace = await factory.workspace();
      const viewer = await factory.user();
      await factory.membership({
        tenantId: workspace.tenant.id,
        userId: viewer.id,
        roleId: workspace.memberRole.id,
      });
      const noPermission = await memberScope(prisma, {
        tenantId: workspace.tenant.id,
        userId: viewer.id,
      });
      const file = {
        fileName: 'x.csv',
        content: 'Company\nX',
        mapping: { name: 'Company' },
      };
      await expect(noPermission.discovery.importCsv(file)).rejects.toThrow(
        PermissionDeniedError,
      );
      await expect(noPermission.discovery.list({})).rejects.toThrow(
        PermissionDeniedError,
      );
      const worker = systemScope(prisma, {
        tenantId: alpha.tenant,
        name: 'import_test',
      });
      await expect(worker.discovery.importCsv(file)).rejects.toThrow(
        ActorNotAllowedError,
      );
      // A platform admin reads with a stated reason, but never imports or cancels.
      const support = await platformAdminScope(prisma, {
        tenantId: alpha.tenant,
        userId: FIXTURE_USERS.platformAdmin.id,
        reason: REASON,
      });
      const read = await support.discovery.results(mine.id, {});
      expect(read.items.map((r) => r.outcome)).toEqual(['CREATED']);
      await expect(support.discovery.importCsv(file)).rejects.toThrow(
        ActorNotAllowedError,
      );
      // Members can't run the worker's steps.
      const admin = await adminOf();
      await expect(admin.discovery.beginSearch(mine.id)).rejects.toThrow(
        ActorNotAllowedError,
      );
      // Options: usable ICPs only, and the provider's limits.
      const options = await admin.discovery.options({
        source: 'FAKE',
        capabilities: {
          supportedFilters: ['industries'],
          maxPageSize: 25,
          maxResultsPerSearch: 500,
          attribution: 'Synthetic.',
        },
      });
      expect(options.icps.map((icp) => icp.id)).toContain(alpha.icp);
      expect(options.search).toMatchObject({
        provider: 'FAKE',
        maxResults: 500,
        defaultResults: 100,
      });
      expect(options.csv).toEqual({
        maxBytes: ORGANIZATION_IMPORT_LIMITS.maxChars,
        maxRows: ORGANIZATION_IMPORT_LIMITS.maxRows,
        fields: [
          'name',
          'domain',
          'website',
          'industry',
          'employees',
          'country',
        ],
      });
    });
  },
);
