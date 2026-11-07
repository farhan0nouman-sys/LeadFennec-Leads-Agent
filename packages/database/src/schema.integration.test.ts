import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { normalizeDomain, normalizeEmail } from '@lead-fennec-ai/shared';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from './client.js';
import { fixtureIds } from './fixtures/fixture-data.js';
import {
  loadFixtureTenants,
  summarizeFixtureTenants,
} from './fixtures/load.js';
import type { PrismaClient } from './generated/prisma/client.js';
import {
  MigratedSchema,
  packageDir,
  testDatabaseUrl,
} from './testing/migrated-schema.js';

// Runs against real PostgreSQL only when TEST_DATABASE_URL is set (CI always sets it);
// otherwise the suite is reported as skipped, never as passed. Each run works in its own
// schema inside the *_test database and drops it afterwards.
const db = new MigratedSchema('t03a');
const schema = db.name;
const alpha = fixtureIds('alpha');
const beta = fixtureIds('beta');

function databaseUrl(): string {
  return db.databaseUrl;
}

function connect(): Promise<Client> {
  return db.connect();
}

describe.runIf(testDatabaseUrl !== undefined)(
  'database schema on PostgreSQL',
  () => {
    beforeAll(() => db.create(), 60_000);

    afterAll(() => db.drop(), 60_000);

    it('migrations produce exactly the Prisma schema (no drift)', async () => {
      const require = createRequire(import.meta.url);
      const prismaCli = join(
        dirname(require.resolve('prisma/package.json')),
        'build',
        'index.js',
      );
      const url = new URL(databaseUrl());
      url.searchParams.set('schema', schema);
      const run = promisify(execFile);
      const result = await run(
        process.execPath,
        [
          prismaCli,
          'migrate',
          'diff',
          '--from-config-datasource',
          '--to-schema',
          'prisma/schema.prisma',
          '--exit-code',
        ],
        {
          cwd: packageDir,
          env: {
            ...process.env,
            DATABASE_URL: url.toString(),
            CHECKPOINT_DISABLE: '1',
            PRISMA_HIDE_UPDATE_MESSAGE: '1',
          },
        },
      ).catch((error: unknown) => error as { code?: number; stdout?: string });
      // --exit-code: 0 = no difference, 2 = difference, 1 = error.
      expect(result, JSON.stringify(result)).not.toHaveProperty('code');
    }, 60_000);

    describe('fixture tenants (Prisma Client)', () => {
      let prisma: PrismaClient;

      beforeAll(async () => {
        prisma = createPrismaClient({
          databaseUrl: databaseUrl(),
          schema,
          maxConnections: 1,
        });
        await loadFixtureTenants(prisma);
      }, 60_000);

      afterAll(async () => {
        await prisma.$disconnect();
      });

      it('loads two tenants with the same shape of data', async () => {
        const summary = await summarizeFixtureTenants(prisma);
        expect(summary.map((s) => s.slug)).toEqual([
          'fixture-alpha',
          'fixture-beta',
        ]);
        for (const tenant of summary) {
          expect(tenant).toMatchObject({
            memberships: 2,
            organizations: 2,
            contacts: 3,
            leadListMembers: 3,
            sourceRecords: 3,
            research: 2,
            evidence: 1,
            scores: 3,
            verifications: 1,
          });
        }
      });

      it('is idempotent', async () => {
        const before = await summarizeFixtureTenants(prisma);
        await loadFixtureTenants(prisma);
        expect(await summarizeFixtureTenants(prisma)).toEqual(before);
      });

      it('keeps the same identity separate in each tenant', async () => {
        const email = normalizeEmail('Alex.Rivera@Shared-Prospect.TEST').email;
        const both = await prisma.contact.findMany({
          where: { normalizedEmail: email },
          select: { tenantId: true, title: true },
          orderBy: { title: 'asc' },
        });
        expect(both).toEqual([
          { tenantId: beta.tenant, title: 'Practice Manager' },
          { tenantId: alpha.tenant, title: 'VP Sales' },
        ]);
        const alphaContacts = await prisma.contact.findMany({
          where: { tenantId: alpha.tenant },
        });
        expect(alphaContacts.map((c) => c.tenantId)).toEqual(
          Array(3).fill(alpha.tenant),
        );
        // Unique lookups need the tenant: another tenant's id resolves to nothing.
        await expect(
          prisma.contact.findUnique({
            where: {
              tenantId_id: { tenantId: beta.tenant, id: alpha.contactShared },
            },
          }),
        ).resolves.toBeNull();
      });

      it('stores the raw input and the normalized identity separately', async () => {
        const contact = await prisma.contact.findUniqueOrThrow({
          where: {
            tenantId_id: { tenantId: alpha.tenant, id: alpha.contactShared },
          },
        });
        expect(contact).toMatchObject({
          email: 'Alex.Rivera@Shared-Prospect.TEST',
          normalizedEmail: 'alex.rivera@shared-prospect.test',
          emailDomain: 'shared-prospect.test',
        });
        const org = await prisma.organization.findUniqueOrThrow({
          where: { tenantId_id: { tenantId: beta.tenant, id: beta.orgOwn } },
        });
        expect(org).toMatchObject({
          websiteUrl: 'http://WWW.Beta-Only.test/',
          normalizedDomain: 'beta-only.test',
        });
      });

      it('defaults new tenants to approval required and sending disabled', async () => {
        const settings = await prisma.tenantSettings.findMany({
          orderBy: { timezone: 'asc' },
        });
        expect(settings).toHaveLength(2);
        for (const s of settings) {
          expect(s).toMatchObject({
            requireSendApproval: true,
            outboundSendingEnabled: false,
          });
        }
      });
    });

    describe('planned queries use their indexes', () => {
      let client: Client;
      const t = `'${alpha.tenant}'`;

      beforeAll(async () => {
        client = await connect();
        // Planner statistics, as autovacuum would provide; without them every index on
        // these tiny tables costs the same and ties are broken arbitrarily.
        await client.query('ANALYZE');
      });

      afterAll(async () => {
        await client.end();
      });

      // Each planned query (docs/decisions.md D-03A-07) must be servable by the named index.
      // Sequential scans are disabled for the transaction only, so the planner must use an
      // index if a suitable one exists; the test asserts it picks the intended one.
      it.each([
        [
          'contact by email identity',
          `SELECT id FROM contacts WHERE tenant_id = ${t} AND normalized_email = 'alex.rivera@shared-prospect.test'`,
          'contacts_tenant_id_normalized_email_key',
        ],
        [
          'contacts of an organization',
          `SELECT id FROM contacts WHERE tenant_id = ${t} AND organization_id = '${alpha.orgShared}'`,
          'contacts_tenant_id_organization_id_idx',
        ],
        [
          'contacts by email domain',
          `SELECT id FROM contacts WHERE tenant_id = ${t} AND email_domain = 'shared-prospect.test'`,
          'contacts_tenant_id_email_domain_idx',
        ],
        [
          'newest active contacts',
          `SELECT id FROM contacts WHERE tenant_id = ${t} AND status = 'ACTIVE' ORDER BY created_at DESC LIMIT 50`,
          'contacts_tenant_id_status_created_at_idx',
        ],
        [
          'organization by domain',
          `SELECT id FROM organizations WHERE tenant_id = ${t} AND normalized_domain = 'shared-prospect.test'`,
          'organizations_tenant_id_normalized_domain_key',
        ],
        [
          'members of a lead list, newest first',
          `SELECT contact_id FROM lead_list_members WHERE tenant_id = ${t} AND lead_list_id = '${alpha.leadList}' ORDER BY added_at DESC LIMIT 50`,
          'lead_list_members_tenant_id_lead_list_id_added_at_idx',
        ],
        [
          'lead lists containing a contact',
          `SELECT lead_list_id FROM lead_list_members WHERE tenant_id = ${t} AND contact_id = '${alpha.contactShared}'`,
          'lead_list_members_tenant_id_contact_id_idx',
        ],
        [
          'top scores for an ICP',
          `SELECT id FROM scores WHERE tenant_id = ${t} AND icp_id = '${alpha.icp}' ORDER BY value DESC LIMIT 50`,
          'scores_tenant_id_icp_id_value_idx',
        ],
        [
          'latest verification of a contact',
          `SELECT status FROM verifications WHERE tenant_id = ${t} AND contact_id = '${alpha.contactShared}' ORDER BY checked_at DESC LIMIT 1`,
          'verifications_tenant_id_contact_id_checked_at_idx',
        ],
        [
          'source record by provider id',
          `SELECT id FROM source_records WHERE tenant_id = ${t} AND provider = 'APOLLO' AND external_id = 'apollo-person-0001'`,
          'source_records_tenant_id_provider_external_id_idx',
        ],
        [
          'research history of a contact',
          `SELECT id FROM research WHERE tenant_id = ${t} AND contact_id = '${alpha.contactShared}' ORDER BY created_at DESC LIMIT 20`,
          'research_tenant_id_contact_id_created_at_idx',
        ],
        [
          'recent imports',
          `SELECT id FROM imports WHERE tenant_id = ${t} ORDER BY created_at DESC LIMIT 20`,
          'imports_tenant_id_created_at_idx',
        ],
        [
          "a user's tenants",
          `SELECT tenant_id FROM memberships WHERE user_id = '00000000-0000-4000-8000-c00000000004'`,
          'memberships_user_id_idx',
        ],
      ])('%s', async (_name, sql, index) => {
        await client.query('BEGIN');
        try {
          await client.query('SET LOCAL enable_seqscan = off');
          const plan = await client.query<{ 'QUERY PLAN': unknown }>(
            `EXPLAIN (FORMAT JSON) ${sql}`,
          );
          expect(JSON.stringify(plan.rows[0]?.['QUERY PLAN'])).toContain(
            `"Index Name":"${index}"`,
          );
        } finally {
          await client.query('ROLLBACK');
        }
      });
    });

    describe('integrity constraints (SQL)', () => {
      let client: Client;
      const newId = () => randomUUID();

      beforeAll(async () => {
        client = await connect();
      });

      afterAll(async () => {
        await client.end();
      });

      async function expectSqlState(
        sql: string,
        params: unknown[],
        code: string,
      ): Promise<void> {
        await expect(client.query(sql, params)).rejects.toMatchObject({ code });
      }

      async function count(table: string, tenantId: string): Promise<number> {
        const result = await client.query<{ n: string }>(
          `SELECT count(*) AS n FROM "${table}" WHERE tenant_id = $1`,
          [tenantId],
        );
        return Number(result.rows[0]?.n);
      }

      it("rejects every reference to another tenant's rows", async () => {
        const fk = '23503';
        await expectSqlState(
          `INSERT INTO contacts (tenant_id, id, organization_id, updated_at)
         VALUES ($1, $2, $3, now())`,
          [alpha.tenant, newId(), beta.orgShared],
          fk,
        );
        await expectSqlState(
          `INSERT INTO lead_list_members (tenant_id, lead_list_id, contact_id)
         VALUES ($1, $2, $3)`,
          [alpha.tenant, alpha.leadList, beta.contactShared],
          fk,
        );
        await expectSqlState(
          `INSERT INTO memberships (tenant_id, id, user_id, role_id, updated_at)
         VALUES ($1, $2, '00000000-0000-4000-8000-c00000000001', $3, now())`,
          [alpha.tenant, newId(), beta.roleMember],
          fk,
        );
        await expectSqlState(
          `INSERT INTO scores (tenant_id, id, icp_id, contact_id, value, reason, method)
         VALUES ($1, $2, $3, $4, 50, 'x', 'MANUAL')`,
          [alpha.tenant, newId(), beta.icp, alpha.contactShared],
          fk,
        );
        await expectSqlState(
          `INSERT INTO verifications (tenant_id, id, contact_id, normalized_email, provider, status)
         VALUES ($1, $2, $3, 'alex.rivera@shared-prospect.test', 'fake', 'VALID')`,
          [alpha.tenant, newId(), beta.contactShared],
          fk,
        );
        await expectSqlState(
          `INSERT INTO evidence (tenant_id, id, kind, contact_id, research_id, excerpt)
         VALUES ($1, $2, 'MANUAL_NOTE', $3, $4, 'x')`,
          [alpha.tenant, newId(), alpha.contactShared, beta.research],
          fk,
        );
      });

      it('scopes uniqueness to the tenant', async () => {
        const unique = '23505';
        await expectSqlState(
          `INSERT INTO contacts (tenant_id, id, email, normalized_email, email_domain, updated_at)
         VALUES ($1, $2, 'alex.rivera@shared-prospect.test', 'alex.rivera@shared-prospect.test', 'shared-prospect.test', now())`,
          [alpha.tenant, newId()],
          unique,
        );
        // A record is received once per run (task 07C): the same import row twice is refused.
        await expectSqlState(
          `INSERT INTO source_records (tenant_id, id, provider, import_id, import_row_number, payload, payload_sha256)
         VALUES ($1, $2, 'CSV_IMPORT', $3, 1, '{}', repeat('0', 64))`,
          [alpha.tenant, newId(), alpha.import],
          unique,
        );
        // alpha-only.test exists only in Alpha, so Beta may use it.
        const id = newId();
        await client.query(
          `INSERT INTO organizations (tenant_id, id, name, normalized_domain, updated_at)
         VALUES ($1, $2, 'Beta copy', 'alpha-only.test', now())`,
          [beta.tenant, id],
        );
        await client.query(
          'DELETE FROM organizations WHERE tenant_id = $1 AND id = $2',
          [beta.tenant, id],
        );
      });

      it('accepts only normalized email and domain identities', async () => {
        const check = '23514';
        const contact = (email: string, normalized: string, domain: string) =>
          expectSqlState(
            `INSERT INTO contacts (tenant_id, id, email, normalized_email, email_domain, updated_at)
           VALUES ($1, $2, $3, $4, $5, now())`,
            [alpha.tenant, newId(), email, normalized, domain],
            check,
          );
        await contact('A@x.test', 'A@x.test', 'x.test'); // not lower-cased
        await contact('a@x.test', 'a@x.test', 'y.test'); // email_domain mismatch
        await contact('a@x', 'a@x', 'x'); // no dot in domain
        await expectSqlState(
          `INSERT INTO contacts (tenant_id, id, normalized_email, email_domain, updated_at)
         VALUES ($1, $2, 'a@x.test', 'x.test', now())`,
          [alpha.tenant, newId()],
          check, // identity without the raw email
        );
        for (const domain of [
          'www.x.test',
          'https://x.test',
          'X.test',
          'x.test.',
        ]) {
          await expectSqlState(
            `INSERT INTO organizations (tenant_id, id, name, normalized_domain, updated_at)
           VALUES ($1, $2, 'Bad', $3, now())`,
            [alpha.tenant, newId(), domain],
            check,
          );
        }
        await expectSqlState(
          `INSERT INTO users (id, email, normalized_email, updated_at)
         VALUES ($1, 'Bad', 'Bad@X.test', now())`,
          [newId()],
          check,
        );
      });

      it('agrees with the TypeScript normalizers', async () => {
        const emails = [
          ' Alex.Smith@Example.TEST ',
          "o'brien+tag@sub.example.test",
          'alex@www.example.test',
          'alex@bücher.example',
        ].map((raw) => normalizeEmail(raw).email);
        const domains = [
          'https://WWW.Example.co.uk/path',
          'bücher.example',
          'sub-1.example.test.',
        ].map(normalizeDomain);
        for (const email of emails) {
          const r = await client.query<{ ok: boolean }>(
            'SELECT is_normalized_email($1) AS ok',
            [email],
          );
          expect(r.rows[0]?.ok, email).toBe(true);
        }
        for (const domain of domains) {
          const r = await client.query<{ ok: boolean }>(
            'SELECT is_normalized_domain($1) AS ok',
            [domain],
          );
          expect(r.rows[0]?.ok, domain).toBe(true);
        }
      });

      it('enforces value rules', async () => {
        const check = '23514';
        const score = (
          value: number,
          contactId: string | null,
          orgId: string | null,
        ) =>
          expectSqlState(
            `INSERT INTO scores (tenant_id, id, icp_id, contact_id, organization_id, value, reason, method)
           VALUES ($1, $2, $3, $4, $5, $6, 'x', 'MANUAL')`,
            [alpha.tenant, newId(), alpha.icp, contactId, orgId, value],
            check,
          );
        await score(101, alpha.contactShared, null);
        await score(50, alpha.contactShared, alpha.orgShared); // two subjects
        await score(50, null, null); // no subject
        await expectSqlState(
          `INSERT INTO imports (tenant_id, id, source, total_rows, imported_rows, updated_at)
         VALUES ($1, $2, 'CSV', 1, 2, now())`,
          [alpha.tenant, newId()],
          check,
        );
        await expectSqlState(
          `INSERT INTO tenants (id, slug, name, updated_at)
         VALUES ($1, 'Bad Slug', 'x', now())`,
          [newId()],
          check,
        );
      });

      it('never lets a row move to another tenant', async () => {
        await expectSqlState(
          'UPDATE contacts SET tenant_id = $1 WHERE tenant_id = $2 AND id = $3',
          [beta.tenant, alpha.tenant, alpha.contactNoEmail],
          '23000',
        );
      });

      it('refuses to delete a referenced organization (NO ACTION)', async () => {
        await expectSqlState(
          'DELETE FROM organizations WHERE tenant_id = $1 AND id = $2',
          [alpha.tenant, alpha.orgShared],
          '23503',
        );
      });

      it("cascades a contact's derived data without touching the other tenant", async () => {
        await client.query(
          'DELETE FROM contacts WHERE tenant_id = $1 AND id = $2',
          [alpha.tenant, alpha.contactShared],
        );
        for (const table of [
          'verifications',
          'scores',
          'evidence',
          'research',
          'lead_list_members',
          'source_records',
        ]) {
          const left = await client.query<{ n: string }>(
            `SELECT count(*) AS n FROM "${table}" WHERE tenant_id = $1 AND contact_id = $2`,
            [alpha.tenant, alpha.contactShared],
          );
          expect(Number(left.rows[0]?.n), table).toBe(0);
        }
        const betaShared = await client.query<{ n: string }>(
          'SELECT count(*) AS n FROM verifications WHERE tenant_id = $1 AND contact_id = $2',
          [beta.tenant, beta.contactShared],
        );
        expect(Number(betaShared.rows[0]?.n)).toBe(1);
      });

      it('deletes a whole tenant and nothing else', async () => {
        // Every table with a tenant_id column, so new tables are covered automatically.
        const tables = await client.query<{ table_name: string }>(
          `SELECT table_name FROM information_schema.columns
            WHERE table_schema = $1 AND column_name = 'tenant_id' ORDER BY table_name`,
          [schema],
        );
        const tenantTables = tables.rows.map((r) => r.table_name);
        expect(tenantTables.length).toBeGreaterThanOrEqual(35);
        // One query at a time: a pg client must not run queries concurrently.
        const rowsByTable = async (tenantId: string) => {
          const counts: Record<string, number> = {};
          for (const table of tenantTables) {
            counts[table] = await count(table, tenantId);
          }
          return counts;
        };
        const alphaBefore = await rowsByTable(alpha.tenant);
        await client.query('DELETE FROM tenants WHERE id = $1', [beta.tenant]);
        expect(await rowsByTable(beta.tenant)).toEqual(
          Object.fromEntries(tenantTables.map((t) => [t, 0])),
        );
        expect(await rowsByTable(alpha.tenant)).toEqual(alphaBefore);
      });
    });
  },
);
