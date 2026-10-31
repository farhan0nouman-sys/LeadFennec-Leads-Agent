# Lead Fennec AI

Multi-tenant lead-generation and outreach application: Next.js web app, NestJS API and a
background worker in a pnpm/Turborepo monorepo, with PostgreSQL and Redis.

> **Status:** early scaffold. Infrastructure, configuration, health checks, logging and the
> test setup exist; product features do not yet. Build progress: `docs/build-progress.md`.
> Decisions and pinned versions: `docs/decisions.md`. Rules for contributors and coding
> agents: `CLAUDE.md`.

## Developer startup

Prerequisites: Node.js `^24.15.0`, pnpm 12.16.1, and Docker Desktop with Compose v2 for the
local PostgreSQL and Redis.

```bash
pnpm install
cp .env.example .env          # then replace every "replace-with-..." placeholder
pnpm dev                      # starts PostgreSQL + Redis (Docker), then web, API and worker
```

| App           | URL                                                     |
| ------------- | ------------------------------------------------------- |
| Web           | http://localhost:3000                                   |
| API           | http://localhost:3001 (`/health/live`, `/health/ready`) |
| Worker health | http://localhost:3002 (`/health/live`, `/health/ready`) |

`pnpm dev` checks Node, dependencies, `.env` and Docker first, and stops with a specific
message if anything is missing. To use your own PostgreSQL and Redis instead of Docker, run
`pnpm dev --skip-services`. Ports, every environment variable, startup errors and data resets
are covered in **[docs/local-development.md](docs/local-development.md)**.

## Repository layout

```
apps/web            Next.js 16 (App Router)
apps/api            NestJS 12 API
apps/worker         Background worker (job processors not added yet)
packages/shared     Env validation, health checks, logging, redaction, test network guard
packages/database   PostgreSQL/Redis connectivity and test-database guards
packages/integrations  Provider interfaces and fake providers
packages/ai-agents, compliance, email-engine, ui   Placeholders (nothing exported yet)
infra/postgres/initdb  Creates the isolated test database on first PostgreSQL start
```

## Commands

| Command                             | What it does                                                       |
| ----------------------------------- | ------------------------------------------------------------------ |
| `pnpm dev`                          | Local services plus all apps in watch mode                         |
| `pnpm build`                        | Build every package and app                                        |
| `pnpm lint`                         | ESLint (strict, type-aware) for every package and the root scripts |
| `pnpm typecheck`                    | Strict TypeScript checks for every package, including tests        |
| `pnpm test`                         | Unit and integration tests (Vitest)                                |
| `pnpm test:e2e`                     | Builds, then runs the Playwright browser smoke test                |
| `pnpm format` / `pnpm format:check` | Prettier                                                           |

## Tests

- **Unit tests:** `src/**/*.test.ts` next to the code, run with Vitest 5.
- **API integration tests:** `apps/api/src/**/*.integration.test.ts` boot the real NestJS app on
  a loopback port and call it over HTTP. Readiness checks are replaced with fakes, so no
  services are needed.
- **Database integration tests:** `packages/database/src/infrastructure.integration.test.ts`
  runs against real PostgreSQL and Redis **only** when `TEST_DATABASE_URL` and
  `TEST_REDIS_URL` are set. Otherwise those suites are reported as _skipped_. CI always sets
  them.
- **Browser smoke test:** `apps/web/e2e/smoke.spec.ts` uses Playwright (Chromium) against the
  production build on `127.0.0.1:3100`. Install the browser once with
  `pnpm --filter @lead-fennec-ai/web exec playwright install chromium --only-shell`.

### Safety in tests

- **No network beyond loopback.** Every Vitest project loads
  `packages/shared/src/testing/network-guard.ts`. Any TCP/TLS connection to a non-loopback
  host fails with `NetworkAccessDeniedError`, before DNS lookup or connect: `fetch`, `http`,
  SDKs, SMTP. Real sending and real provider calls cannot happen in tests, whatever the code
  under test tries.
- **Fake providers only.** `createProviders(appEnv, mode)` in `@lead-fennec-ai/integrations`
  refuses live providers when `APP_ENV` is `test` or `development`. Tests use
  `createFakeProviders()`: in-memory fakes for OpenAI, Apollo, email verification, Gmail,
  Microsoft Graph, GoHighLevel and Stripe that record calls. The interfaces are provisional
  (`docs/decisions.md` O-07).
- **Isolated test databases.** `assertTestDatabaseUrl` refuses any database whose name doesn't
  end in `_test`, and `assertTestRedisUrl` refuses Redis database 0. Tests never read `.env`.

To run the database integration tests locally (Docker running, `pnpm dev` started at least
once so the test database exists):

```bash
TEST_DATABASE_URL=postgresql://leadfennec:<your-password>@127.0.0.1:5432/leadfennec_test \
TEST_REDIS_URL=redis://:<your-password>@127.0.0.1:6379/15 \
pnpm test
```

## Migrations

**Not available yet.** Prisma is part of the stack, but no schema or migrations exist: they
depend on the data model, which isn't defined yet (`docs/decisions.md` O-08). What exists
today:

- The isolated test database `<POSTGRES_DB>_test`. `infra/postgres/initdb` creates it the first
  time the PostgreSQL volume is initialized.
- The test-database guards described above.

When migrations are added, this section will document the commands to create and apply them,
and how they run against the test database.

## Fixtures

**Provider fixtures:** the fake providers are the fixtures for external data. Seed them in a
test, for example `new FakeLeadDataProvider([...people])`,
`new FakeEmailVerificationProvider({ 'a@example.test': 'valid' })` or
`new FakeAiProvider([scriptedOutput])`, and assert on what they recorded (`sent`, `requests`,
`usage`).

**Database fixtures:** not available yet; they need the Prisma schema (O-08). There is no
fixture-loading command yet.

## Verification

CI (`.github/workflows/ci.yml`) runs on every push to `main` and every pull request:

1. Install from the lockfile (`pnpm install --frozen-lockfile`).
2. Format check, lint and typecheck.
3. Unit and integration tests, with PostgreSQL and Redis test databases as service containers.
4. Build.
5. Playwright smoke test.

It uses no secrets. To reproduce locally:

```bash
pnpm install --frozen-lockfile
pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e
```

A check counts as passed only when it ran and succeeded. Skipped database suites are not
passes; record them as not run (see `docs/build-progress.md`).

## Logging

The API and the worker write structured JSON lines (pino) to stdout. `LOG_LEVEL` defaults to
`info`.

- **Request IDs:** every HTTP request gets one. A well-formed incoming `X-Request-Id` is reused;
  otherwise a UUID is generated. It is returned in the `X-Request-Id` response header and
  included in every log line written during that request.
- **Redaction:** auth headers, cookies and password/token/key fields are replaced with
  `[REDACTED]`. Credentials inside URLs (`scheme://user:password@host`) are masked to `***` in
  the final log line, including error messages and stacks.
