# Local development

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | `^24.15.0` | `package.json` engines |
| pnpm | 12.16.1 | Pinned by `packageManager` |
| Docker Desktop | Any version with Compose v2 (`docker compose`) | Runs PostgreSQL and Redis. Not needed with `--skip-services`. |

## First-time setup

```bash
pnpm install
cp .env.example .env
```

Then edit `.env` and replace each `replace-with-...` placeholder with a local password of your
choice.
- **PostgreSQL:** the password appears in `POSTGRES_PASSWORD` *and* inside `DATABASE_URL`.
- **Redis:** the password appears in `REDIS_PASSWORD` *and* inside `REDIS_URL`.

`.env` is git-ignored. Never commit it, and never put real provider credentials in
`.env.example`.

## Start everything: one command

```bash
pnpm dev
```

[`scripts/dev.mjs`](../scripts/dev.mjs) runs these steps in order and stops at the first
failure with a specific message (see [Startup errors](#startup-errors)):

1. Checks Node `^24.15.0`, installed dependencies, and that `.env` exists.
2. Checks that Docker is installed and running, with Compose v2.
3. `docker compose up --detach --wait`: starts PostgreSQL and Redis and waits until both pass
   their health checks.
4. `turbo run dev`: starts web, API and worker in watch mode with the variables from `.env`.
   Variables already exported in your shell take precedence.

`Ctrl+C` stops the apps. PostgreSQL and Redis keep running so the next start is fast; stop them
with `docker compose stop`.

**Own PostgreSQL/Redis, or no Docker:** point `DATABASE_URL` and `REDIS_URL` at your services and
run `pnpm dev --skip-services`.

## Ports

| Service | URL / address | Configured by | Bound to |
|---|---|---|---|
| Web (Next.js) | http://localhost:3000 | `apps/web/package.json` (`--port 3000`) | All interfaces (Next.js default; open choice O-03) |
| API (NestJS) | http://localhost:3001 | `API_PORT` | All interfaces (NestJS default; O-03) |
| Worker health | http://localhost:3002 | `WORKER_HEALTH_PORT` | All interfaces (Node default; O-03) |
| PostgreSQL 18.6 | `127.0.0.1:5432` | `POSTGRES_PORT` | 127.0.0.1 only |
| Redis 8.8.4 | `127.0.0.1:6379` | `REDIS_PORT` | 127.0.0.1 only |

If you change `POSTGRES_PORT` or `REDIS_PORT`, change the port in `DATABASE_URL` or `REDIS_URL`
to match.

**A native PostgreSQL already on 5432** (for example the Windows service
`postgresql-x64-18`) blocks the Docker PostgreSQL, and the apps would reach the wrong server.
Either:
- set `POSTGRES_PORT=5433` and use port `5433` in `DATABASE_URL`, or
- create a database and user for this project in your native server, point `DATABASE_URL` at it,
  and run `pnpm dev --skip-services` (Redis must then also run outside Docker).

## Health endpoints

Both the API and the worker expose:

| Endpoint | Meaning | Status codes |
|---|---|---|
| `GET /health/live` | The process is running. Never checks dependencies. | `200 {"status":"ok"}` |
| `GET /health/ready` | PostgreSQL (`SELECT 1`) and Redis (`PING`) are reachable within `HEALTH_CHECK_TIMEOUT_MS`. | `200` when ready, `503` otherwise |

Example readiness response with Redis down:

```json
{
  "status": "not_ready",
  "checks": {
    "postgres": { "status": "up", "durationMs": 12 },
    "redis": { "status": "down", "durationMs": 3, "reason": "unavailable" }
  }
}
```

Responses never include hostnames, error messages or credentials. The failure detail is logged
server-side with credentials in URLs masked.

```bash
curl -i http://localhost:3001/health/ready   # API
curl -i http://localhost:3002/health/ready   # worker
```

## Environment variables

Each app validates its own variables at startup and refuses to start if any are invalid. The
schemas are in `apps/api/src/env.ts`, `apps/worker/src/env.ts` and `apps/web/env.ts`.

| Variable | Used by | Default | Rule |
|---|---|---|---|
| `APP_ENV` | web, api, worker | `development` | `development` \| `test` \| `staging` \| `production` |
| `POSTGRES_USER`, `POSTGRES_DB` | compose | `leadfennec` | |
| `POSTGRES_PASSWORD` | compose | none (required) | |
| `POSTGRES_PORT` | compose | `5432` | Host port |
| `REDIS_PASSWORD` | compose | none (required) | |
| `REDIS_PORT` | compose | `6379` | Host port |
| `DATABASE_URL` | api, worker | none (required) | `postgres://` or `postgresql://` URL |
| `REDIS_URL` | api, worker | none (required) | `redis://` or `rediss://` URL. The worker's job queue (BullMQ, task 07C) uses it; the API only checks it is reachable. |
| `TRUST_PROXY_HOPS` | api | `0` | Integer 0–5: proxies in front of the API whose `X-Forwarded-For` entry is trusted (Express `trust proxy`). Per-address rate limits use the resulting client address. `1` when the browser goes through the web app's `/api` proxy (local development, browser tests). In a deployment, count the load balancer too, and make it overwrite `X-Forwarded-For` (O-24). |
| `DATABASE_POOL_MAX` | api | `10` | Integer 1–100: the most PostgreSQL connections the API opens. The browser tests set `1` (PGlite serves one session). |
| `API_PORT` | api | `3001` | Integer 1–65535 |
| `WORKER_HEALTH_PORT` | worker | `3002` | Integer 1–65535 |
| `HEALTH_CHECK_TIMEOUT_MS` | api, worker | `2000` | Integer 100–30000 |
| `LOG_LEVEL` | api, worker | `info` | `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace` \| `silent` |
| `API_BASE_URL` | web | none (required) | `http://` or `https://` URL. Server-side only. |
| `WEB_APP_URL` | api | `http://localhost:3000` in development and test; required elsewhere | Origin of the web app, no path. `https://` outside development and test. Emailed account links point here, and the API refuses state-changing requests from any other origin. |
| `APOLLO_API_KEY` | worker | none | Staging and production only: an Apollo API key scoped to `api/v1/mixed_companies/search` (organization search, task 07B). 8–200 printable characters, no spaces; empty counts as unset. Development and tests always use the fake provider, so leave it unset locally. Redacted from logs. |
| `WEBSITE_FETCH_BLOCKED_HOSTS` | worker | none | Comma-separated domains the website fetcher never fetches, with their subdomains (task 09A). Each entry is normalized like a company domain (lower case, no `www.`); an invalid entry stops the worker at startup. Applies in every environment, the fake included. Empty counts as unset. |
| `OPENAI_API_KEY` | worker | none | Staging and production only (task 09B): an OpenAI API key, 20-512 printable characters, no spaces. Development and tests always use the fake model, so leave it unset locally. Empty counts as unset. Redacted from logs. |
| `OPENAI_MODEL` | worker | none | The model id, e.g. `gpt-6-luna`; required with `OPENAI_API_KEY` (unconfigured fails closed). |
| `OPENAI_REASONING_EFFORT` | worker | none | `none`, `minimal`, `low`, `medium`, `high`, `xhigh` or `max`; sent only when set (models differ). |
| `OPENAI_INPUT_USD_PER_MTOK`, `OPENAI_OUTPUT_USD_PER_MTOK` | worker | none | Prices in US dollars per million tokens, from OpenAI's pricing page, both or neither. Without them, cost events carry tokens but no cost. |
| `WEBSITE_FETCH_ALLOWED_HOSTS` | worker | none | When set, the only domains (and subdomains) the website fetcher fetches; everything else is refused. Same format as above. Useful in staging. |

Turborepo runs in strict environment mode: the `dev` task only passes the variables listed in
`turbo.json` (`passThroughEnv`). When an app gains a variable, add it there too.

### OpenAPI document

`docs/api/openapi.json` is generated from `packages/shared/src/contracts/endpoints.ts`. After
changing a route or a contract schema, run `pnpm openapi`; the shared package's tests fail
while the file is out of date (`pnpm openapi --check` only compares).

### Component demo

With `APP_ENV` `development` or `test`, http://localhost:3000/dev/ui shows the shared tables,
filters, forms, dialogs and states on invented data. It calls no API and needs no sign-in. In
`staging` and `production` it answers 404.

### Browser tests

`pnpm test:e2e` builds the web app and the API, then runs Playwright (Chromium).

- The smoke test and the component scenarios (`apps/web/e2e/ui-components.spec.ts`, on the
  fixture demo page) always run.
- The account and team scenarios (`apps/web/e2e/accounts-and-teams.spec.ts`) and the app-shell
  scenarios (`apps/web/e2e/app-shell.spec.ts`, with axe accessibility checks) and the data
  client scenarios (`apps/web/e2e/data-client.spec.ts`) and the dashboard scenarios
  (`apps/web/e2e/dashboard.spec.ts`, which insert fake contacts and campaigns with
  `E2eDatabase.seedDashboard` and drive polling with Playwright's clock) and the campaign
  wizard scenarios (`apps/web/e2e/campaign-wizard.spec.ts`, with `E2eDatabase.seedCampaignChoices`)
  start the built API on port 3101 and
  the web app on 3100, and need `E2E_DATABASE_URL`: a PostgreSQL URL
  whose database name ends in `_test`. Migrations are applied to it first
  (`prisma migrate deploy`), into its `public` schema. Without the variable the scenarios
  are reported as skipped.
- Emails are never sent: the scenarios read and write tokens in the database instead.
- Example (the isolated test database from Docker Compose):

  ```bash
  E2E_DATABASE_URL=postgresql://leadfennec:<password>@127.0.0.1:5432/leadfennec_test pnpm test:e2e
  ```

### Test-only variables

Tests never read `.env`. These are read from the process environment by `pnpm test`. CI always
sets them; locally, export them in your shell.

| Variable | Rule | Without it |
|---|---|---|
| `TEST_DATABASE_URL` | PostgreSQL URL whose database name ends in `_test` | Real-database suites are reported as skipped |
| `TEST_REDIS_URL` | Redis URL selecting a database other than 0 (e.g. `/15`) | Same |

`infra/postgres/initdb/10-create-test-database.sh` creates `<POSTGRES_DB>_test` the **first**
time the PostgreSQL volume is initialized. For a volume created before this script existed,
create it once with `docker compose exec postgres createdb -U leadfennec leadfennec_test`.
Testing, fake providers and the network guard are documented in [README.md](../README.md#tests).

## Startup errors

| Message starts with | Fix |
|---|---|
| `[dev] Node ... found` | Install Node 24.15 or later on the 24 line. |
| `[dev] Dependencies are not installed` | `pnpm install` |
| `[dev] Missing .env` | `cp .env.example .env`, then set the passwords. |
| `[dev] Docker was not found on PATH` | Install Docker Desktop, or use `--skip-services`. |
| `[dev] Docker is installed but not running` | Start Docker Desktop. |
| `[dev] PostgreSQL/Redis did not start or become healthy` | `docker compose ps` / `docker compose logs postgres redis`. Usually a missing password or a port already in use. |
| `[api] Invalid environment configuration:` (also `[web]`, `[worker]`) | The listed variables are missing or invalid in `.env`. Values are never printed. |
| `[api] Port already in use` (also `[worker]`) | Stop the other process or change `API_PORT` / `WORKER_HEALTH_PORT`. |
| Readiness log: `password authentication failed for user ...` | Something else answers on the `DATABASE_URL` port, often a native PostgreSQL on 5432. See [Ports](#ports). |
| `[fixtures] Fixture tenants are for development and test databases only` | `pnpm db:fixtures` refuses `APP_ENV=staging` or `production`. |
| `[api] LiveProvidersForbiddenError` or `No live provider adapters exist yet` | Outside development and test the API needs a real mail provider for account email, and none exists yet (`docs/decisions.md` O-19). |

## Database schema and fixtures

With PostgreSQL running (`pnpm dev`), in a second terminal:

```bash
pnpm db:migrate     # prisma migrate deploy: applies pending migrations, never resets
pnpm db:fixtures    # loads the two fixture tenants (idempotent); --reset reloads them
```

Both read `DATABASE_URL` from the environment or from the root `.env`; the environment wins.

**Account email in development.** Sign-up, verification and password-reset emails go to the
fake mail provider, which keeps them in memory and never sends or logs them (links contain
one-time tokens). A local inbox for trying the flows by hand is open (`docs/decisions.md`
O-19); until then, use the API tests (`apps/api/src/auth/auth.integration.test.ts`).
After `pnpm db:migrate`, `pnpm --filter @lead-fennec-ai/database exec prisma migrate status`
should report "Database schema is up to date!". Adding migrations and the fixture contents
are described in [README.md](../README.md#migrations).

## Data and resets

Data lives in the named Docker volumes `lead-fennec-ai_postgres-data` and
`lead-fennec-ai_redis-data`. It survives `docker compose stop`, `docker compose down` and restarts.

**Destructive, manual only.** `pnpm dev` never does this:

```bash
docker compose down --volumes   # DELETES all local PostgreSQL and Redis data
```
