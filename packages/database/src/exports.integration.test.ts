import { EXPORT_LIMITS, LEAD_EXPORT_COLUMNS } from '@lead-fennec-ai/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from './client.js';
import { FIXTURE_USERS, fixtureIds } from './fixtures/fixture-data.js';
import { loadFixtureTenants } from './fixtures/load.js';
import type { PrismaClient } from './generated/prisma/client.js';
import {
  memberScope,
  platformAdminScope,
  systemScope,
  type TenantScope,
} from './tenancy/access.js';
import { ActorNotAllowedError } from './tenancy/actors.js';
import {
  PermissionDeniedError,
  RecordNotFoundError,
} from './tenancy/authorization.js';
import { ExportExpiredError, ExportLimitError } from './tenancy/exports.js';
import { MigratedSchema, testDatabaseUrl } from './testing/migrated-schema.js';

// Lead exports (task 11C, docs/decisions.md D-11C-02) on real PostgreSQL: a member with
// contacts.export makes a file of a search, every cell safe in a spreadsheet; at most 2,000 leads
// (more are cut and the export says so); only that member downloads it, until it expires; then
// its content is deleted (by the download and by the worker's sweep); at most 10 files wait per
// member; audits carry counts only; tenancy and permissions hold. Runs only when
// TEST_DATABASE_URL is set; otherwise reported as skipped.
const db = new MigratedSchema('t11ce');
const alpha = fixtureIds('alpha');
const beta = fixtureIds('beta');
const HOUR = 3_600_000;
const BOM = String.fromCharCode(0xfeff);

describe.runIf(testDatabaseUrl !== undefined)(
  'lead exports on PostgreSQL',
  () => {
    let prisma: PrismaClient;
    let clock = new Date('2026-11-09T10:00:00Z');
    const now = () => clock;

    const as = (
      userId: string,
      tenantId = alpha.tenant,
    ): Promise<TenantScope> =>
      memberScope(prisma, { tenantId, userId }, { now });
    const admin = () => as(FIXTURE_USERS.alphaAdmin.id);

    beforeAll(async () => {
      await db.create();
      prisma = createPrismaClient({
        databaseUrl: db.databaseUrl,
        schema: db.name,
        maxConnections: 1,
      });
      await loadFixtureTenants(prisma);
      // A lead whose name a spreadsheet would run as a formula.
      await prisma.contact.create({
        data: {
          tenantId: alpha.tenant,
          firstName: '=HYPERLINK("http://evil.example","x")',
          lastName: '+1',
          title: '@SUM(A1)',
          email: 'formula@evil.example',
          normalizedEmail: 'formula@evil.example',
          emailDomain: 'evil.example',
        },
      });
    }, 120_000);

    afterAll(async () => {
      await prisma.$disconnect();
      await db.drop();
    });

    it('makes a spreadsheet-safe file of a search, for its maker only, until it expires', async () => {
      const scope = await admin();
      const made = await scope.exports.createLeadExport({
        filters: { sort: 'name', order: 'asc' },
      });
      expect(made).toMatchObject({
        kind: 'LEADS',
        status: 'READY',
        rowCount: 4,
        truncated: false,
        filters: { sort: 'name', order: 'asc' },
        downloadCount: 0,
        downloadedAt: null,
      });
      expect(made.fileName).toMatch(/^leads-\d{12}\.csv$/);
      expect(made.expiresAt.getTime() - made.createdAt.getTime()).toBe(
        EXPORT_LIMITS.ttlHours * HOUR,
      );

      const file = await scope.exports.download(made.id);
      expect(file.fileName).toBe(made.fileName);
      expect(file.content.startsWith(BOM)).toBe(true);
      const lines = file.content.slice(1).split('\r\n');
      expect(lines[0]).toBe(LEAD_EXPORT_COLUMNS.join(','));
      // Formulas stay text: a leading apostrophe, quoted where needed.
      const evil = lines.find((line) => line.includes('formula@evil.example'));
      expect(evil).toContain(`"'=HYPERLINK(""http://evil.example"",""x"") +1"`);
      expect(evil).toContain(`'@SUM(A1)`);
      expect(lines).toHaveLength(4 + 2);
      // Only alpha's leads.
      expect(file.content).not.toContain(beta.contactShared);

      // Another workspace, and a member without contacts.export, can't have it.
      const betaAdmin = await as(FIXTURE_USERS.betaAdmin.id, beta.tenant);
      await expect(betaAdmin.exports.download(made.id)).rejects.toBeInstanceOf(
        RecordNotFoundError,
      );
      const member = await as(FIXTURE_USERS.sharedMember.id);
      await expect(member.exports.download(made.id)).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );
      await expect(
        member.exports.createLeadExport({ filters: {} }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      await expect(member.exports.list({})).rejects.toBeInstanceOf(
        PermissionDeniedError,
      );

      // Listed for its maker, downloads counted and audited without any lead's data.
      const listed = await scope.exports.list({});
      expect(listed.items.map((item) => item.id)).toContain(made.id);
      expect(listed.items.find((i) => i.id === made.id)).toMatchObject({
        downloadCount: 1,
        status: 'READY',
      });
      const audit = await prisma.auditRecord.findMany({
        where: { tenantId: alpha.tenant, targetId: made.id },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      });
      expect(audit.map((a) => [a.action, a.metadata])).toEqual([
        ['leads.exported', { rows: 4, truncated: false }],
        ['leads.export_downloaded', null],
      ]);

      // After its time: refused, and its content deleted.
      clock = new Date(clock.getTime() + EXPORT_LIMITS.ttlHours * HOUR + 1);
      const later = await admin();
      expect((await later.exports.list({})).items[0]).toMatchObject({
        id: made.id,
        status: 'EXPIRED',
      });
      await expect(later.exports.download(made.id)).rejects.toBeInstanceOf(
        ExportExpiredError,
      );
      const row = await prisma.export.findUniqueOrThrow({
        where: { tenantId_id: { tenantId: alpha.tenant, id: made.id } },
      });
      expect(row).toMatchObject({ status: 'EXPIRED', content: null });
      expect(row.purgedAt).not.toBeNull();
      // An expired file's content can't be written again.
      await expect(
        prisma.export.update({
          where: { tenantId_id: { tenantId: alpha.tenant, id: made.id } },
          data: { content: 'x', status: 'READY', purgedAt: null },
        }),
      ).rejects.toThrow();
    });

    it('cuts a large search at the limit and says so', async () => {
      const extra = EXPORT_LIMITS.maxRows + 5;
      await prisma.contact.createMany({
        data: Array.from({ length: extra }, (_, i) => ({
          tenantId: alpha.tenant,
          firstName: 'Bulk',
          lastName: `Lead ${String(i)}`,
          email: `bulk${String(i)}@bulk.example`,
          normalizedEmail: `bulk${String(i)}@bulk.example`,
          emailDomain: 'bulk.example',
        })),
      });
      const scope = await admin();
      const made = await scope.exports.createLeadExport({
        filters: { q: 'bulk' },
      });
      expect(made).toMatchObject({
        rowCount: EXPORT_LIMITS.maxRows,
        truncated: true,
        filters: { q: 'bulk' },
      });
      const file = await scope.exports.download(made.id);
      expect(file.content.split('\r\n')).toHaveLength(
        EXPORT_LIMITS.maxRows + 2,
      );
      // An export starts from the first lead: no page of a search.
      await expect(
        scope.exports.createLeadExport({ filters: { cursor: 'x' } }),
      ).rejects.toThrow();
    }, 120_000);

    it('keeps at most 10 files waiting per member, and the sweep deletes expired ones', async () => {
      const scope = await admin();
      for (let i = 0; i < EXPORT_LIMITS.maxLivePerMember; i += 1) {
        const waiting = await prisma.export.count({
          where: { tenantId: alpha.tenant, status: 'READY' },
        });
        if (waiting >= EXPORT_LIMITS.maxLivePerMember) {
          break;
        }
        await scope.exports.createLeadExport({ filters: { q: 'formula' } });
      }
      await expect(
        scope.exports.createLeadExport({ filters: { q: 'formula' } }),
      ).rejects.toBeInstanceOf(ExportLimitError);

      // A day later the worker's sweep (a system scope per workspace) deletes their content.
      clock = new Date(clock.getTime() + EXPORT_LIMITS.ttlHours * HOUR + 1);
      const sweep = systemScope(
        prisma,
        { tenantId: alpha.tenant, name: 'export_retention' },
        { now },
      );
      expect(await sweep.exports.purgeExpired()).toBe(
        EXPORT_LIMITS.maxLivePerMember,
      );
      expect(
        await prisma.export.count({
          where: { tenantId: alpha.tenant, content: { not: null } },
        }),
      ).toBe(0);
      expect(
        await prisma.auditRecord.count({
          where: { tenantId: alpha.tenant, action: 'exports.purged' },
        }),
      ).toBe(1);
      // Beta's fixture file was never alpha's to purge.
      expect(
        await prisma.export.count({ where: { tenantId: beta.tenant } }),
      ).toBe(1);
      // Room again.
      await expect(
        scope.exports.createLeadExport({ filters: { q: 'formula' } }),
      ).resolves.toMatchObject({ status: 'READY', rowCount: 1 });
      // Workers and platform admins never make or read files.
      await expect(
        sweep.exports.createLeadExport({ filters: {} }),
      ).rejects.toBeInstanceOf(ActorNotAllowedError);
      const support = await platformAdminScope(prisma, {
        tenantId: alpha.tenant,
        userId: FIXTURE_USERS.platformAdmin.id,
        reason: 'Support request FIX-0012: checking an export',
      });
      await expect(support.exports.list({})).rejects.toBeInstanceOf(
        ActorNotAllowedError,
      );
    });
  },
);
