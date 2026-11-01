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

Then, in a second terminal, create the schema and (optionally) load the two fixture tenants:

```bash
pnpm db:migrate               # applies prisma/migrations (never resets data)
pnpm db:fixtures              # two fake tenants for development
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
packages/database   Prisma schema, migrations and client; tenant-aware access (entry points,
                    scoped client, repositories); pagination; fixture tenants and factories;
                    PostgreSQL/Redis readiness probes; test-database guards
packages/integrations  Provider interfaces and fake providers
packages/ai-agents, compliance, email-engine, ui   Placeholders (nothing exported yet)
infra/postgres/initdb  Creates the isolated test database on first PostgreSQL start
```

## Commands

| Command                             | What it does                                                              |
| ----------------------------------- | ------------------------------------------------------------------------- |
| `pnpm dev`                          | Local services plus all apps in watch mode                                |
| `pnpm build`                        | Build every package and app                                               |
| `pnpm lint`                         | ESLint (strict, type-aware) for every package and the root scripts        |
| `pnpm typecheck`                    | Strict TypeScript checks for every package, including tests               |
| `pnpm test`                         | Unit and integration tests (Vitest)                                       |
| `pnpm test:e2e`                     | Builds, then runs the Playwright browser smoke test                       |
| `pnpm db:migrate`                   | Applies pending migrations to `DATABASE_URL` (`prisma migrate deploy`)    |
| `pnpm db:fixtures [--reset]`        | Loads the two fixture tenants into `DATABASE_URL` (development/test only) |
| `pnpm format` / `pnpm format:check` | Prettier                                                                  |

## Tests

- **Unit tests:** `src/**/*.test.ts` next to the code, run with Vitest 5.
- **API integration tests:** `apps/api/src/**/*.integration.test.ts` boot the real NestJS app on
  a loopback port and call it over HTTP. Readiness checks are replaced with fakes, so no
  services are needed.
- **Database integration tests:** `packages/database/src/*.integration.test.ts` run against
  real PostgreSQL and Redis **only** when `TEST_DATABASE_URL` and `TEST_REDIS_URL` are set.
  Otherwise those suites are reported as _skipped_. CI always sets them.
  - There are five suites: core data; outreach and jobs; billing, usage, audit and
    notifications; catalog structure; and tenant access. Each creates its own schema in the
    `_test` database, applies every migration and drops the schema afterwards.
  - Together they check:
    - no drift between the migrations and `schema.prisma`;
    - the fixture tenants;
    - the integrity rules;
    - the index used by each planned query;
    - the rules every table follows: tenant keys, foreign keys and their indexes, UTC
      timestamps, no credential columns, one table per concept;
    - tenant isolation: every tenant-owned model through the scoped client, and every
      relation between tenant rows, with an authorized and an unauthorized tenant;
    - the access entry points, platform-admin auditing, and the audit, notification, usage
      and billing repositories.
  - One test (concurrent usage reservations) needs real PostgreSQL. It skips itself on PGlite
    and runs in CI.
  - The database package runs its test files one at a time.
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

The schema is `packages/database/prisma/schema.prisma` (Prisma 7). Migrations live in
`packages/database/prisma/migrations`:

- `20261101000000_core_data_model` was generated from the schema.
- `20261101000100_tenant_integrity_checks` is hand-written: CHECK constraints, normalization
  predicates and `tenant_id` immutability triggers, which Prisma cannot express.
- `20261101000200_outreach_and_jobs` was generated from the schema: campaigns, drafts and
  approvals, sending, mailboxes and conversations, suppression, and background jobs.
- `20261101000300_outreach_integrity_checks` is hand-written: time zone and secret-reference
  predicates, CHECK constraints, append-only triggers for drafts and approvals, and
  `tenant_id` immutability triggers for the new tables.
- `20261101000400_billing_audit_notifications` was generated from the schema: plans and
  limits, subscriptions, payment facts, usage reservations and ledger, limit overrides,
  branding, audit records and notifications.
- `20261101000500_billing_integrity_checks` is hand-written: CHECK constraints, append-only
  triggers for payment facts, the usage ledger and audit records, and `tenant_id`
  immutability triggers for the new tables.

**Apply migrations:** `pnpm db:migrate` runs `prisma migrate deploy` against `DATABASE_URL`
(read from the environment, or from the root `.env`). It only applies pending migrations and
never resets data.

**Add a migration:**

1. Change `schema.prisma`.
2. Generate the SQL for the change, and review it before applying it anywhere:

   ```bash
   cd packages/database
   pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
   ```

   Run this against a database that has all current migrations applied.

3. Save the output as `prisma/migrations/<UTC timestamp>_<name>/migration.sql`. Add
   hand-written SQL in its own migration when Prisma cannot express it.
4. Commit it. The schema integration suite fails if migrations and `schema.prisma` drift
   apart.

**Partial indexes** (`where: raw(...)`, a Prisma preview feature):

- Write enum literals the way PostgreSQL prints them back, e.g.
  `status <> 'FAILED'::outbound_attempt_status`. Otherwise the drift check fails.
- Give partial unique constraints a `name` ending in `_partial`. Prisma Client offers them as
  `findUnique` keys but ignores their WHERE clause, so ESLint forbids using them for lookups.

Avoid `prisma migrate dev` and `prisma migrate reset` on databases you care about: they can
reset data.

**Generated client:** `prisma generate` writes Prisma Client to `packages/database/src/generated`
(git-ignored). Turborepo runs it automatically before build, typecheck, lint, test and dev.

## Fixtures

**Database fixtures:** `pnpm db:fixtures` loads two isolated fixture tenants, **Alpha**
(hosted) and **Beta** (dedicated), into `DATABASE_URL`. Each has:

- users, roles, permissions, memberships and settings;
- an ICP, organizations, contacts and a lead list with members;
- an import with source records;
- research, evidence, a score and a verification;
- outreach in mid-flight:
  - a mailbox with a `fake://` secret reference, templates, and a campaign with a two-step
    sequence;
  - one lead whose AI draft was rejected, whose edited version was approved and sent (the
    first attempt failed, the second succeeded), and who replied, which stopped the lead;
  - a second lead whose draft awaits approval;
  - suppressions;
- background-job rows: schedules with a run and tasks, a lease, outbox events, an inbound
  event and a sync cursor;
- billing: a cancelled Starter subscription and a current one; a failed payment and its
  successful retry, derived from Stripe-shaped inbound events; a limit override; usage
  holds and ledger entries; branding; audit records by a member, a worker and a platform
  admin; notifications.

Every relation between tenant rows is used in both tenants.

Details:

- **Only fake data.** Every address and domain uses the reserved `.test` TLD. Nothing was
  sent or charged: provider ids (`fake_…`) and `fake://` secret references point at
  nothing.
- **The same identity in both tenants.** Both deliberately share the same email, domain,
  Apollo id and provider message, thread and event ids, which only works because uniqueness
  is per tenant (and per mailbox).
- **Time zone intent.** Each tenant's sent intent was planned for 09:30 local time (New York
  and London), so the two are different UTC instants.
- **Idempotent.** Loading again changes nothing.
- **Reset is scoped.** `pnpm db:fixtures --reset` deletes only the two fixture tenants, the
  fixture users and the three fixture plans, then reloads them. Platform audit records are
  kept (they outlive tenants by design).
- **Never in staging or production.** The command refuses to run when `APP_ENV` is `staging`
  or `production`.

In code: `loadFixtureTenants(prisma)`, `fixtureIds('alpha' | 'beta')`, `FIXTURE_TENANTS` and
`FIXTURE_PLANS` from `@lead-fennec-ai/database`.

**Fixture factories:** `createFixtureFactory(prisma)` creates fresh rows with valid defaults
and unique `.test` names, for tests that need their own tenants: `user`, `tenant` (with
settings and the system roles), `membership`, `plan` (with limits), `subscription`,
`contact`, and `workspace(limits)` (a tenant with an active admin and a current
subscription).

**Provider fixtures:** the fake providers are the fixtures for external data. Seed them in a
test, for example `new FakeLeadDataProvider([...people])`,
`new FakeEmailVerificationProvider({ 'a@example.test': 'valid' })` or
`new FakeAiProvider([scriptedOutput])`, and assert on what they recorded (`sent`, `requests`,
`usage`).

## Tenant-aware data access

Server code reads and writes tenant data only through the entry points in
`@lead-fennec-ai/database` (`docs/decisions.md` D-03C-04, D-03C-05):

```ts
const scope = await memberScope(prisma, { tenantId, userId }); // active members only
await scope.db.contact.findMany(); // every query is limited to this tenant
const page = await scope.audit.list({ limit: 25, cursor }); // keyset pagination
const hold = await scope.usage.reserve({
  metric: 'AI_TOKENS',
  quantity: 4000,
  idempotencyKey,
  purpose: 'research.run',
});
await scope.usage.commit(hold.id, tokensUsed);
```

- `memberScope`: a user with an active membership in an active tenant.
- `platformAdminScope`: a platform admin with a stated reason. Opening it writes an audit
  record in the tenant, and its client is read-only. A refusal is recorded in
  `platform_audit_records`.
- `systemScope`: a named worker, after iterating `tenants`.
- `platformConsole`: the only cross-tenant view, for platform admins, audited.

The scoped client (`scope.db`) rejects arguments that name another tenant and has no raw
SQL and no platform models. Lists use `paginate` (`src/pagination.ts`): opaque cursors,
25 rows by default, at most 100.

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
