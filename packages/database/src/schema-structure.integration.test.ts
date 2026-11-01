import type { Client } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MigratedSchema, testDatabaseUrl } from './testing/migrated-schema.js';

// Rules every table follows (docs/decisions.md D-03A-03, D-03A-04, D-03B-02, D-03C-01), read from the
// PostgreSQL catalog so that tables added later are checked automatically. Runs only when
// TEST_DATABASE_URL is set; otherwise it is reported as skipped, never as passed.
const db = new MigratedSchema('tstruct');

/** Tables without tenant_id (D-03A-02, D-03C-02). */
const PLATFORM_TABLES = [
  'auth_throttles',
  'auth_tokens',
  'billing_plans',
  'permissions',
  'plan_limits',
  'platform_audit_records',
  'tenants',
  'user_credentials',
  'user_sessions',
  'users',
];
/** The only references from tenant rows to platform rows other than tenants. */
const PLATFORM_REFERENCES = [
  'memberships(user_id) -> users(id)',
  'role_permissions(permission_key) -> permissions(key)',
  'subscriptions(plan_id) -> billing_plans(id)',
];
/**
 * Names a second copy of an existing concept would get (D-03C-01). Each concept has one table;
 * add to it instead of creating one of these.
 */
const DUPLICATE_CONCEPT_NAMES = [
  'billing_subscriptions',
  'tenant_subscriptions',
  'plans',
  'billing_plan_limits',
  'tenant_limits',
  'usage_limits',
  'usage_events',
  'usage_records',
  'usage_counters',
  'credit_ledger',
  'payments',
  'billing_events',
  'stripe_events',
  'webhook_events',
  'audit_logs',
  'audit_events',
  'activity_logs',
  'branding',
  'tenant_brandings',
  'white_label_settings',
  'user_notifications',
  'notification_events',
  // Authentication (D-04A-02).
  'sessions',
  'user_tokens',
  'email_verification_tokens',
  'password_reset_tokens',
  'login_attempts',
  'credentials',
];

interface ForeignKey {
  readonly name: string;
  readonly table: string;
  readonly refTable: string;
  readonly columns: string[];
  readonly refColumns: string[];
  /** pg_constraint codes: a = NO ACTION, r = RESTRICT, c = CASCADE, n = SET NULL. */
  readonly onDelete: string;
  readonly onUpdate: string;
}

interface Index {
  readonly table: string;
  readonly columns: string[];
  readonly partial: boolean;
}

describe.runIf(testDatabaseUrl !== undefined)(
  'schema structure (catalog)',
  () => {
    let client: Client;
    let tables: { name: string; hasTenantId: boolean }[];
    let foreignKeys: ForeignKey[];
    let indexes: Index[];

    beforeAll(async () => {
      await db.create();
      client = await db.connect();
      tables = (
        await client.query<{ name: string; has_tenant_id: boolean }>(
          `SELECT c.relname AS name,
                EXISTS (SELECT 1 FROM pg_attribute a
                         WHERE a.attrelid = c.oid AND a.attname = 'tenant_id'
                           AND NOT a.attisdropped) AS has_tenant_id
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND c.relkind = 'r'
          ORDER BY 1`,
          [db.name],
        )
      ).rows.map((r) => ({ name: r.name, hasTenantId: r.has_tenant_id }));
      foreignKeys = (
        await client.query<{
          name: string;
          table: string;
          ref_table: string;
          columns: string[];
          ref_columns: string[];
          on_delete: string;
          on_update: string;
        }>(
          `SELECT con.conname AS name, src.relname AS table, dst.relname AS ref_table,
                ARRAY(SELECT a.attname::text FROM unnest(con.conkey) WITH ORDINALITY k(n, i)
                        JOIN pg_attribute a ON a.attrelid = con.conrelid AND a.attnum = k.n
                       ORDER BY k.i) AS columns,
                ARRAY(SELECT a.attname::text FROM unnest(con.confkey) WITH ORDINALITY k(n, i)
                        JOIN pg_attribute a ON a.attrelid = con.confrelid AND a.attnum = k.n
                       ORDER BY k.i) AS ref_columns,
                con.confdeltype::text AS on_delete, con.confupdtype::text AS on_update
           FROM pg_constraint con
           JOIN pg_class src ON src.oid = con.conrelid
           JOIN pg_class dst ON dst.oid = con.confrelid
           JOIN pg_namespace n ON n.oid = src.relnamespace
          WHERE con.contype = 'f' AND n.nspname = $1
          ORDER BY 1`,
          [db.name],
        )
      ).rows.map((r) => ({
        name: r.name,
        table: r.table,
        refTable: r.ref_table,
        columns: r.columns,
        refColumns: r.ref_columns,
        onDelete: r.on_delete,
        onUpdate: r.on_update,
      }));
      indexes = (
        await client.query<{
          table: string;
          columns: string[];
          partial: boolean;
        }>(
          `SELECT t.relname AS table,
                ARRAY(SELECT a.attname::text FROM unnest(ix.indkey::int2[]) WITH ORDINALITY k(n, i)
                        JOIN pg_attribute a ON a.attrelid = ix.indrelid AND a.attnum = k.n
                       ORDER BY k.i) AS columns,
                ix.indpred IS NOT NULL AS partial
           FROM pg_index ix
           JOIN pg_class t ON t.oid = ix.indrelid
           JOIN pg_namespace n ON n.oid = t.relnamespace
          WHERE n.nspname = $1`,
          [db.name],
        )
      ).rows;
    }, 60_000);

    afterAll(async () => {
      await client.end();
      await db.drop();
    }, 60_000);

    const tenantTables = () =>
      tables.filter((t) => t.hasTenantId).map((t) => t.name);
    const describeKey = (fk: ForeignKey) =>
      `${fk.table}(${fk.columns.join(', ')}) -> ${fk.refTable}(${fk.refColumns.join(', ')})`;

    it('has tenant_id on every table except the platform tables', () => {
      expect(tables.filter((t) => !t.hasTenantId).map((t) => t.name)).toEqual(
        PLATFORM_TABLES,
      );
      expect(tenantTables()).toHaveLength(44);
    });

    it('makes tenant_id required, the first key column, cascading and immutable', async () => {
      const rows = await client.query<{
        table: string;
        not_null: boolean;
        first_key_column: string | null;
        immutable: boolean;
      }>(
        `SELECT c.relname AS table,
              (SELECT a.attnotnull FROM pg_attribute a
                WHERE a.attrelid = c.oid AND a.attname = 'tenant_id') AS not_null,
              (SELECT a.attname::text FROM pg_index i
                 JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = i.indkey[0]
                WHERE i.indrelid = c.oid AND i.indisprimary) AS first_key_column,
              EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
                       WHERE t.tgrelid = c.oid AND NOT t.tgisinternal
                         AND p.proname = 'forbid_tenant_id_change') AS immutable
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relkind = 'r' AND c.relname = ANY($2)
        ORDER BY 1`,
        [db.name, tenantTables()],
      );
      expect(rows.rows).toHaveLength(tenantTables().length);
      for (const row of rows.rows) {
        expect(row, row.table).toEqual({
          table: row.table,
          not_null: true,
          first_key_column: 'tenant_id',
          immutable: true,
        });
        const toTenant = foreignKeys.filter(
          (fk) => fk.table === row.table && fk.refTable === 'tenants',
        );
        expect(toTenant.map(describeKey), row.table).toEqual([
          `${row.table}(tenant_id) -> tenants(id)`,
        ]);
        expect(toTenant[0]?.onDelete, row.table).toBe('c');
      }
    });

    it('links tenant rows only within the same tenant', () => {
      const tenantSet = new Set(tenantTables());
      const platformLinks: string[] = [];
      for (const fk of foreignKeys) {
        if (!tenantSet.has(fk.table) || fk.refTable === 'tenants') {
          continue;
        }
        if (!tenantSet.has(fk.refTable)) {
          platformLinks.push(describeKey(fk));
          continue;
        }
        // tenant_id must map onto tenant_id, so both rows belong to the same tenant.
        const at = fk.columns.indexOf('tenant_id');
        expect(at, fk.name).toBeGreaterThanOrEqual(0);
        expect(fk.refColumns[at], fk.name).toBe('tenant_id');
      }
      expect(platformLinks.sort()).toEqual(PLATFORM_REFERENCES);
    });

    it('never sets references to NULL and never cascades updates', () => {
      for (const fk of foreignKeys) {
        expect(['a', 'r', 'c'], fk.name).toContain(fk.onDelete);
        expect(fk.onUpdate, fk.name).toBe('a');
      }
    });

    it('has an index for every foreign key', () => {
      // An index serves a key's checks and cascades when it starts with all of the key's
      // columns, or with tenant_id followed by the column that names the referenced row.
      const missing = foreignKeys.filter((fk) => {
        const keyColumns = [...fk.columns].sort().join(',');
        const target = fk.columns[fk.refColumns.indexOf('id')];
        return !indexes.some(
          (ix) =>
            ix.table === fk.table &&
            !ix.partial &&
            ([...ix.columns.slice(0, fk.columns.length)].sort().join(',') ===
              keyColumns ||
              (target !== undefined &&
                ix.columns[0] === 'tenant_id' &&
                ix.columns[1] === target)),
        );
      });
      expect(missing.map(describeKey)).toEqual([]);
    });

    it('keeps one table per concept (no duplicate sources of truth)', () => {
      const names = tables.map((t) => t.name);
      expect(names.filter((n) => DUPLICATE_CONCEPT_NAMES.includes(n))).toEqual(
        [],
      );
    });

    it('stores every timestamp as timestamptz (UTC instants)', async () => {
      const rows = await client.query<{ col: string }>(
        `SELECT table_name || '.' || column_name AS col FROM information_schema.columns
          WHERE table_schema = $1
            AND data_type IN ('timestamp without time zone', 'time without time zone')
          ORDER BY 1`,
        [db.name],
      );
      expect(rows.rows).toEqual([]);
    });

    it('has no column meant to hold credentials', async () => {
      const rows = await client.query<{ col: string }>(
        `SELECT table_name || '.' || column_name AS col FROM information_schema.columns
          WHERE table_schema = $1
            AND column_name ~ '(password|passwd|secret|api_?key|private_key|credential|(access|refresh|id|auth|bearer|session)_?token)'
          ORDER BY 1`,
        [db.name],
      );
      // secret_ref holds only a reference into the secret store (CHECK is_secret_ref), and
      // password_hash only an Argon2id hash (CHECK on the PHC format, D-04A-03);
      // password_changed_at is a timestamp.
      expect(rows.rows.map((r) => r.col)).toEqual([
        'email_accounts.secret_ref',
        'user_credentials.password_changed_at',
        'user_credentials.password_hash',
      ]);
    });
  },
);
