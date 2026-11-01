// Test-only (excluded from the build): a throwaway PostgreSQL schema with every migration
// applied, inside the *_test database that TEST_DATABASE_URL names. Suites that use it run
// only when TEST_DATABASE_URL is set; otherwise they are reported as skipped, never passed.
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

  /** Creates the schema and applies every migration in order. */
  async create(): Promise<void> {
    const client = new Client({ connectionString: this.databaseUrl });
    await client.connect();
    try {
      await client.query(`CREATE SCHEMA "${this.name}"`);
      await client.query(`SET search_path TO "${this.name}"`);
      const migrations = readdirSync(migrationsDir)
        .filter((name) => /^\d{14}_/.test(name))
        .sort();
      for (const name of migrations) {
        await client.query(
          readFileSync(join(migrationsDir, name, 'migration.sql'), 'utf8'),
        );
      }
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
