# Lead Fennec AI

Multi-tenant lead-generation and outreach application: Next.js web app, NestJS API and a
background worker in a pnpm/Turborepo monorepo, with PostgreSQL and Redis.

> **Status:** early. Infrastructure, configuration, health checks, logging, the test setup,
> the data model, the account API (registration, email verification, sign-in, sessions,
> password reset), the workspace API (workspaces, invitations, roles, platform-admin
> operations), their screens, the app shell, the shared UI components, the typed API client,
> the workspace dashboard, the campaign configuration API, the campaign setup wizard and the
> campaign readiness checks exist. No campaign can start yet: the services it needs are marked
> "Not available yet". The lead-generation pages are shells marked "Not available
> yet". Build progress:
> `docs/build-progress.md`.
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
apps/web            Next.js 16 (App Router), Tailwind CSS 4, shadcn/ui-style components:
                    app shell, account, workspace, team and admin screens, route shells;
                    shared tables, filters, forms, dialogs and states; typed API client and
                    workspace-scoped cache (lib); server-side page checks (lib/server);
                    /api proxy; fixture demo at /dev/ui (development and test only)
apps/api            NestJS 12 API: health, auth (docs/api/auth.md), workspaces and teams
                    (docs/api/workspaces.md)
apps/worker         Background worker (job processors not added yet)
packages/shared     Env validation, health checks, logging, redaction, test network guard;
                    API contracts, the endpoint list and the OpenAPI generator
packages/database   Prisma schema, migrations and client; tenant-aware access (entry points,
                    scoped client, repositories); pagination; fixture tenants and factories;
                    PostgreSQL/Redis readiness probes; test-database guards
packages/integrations  Provider interfaces and fake providers (including transactional mail)
packages/ai-agents, compliance, email-engine, ui   Placeholders (nothing exported yet)
infra/postgres/initdb  Creates the isolated test database on first PostgreSQL start
```

## Commands

| Command                             | What it does                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm dev`                          | Local services plus all apps in watch mode                                           |
| `pnpm build`                        | Build every package and app                                                          |
| `pnpm lint`                         | ESLint (strict, type-aware) for every package and the root scripts                   |
| `pnpm typecheck`                    | Strict TypeScript checks for every package, including tests                          |
| `pnpm test`                         | Unit and integration tests (Vitest)                                                  |
| `pnpm test:e2e`                     | Builds the web app and API, then runs the Playwright browser tests                   |
| `pnpm openapi`                      | Regenerates `docs/api/openapi.json` from the endpoint list (`--check` compares only) |
| `pnpm db:migrate`                   | Applies pending migrations to `DATABASE_URL` (`prisma migrate deploy`)               |
| `pnpm db:fixtures [--reset]`        | Loads the two fixture tenants into `DATABASE_URL` (development/test only)            |
| `pnpm format` / `pnpm format:check` | Prettier                                                                             |

## Tests

- **Unit tests:** `src/**/*.test.ts` next to the code, run with Vitest 5. The web app's are in
  `apps/web/lib/**/*.test.ts` (the client cache, address-bar parameters, the typed client, the
  proxy, the polling rules, the dashboard formatting and the campaign wizard rules).
- **API contract:** `apps/api/src/http/api-contract.test.ts` checks the registered routes
  against the endpoint list (guards, permission, status, the validation schemas), and a
  shared test fails when `docs/api/openapi.json` is out of date.
- **API integration tests:** `apps/api/src/**/*.integration.test.ts` boot the real NestJS app on
  a loopback port and call it over HTTP.
  - The health tests replace the readiness checks with fakes, so they need no services.
  - The auth, workspace, dashboard, campaign and discovery tests (`apps/api/src/auth/auth.integration.test.ts`,
    `apps/api/src/workspaces/workspaces.integration.test.ts`,
    `apps/api/src/workspaces/dashboard.integration.test.ts`,
    `apps/api/src/workspaces/campaigns.integration.test.ts`,
    `apps/api/src/workspaces/discovery.integration.test.ts`,
    `apps/api/src/workspaces/imports.integration.test.ts`) need `TEST_DATABASE_URL` and are
    reported as skipped without it. They share a harness (`apps/api/src/testing`) and run one
    file at a time. They use their own migrated schema, the fake mail
    provider and a controllable clock, and run every account flow over HTTP. They check each
    response against the shared contract and fail if any password or token appears in a log
    line.
- **Database integration tests:** `packages/database/src/*.integration.test.ts` run against
  real PostgreSQL and Redis **only** when `TEST_DATABASE_URL` and `TEST_REDIS_URL` are set.
  Otherwise those suites are reported as _skipped_. CI always sets them.
  - There are twelve suites: core data; outreach and jobs; billing, usage, audit and
    notifications; authentication; workspaces, invitations and the worker context; dashboard
    aggregates; campaign configuration; campaign activation; lead discovery requests; CSV
    imports of companies; catalog structure; and tenant access. Each creates its own schema in the
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
- **Worker job tests:** `apps/worker/src/jobs/lead-discovery.integration.test.ts` runs the
  organization search job against real PostgreSQL with the fake provider (saving, exclusions,
  repeats, resuming, cancellation, failures, budgets, the relay); it needs `TEST_DATABASE_URL`
  and is reported as skipped without it. Nothing there needs Redis.
- **Browser tests** (Playwright, Chromium) run against the production builds. Install the
  browser once with `pnpm --filter @lead-fennec-ai/web exec playwright install chromium --only-shell`.
  - `apps/web/e2e/smoke.spec.ts` and `apps/web/e2e/ui-components.spec.ts` (8 scenarios on the
    fixture demo page) always run (web app on `127.0.0.1:3100`).
  - `apps/web/e2e/accounts-and-teams.spec.ts` (11 scenarios: two workspaces, all three roles)
    `apps/web/e2e/app-shell.spec.ts` (7 scenarios: navigation by role, server-side page
    checks, keyboard, narrow screens, the admin area, axe accessibility checks) and
    `apps/web/e2e/data-client.spec.ts` (3 scenarios: the workspace-scoped cache, confirmations,
    an ended session) and `apps/web/e2e/dashboard.spec.ts` (5 scenarios: counts from the
    database, panels by role, bounded polling with Playwright's clock, error recovery, narrow
    screens) and `apps/web/e2e/campaign-wizard.spec.ts` (7 scenarios, readiness checks included: saving and reopening a
    half-done campaign, the page and the API refusing the same values, honest notices,
    conflicts, read-only campaigns, narrow screens) and `apps/web/e2e/imports.spec.ts` (5
    scenarios: a search run by the worker code through `run-task` and followed live, repeats
    matched, a suppressed domain, a CSV import with mapping and a formula-safe error report,
    cancellation, a failed run, narrow screens) also start the built API on `127.0.0.1:3101`. They need `E2E_DATABASE_URL` (a `*_test` database;
    migrations are applied first) and are reported as skipped without it. See
    `docs/local-development.md` → Browser tests.

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
- `20261101000600_user_authentication` was generated from the schema: password hashes,
  sessions, emailed one-time tokens and attempt counters, plus `users.email_verified_at`.
- `20261101000700_user_authentication_checks` is hand-written: the Argon2id hash format,
  SHA-256 token shapes, and session and token timing.
- `20261101000800_retire_invited_memberships` (hand-written data step) turns `INVITED`
  memberships into `SUSPENDED` before the status is removed.
- `20261101000900_workspaces_and_invitations` was generated (then its `"public".`
  qualifiers removed): `invitations`, the enum changes, and a unique index on `job_tasks.id`.
- `20261101001000_invitation_integrity_checks` is hand-written: invitation CHECKs and the
  trigger that keeps an invitation's binding immutable.
- `20261101001100_user_audit_actor` was generated: the `USER` audit actor.
- `20261101001200_user_audit_actor_checks` is hand-written: `USER` only in platform audit
  records; explicit actor lists in both audit tables.
- `20261102000000_campaign_configuration` was generated: the campaign approval mode, version,
  configuration sections (JSONB) and lead limits.
- `20261102000100_campaign_configuration_checks` is hand-written: version, name, description
  and lead-limit bounds, and the shape and size of the configuration sections.

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
- an import with source records, and a queued organization search from the ICP (07A);
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

## Accounts and sessions

The API implements registration, email verification, sign-in, logout, sessions and password
reset. The contract (routes, schemas, error codes) is `packages/shared/src/contracts/auth.ts`,
described in **[docs/api/auth.md](docs/api/auth.md)**. Decisions and sources:
`docs/decisions.md` D-04A-*.

- **Passwords:** Argon2id (OWASP minimum settings), 15–128 characters, any characters.
- **Sessions:** a random token in a `__Host-` cookie (HttpOnly, Secure, SameSite=Lax), stored
  only as SHA-256. They end after 30 idle minutes or 8 hours, on logout, and when the
  password is reset.
- **CSRF:** authenticated mutations need the session's `x-csrf-token`. Every `POST` from
  another origin is refused.
- **No account enumeration:** register, resend and reset requests always answer `202`, and
  sign-in failures are indistinguishable.
- **Limits:** a sign-in lock per address after 5 failures, email limits per address, and a
  per-IP limit.
- **Email:** goes through `TransactionalMailProvider`. Development and test use the fake,
  which never sends. Staging and production don't start until a live adapter exists (O-19).

## Workspaces and teams

A signed-in, verified user creates a workspace and becomes its **Client Admin**. Admins invite
people by email with a role. The invitation is bound to that workspace and that address,
expires after 7 days and works once. Team members (**Client Team Member**) can see the team but
not change it. **Platform admins** act only through explicit `/platform/*` routes, each with a
stated reason and audit records. Contract: **[docs/api/workspaces.md](docs/api/workspaces.md)**;
decisions: `docs/decisions.md` D-04B-*.

- The permission catalog and the system roles are code: `packages/shared/src/authorization.ts`.
- Every `:workspaceId` is checked against the session user's active membership (otherwise
  `404`). Every record id is looked up inside that workspace.
- **Background jobs** carry only `{ v: 1, taskId }`. Workers call
  `claimJob(prisma, defineWorker({ name, taskTypes }), message)`, which takes the workspace
  from the task row, never from the message.

## Lead discovery

A member with `imports.create` asks for an organization search from one of the workspace's
ICPs (`POST /workspaces/:workspaceId/imports/discovery`) and gets `202` with a run id and a
status URL; the worker runs it. Companies also come from CSV files
(`POST /workspaces/:workspaceId/imports/csv`). Contract:
**[docs/api/discovery.md](docs/api/discovery.md)**; decisions: `docs/decisions.md` D-07A-* to
D-07C-*.

- **Checked first:** the ICP's criteria (`icpCriteriaSchema`), at least one company filter,
  only filters the provider supports, and the limit (at most 1000, and at most the provider's
  own). A refused request stores nothing.
- **Stored:** an `imports` row (`ORGANIZATION_SEARCH`) with the filters, limit, provider,
  attribution and a query hash, all immutable, plus a queued job task and an audit record.
- **Companies only:** people criteria (titles, seniorities) are kept for contact discovery;
  nothing creates contacts.
- **Providers** sit behind `OrganizationSearchProvider` (`packages/integrations`).
  `LeadDiscoveryService` pages through one, validates each record, normalizes company
  identities (`normalizeCompanyIdentity`), drops duplicates and keeps each company's source.
  Development and tests use `FakeOrganizationSearchProvider`: 240 synthetic companies, the
  same results every time.
- **Apollo** (D-07B-*): `ApolloOrganizationSearchProvider` calls only Apollo's documented
  organization search, with explicit field mapping, page tokens, rate-limit and quota
  handling, bounded retries, timeouts and errors that never carry Apollo's words or the key.
  It is used only in staging and production, by the worker, with `APOLLO_API_KEY`; the API
  sees only its declaration. Its contract tests use synthetic fixtures
  (`packages/integrations/src/fixtures/apollo`) and a scripted `fetch`.
- **Search jobs** (D-07C-01, D-07C-02): the worker's relay publishes due job tasks to BullMQ
  (Redis); the worker runs each search page by page. Each page is saved in one transaction
  (companies, a result per record, counts, the resume token), so an interrupted search resumes
  without duplicates. Paid providers reserve a search credit per page first. A queued or
  running search can be cancelled.
- **Saving companies** (`saveOrganizations`): a domain (or parent domain) on the suppression
  list is excluded; a company already in the workspace is matched, never added twice;
  otherwise it is created. Every received record keeps its outcome and source.
- **CSV imports** (D-07C-03): at most 256 KB and 1000 rows; columns mapped to fields; every
  row saved, matched, excluded or reported as failed with its reasons; values cleaned and never
  evaluated.
- **Screens** (D-07C-06): the Imports page (find companies, import a CSV, the runs so far)
  and a page per run with its status, counts, failure reason, cancellation, results by outcome
  and an error report whose cells can't run as spreadsheet formulas (`toCsv`, D-07C-05).

## Screens

The web app has the account and team screens (`docs/decisions.md` D-04C-*): sign-in,
registration, email confirmation, password reset, the workspace list, a workspace overview, the
team page (members, roles, invitations) and the platform console (`/admin`).

- **App shell** (D-05A-*): a sidebar (a drawer on narrow screens) with the workspace selector
  and the pages the member's role opens, breadcrumbs, a skip link, and route shells for the
  pages not built yet.
- **Pages** are listed once, in `packages/shared/src/navigation.ts`: path, group, permission,
  status and API resources.
- **Server-side checks:** every page calls `apps/web/lib/server/access.ts` before rendering
  (sign-in, membership, permission, platform admin). The API checks every data request again.
- **Shared components** (D-05B-04): paginated tables, search and filters kept in the address
  bar, status labels, form fields, dialogs and confirmations, empty and retry states, and error
  boundaries. `/dev/ui` shows them all on invented data (development and test only).
- **Dashboard** (D-05C-*): the workspace overview shows lead and campaign counts from the
  database, metrics that later features will provide as "Not available yet", recent
  activity (audit records) and integration health. Each panel appears only when the
  member's role opens its section. Activity and integration health refresh themselves while
  the page is visible, for at most 30 minutes (`apps/web/lib/polling.ts`). API:
  `docs/api/dashboard.md`.
- **Campaigns** (D-06B-01 to 06): a list, and an eight-stage setup wizard (business profile, target
  audience, offer, lead filters, mailbox, sequence, schedule, review). Each stage saves its part
  of the draft, incomplete or not, with the same validation as the API. Connecting mailboxes
  and writing emails are marked "Not available yet". The review stage lists every check that
  must pass before the campaign can start (D-06C-01 to 05); starting uses its own endpoint, and the
  checks for unbuilt services always block.

- **API access:** the browser calls only the web app's `/api/*`, which forwards to
  `API_BASE_URL` with the session cookie (`apps/web/lib/api-proxy.ts`). Client code calls an
  endpoint of the shared list: `callApi` (`apps/web/lib/api.ts`), or `useApiQuery` and
  `useApiMutation` (`apps/web/lib/query.tsx`), which cache reads per user and workspace and
  reload what a change made stale (D-05B-03). The OpenAPI document of every route is
  `docs/api/openapi.json`.
- **Session:** `SessionProvider` (`apps/web/lib/session.tsx`) holds the user and the CSRF token
  in memory. Pages that need a user call `useRequiredSession()`.
- **Security events** (sign-in, sign-out, reset…) are written to the platform audit records;
  see `docs/api/auth.md`. The authorization review is in
  **[docs/security/authorization-review.md](docs/security/authorization-review.md)**.

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
5. Playwright browser tests, including the account and team scenarios against the built API.

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
