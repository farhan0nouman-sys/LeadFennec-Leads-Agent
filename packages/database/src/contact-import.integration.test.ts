import { randomUUID } from 'node:crypto';
import {
  CONTACT_IMPORT_BATCH_ROWS,
  normalizeContactIdentity,
} from '@lead-fennec-ai/shared';
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
import { saveContacts } from './tenancy/contact-store.js';
import { CsvImportError } from './tenancy/discovery.js';
import { MigratedSchema, testDatabaseUrl } from './testing/migrated-schema.js';

// People imports from CSV files (task 11C, docs/decisions.md D-11C-01) on real PostgreSQL: every
// row is checked when the file is accepted (failed rows reported at once, unmapped columns never
// kept); the worker saves the rest in batches with the run's progress; people are matched, never
// duplicated; addresses and domains on the do-not-contact list are excluded, and so is a known
// suppressed person who comes back without their address (matched by their profile); erased
// people are never imported again; a cancelled import keeps only what was done; tenancy and
// permissions hold. Runs only when TEST_DATABASE_URL is set; otherwise reported as skipped.
const db = new MigratedSchema('t11ci');
const alpha = fixtureIds('alpha');
const beta = fixtureIds('beta');
const REASON = 'Support request FIX-0011: checking an import';

const MAPPING = {
  firstName: 'First Name',
  lastName: 'Last Name',
  email: 'Email',
  title: 'Title',
  company: 'Company',
  companyDomain: 'Domain',
  country: 'Country',
  linkedinUrl: 'LinkedIn',
} as const;
const HEADER =
  'First Name,Last Name,Email,Title,Company,Domain,Country,LinkedIn,Secret';

describe.runIf(testDatabaseUrl !== undefined)(
  'people imports on PostgreSQL',
  () => {
    let prisma: PrismaClient;

    const admin = (): Promise<TenantScope> =>
      memberScope(prisma, {
        tenantId: alpha.tenant,
        userId: FIXTURE_USERS.alphaAdmin.id,
      });
    const worker = (tenantId = alpha.tenant) =>
      systemScope(prisma, { tenantId, name: 'contact_import' });

    /** Runs the worker's steps to the end, like the job. */
    async function runImport(runId: string) {
      const scope = worker();
      expect(await scope.contactImports.begin(runId)).toEqual({
        state: 'run',
      });
      for (;;) {
        const step = await scope.contactImports.saveBatch(runId);
        if (step.state !== 'continue') {
          break;
        }
      }
      return scope.contactImports.finish(runId);
    }

    const outcomes = async (runId: string) =>
      (
        await (await admin()).discovery.results(runId, { limit: 100 })
      ).items.map((r) => [r.position, r.outcome, r.name]);

    beforeAll(async () => {
      await db.create();
      prisma = createPrismaClient({
        databaseUrl: db.databaseUrl,
        schema: db.name,
        maxConnections: 1,
      });
      await loadFixtureTenants(prisma);
    }, 120_000);

    afterAll(async () => {
      await prisma.$disconnect();
      await db.drop();
    });

    it('checks every row at once, then saves the rest in batches, keeping only mapped columns', async () => {
      const scope = await admin();
      const content = [
        HEADER,
        // An existing person (matched by address, never a second contact).
        'Alex,Rivera,ALEX.RIVERA@shared-prospect.test,VP Sales,Shared Prospect,shared-prospect.test,US,,s1',
        // New; a formula stays text.
        'Nina,Park,nina@new-co.example,=SUM(A1),New Co,new-co.example,de,,s2',
        // On the do-not-contact list: the address, and a domain under a suppressed one.
        'Opted,Out,opted.out@shared-prospect.test,CEO,Shared Prospect,shared-prospect.test,US,,s3',
        'Rival,Person,ceo@eu.competitor.test,CEO,Competitor,eu.competitor.test,US,,s4',
        // Failed: a malformed address, nothing that identifies the person, no last name.
        'Bad,Email,not-an-address,CTO,Bad Co,bad.example,US,,s5',
        'No,Identity,,CTO,Nameless Co,,,,s6',
        'Sam,,sam@new-co.example,CTO,New Co,new-co.example,US,,s7',
        // New, identified by the company domain: saved, but without an address not listed.
        'Lee,Wong,,Engineer,Wong Co,wong.example,US,,s8',
      ].join('\n');
      const accepted = await scope.contactImports.request({
        fileName: 'people.csv',
        content,
        mapping: MAPPING,
        leadListId: alpha.leadList,
      });
      expect(accepted).toMatchObject({
        source: 'CONTACT_CSV',
        status: 'PENDING',
        fileName: 'people.csv',
        counts: { found: 8, saved: 0, failed: 3, excluded: 0, repeated: 0 },
        contactImport: { leadListId: alpha.leadList, rows: 8, processed: 3 },
      });
      // The failed rows are reported before the worker runs, with their reasons.
      const failed = await scope.discovery.results(accepted.id, {
        outcome: 'FAILED',
      });
      expect(
        failed.items.map((r) => [r.position, r.kind, r.issues[0]?.field]),
      ).toEqual([
        [6, 'person', 'email'],
        [7, 'person', 'person'],
        [8, 'person', 'lastName'],
      ]);
      const task = await prisma.jobTask.findFirstOrThrow({
        where: {
          tenantId: alpha.tenant,
          idempotencyKey: `import:${accepted.id}`,
        },
      });
      expect(task.taskType).toBe('contact_import.run');
      expect(task.payload).toEqual({ importId: accepted.id });

      const finished = await runImport(accepted.id);
      expect(finished).toMatchObject({
        status: 'COMPLETED',
        counts: {
          found: 8,
          saved: 3,
          created: 2,
          excluded: 2,
          failed: 3,
          repeated: 0,
        },
        contactImport: { rows: 8, processed: 8 },
      });
      expect(await outcomes(accepted.id)).toEqual([
        [2, 'MATCHED', 'Alex Rivera'],
        [3, 'CREATED', 'Nina Park'],
        [4, 'EXCLUDED', 'Opted Out'],
        [5, 'EXCLUDED', 'Rival Person'],
        [6, 'FAILED', 'Bad Email'],
        [7, 'FAILED', 'No Identity'],
        [8, 'FAILED', 'Sam'],
        [9, 'CREATED', 'Lee Wong'],
      ]);
      const results = (
        await scope.discovery.results(accepted.id, { limit: 100 })
      ).items;
      const excluded = results.find((r) => r.position === 4);
      expect(excluded).toMatchObject({
        kind: 'person',
        email: 'opted.out@shared-prospect.test',
        contactId: null,
        issues: [
          {
            field: 'email',
            message: 'This address is on the do-not-contact list.',
          },
        ],
      });
      // Nobody on the list was saved, and no company came in for them.
      expect(
        await prisma.contact.count({
          where: {
            tenantId: alpha.tenant,
            normalizedEmail: {
              in: ['opted.out@shared-prospect.test', 'ceo@eu.competitor.test'],
            },
          },
        }),
      ).toBe(0);
      expect(
        await prisma.organization.count({
          where: {
            tenantId: alpha.tenant,
            normalizedDomain: 'eu.competitor.test',
          },
        }),
      ).toBe(0);
      // The matched person is the fixture's own, not a copy.
      expect(results.find((r) => r.position === 2)?.contactId).toBe(
        alpha.contactShared,
      );
      const nina = await prisma.contact.findFirstOrThrow({
        where: {
          tenantId: alpha.tenant,
          normalizedEmail: 'nina@new-co.example',
        },
      });
      expect(nina).toMatchObject({
        title: '=SUM(A1)',
        countryCode: 'DE',
        firstName: 'Nina',
      });
      // People with an address go on the list; Lee has none.
      const listed = await prisma.leadListMember.findMany({
        where: { tenantId: alpha.tenant, leadListId: alpha.leadList },
        select: { contactId: true },
      });
      expect(listed.map((m) => m.contactId)).toEqual(
        expect.arrayContaining([alpha.contactShared, nina.id]),
      );
      const lee = results.find((r) => r.position === 9);
      expect(lee?.issues).toEqual([
        {
          field: 'email',
          message: 'No email address: not added to the lead list.',
        },
      ]);
      expect(listed.map((m) => m.contactId)).not.toContain(lee?.contactId);
      // Only the mapped columns are kept.
      const record = await prisma.sourceRecord.findFirstOrThrow({
        where: {
          tenantId: alpha.tenant,
          importId: accepted.id,
          importRowNumber: 3,
        },
      });
      expect(JSON.stringify(record.payload)).not.toContain('s2');
      expect(record.provider).toBe('CSV_IMPORT');
      // Audited without anyone's address.
      const audit = await prisma.auditRecord.findMany({
        where: { tenantId: alpha.tenant, targetId: accepted.id },
        orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      });
      expect(audit.map((a) => a.action)).toEqual([
        'contact_import.requested',
        'contact_import.completed',
      ]);
      expect(JSON.stringify(audit)).not.toContain('@');
    });

    it('moves its progress by batches; a cancelled import keeps only what was done', async () => {
      const scope = await admin();
      const rows = Array.from(
        { length: 250 },
        (_, i) =>
          `Batch${String(i)},Person,p${String(i)}@batch.example,Analyst,Batch Co,batch.example,US,,x`,
      );
      const accepted = await scope.contactImports.request({
        fileName: 'batch.csv',
        content: [HEADER, ...rows].join('\n'),
        mapping: MAPPING,
      });
      const steps = worker().contactImports;
      await steps.begin(accepted.id);
      expect(await steps.saveBatch(accepted.id)).toEqual({ state: 'continue' });
      expect(
        (await scope.discovery.get(accepted.id)).contactImport,
      ).toMatchObject({ rows: 250, processed: CONTACT_IMPORT_BATCH_ROWS });
      expect(await steps.saveBatch(accepted.id)).toEqual({ state: 'continue' });
      const cancelled = await scope.discovery.cancel(accepted.id);
      expect(cancelled).toMatchObject({
        status: 'CANCELLED',
        counts: { found: 250, saved: 200 },
        contactImport: { processed: 200 },
      });
      // The rows that were never imported are not kept.
      expect(
        await prisma.sourceRecord.count({
          where: { tenantId: alpha.tenant, importId: accepted.id },
        }),
      ).toBe(200);
      expect(await steps.saveBatch(accepted.id)).toEqual({ state: 'stopped' });
      expect(
        await prisma.contact.count({
          where: { tenantId: alpha.tenant, emailDomain: 'batch.example' },
        }),
      ).toBe(200);
    });

    it('never brings back a suppressed or erased person', async () => {
      const scope = await admin();
      const first = await scope.contactImports.request({
        fileName: 'first.csv',
        content: [
          HEADER,
          'Pat,Erased,pat@reenrol.example,CEO,Reenrol Co,reenrol.example,US,https://www.linkedin.com/in/pat-erased,x',
          'Quinn,Kept,quinn@keep.example,CTO,Keep Co,keep.example,US,https://www.linkedin.com/in/quinn-kept,x',
        ].join('\n'),
        mapping: MAPPING,
      });
      await runImport(first.id);
      const pat = await prisma.contact.findFirstOrThrow({
        where: {
          tenantId: alpha.tenant,
          normalizedEmail: 'pat@reenrol.example',
        },
      });
      const quinn = await prisma.contact.findFirstOrThrow({
        where: {
          tenantId: alpha.tenant,
          normalizedEmail: 'quinn@keep.example',
        },
      });
      // Pat asks to be erased; Quinn asks not to be contacted.
      await scope.suppressions.deleteLead(pat.id, { version: pat.version });
      await scope.suppressions.suppressLead(quinn.id, { reason: 'OPT_OUT' });

      // Again, into a lead list: Pat by address; Quinn by profile only, without the address.
      const again = await scope.contactImports.request({
        fileName: 'again.csv',
        content: [
          HEADER,
          'Pat,Erased,pat@reenrol.example,CEO,Reenrol Co,reenrol.example,US,,x',
          'Quinn,Kept,,CTO,Keep Co,keep.example,US,https://www.linkedin.com/in/quinn-kept,x',
        ].join('\n'),
        mapping: MAPPING,
        leadListId: alpha.leadList,
      });
      const done = await runImport(again.id);
      expect(done.counts).toMatchObject({ saved: 0, excluded: 2, failed: 0 });
      expect(await outcomes(again.id)).toEqual([
        [2, 'EXCLUDED', 'Pat Erased'],
        [3, 'EXCLUDED', 'Quinn Kept'],
      ]);
      expect(
        await prisma.contact.count({
          where: {
            tenantId: alpha.tenant,
            normalizedEmail: 'pat@reenrol.example',
          },
        }),
      ).toBe(0);
      expect(
        await prisma.leadListMember.count({
          where: {
            tenantId: alpha.tenant,
            leadListId: alpha.leadList,
            contactId: quinn.id,
          },
        }),
      ).toBe(0);
      // Found people go through the same check (contact enrichment, task 08C): a known suppressed
      // person without their address is excluded, not matched and listed.
      const outcome = await prisma.$transaction((tx) =>
        saveContacts(
          tx,
          alpha.tenant,
          [
            {
              kind: 'found',
              identity: normalizeContactIdentity({
                firstName: 'Quinn',
                lastName: 'Kept',
                linkedinUrl: 'https://www.linkedin.com/in/quinn-kept',
              }),
              title: null,
              organizationId: alpha.orgOwn,
              source: { provider: 'FAKE', externalId: null },
            },
          ],
          null,
        ),
      );
      expect(outcome).toEqual([
        {
          outcome: 'EXCLUDED',
          issues: [
            {
              field: 'email',
              message: 'This address is on the do-not-contact list.',
            },
          ],
        },
      ]);
    });

    it('checks the lead list, the permissions and the tenant', async () => {
      const scope = await admin();
      const file = {
        fileName: 'x.csv',
        content: `${HEADER}\nAna,Lima,ana@lima.example,CEO,Lima Co,lima.example,BR,,x`,
        mapping: MAPPING,
      };
      // Another workspace's lead list reads like a missing one.
      await expect(
        scope.contactImports.request({ ...file, leadListId: beta.leadList }),
      ).rejects.toMatchObject({
        issues: [
          { path: 'leadListId', message: 'Not found in this workspace.' },
        ],
      });
      await expect(
        scope.contactImports.request({
          ...file,
          mapping: { ...MAPPING, company: 'Employer' },
        }),
      ).rejects.toBeInstanceOf(CsvImportError);
      // A role that may import but not create contacts.
      const role = await prisma.role.create({
        data: { tenantId: alpha.tenant, key: 'importer', name: 'Importer' },
      });
      await prisma.rolePermission.create({
        data: {
          tenantId: alpha.tenant,
          roleId: role.id,
          permissionKey: 'imports.create',
        },
      });
      const address = `importer-${randomUUID()}@fixtures.test`;
      const user = await prisma.user.create({
        data: {
          email: address,
          normalizedEmail: address,
          displayName: 'Importer',
        },
      });
      await prisma.membership.create({
        data: {
          tenantId: alpha.tenant,
          userId: user.id,
          roleId: role.id,
          status: 'ACTIVE',
        },
      });
      const importer = await memberScope(prisma, {
        tenantId: alpha.tenant,
        userId: user.id,
      });
      await expect(
        importer.contactImports.request(file),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
      // Members never run the worker's steps; workers never request.
      const accepted = await scope.contactImports.request(file);
      await expect(
        scope.contactImports.saveBatch(accepted.id),
      ).rejects.toBeInstanceOf(ActorNotAllowedError);
      await expect(
        worker().contactImports.request(file),
      ).rejects.toBeInstanceOf(ActorNotAllowedError);
      // Another workspace's worker can't touch it.
      await expect(
        worker(beta.tenant).contactImports.saveBatch(accepted.id),
      ).rejects.toBeInstanceOf(RecordNotFoundError);
      await expect(
        worker(beta.tenant).contactImports.begin(accepted.id),
      ).rejects.toBeInstanceOf(RecordNotFoundError);
      // A platform admin looks, read-only.
      const support = await platformAdminScope(prisma, {
        tenantId: alpha.tenant,
        userId: FIXTURE_USERS.platformAdmin.id,
        reason: REASON,
      });
      await expect(support.contactImports.request(file)).rejects.toBeInstanceOf(
        ActorNotAllowedError,
      );
      expect((await support.discovery.get(accepted.id)).status).toBe('PENDING');
    });
  },
);
