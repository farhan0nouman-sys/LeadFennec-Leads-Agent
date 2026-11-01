// Test-only: a throwaway PostgreSQL schema with every migration applied, inside the *_test
// database that TEST_DATABASE_URL names. Suites that use it run only when TEST_DATABASE_URL
// is set; otherwise they are reported as skipped, never passed. Published as the separate
// entry point `@lead-fennec-ai/database/testing` (for the API's tests); the main entry point
// never imports it.
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { assertTestDatabaseUrl } from '../test-database.js';

/** packages/database */
export const packageDir = fileURLToPath(new URL('../..', import.meta.url));
const migrationsDir = join(packageDir, 'prisma', 'migrations');

export const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

export class MigratedSchema {
  /** Random schema name, e.g. "t03b_1a2b3c4d5e6f". */
  readonly name: string;

  constructor(prefix: string) {
    this.name = `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  }

  /** TEST_DATABASE_URL, after checking that it names a *_test database. */
  get databaseUrl(): string {
    return assertTestDatabaseUrl(testDatabaseUrl ?? '');
  }

  /** A pg client whose search_path is this schema. */
  async connect(): Promise<Client> {
    const client = new Client({ connectionString: this.databaseUrl });
    await client.connect();
    await client.query(`SET search_path TO "${this.name}"`);
    return client;
  }

  private applied = 0;

  /**
   * Creates the schema and applies the migrations in order: all of them, or only those up to
   * and including `through` (a migration folder name), to test a data migration.
   */
  async create(options: { through?: string } = {}): Promise<void> {
    const client = new Client({ connectionString: this.databaseUrl });
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA "${this.name}"`);
    } finally {
      await client.end();
    }
    await this.migrate(options);
  }

  /** Applies the migrations not applied yet (up to `through`, if given). */
  async migrate(options: { through?: string } = {}): Promise<void> {
    const all = readdirSync(migrationsDir)
      .filter((name) => /^\d{14}_/.test(name))
      .sort();
    const last =
      options.through === undefined
        ? all.length
        : all.indexOf(options.through) + 1;
    if (last === 0) {
      throw new Error(`Unknown migration ${options.through ?? ''}`);
    }
    const client = await this.connect();
    try {
      for (const name of all.slice(this.applied, last)) {
        await client.query(
          readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf8'),
        );
      }
      this.applied = Math.max(this.applied, last);
    } finally {
      await client.end();
    }
  }

  async drop(): Promise<void> {
    const client = new Client({ connectionString: this.databaseUrl });
    await client.connect();
    try {
      await client.query(`DROP SCHEMA "${this.name}" CASCADE`);
    } finally {
      await client.end();
    }
  }
}
