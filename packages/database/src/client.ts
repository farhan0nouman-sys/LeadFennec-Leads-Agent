import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export interface CreatePrismaClientOptions {
  readonly databaseUrl: string;
  /** PostgreSQL schema to use; defaults to "public". Tests use an isolated schema per run. */
  readonly schema?: string;
  /** Maximum pooled connections (default 10). */
  readonly maxConnections?: number;
}

/** Prisma Client over node-postgres (Prisma 7 driver adapter). */
export function createPrismaClient(
  options: CreatePrismaClientOptions,
): PrismaClient {
  const adapter = new PrismaPg(
    {
      connectionString: options.databaseUrl,
      max: options.maxConnections ?? 10,
    },
    options.schema === undefined ? undefined : { schema: options.schema },
  );
  return new PrismaClient({ adapter });
}
