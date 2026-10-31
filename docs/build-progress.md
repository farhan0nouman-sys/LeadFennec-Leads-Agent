# Build progress — Lead Fennec AI

Newest entry first. A check is listed as passed only if it ran and succeeded.

---

## GIT-01: Initialize the repository and make the initial commit (2026-11-01)

**Status: Done (local).** The user's request was "git commit". It has no task ID, so `GIT-01`
labels this housekeeping step. Nothing was pushed; there is no remote.

### Choices (answered by the user)

- **Author:** `LeadFennec-Leads-Agent` (global `user.name`, set by the user). The email is set
  for **this repository only** (`.git/config`); the global email stays unset.
- **Branch:** `main`, which matches the CI trigger. A brand-new repository has no other branch,
  so the root commit goes directly on `main`; later work goes on branches.

### Changed components

| Path | Change |
|---|---|
| `.git/` | `git init -b main`; repository-local `user.email` |
| `infra/postgres/initdb/10-create-test-database.sh` | Recorded as executable (mode `100755`) so Linux checkouts can run it |
| `CLAUDE.md` | Git note updated (was "not a git repository") |
| `docs/decisions.md` | O-04 resolved; D-02C-07 wording ("no GitHub remote yet") |
| `docs/build-progress.md` | This entry |

### Checks before committing

| Check | Actual result |
|---|---|
| Preview with a throwaway git directory outside the project (deleted afterwards) | 106 files would be committed |
| `git add -A` | 106 files staged, identical to the preview; no line-ending warnings |
| Excluded paths in the staged set | 0 each: `node_modules`, `dist`, `.next`, `.turbo`, `reference-repos`, `.env`, `test-results`, `*.tsbuildinfo`, `next-env.d.ts`, `.vitest` |
| Embedded repositories (gitlinks) | 0. The 9 reference clones are not included. |
| `git grep --cached` for credential patterns | None (only fake placeholders, test fixtures and the CI throwaway password) |
| Personal email inside committed files | 0 files (it appears only in commit metadata) |
| Code since the last full regression run (02C) | Unchanged; only these doc edits |

The commit hash is in `git log`; this entry is part of the commit, so it can't contain it.

### Not done

- No push and no remote (O-09). CI will run on the first push to GitHub.

### Next prompt

**03A.** This assumes the numbering continues; it can't be confirmed without the plan.

---

## 02C: Tests, CI, test isolation, fake providers, structured logging (2026-11-01)

**Status: Passed (local checks). Incomplete live checks:**
- CI has never run on GitHub (no repository yet).
- The real-database suites were skipped (no Docker or services here).

The reference plan is still missing (O-01). This task's spec is self-contained, except that
**migrations and DB fixtures don't exist** (no Prisma schema). README documents that gap rather
than inventing commands (O-08).

### Changed components

| Area | Files |
|---|---|
| Test setup | `vitest.shared.mjs` (new); `vitest.config.mjs` in shared, database, integrations, api and worker; `tsconfig.build.json` in those five (builds exclude tests); `nest-cli.json` builds from `tsconfig.build.json` |
| Network guard | `packages/shared/src/testing/network-guard.ts`, `setup.ts` and tests |
| Unit tests | `packages/shared/src/{env,redact,health,logger}.test.ts`; `packages/database/src/{test-database,probes}.test.ts`; `packages/integrations/src/{fakes,registry}.test.ts` |
| API integration tests | `apps/api/src/health/health.integration.test.ts`; `READINESS_CHECKS` token (`health.tokens.ts`) so tests substitute fakes |
| Worker tests | `apps/worker/src/health-server.test.ts` |
| Browser smoke test | `apps/web/playwright.config.ts`, `apps/web/e2e/smoke.spec.ts` |
| Test database | `packages/database/src/test-database.ts` (guards), `infrastructure.integration.test.ts`, `infra/postgres/initdb/10-create-test-database.sh`, a Compose mount, `.gitattributes` |
| Fake providers | `packages/integrations/src/{providers,fakes,registry}.ts`, provisional (O-07) |
| Logging | `packages/shared/src/logger.ts` (new `./logger` export); `LOG_LEVEL` in the env rules; API `nestjs-pino` (`app.module.ts`, `main.ts`); worker `pino-http` (`health-server.ts`, `main.ts`) |
| CI | `.github/workflows/ci.yml` (new) |
| Workspace | Catalog (+vitest, vite, @nestjs/testing, pino, pino-http, nestjs-pino, @playwright/test); root, package and app manifests; `turbo.json` (`test`, `test:e2e`, `LOG_LEVEL`); `pnpm-lock.yaml`; ignore files |
| Docs | `README.md` (new); `docs/decisions.md` (D-02C-01 to 08, O-07 to O-09, O-02 updated); `docs/local-development.md` (`LOG_LEVEL`, test-only variables); `CLAUDE.md` ("Testing and logging"); this entry |
| Machine | Playwright Chromium headless shell 156.0.8078.4, plus ffmpeg and winldd, in `%LOCALAPPDATA%\ms-playwright` (official Playwright CDN) |

### Passed local checks (final regression run)

| Command | Actual result |
|---|---|
| `pnpm install --frozen-lockfile` / `pnpm peers check` | Exit 0; lockfile up to date; no peer issues |
| `pnpm format:check` | Exit 0 (after `pnpm format` on the new files) |
| `pnpm lint` | Exit 0; 12/12 plus root `eslint.config.mjs`, `vitest.shared.mjs`, `scripts` |
| `pnpm typecheck` | Exit 0; 12/12, test files included |
| `pnpm test` | Exit 0; 7/7 tasks: shared **40**, integrations **12**, database **10 passed / 2 skipped**, api **6**, worker **4** (72 passed, 2 skipped) |
| `pnpm build --force` | Exit 0; 10/10, no cache |
| `pnpm test:e2e` | Exit 0; Playwright **1 passed** (Chromium against the `next start` build on 127.0.0.1:3100) |
| API integration tests, 3 consecutive runs | 6/6 each time |
| Built API and worker binaries (`node dist/main.js`) | Stdout all valid JSON (api 13 lines, worker 5); `X-Request-Id: smoke-…` echoed and present on the request's log lines; `authorization` `[REDACTED]`; **0** occurrences of the URL or header secrets |
| `pnpm dev --skip-services` (temporary `.env`, deleted afterwards) | API, worker and web up in about 15 s; liveness 200; readiness 503 (no services); 14 JSON API log lines; placeholder password 0 times in the log; 31 processes stopped; ports free |
| `ci.yml` against SchemaStore `github-workflow.json` (ajv) | VALID; all 3 actions SHA-pinned; service images digest-pinned; `permissions: contents: read` |
| `compose.yaml` against the Compose schema (after adding the init mount) | VALID, raw and interpolated |
| `sh -n` on the init script | OK; POSIX shell, LF line endings |
| Secret scan; `git status` in the 9 `reference-repos/*` | No credentials (only placeholders, test fixtures and the CI throwaway password); all 9 clean |

### Defects found and fixed during 02C (by the new tests)

1. **Network-guard leak:** `http.request` options carry `path: null`, which my first version
   treated as IPC, so the request went out. Fixed (only a non-empty string `path` is IPC);
   covered by `network-guard.test.ts`.
2. **Redaction gap:** pino-http child loggers use their own `err` serializer, so a credential in
   an error message reached the worker log. Fixed with line-level redaction
   (`hooks.streamWrite`) and a quote-safe regex; covered by child-logger and JSON-validity tests.
3. **Test isolation:** nestjs-pino keeps one pino-http instance per process, so later test apps
   logged into the first test's stream. Fixed with one logger per test file (D-02C-06).
4. **Missing dependency:** the root `vitest.shared.mjs` couldn't resolve `vitest/config`. Fixed
   by adding `vitest` and `vite` as root dev dependencies.

### Incomplete live checks (not passed)

- **GitHub Actions has never run** `ci.yml` (no remote repository; O-09).
- **Real PostgreSQL and Redis suites were skipped:** `infrastructure.integration.test.ts`
  (2 tests) needs `TEST_DATABASE_URL` / `TEST_REDIS_URL`; Docker isn't installed (O-06). They
  run in CI.
- **The Compose init script was never executed** (no Docker).
- **Graceful SIGINT/SIGTERM shutdown** is still not exercised on Windows.

### Live checks (external services)

None. Nothing was sent, charged or published. The only network use was package installs and
the Playwright browser download from the official CDN.

### Blockers

1. **No GitHub repository**, so CI can't run (O-09). `git init` and a push are the user's
   decisions (O-04).
2. **Docker isn't installed** (O-06), and native PostgreSQL occupies 5432 (O-05).
3. **No Prisma schema yet**, so no migrations or fixtures (O-08). It depends on the missing plan
   (O-01).
4. Open: telemetry (O-02), network binding (O-03), provisional provider interfaces (O-07).

### Manual check

- After installing Docker: run `pnpm dev`, then in another terminal run `pnpm test` with
  `TEST_DATABASE_URL` / `TEST_REDIS_URL` exported (see README). Expect database `12 passed`,
  0 skipped.
- After creating the GitHub repository and pushing: confirm the first CI run is green.

### Next prompt

**03A.** This assumes the numbering continues; it can't be confirmed without the plan.

---

## 02B: Local services, env validation, health endpoints, dev command (2026-10-31)

**Status: Passed (local checks). Live Docker check incomplete:** Docker isn't installed, so the
Compose services have never run here. See "Incomplete live checks".

The reference plan is still missing. Like 02A, this task's spec is self-contained (O-01).

### Changed components

| Area | Files |
|---|---|
| Local services | `compose.yaml` (new): PostgreSQL 18.6 and Redis 8.8.4, digest-pinned; ports on 127.0.0.1; named volumes; health checks; passwords required from `.env` |
| Environment | `.env.example` (new, fake placeholders). Schemas: `apps/api/src/env.ts`, `apps/worker/src/env.ts`, `apps/web/env.ts`. Shared rules and `parseEnv`: `packages/shared/src/env.ts` |
| Health | `packages/shared/src/health.ts` (aggregator), `redact.ts`, `startup.ts`. `packages/database/src/{postgres,redis,readiness}.ts` (probes). API: `src/health/*`, `src/env.module.ts`, updated `app.module.ts` and `main.ts`. Worker: `src/health-server.ts`, updated `main.ts` |
| Web startup check | `apps/web/instrumentation.ts`, `instrumentation-node.ts`, `next-runtime.d.ts` |
| Dev command | `scripts/dev.mjs` (new). Root `package.json`: `dev` now runs the launcher, and `lint` also checks root scripts |
| Workspace | `pnpm-workspace.yaml` catalog (+zod, pg, @types/pg, ioredis), app and package manifests, `pnpm-lock.yaml`. `turbo.json`: `concurrency: "20"` (fixes a 02A regression) and `dev.passThroughEnv` |
| Docs | `docs/local-development.md` (new), `docs/decisions.md` (D-02B-01 to 08, O-05, O-06), `CLAUDE.md` (two bullets), this entry |

### Passed local checks

| Command / check | Actual result |
|---|---|
| `pnpm install` / `install --frozen-lockfile` / `peers check` | Exit 0; +21 packages; lockfile up to date; no peer issues |
| `pnpm format:check` | Exit 0. The first run flagged 14 new files; fixed with `pnpm format` (Prettier only). |
| `pnpm lint` | Exit 0; 12/12, plus `eslint eslint.config.mjs scripts`. The first run caught a dead `PING` reply check in `redis.ts`; fixed. |
| `pnpm typecheck` / `pnpm build` | Exit 0; 12/12 and 10/10 |
| API and worker with a missing or invalid env (fake secret in `REDIS_URL`) | Exit 1. Lists `DATABASE_URL: is required`, `REDIS_URL: must be a redis:// or rediss:// URL`, and the non-numeric port. **0** secret occurrences, **0** stack-trace lines. |
| `next start` without / with an invalid `API_BASE_URL` | Exit 1, `[web] … API_BASE_URL: is required`. Invalid case: 0 secret occurrences. Before the fix, Next.js logged the error and **kept serving** (exit 124 at the 40 s timeout); fixed with an explicit exit (D-02B-07). |
| `next start` with a valid `API_BASE_URL` | HTTP 200 |
| `next build` warnings | The first build warned "process.exit … not supported in the Edge Runtime". Fixed with dot-access `NEXT_RUNTIME` and a Node-only module; the clean rebuild has no warnings. |
| `pnpm dev` without `.env` | Exit 1, `[dev] Missing .env … cp .env.example .env` |
| `pnpm dev` with `.env` (temporary placeholder copy, deleted afterwards) | Exit 1, `[dev] Docker was not found on PATH … or … pnpm dev --skip-services` |
| `pnpm dev --skip-services` (first try) | **Failed:** turbo reported "10 persistent tasks but concurrency of 10". 02A regression, fixed (D-02B-08). |
| `pnpm dev --skip-services` (after the fix) | All 7 package watchers and the Nest watcher report "Found 0 errors". Nest started, the worker started, and Next reported "Ready". |
| API `GET /health/live`, `/health/ready` (no services) | 200 `{"status":"ok"}`; 503, both dependencies `down` / `unavailable`; `Cache-Control: no-store` |
| Worker `/health/live`, `/health/ready`, `/nope`, `POST /health/live` | 200; 503 (same shape); 404; 405 |
| Web `GET /` via `next dev` | 200 |
| Dev log check | Readiness failures logged server-side; placeholder password occurrences: **0** |
| Readiness against non-routable 10.255.255.1, timeout 500 ms | 503: `postgres` and `redis` both `down` / `timeout` (516 and 511 ms); the request took 643 ms (parallel checks) |
| API and worker with the port already taken | Exit 1, `[api] Port already in use … change the port in .env` (same for worker); 0 secret occurrences |
| `redactSecrets` / `describeError` on 5 sample strings | Credentials masked in postgres, redis, rediss and error-message URLs; plain URLs and emails unchanged; 0 secret occurrences |
| `compose.yaml` against the official Compose Specification JSON schema (ajv 8.20, draft 2020-12) | **VALID** raw and after `.env.example` interpolation. Ports `127.0.0.1:5432` / `127.0.0.1:6379`; volume paths correct; both images digest-pinned; missing passwords fail with the intended messages. |
| Process cleanup after each run | All test processes stopped (dev tree: 31 processes); ports 3000–3002 free; no leftover processes |
| Secret scan of project files | No credentials; only fake placeholders and the redaction example comment |
| `git status` in the 9 `reference-repos/*` | All clean |

### Incomplete live checks (not passed)

- **Docker Compose was never run.** Docker isn't installed (O-06). Not verified:
  - `docker compose up --wait` and container health checks
  - volume persistence across restarts
  - `/health/ready` returning **200** with real PostgreSQL and Redis
- **SIGINT/SIGTERM graceful shutdown** was not exercised. Windows force-terminates instead of
  delivering signals.
- **Readiness "up" path:** no reachable PostgreSQL/Redis with valid credentials existed, so a
  `status: up` result was never observed.

### Live checks (external services)

None. Nothing was sent, charged or published.

**Observation:** a native PostgreSQL 18 Windows service (`postgresql-x64-18`) listens on
127.0.0.1:5432. The readiness probe reached it once with the fake placeholder credentials and was
rejected (`28P01`). Nothing else touched it (O-05).

### Blockers

1. **Docker Desktop isn't installed** (O-06). This blocks the live Compose verification above.
2. **Port 5432 is taken by the native PostgreSQL** (O-05). Choose `POSTGRES_PORT=5433` or
   `--skip-services` with the native server.
3. Carried over: the reference plan is missing (O-01); telemetry (O-02), network binding (O-03)
   and `git init` (O-04) are open.

### Manual check (after installing Docker Desktop)

```bash
cp .env.example .env    # set passwords; with the native PostgreSQL on 5432, also set POSTGRES_PORT=5433 and the DATABASE_URL port
pnpm dev
curl -i http://localhost:3001/health/ready   # expect 200, postgres and redis "up"
curl -i http://localhost:3002/health/ready   # expect 200
```

### Next prompt

**02C.** This assumes the A/B/C numbering continues; it can't be confirmed without the plan.

---

## 02A: Monorepo initialization (2026-10-31)

**Status: Passed (local checks).** Live checks don't apply: no external services.

The reference plan is still missing. 02A could proceed because its spec is fully defined by the
task prompt and `CLAUDE.md`. Recorded as open choice O-01 in `docs/decisions.md`: if the plan
specifies something different, it needs reconciling.

### Changed components

| Area | Files |
|---|---|
| Workspace root | `package.json` (`lead-fennec-ai`, `packageManager: pnpm@12.16.1`, engines `^24.15.0`), `pnpm-workspace.yaml` (workspaces, version catalog, `saveExact`, `allowBuilds`, `peerDependencyRules`), `turbo.json`, `pnpm-lock.yaml` |
| Shared tooling | `tsconfig.base.json`, `eslint.config.mjs`, `.prettierrc.json`, `.prettierignore`, `.editorconfig`, `.gitignore` |
| `apps/web` | Next.js 16 App Router: `app/layout.tsx`, `app/page.tsx`, `tsconfig.json`, `eslint.config.mjs` (adds Next rules), `package.json` |
| `apps/api` | NestJS 12 ESM: `src/main.ts` (listens on `API_PORT`, default 3001), `src/app.module.ts` (empty module), `nest-cli.json`, `tsconfig.json`, `package.json` |
| `apps/worker` | `src/main.ts`: starts, logs that no processors are registered, stays alive until signalled. `tsconfig.json`, `package.json` |
| `packages/*` | `database`, `shared`, `ai-agents`, `integrations`, `email-engine`, `compliance`, `ui`: compiled packages with an empty `src/index.ts`, `tsconfig.json` and `package.json` |
| Docs | `docs/decisions.md` (new: D-02A-01 to D-02A-09 and open choices O-01 to O-04), this entry |
| Machine | pnpm 12.16.1 installed globally for the user (`npm install -g`, under `%APPDATA%\npm`) |

No features were implemented. Tailwind/shadcn, Prisma, BullMQ/Redis, a test runner and env
validation are deferred (D-02A-09). `CLAUDE.md` and `reference-repos/` are unchanged.

### Passed local checks

| Command | Actual result |
|---|---|
| `pnpm install` (first run) | **Exit 1**, `ERR_PNPM_IGNORED_BUILDS` for `esbuild@0.28.2` and `unrs-resolver@1.12.2`. Expected under pnpm's default `strictDepBuilds`. Reviewed both scripts; both set to `false` (D-02A-08). |
| `pnpm install` (after review) | Exit 0. 11 workspace projects; lockfile passes supply-chain policies; `pnpm-lock.yaml` written (v9). |
| `pnpm peers check` | First: 3 unmet ESLint 10 peers (`eslint-plugin-import`, `jsx-a11y`, `react`), as Next.js documents. After the scoped `peerDependencyRules`: "No peer dependency issues found". |
| `pnpm build` (`turbo run build`) | Exit 0. **10 successful, 10 total.** Next.js 16.4.3 (Turbopack) compiled, ran TypeScript, and prerendered `/` and `/_not-found`. |
| `apps/web/tsconfig.json` after `next build` | Unchanged; Next.js did not rewrite it. |
| `pnpm typecheck` | Exit 0. **10 successful, 10 total** under the strict options. |
| `pnpm lint` | Exit 0. **10 successful, 10 total.** |
| `eslint --print-config` (web `page.tsx`, api `app.module.ts`) | Web: typescript-eslint parser 8.72.1 with `projectService`; Next, React Hooks and typed rules active. Api: `no-extraneous-class` with `allowWithDecorator`. |
| Lint probe files (deleted afterwards) | `packages/shared`: 5 errors, including `no-floating-promises` and `no-unsafe-assignment`. `apps/web`: `@next/next/no-img-element` warning. The rules are enforced, not just loaded. |
| `pnpm format:check` | Exit 0. "All matched files use Prettier code style!" |
| `node dist/main.js` (api) + `GET 127.0.0.1:3001/` | Nest logged "Nest application successfully started". HTTP 404 JSON, as expected with no routes defined yet. |
| `next start --port 3000` + `GET 127.0.0.1:3000/` | HTTP 200; `<h1>Lead Fennec AI</h1>` and `<title>Lead Fennec AI</title>`. |
| `node dist/main.js` (worker) | Logged `[worker] started; no job processors registered`; still running when checked about 30 s later. |
| Smoke-test cleanup | The 3 Windows Node processes were stopped with `taskkill`. Ports 3000 and 3001 were released; no leftover processes. |
| `tsx -e …` (esbuild script disabled) | Printed `tsx/esbuild transform ok: 42`, exit 0. |
| Self-import of each `@lead-fennec-ai/<pkg>` by name | All 7 resolve through their `exports` maps (empty exports, as intended). |
| `git status --porcelain` in the 9 `reference-repos/*` | 0 changed files in each. |

### Not verified (not passed)

- `pnpm dev` was not run: Next dev, `nest start --watch`, `tsx watch` and the package `tsc --watch`
  watchers.
- The worker's SIGINT/SIGTERM handler was not exercised. It was stopped with a forced
  `taskkill`, which Windows doesn't deliver as a signal.
- No app imports a workspace package yet, so cross-package consumption from Next.js and Nest is
  untested beyond the self-import resolution check.

### Live checks (external services)

None. Nothing was sent, charged or published.

### Blockers

1. **The reference plan is still missing.** It blocks SETUP-01 extraction and 01A–01C (O-01).
2. **PostgreSQL, Redis and Docker aren't installed.** They're needed before the deferred Prisma and
   BullMQ work (D-02A-09).
3. **Open choices** need the user's decision: telemetry (O-02), dev network binding (O-03),
   `git init` (O-04).

### Next prompt

**02B.** This assumes the A/B/C numbering continues; it can't be confirmed without the plan. The
blocked 01A–01C should be completed once the plan is supplied.

---

## 01C: Workflow, security, integration, acceptance and roadmap docs (2026-10-31)

**Status: Blocked, not started.** The source plan is missing, so none of the five documents were
written.

Every 01C deliverable comes from the plan:
- **Prompt tracker (01A to 27C):** only 01A, 01B and 01C are known.
- **Milestone gates M1 to M9:** defined in the plan.
- **Acceptance cases:** these map to 01A's requirement IDs, and 01A is blocked.

### Instructions given in 01C that don't depend on the plan

Kept here so they aren't lost. They'll be written into the 01C documents once the task is
unblocked.

- **Development:** mock providers, real sending disabled. `CLAUDE.md` already requires this.
- **Staging:** only designated test recipients. This is new and not yet in `CLAUDE.md` or any doc.
- 01C asks to *create* `docs/build-progress.md`, but the file already exists. When unblocked, it
  will be restructured into the 01A–27C tracker **without discarding these existing entries**.

### Changed components

| Path | Change |
|---|---|
| `docs/build-progress.md` | Added this entry. |
| `docs/workflow-specifications.md`, `docs/security-requirements.md`, `docs/integration-requirements.md`, `docs/acceptance-criteria.md`, `docs/implementation-roadmap.md` | **Not created** (blocked). |

### Passed local checks

| Command | Actual result |
|---|---|
| `ls -la . docs` (project root) | Unchanged: `CLAUDE.md`, `docs/build-progress.md`, `reference-repos/`. |
| `find` for files newer than `docs/build-progress.md` (excluding `reference-repos/`) | None. Nothing was added since 01B. |
| `find` for `*.docx`, `reference-plan*`, `*.ts`, `package.json`, `*.prisma` (project), and `reference-plan*` (`D:\CLAUDE Projects`, depth 6) | No matches. No plan, no code. |

### Live checks (external services)

None run.

### Blockers

1. **The reference plan is still missing.** It blocks SETUP-01's extraction step and 01A to 01C.
2. 01C also depends on 01A's requirement IDs.
3. Carried over: no local PostgreSQL, Redis or Docker; not a git repository.

### Next prompt

Supply the plan (or explicitly authorize working without it), then run SETUP-01's extraction,
then **01A**, **01B** and **01C** in order.

---

## 01B: Architecture, database, API and agent specifications (2026-10-31)

**Status: Blocked, not started.** The source plan is missing, so no design documents were written.

01B requires mapping the plan's API routes to authenticated roles. Its database and API designs
also build on 01A's requirement IDs, and 01A is blocked for the same reason. Some 01B topics are
fully defined by the prompt and `CLAUDE.md` (tenant boundaries, outbox and inbound-event ledger,
draft versions, outbound intents, usage reservations, worker leases, provider reconciliation). But
writing the four documents without the plan would mean inventing its routes and entities.

### Changed components

| Path | Change |
|---|---|
| `docs/build-progress.md` | Added this entry. |
| `docs/system-architecture.md`, `docs/database-design.md`, `docs/api-specification.md`, `docs/agent-specifications.md` | **Not created** (blocked). |

### Passed local checks

| Command | Actual result |
|---|---|
| `ls -la . docs` (project root) | Unchanged since 01A: `CLAUDE.md`, `docs/build-progress.md`, `reference-repos/`. |
| `find` for files newer than `CLAUDE.md` (excluding `reference-repos/`) | Only `docs/build-progress.md` (the 01A log entry). |
| `find` for `*.docx`, `reference-plan*`, `*.ts`, `package.json`, `*.prisma` in the project (excluding `reference-repos/`) | No matches. No plan, and no code or interfaces to reuse. |
| `find` (filename only, depth 6) for `reference-plan*` across `D:\CLAUDE Projects` | No matches. |

### Live checks (external services)

None run.

### Blockers

1. **The reference plan is still missing.** This blocks SETUP-01's extraction step, 01A and 01B,
   and probably every later task.
2. 01B also depends on 01A's requirement IDs.
3. Carried over: no local PostgreSQL, Redis or Docker; not a git repository.

### Next prompt

Supply the plan, finish SETUP-01's extraction, then re-run **01A** and then **01B**.

---

## 01A: Product requirements and user stories (2026-10-31)

**Status: Blocked, not started.** The source plan is missing, so no requirement documents were
written.

01A requires preserving all 27 source steps from `docs/reference-plan.md` and assigning stable
requirement IDs. Neither is possible without the plan. Drafting requirements from the task text
alone would mean guessing the plan's contents, and requirement IDs assigned now would probably need
renumbering once the plan is read.

### Changed components

| Path | Change |
|---|---|
| `docs/build-progress.md` | Added this entry. |
| `docs/product-requirements.md` | **Not created** (blocked). |
| `docs/user-stories.md` | **Not created** (blocked). |
| `docs/decisions.md` | **Not created.** There are no scope choices to record until the plan is read. |

### Passed local checks

| Command | Actual result |
|---|---|
| `ls -la . docs` (project root) | Only `CLAUDE.md`, `docs/build-progress.md` and `reference-repos/`. No `docs/reference-plan.md` or `.docx`. |
| `find` for `*.docx` and `reference-plan*` in the project (excluding `reference-repos/`) | No matches. |
| `find` (filename only, depth 6) for `reference-plan*` and similar names across `D:\CLAUDE Projects` | No matches. |
| Timestamps and sizes of `CLAUDE.md` and `docs/build-progress.md` | Unchanged since SETUP-01. |
| Look for existing code to reuse | None. The project has no application code yet. |

### Live checks (external services)

None run.

### Blockers

1. **`docs/reference-plan.docx` (or the plan's text) is still missing.** This blocks SETUP-01's
   extraction step and all of 01A.
2. Carried over from SETUP-01: no local PostgreSQL, Redis or Docker; not a git repository.

### Next prompt

First, finish SETUP-01's extraction once the plan is supplied, then re-run **01A**.

---

## SETUP-01: Project rules and reference-plan import (2026-10-31)

**Task ID note:** `SETUP-01` is a provisional label. Real task and prompt IDs are expected to
come from `docs/reference-plan.docx`, which is missing; rename this entry once that numbering
is known.

**Status:** Partly done. `CLAUDE.md` is complete. Importing the reference plan is **blocked**:
the source file is missing.

### Changed components

| Path | Change |
|---|---|
| `CLAUDE.md` | **New.** No `CLAUDE.md` existed at the project root, so nothing was merged or discarded. It records the stack, provider interfaces, docs-first rule, validation, tenancy, secrets, untrusted-data, bounded-AI, working and progress-log rules. It also adds a note that `reference-repos/` is read-only and lists the license status of each repo. |
| `docs/build-progress.md` | **New.** This file. |
| `docs/reference-plan.md` | **Not created.** The source DOCX is missing; no content was guessed. |

No application code was written. Nothing under `reference-repos/` was modified.

### Passed local checks

| Command | Actual result |
|---|---|
| `ls -la` (project root) | Only `reference-repos/` existed before this task. No `docs/`, no `CLAUDE.md`. |
| `find . -iname '*.docx' -o -iname '*reference-plan*'` (project root, including `reference-repos/`) | No matches. |
| `git rev-parse --is-inside-work-tree` (project root) | `fatal: not a git repository`. |
| 37 `grep -qiE` checks, one per required rule, against `CLAUDE.md` | **37 passed, 0 failed.** |
| `git status --porcelain \| wc -l` in each of the 9 `reference-repos/*` clones | **0 changed files in all 9.** |
| Tool versions | node v24.19.0 · npm 11.17.0 · git 2.55.0 · uv 0.13.1 · PowerShell 5.1 with `System.IO.Compression` available. |
| Missing tools | pnpm, yarn, docker, psql/postgres, redis-server/redis-cli: not found. Python: Microsoft Store stub only. |

### Failed or blocked checks

| Check | Result |
|---|---|
| Read `docs/reference-plan.docx` | **Blocked: file missing.** A filename-only search of the sibling folder `D:\CLAUDE Projects\LeadFennec` also found no `reference-plan*` file. It holds four unrelated `.docx` files, which were not opened and not used as substitutes. |

### Live checks (external services)

None run. No provider was contacted and nothing was sent, charged or published.

### Blockers

1. **`docs/reference-plan.docx` is missing.** The user needs to supply the file (place it at
   `docs/reference-plan.docx`).
2. **No local PostgreSQL, Redis or Docker.** This doesn't block this task, but it will block the
   database and job-queue prompts until one of these is in place: Docker Desktop, native
   Postgres/Redis installs, or hosted dev instances (a hosted service would need explicit
   approval).
3. **Not a git repository.** This doesn't block anything, but there's no version history to
   protect work. `git init` is left to the user.

### Planned DOCX extraction method (for when the file arrives)

1. Open the `.docx` read-only as a ZIP with PowerShell `System.IO.Compression`.
2. Parse only `word/document.xml` as XML, walking `w:body` children in document order.
3. Convert each `w:p` to a paragraph. Map `w:pStyle` Title/Heading1–9 to Markdown headings and
   keep list paragraphs as list items.
4. Convert each `w:tbl` to a Markdown table, keeping its position in the document.
5. Don't run macros, fields or embedded objects, and treat all text as data.
6. Verify by comparing the paragraph, heading and table counts in the XML against the Markdown
   output.

### Next prompt

Once `docs/reference-plan.docx` is in place, re-run the extraction step of this task
(`SETUP-01`). The next real prompt ID can't be known until the plan has been read.
