import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient } from './client.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { MigratedSchema, testDatabaseUrl } from './testing/migrated-schema.js';

// The Prisma client in a schema other than "public" (the test suites' isolated schemas). Raw
// SQL and the hand-written triggers name tables without a schema, so they must resolve in the
// client's schema too. PGlite hid this (one shared session kept the migrations' search_path);
// real PostgreSQL did not. Runs only when TEST_DATABASE_URL is set; otherwise it is reported
// as skipped, never passed.
const db = new MigratedSchema('tcli');

describe('createPrismaClient', () => {
  it('refuses a schema name that would need quoting', () => {
    for (const schema of ['Mixed', 'a b', 'a"b', 'a;b', '1abc', '']) {
      expect(() =>
        createPrismaClient({
          databaseUrl: 'postgresql://unused:unused@127.0.0.1:1/unused_test',
          schema,
        }),
      ).toThrow('Invalid schema name');
    }
  });
});

describe.runIf(testDatabaseUrl !== undefined)(
  'Prisma client in its own schema on PostgreSQL',
  () => {
    let prisma: PrismaClient;

    beforeAll(async () => {
      await db.create();
      prisma = createPrismaClient({
        databaseUrl: db.databaseUrl,
        schema: db.name,
        maxConnections: 1,
      });
    }, 60_000);

    afterAll(async () => {
      await prisma.$disconnect();
      await db.drop();
    });

    it('runs raw SQL in the same schema as the queries Prisma builds', async () => {
      const [row] = await prisma.$queryRaw<
        { schema: string }[]
      >`SELECT current_schema() AS schema`;
      expect(row?.schema).toBe(db.name);

      await prisma.$transaction(async (tx) => {
        // The row locks in the repositories, e.g. discovery.ts and research.ts.
        await tx.$queryRaw`SELECT id FROM imports WHERE id = gen_random_uuid() FOR UPDATE`;
        await tx.$queryRaw`SELECT 1 FROM "research" WHERE "id" = gen_random_uuid() FOR UPDATE`;
      });
      expect(await prisma.import.count()).toBe(0);
    });
  },
);
