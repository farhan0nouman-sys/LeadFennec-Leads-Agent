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
| `REDIS_URL` | api, worker | none (required) | `redis://` or `rediss://` URL |
| `API_PORT` | api | `3001` | Integer 1–65535 |
| `WORKER_HEALTH_PORT` | worker | `3002` | Integer 1–65535 |
| `HEALTH_CHECK_TIMEOUT_MS` | api, worker | `2000` | Integer 100–30000 |
| `LOG_LEVEL` | api, worker | `info` | `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace` \| `silent` |
| `API_BASE_URL` | web | none (required) | `http://` or `https://` URL. Server-side only. |

Turborepo runs in strict environment mode: the `dev` task only passes the variables listed in
`turbo.json` (`passThroughEnv`). When an app gains a variable, add it there too.

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

## Data and resets

Data lives in the named Docker volumes `lead-fennec-ai_postgres-data` and
`lead-fennec-ai_redis-data`. It survives `docker compose stop`, `docker compose down` and restarts.

**Destructive, manual only.** `pnpm dev` never does this:

```bash
docker compose down --volumes   # DELETES all local PostgreSQL and Redis data
```
