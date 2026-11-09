import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export interface CreatePrismaClientOptions {
  readonly databaseUrl: string;
  /** PostgreSQL schema to use; defaults to "public". Tests use an isolated schema per run. */
  readonly schema?: string;
  /** Maximum pooled connections (default 10). */
  readonly maxConnections?: number;
}

/** A plain lower-case identifier: needs no quoting in search_path or a startup option. */
const SCHEMA_NAME = /^[a-z_][a-z0-9_]{0,62}$/;

/** Prisma Client over node-postgres (Prisma 7 driver adapter). */
export function createPrismaClient(
  options: CreatePrismaClientOptions,
): PrismaClient {
  const { schema } = options;
  if (schema !== undefined && !SCHEMA_NAME.test(schema)) {
    throw new Error(
      'Invalid schema name: use lower-case letters, digits and underscores',
    );
  }
  const adapter = new PrismaPg(
    {
      connectionString: options.databaseUrl,
      max: options.maxConnections ?? 10,
      // The adapter's `schema` option qualifies only the queries Prisma builds. Raw SQL
      // ($queryRaw row locks, lead search) and the hand-written triggers name tables without a
      // schema, so every connection's search_path is this schema. Without it they reach
      // "public" on real PostgreSQL (PGlite hid this: its one shared session kept the
      // search_path that the test migrations had set).
      ...(schema === undefined ? {} : { options: `-c search_path=${schema}` }),
    },
    schema === undefined ? undefined : { schema },
  );
  return new PrismaClient({ adapter });
}
