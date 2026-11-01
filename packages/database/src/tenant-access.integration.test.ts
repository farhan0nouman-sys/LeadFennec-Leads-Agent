import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { createPrismaClient } from './client.js';
import {
  createFixtureFactory,
  type FactoryWorkspace,
  type FixtureFactory,
} from './fixtures/factories.js';
import { FIXTURE_USERS, fixtureIds } from './fixtures/fixture-data.js';
import { loadFixtureTenants } from './fixtures/load.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { InvalidCursorError } from './pagination.js';
import {
  memberScope,
  platformAdminScope,
  platformConsole,
  systemScope,
  type TenantScope,
} from './tenancy/access.js';
import {
  ActorNotAllowedError,
  TenantAccessDeniedError,
} from './tenancy/actors.js';
import {
  TENANT_MODELS,
  TenantScopeError,
  createTenantDb,
  type TenantDb,
} from './tenancy/tenant-db.js';
import {
  NoEntitledSubscriptionError,
  ReservationStateError,
  UsageLimitExceededError,
} from './tenancy/usage.js';
import { MigratedSchema, testDatabaseUrl } from './testing/migrated-schema.js';

// Tenant isolation through the access layer (task 03C, docs/decisions.md D-03C-04, D-03C-05):
// every tenant-owned model and every relation between tenant rows, with an authorized and an
// unauthorized tenant context, plus the entry points and repositories. Runs only when
// TEST_DATABASE_URL is set; otherwise it is reported as skipped, never as passed.
const db = new MigratedSchema('taccess');
const alpha = fixtureIds('alpha');
const beta = fixtureIds('beta');
const REASON = 'Support request FIX-0002: checking a campaign';

/** The subset of a Prisma model delegate the generic tests call. */
interface Delegate {
  findMany(args?: object): Promise<Record<string, unknown>[]>;
  findFirst(args?: object): Promise<Record<string, unknown> | null>;
  findUnique(args: object): Promise<Record<string, unknown> | null>;
  count(args?: object): Promise<number>;
  deleteMany(args?: object): Promise<{ count: number }>;
  create(args: object): Promise<unknown>;
}

function delegate(client: unknown, model: string): Delegate {
  const name = model.charAt(0).toLowerCase() + model.slice(1);
  const found = (client as Partial<Record<string, Delegate>>)[name];
  if (found === undefined) {
    throw new Error(`No delegate ${name}`);
  }
  return found;
}

interface ForeignKey {
  readonly name: string;
  readonly table: string;
  readonly refTable: string;
  readonly columns: string[];
  readonly refColumns: string[];
}

/** Fixture ids differ between tenants only in the group letter (fixture-data.ts). */
const toAlpha = (value: unknown): unknown =>
  typeof value === 'string' && /^0{8}-0{4}-4000-8000-b[0-9a-f]{11}$/.test(value)
    ? value.replace('-8000-b', '-8000-a')
    : value;

describe.runIf(testDatabaseUrl !== undefined)(
  'tenant access on PostgreSQL',
  () => {
    let prisma: PrismaClient;
    let client: Client;
    let factory: FixtureFactory;
    let alphaDb: TenantDb;
    let betaDb: TenantDb;

    beforeAll(async () => {
      await db.create();
      prisma = createPrismaClient({
        databaseUrl: db.databaseUrl,
        schema: db.name,
        maxConnections: 1,
      });
      await loadFixtureTenants(prisma);
      client = await db.connect();
      factory = createFixtureFactory(prisma);
      alphaDb = createTenantDb(prisma, alpha.tenant);
      betaDb = createTenantDb(prisma, beta.tenant);
    }, 60_000);

    afterAll(async () => {
      await client.end();
      await prisma.$disconnect();
      await db.drop();
    }, 60_000);

    describe('every relation between tenant rows (SQL)', () => {
      let tenantTables: string[];
      let relations: ForeignKey[];

      beforeAll(async () => {
        tenantTables = (
          await client.query<{ table_name: string }>(
            `SELECT table_name FROM information_schema.columns
              WHERE table_schema = $1 AND column_name = 'tenant_id' ORDER BY 1`,
            [db.name],
          )
        ).rows.map((r) => r.table_name);
        relations = (
          await client.query<{
            name: string;
            table: string;
            ref_table: string;
            columns: string[];
            ref_columns: string[];
          }>(
            `SELECT con.conname AS name, src.relname AS table, dst.relname AS ref_table,
                  ARRAY(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY k(n, i)
                          JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.n
                         ORDER BY k.i) AS columns,
                  ARRAY(SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY k(n, i)
                          JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.n
                         ORDER BY k.i) AS ref_columns
             FROM pg_constraint con
             JOIN pg_class src ON src.oid = con.conrelid
             JOIN pg_class dst ON dst.oid = con.confrelid
             JOIN pg_namespace n ON n.oid = src.relnamespace
            WHERE con.contype = 'f' AND n.nspname = $1 AND dst.relname <> 'tenants'
            ORDER BY 1`,
            [db.name],
          )
        ).rows
          .map((r) => ({
            name: r.name,
            table: r.table,
            refTable: r.ref_table,
            columns: r.columns,
            refColumns: r.ref_columns,
          }))
          .filter(
            (fk) =>
              tenantTables.includes(fk.table) &&
              tenantTables.includes(fk.refTable),
          );
      });

      const notNull = (fk: ForeignKey) =>
        fk.columns.map((c) => `"${c}" IS NOT NULL`).join(' AND ');

      it('fixtures hold rows of every tenant table in both tenants', async () => {
        expect(tenantTables).toHaveLength(44);
        const empty: string[] = [];
        for (const table of tenantTables) {
          for (const [key, ids] of [
            ['alpha', alpha],
            ['beta', beta],
          ] as const) {
            const { rows } = await client.query<{ n: number }>(
              `SELECT count(*)::int AS n FROM "${table}" WHERE tenant_id = $1`,
              [ids.tenant],
            );
            if (rows[0]?.n === 0) {
              empty.push(`${table} (${key})`);
            }
          }
        }
        expect(empty).toEqual([]);
      });

      it('fixtures use every relation in both tenants (authorized: same tenant)', async () => {
        // Every foreign key between two tenant tables (54 before 03C, 4 added by 03C, 3 by 04B).
        expect(relations).toHaveLength(61);
        const unused: string[] = [];
        for (const fk of relations) {
          for (const [key, ids] of [
            ['alpha', alpha],
            ['beta', beta],
          ] as const) {
            const { rows } = await client.query<{ n: number }>(
              `SELECT count(*)::int AS n FROM "${fk.table}" WHERE tenant_id = $1 AND ${notNull(fk)}`,
              [ids.tenant],
            );
            if (rows[0]?.n === 0) {
              unused.push(`${fk.name} (${key})`);
            }
          }
        }
        expect(unused).toEqual([]);
      });

      it('rejects a reference to the same row in another tenant (unauthorized)', async () => {
        // For each relation, take a Beta row and point it at the matching Alpha row: the
        // referenced key exists, but in Alpha, so the only reason to fail is the tenant. User
        // triggers (immutability) are disabled inside the savepoint so the foreign key itself
        // is what rejects the change.
        const outcomes: Record<string, string> = {};
        await client.query('BEGIN');
        try {
          for (const fk of relations) {
            await client.query('SAVEPOINT relation');
            try {
              await client.query(
                `ALTER TABLE "${fk.table}" DISABLE TRIGGER USER`,
              );
              const pairs = fk.columns
                .map((column, i) => ({ column, ref: fk.refColumns[i] ?? '' }))
                .filter((p) => p.column !== 'tenant_id');
              const { rows } = await client.query<Record<string, unknown>>(
                `SELECT ctid::text AS row_ctid, ${pairs.map((p) => `"${p.column}"`).join(', ')}
                   FROM "${fk.table}" WHERE tenant_id = $1 AND ${notNull(fk)} LIMIT 1`,
                [beta.tenant],
              );
              const row = rows[0];
              if (row === undefined) {
                outcomes[fk.name] = 'no beta row';
                continue;
              }
              const values = pairs.map((p) => toAlpha(row[p.column]));
              const control = await client.query<{ n: number }>(
                `SELECT count(*)::int AS n FROM "${fk.refTable}" WHERE tenant_id = $1 AND ${pairs
                  .map((p, i) => `"${p.ref}" = $${String(i + 2)}`)
                  .join(' AND ')}`,
                [alpha.tenant, ...values],
              );
              if (control.rows[0]?.n !== 1) {
                outcomes[fk.name] = 'no matching alpha row';
                continue;
              }
              const assignments = pairs.map(
                (p, i) => `"${p.column}" = $${String(i + 1)}`,
              );
              // A mailbox cursor's scope is its account id (CHECK); keep them in step.
              if (
                fk.table === 'integration_sync_cursors' &&
                pairs.some((p) => p.column === 'email_account_id')
              ) {
                const at = pairs.findIndex(
                  (p) => p.column === 'email_account_id',
                );
                assignments.push(
                  `"scope_key" = $${String(at + 1)}::uuid::text`,
                );
              }
              try {
                await client.query(
                  `UPDATE "${fk.table}" SET ${assignments.join(', ')}
                    WHERE ctid = $${String(values.length + 1)}::tid`,
                  [...values, row['row_ctid']],
                );
                outcomes[fk.name] = 'accepted';
              } catch (error) {
                outcomes[fk.name] = String((error as { code?: unknown }).code);
              }
            } finally {
              await client.query('ROLLBACK TO SAVEPOINT relation');
            }
          }
        } finally {
          await client.query('ROLLBACK');
        }
        expect(outcomes).toEqual(
          Object.fromEntries(relations.map((fk) => [fk.name, '23503'])),
        );
      });
    });

    describe('tenant-scoped client: every tenant-owned model', () => {
      it.each(TENANT_MODELS)(
        '%s: an authorized scope reads exactly its own rows',
        async (model) => {
          const rows = await delegate(alphaDb, model).findMany();
          expect(rows.length).toBeGreaterThan(0);
          expect(new Set(rows.map((r) => r['tenantId']))).toEqual(
            new Set([alpha.tenant]),
          );
          expect(await delegate(alphaDb, model).count()).toBe(
            await delegate(prisma, model).count({
              where: { tenantId: alpha.tenant },
            }),
          );
        },
      );

      it.each(TENANT_MODELS)(
        "%s: another tenant's scope cannot read, delete or create its rows",
        async (model) => {
          const scoped = delegate(betaDb, model);
          const base = delegate(prisma, model);
          const before = await base.count({
            where: { tenantId: alpha.tenant },
          });
          const own = await scoped.findMany();
          expect(own.every((r) => r['tenantId'] === beta.tenant)).toBe(true);
          await expect(
            scoped.findMany({ where: { tenantId: alpha.tenant } }),
          ).rejects.toThrow(TenantScopeError);
          await expect(
            scoped.deleteMany({ where: { tenantId: alpha.tenant } }),
          ).rejects.toThrow(TenantScopeError);
          await expect(
            scoped.create({ data: { tenantId: alpha.tenant } }),
          ).rejects.toThrow(TenantScopeError);
          const alphaRow = await base.findFirst({
            where: { tenantId: alpha.tenant },
          });
          const id = alphaRow?.['id'];
          if (typeof id === 'string') {
            // By id alone, Alpha's row is invisible and untouchable from Beta.
            await expect(
              scoped.findFirst({ where: { id } }),
            ).resolves.toBeNull();
            await expect(scoped.deleteMany({ where: { id } })).resolves.toEqual(
              {
                count: 0,
              },
            );
            await expect(
              scoped.findUnique({
                where: { tenantId_id: { tenantId: alpha.tenant, id } },
              }),
            ).rejects.toThrow(TenantScopeError);
          }
          expect(await base.count({ where: { tenantId: alpha.tenant } })).toBe(
            before,
          );
        },
      );

      it('keeps the scope inside interactive transactions', async () => {
        const result = await alphaDb.$transaction(async (tx) => {
          await expect(
            tx.contact.findMany({ where: { tenantId: beta.tenant } }),
          ).rejects.toThrow(TenantScopeError);
          return tx.contact.findMany();
        });
        expect(result.map((c) => c.tenantId)).toEqual(
          Array(3).fill(alpha.tenant),
        );
      });

      it('offers no raw SQL and no platform models', async () => {
        const raw = betaDb as unknown as Record<string, unknown>;
        expect(() => raw['$queryRawUnsafe']).toThrow(TenantScopeError);
        expect(() => raw['$executeRaw']).toThrow(TenantScopeError);
        expect(() => raw['$extends']).toThrow(TenantScopeError);
        for (const model of [
          'User',
          'Tenant',
          'BillingPlan',
          'PlatformAuditRecord',
        ]) {
          await expect(delegate(betaDb, model).findMany()).rejects.toThrow(
            TenantScopeError,
          );
        }
      });

      it('creates rows in its own tenant only', async () => {
        const created = await betaDb.suppression.create({
          data: {
            tenantId: betaDb.tenantId,
            normalizedEmail: 'scoped.create@example.test',
            reason: 'MANUAL',
            source: 'MANUAL',
          },
        });
        expect(created.tenantId).toBe(beta.tenant);
        await expect(
          betaDb.suppression.update({
            where: { tenantId_id: { tenantId: beta.tenant, id: created.id } },
            data: { tenantId: alpha.tenant },
          }),
        ).rejects.toThrow(TenantScopeError);
      });
    });

    describe('entry points', () => {
      it('lets an active member into their tenant with their permissions', async () => {
        const scope = await memberScope(prisma, {
          tenantId: alpha.tenant,
          userId: FIXTURE_USERS.sharedMember.id,
        });
        expect(scope.actor).toMatchObject({
          kind: 'member',
          membershipId: alpha.membershipShared,
        });
        expect(
          scope.actor.kind === 'member' &&
            scope.actor.permissions.has('campaigns.read'),
        ).toBe(true);
        expect(
          scope.actor.kind === 'member' &&
            scope.actor.permissions.has('members.manage'),
        ).toBe(false);
        expect(await scope.db.contact.count()).toBe(3);
      });

      it.each([
        [
          'a user without a membership there',
          () => ({
            tenantId: beta.tenant,
            userId: FIXTURE_USERS.alphaAdmin.id,
          }),
        ],
        [
          'a suspended member',
          () => ({
            tenantId: beta.tenant,
            userId: FIXTURE_USERS.sharedMember.id,
          }),
        ],
        [
          'a platform admin (no implicit access)',
          () => ({
            tenantId: alpha.tenant,
            userId: FIXTURE_USERS.platformAdmin.id,
          }),
        ],
        [
          'an unknown tenant',
          () => ({
            tenantId: randomUUID(),
            userId: FIXTURE_USERS.alphaAdmin.id,
          }),
        ],
      ])('refuses %s', async (_name, input) => {
        await expect(memberScope(prisma, input())).rejects.toThrow(
          TenantAccessDeniedError,
        );
      });

      it('refuses members of suspended tenants and disabled users', async () => {
        const workspace = await factory.workspace();
        const input = {
          tenantId: workspace.tenant.id,
          userId: workspace.admin.id,
        };
        await expect(memberScope(prisma, input)).resolves.toBeDefined();
        await prisma.tenant.update({
          where: { id: workspace.tenant.id },
          data: { status: 'SUSPENDED' },
        });
        await expect(memberScope(prisma, input)).rejects.toThrow(
          TenantAccessDeniedError,
        );
        await prisma.tenant.update({
          where: { id: workspace.tenant.id },
          data: { status: 'ACTIVE' },
        });
        await prisma.user.update({
          where: { id: workspace.admin.id },
          data: { status: 'DISABLED' },
        });
        await expect(memberScope(prisma, input)).rejects.toThrow(
          TenantAccessDeniedError,
        );
      });

      it('validates identifiers before querying', async () => {
        await expect(
          memberScope(prisma, {
            tenantId: "x' OR '1'='1",
            userId: FIXTURE_USERS.alphaAdmin.id,
          }),
        ).rejects.toThrow(ZodError);
        expect(() =>
          systemScope(prisma, { tenantId: alpha.tenant, name: 'Outbox Relay' }),
        ).toThrow(ZodError);
      });

      it('opens audited, read-only platform-admin access', async () => {
        const opened = () =>
          prisma.auditRecord.count({
            where: {
              tenantId: alpha.tenant,
              action: 'platform_admin.access_opened',
              actorUserId: FIXTURE_USERS.platformAdmin.id,
            },
          });
        const before = await opened();
        const scope = await platformAdminScope(prisma, {
          tenantId: alpha.tenant,
          userId: FIXTURE_USERS.platformAdmin.id,
          reason: REASON,
          requestId: 'req-0001',
        });
        expect(await opened()).toBe(before + 1);
        const record = await prisma.auditRecord.findFirstOrThrow({
          where: { tenantId: alpha.tenant, requestId: 'req-0001' },
        });
        expect(record).toMatchObject({
          actorType: 'PLATFORM_ADMIN',
          actorMembershipId: null,
          reason: REASON,
        });
        // Reads work; writes through the generic client do not.
        expect(await scope.db.campaign.count()).toBe(1);
        await expect(
          scope.db.suppression.create({
            data: {
              tenantId: scope.tenantId,
              normalizedDomain: 'admin.test',
              reason: 'MANUAL',
              source: 'MANUAL',
            },
          }),
        ).rejects.toThrow(/read-only/);
        await expect(scope.db.contact.deleteMany()).rejects.toThrow(
          /read-only/,
        );
        await expect(
          scope.usage.reserve({
            metric: 'AI_TOKENS',
            quantity: 1,
            idempotencyKey: 'admin',
            purpose: 'admin.test',
          }),
        ).rejects.toThrow(ActorNotAllowedError);
        // Beta saw nothing of it.
        expect(
          await prisma.auditRecord.count({
            where: { tenantId: beta.tenant, requestId: 'req-0001' },
          }),
        ).toBe(0);
      });

      it('refuses and records platform-admin access by a non-admin', async () => {
        await expect(
          platformAdminScope(prisma, {
            tenantId: beta.tenant,
            userId: FIXTURE_USERS.alphaAdmin.id,
            reason: REASON,
          }),
        ).rejects.toThrow(TenantAccessDeniedError);
        const denied = await prisma.platformAuditRecord.findMany({
          where: {
            action: 'platform_admin.access_denied',
            targetId: FIXTURE_USERS.alphaAdmin.id,
          },
        });
        expect(denied).toHaveLength(1);
        expect(denied[0]).toMatchObject({
          actorType: 'SYSTEM',
          actorName: 'access_control',
          subjectTenantId: beta.tenant,
          reason: REASON,
        });
        expect(
          await prisma.auditRecord.count({
            where: {
              tenantId: beta.tenant,
              actorUserId: FIXTURE_USERS.alphaAdmin.id,
            },
          }),
        ).toBe(0);
      });

      it('requires a stated reason for platform-admin access', async () => {
        const before = await prisma.platformAuditRecord.count();
        await expect(
          platformAdminScope(prisma, {
            tenantId: alpha.tenant,
            userId: FIXTURE_USERS.platformAdmin.id,
            reason: 'because',
          }),
        ).rejects.toThrow(ZodError);
        expect(await prisma.platformAuditRecord.count()).toBe(before);
      });

      it('audits the cross-tenant console and pages through tenants', async () => {
        const platform = await platformConsole(prisma, {
          userId: FIXTURE_USERS.platformAdmin.id,
          reason: REASON,
        });
        expect(
          await prisma.platformAuditRecord.count({
            where: {
              action: 'platform_admin.console_opened',
              actorUserId: FIXTURE_USERS.platformAdmin.id,
            },
          }),
        ).toBe(1);
        const seen: string[] = [];
        let cursor: string | null = null;
        do {
          const page = await platform.listTenants(
            cursor === null ? { limit: 2 } : { limit: 2, cursor },
          );
          seen.push(...page.items.map((t) => t.id));
          cursor = page.nextCursor;
        } while (cursor !== null);
        expect(seen).toEqual(
          expect.arrayContaining([alpha.tenant, beta.tenant]),
        );
        expect(new Set(seen).size).toBe(seen.length);
        await expect(
          platformConsole(prisma, {
            userId: FIXTURE_USERS.betaAdmin.id,
            reason: REASON,
          }),
        ).rejects.toThrow(TenantAccessDeniedError);
      });
    });

    describe('repositories', () => {
      let workspace: FactoryWorkspace;
      let clock: { at: Date };
      let worker: TenantScope;
      let admin: TenantScope;

      beforeAll(async () => {
        workspace = await factory.workspace({
          AI_TOKENS: 1_000n,
          EMAILS_SENT: 10n,
        });
        clock = { at: new Date() };
        const options = { now: () => clock.at };
        worker = systemScope(
          prisma,
          { tenantId: workspace.tenant.id, name: 'test_worker' },
          options,
        );
        admin = await memberScope(
          prisma,
          { tenantId: workspace.tenant.id, userId: workspace.admin.id },
          options,
        );
      });

      it('pages audit records newest first without gaps or repeats', async () => {
        const target = randomUUID();
        for (let i = 0; i < 7; i += 1) {
          await worker.audit.record({
            action: 'test.recorded',
            targetType: 'contact',
            targetId: target,
          });
        }
        await worker.audit.record({ action: 'test.other' });
        const ids: string[] = [];
        let cursor: string | null = null;
        let pages = 0;
        do {
          const page = await admin.audit.list(
            cursor === null ? { limit: 3 } : { limit: 3, cursor },
            { targetType: 'contact', targetId: target },
          );
          ids.push(...page.items.map((r) => r.id));
          cursor = page.nextCursor;
          pages += 1;
        } while (cursor !== null);
        expect(pages).toBe(3);
        expect(ids).toHaveLength(7);
        expect([...ids].sort().reverse()).toEqual(ids);
        await expect(
          admin.audit.list({ cursor: 'not-a-cursor!' }),
        ).rejects.toThrow(InvalidCursorError);
        // A cursor from this tenant used in Alpha's scope only filters Alpha's rows.
        const alphaScope = systemScope(prisma, {
          tenantId: alpha.tenant,
          name: 'test_worker',
        });
        const foreign = await alphaScope.audit.list({
          limit: 50,
          cursor: (await admin.audit.list({ limit: 1 })).nextCursor ?? '',
        });
        expect(foreign.items.every((r) => r.tenantId === alpha.tenant)).toBe(
          true,
        );
      });

      it('shows a member only their own notifications', async () => {
        const otherUser = await factory.user();
        const otherMembership = await factory.membership({
          tenantId: workspace.tenant.id,
          userId: otherUser.id,
          roleId: workspace.memberRole.id,
        });
        const mine = await worker.notifications.notify({
          recipientMembershipId: workspace.adminMembership.id,
          type: 'test.notice',
          title: 'For the admin',
          linkPath: '/settings/billing',
          dedupeKey: 'notice-1',
        });
        // The same dedupe key returns the same notification.
        const again = await worker.notifications.notify({
          recipientMembershipId: workspace.adminMembership.id,
          type: 'test.notice',
          title: 'For the admin',
          dedupeKey: 'notice-1',
        });
        expect(again.id).toBe(mine.id);
        const theirs = await worker.notifications.notify({
          recipientMembershipId: otherMembership.id,
          type: 'test.notice',
          title: 'For the other member',
        });
        const page = await admin.notifications.listMine({ limit: 10 });
        expect(page.items.map((n) => n.id)).toEqual([mine.id]);
        expect(await admin.notifications.unreadCount()).toBe(1);
        expect(await admin.notifications.markRead(theirs.id)).toBe(false);
        expect(await admin.notifications.markRead(mine.id)).toBe(true);
        expect(await admin.notifications.markRead(mine.id)).toBe(false);
        expect(await admin.notifications.unreadCount()).toBe(0);
        // Another tenant's member cannot mark it, and links stay inside the app.
        const alphaAdmin = await memberScope(prisma, {
          tenantId: alpha.tenant,
          userId: FIXTURE_USERS.alphaAdmin.id,
        });
        expect(await alphaAdmin.notifications.markRead(theirs.id)).toBe(false);
        await expect(
          worker.notifications.notify({
            recipientMembershipId: workspace.adminMembership.id,
            type: 'test.notice',
            title: 'Phishing',
            linkPath: '//evil.test/login',
          }),
        ).rejects.toThrow(ZodError);
        // A recipient from another tenant is rejected by the composite foreign key.
        await expect(
          worker.notifications.notify({
            recipientMembershipId: alpha.membershipAdmin,
            type: 'test.notice',
            title: 'Cross-tenant',
          }),
        ).rejects.toThrow();
        await expect(worker.notifications.listMine({})).rejects.toThrow(
          ActorNotAllowedError,
        );
      });

      it('reserves, commits and releases usage within the limit', async () => {
        const usage = worker.usage;
        const first = await usage.reserve({
          metric: 'AI_TOKENS',
          quantity: 600,
          idempotencyKey: 'run-1',
          purpose: 'research.run',
        });
        // Retrying with the same key returns the same hold.
        await expect(
          usage.reserve({
            metric: 'AI_TOKENS',
            quantity: 600,
            idempotencyKey: 'run-1',
            purpose: 'research.run',
          }),
        ).resolves.toMatchObject({ id: first.id });
        await expect(
          usage.reserve({
            metric: 'AI_TOKENS',
            quantity: 700,
            idempotencyKey: 'run-1',
            purpose: 'research.run',
          }),
        ).rejects.toThrow(ReservationStateError);
        // 600 held + 500 > 1,000.
        await expect(
          usage.reserve({
            metric: 'AI_TOKENS',
            quantity: 500,
            idempotencyKey: 'run-2',
            purpose: 'research.run',
          }),
        ).rejects.toThrow(UsageLimitExceededError);
        await expect(usage.commit(first.id, 700)).rejects.toThrow(
          ReservationStateError,
        );
        const committed = await usage.commit(first.id, 400);
        expect(committed).toMatchObject({
          status: 'COMMITTED',
          committedQuantity: 400n,
        });
        await expect(usage.commit(first.id, 400)).resolves.toMatchObject({
          id: first.id,
        });
        await expect(usage.release(first.id)).rejects.toThrow(
          ReservationStateError,
        );
        expect(await usage.summary('AI_TOKENS')).toMatchObject({
          limit: 1_000n,
          used: 400n,
          held: 0n,
          available: 600n,
        });
        const second = await usage.reserve({
          metric: 'AI_TOKENS',
          quantity: 500,
          idempotencyKey: 'run-2',
          purpose: 'research.run',
        });
        await usage.release(second.id);
        expect(await usage.summary('AI_TOKENS')).toMatchObject({
          used: 400n,
          held: 0n,
        });
        const ledger = await worker.db.usageLedgerEntry.findMany();
        expect(
          ledger.map((e) => [e.kind, e.quantity, e.reservationId]),
        ).toEqual([['USAGE', 400n, first.id]]);
        // A metric the plan does not include allows nothing.
        await expect(
          usage.reserve({
            metric: 'LEAD_ENRICHMENTS',
            quantity: 1,
            idempotencyKey: 'enrich-1',
            purpose: 'enrichment.run',
          }),
        ).rejects.toThrow(UsageLimitExceededError);
      });

      it('stops counting expired holds', async () => {
        const hold = await worker.usage.reserve({
          metric: 'EMAILS_SENT',
          quantity: 10,
          idempotencyKey: 'send-batch-1',
          purpose: 'campaign.dispatch',
          holdSeconds: 60,
        });
        await expect(
          worker.usage.reserve({
            metric: 'EMAILS_SENT',
            quantity: 1,
            idempotencyKey: 'send-batch-2',
            purpose: 'campaign.dispatch',
          }),
        ).rejects.toThrow(UsageLimitExceededError);
        clock.at = new Date(clock.at.getTime() + 120_000);
        expect(await worker.usage.summary('EMAILS_SENT')).toMatchObject({
          held: 0n,
          available: 10n,
        });
        expect(await worker.usage.expireHolds()).toBe(1);
        await expect(worker.usage.commit(hold.id, 1)).rejects.toThrow(
          ReservationStateError,
        );
        await expect(admin.usage.expireHolds()).rejects.toThrow(
          ActorNotAllowedError,
        );
      });

      it("never settles another tenant's reservation", async () => {
        const alphaWorker = systemScope(prisma, {
          tenantId: alpha.tenant,
          name: 'test_worker',
        });
        const reservation = await worker.db.usageReservation.findFirstOrThrow();
        await expect(alphaWorker.usage.release(reservation.id)).rejects.toThrow(
          'Reservation not found',
        );
        await expect(
          alphaWorker.usage.commit(alpha.reservationReleased, 1),
        ).rejects.toThrow(ReservationStateError);
      });

      it('lets only platform admins override limits, with an audit record', async () => {
        await expect(
          admin.billing.setLimitOverride({
            metric: 'AI_TOKENS',
            quantityPerPeriod: 5_000n,
            reason: 'More please',
          }),
        ).rejects.toThrow(ActorNotAllowedError);
        const support = await platformAdminScope(prisma, {
          tenantId: workspace.tenant.id,
          userId: FIXTURE_USERS.platformAdmin.id,
          reason: REASON,
        });
        const override = await support.billing.setLimitOverride({
          metric: 'AI_TOKENS',
          quantityPerPeriod: 5_000n,
          reason: 'Pilot extension agreed with the customer',
        });
        expect(await admin.billing.effectiveLimits()).toMatchObject({
          AI_TOKENS: 5_000n,
          EMAILS_SENT: 10n,
          LEAD_ENRICHMENTS: 0n,
        });
        const audit = await prisma.auditRecord.findFirstOrThrow({
          where: {
            tenantId: workspace.tenant.id,
            action: 'limit_override.set',
          },
        });
        expect(audit).toMatchObject({
          actorType: 'PLATFORM_ADMIN',
          actorUserId: FIXTURE_USERS.platformAdmin.id,
          targetId: override.id,
          reason: 'Pilot extension agreed with the customer',
          metadata: { metric: 'AI_TOKENS', quantityPerPeriod: '5000' },
        });
        await expect(
          worker.usage.reserve({
            metric: 'AI_TOKENS',
            quantity: 4_000,
            idempotencyKey: 'run-3',
            purpose: 'research.run',
          }),
        ).resolves.toMatchObject({ status: 'HELD' });
      });

      it('allows metered usage only on an entitled subscription', async () => {
        const none = await factory.tenant();
        const noSubscription = systemScope(prisma, {
          tenantId: none.tenant.id,
          name: 'test_worker',
        });
        await expect(
          noSubscription.usage.reserve({
            metric: 'AI_TOKENS',
            quantity: 1,
            idempotencyKey: 'x',
            purpose: 'research.run',
          }),
        ).rejects.toThrow(NoEntitledSubscriptionError);
        expect(await noSubscription.usage.summary('AI_TOKENS')).toBeNull();
        expect(await noSubscription.billing.effectiveLimits()).toEqual({});
        const paused = await factory.workspace({ AI_TOKENS: 100n });
        await prisma.subscription.update({
          where: {
            tenantId_id: {
              tenantId: paused.tenant.id,
              id: paused.subscription.id,
            },
          },
          data: { status: 'PAUSED' },
        });
        const pausedScope = systemScope(prisma, {
          tenantId: paused.tenant.id,
          name: 'test_worker',
        });
        await expect(
          pausedScope.usage.reserve({
            metric: 'AI_TOKENS',
            quantity: 1,
            idempotencyKey: 'x',
            purpose: 'research.run',
          }),
        ).rejects.toThrow(NoEntitledSubscriptionError);
      });

      it('reads billing state of a fixture tenant from the single source', async () => {
        const scope = await memberScope(prisma, {
          tenantId: alpha.tenant,
          userId: FIXTURE_USERS.alphaAdmin.id,
        });
        expect(await scope.billing.currentSubscription()).toMatchObject({
          id: alpha.subscription,
          status: 'ACTIVE',
        });
        expect(await scope.billing.effectiveLimits()).toMatchObject({
          AI_TOKENS: 2_000_000n,
          EMAILS_SENT: 15_000n,
        });
      });

      it('serializes concurrent reservations (real PostgreSQL only)', async (ctx) => {
        const version = await client.query<{ v: string }>(
          'SELECT version() AS v',
        );
        if (version.rows[0]?.v.includes('PGlite') === true) {
          // PGlite multiplexes every connection onto one session; concurrency needs CI.
          ctx.skip();
        }
        const tight = await factory.workspace({ AI_TOKENS: 1_000n });
        const clients = [0, 1].map(() =>
          createPrismaClient({
            databaseUrl: db.databaseUrl,
            schema: db.name,
            maxConnections: 1,
          }),
        );
        try {
          const results = await Promise.allSettled(
            clients.map((c, i) =>
              systemScope(c, {
                tenantId: tight.tenant.id,
                name: 'test_worker',
              }).usage.reserve({
                metric: 'AI_TOKENS',
                quantity: 600,
                idempotencyKey: `parallel-${String(i)}`,
                purpose: 'research.run',
              }),
            ),
          );
          expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(
            1,
          );
          const rejected = results.find((r) => r.status === 'rejected');
          expect(rejected?.reason).toBeInstanceOf(UsageLimitExceededError);
        } finally {
          await Promise.all(clients.map((c) => c.$disconnect()));
        }
      });
    });
  },
);
