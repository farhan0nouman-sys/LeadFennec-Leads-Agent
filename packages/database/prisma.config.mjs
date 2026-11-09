// Prisma CLI configuration (Prisma 7 does not read .env files itself).
// Developer commands (`db:migrate`, `db:fixtures`) load the repository's root .env here;
// variables already set in the environment win. `prisma generate` needs no database URL.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
if (existsSync(rootEnv)) {
  process.loadEnvFile(rootEnv);
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env['DATABASE_URL'] },
});
