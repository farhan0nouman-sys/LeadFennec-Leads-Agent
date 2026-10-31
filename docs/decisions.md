# Decisions — Lead Fennec AI

Technical decisions, the sources checked, and choices still open. IDs are stable: `D-<task>-NN`
for decisions, `O-NN` for open choices. Pinned versions live in one place:
`pnpm-workspace.yaml` → `catalog:`.

---

## 02A: Monorepo initialization (2026-10-31)

### D-02A-01: Monorepo at the project root

- Root `package.json` is named `lead-fennec-ai`. Apps live in `apps/*` and packages in
  `packages/*`, next to the existing `CLAUDE.md` and `docs/`.
- Workspace packages are scoped `@lead-fennec-ai/<name>`.
- **Why:** The task says to initialize in the working directory and preserve existing files. A
  subfolder would split the docs from the code.
- `reference-repos/` sits outside the workspace globs. It is excluded from ESLint, Prettier and
  (for a future `git init`) git.

### D-02A-02: Pinned versions

**Source:** npm registry `dist-tags.latest`, engines and peer dependencies, checked 2026-10-31.
Every pin is at least 24 hours old, per pnpm's default `minimumReleaseAge` of 1440 minutes.

| Package | Pinned | Latest on 2026-10-31 | Notes |
|---|---|---|---|
| pnpm (`packageManager`) | 12.16.1 | 12.16.1 | Node ≥18 |
| turbo | 2.11.10 | 2.11.10 | |
| typescript | **6.0.3** | 7.0.2 | See D-02A-03 |
| next / eslint-config-next | 16.4.3 | 16.4.3 | Node ≥20.9; TS ≥5.1 |
| react / react-dom | 19.3.1 | 19.3.1 | |
| @types/react / @types/react-dom | 19.3.0 | 19.3.0 | |
| @nestjs/common / core / platform-express | 12.3.2 | 12.3.2 | ESM-only; Node ≥20 |
| @nestjs/cli | 12.0.11 | 12.0.11 | Depends on `typescript ~6.0.2`; Node ≥20.11 |
| reflect-metadata | 0.2.2 | 0.2.2 | Nest peer `^0.1.12 \|\| ^0.2.0` |
| rxjs | 7.8.2 | 7.8.2 | Nest peer `^7.1.0` |
| tslib | **2.8.1** | 2.9.1 | 2.9.1 was under 24 h old; 2.8.1 is also what `@nestjs/core` pins |
| @types/node | **24.19.2** | 26.6.6 | Matches the Node 24 runtime, not the newest types (D-02A-06) |
| eslint | 10.14.0 | 10.14.0 | Node `^20.19 \|\| ^22.13 \|\| >=24` |
| @eslint/js | 10.0.1 | 10.0.1 | |
| typescript-eslint | 8.72.1 | 8.72.1 | Peer `typescript >=4.8.4 <6.1.0` |
| eslint-config-prettier | 10.1.8 | 10.1.8 | |
| globals | 17.13.0 | 17.13.0 | |
| prettier | 3.9.10 | 3.9.10 | |
| tsx | 4.23.15 | 4.23.15 | Worker dev runner only |

The lockfile is `pnpm-lock.yaml` (lockfile v9, written by pnpm 12.16.1).

### D-02A-03: TypeScript 6.0.3, not 7.0.2

TypeScript 7.0.2 (the native Go port) is `latest`, but two required tools exclude it:
- `typescript-eslint` 8.72.1 declares the peer `typescript >=4.8.4 <6.1.0`.
- `@nestjs/cli` 12.0.11 depends on `typescript ~6.0.2`.

The official NestJS starter also uses TypeScript 6.0.2. Revisit once both tools support TS 7.

TypeScript 6.0 default changes accounted for in `tsconfig.base.json`:
- `types` now defaults to `[]`, so `"types": ["node"]` is set explicitly.
- `rootDir` now defaults to `.`, so each package sets `rootDir: "src"`.
- `strict` now defaults to `true`; it is still set explicitly.

### D-02A-04: ESM everywhere

- NestJS 12 ships `"type": "module"` and the official starter is ESM.
- All workspace packages are therefore `"type": "module"` and use `module` / `moduleResolution`
  `nodenext` (Next.js uses `bundler`).
- Relative imports in Node packages use `.js` extensions, as in the NestJS docs.

### D-02A-05: Shared packages are compiled

- Turborepo's internal-packages guide says just-in-time (TypeScript source) packages only work
  for consumers that bundle or natively compile TypeScript. NestJS (built with `tsc`) and the
  worker (`node dist/…`) don't.
- So every `packages/*` builds with `tsc` to `dist/`, exporting `types: dist/index.d.ts` and
  `default: dist/index.js`.
- `turbo.json` makes `build`, `typecheck`, `lint` and `dev` depend on `^build`.

### D-02A-06: Node 24 LTS

- `engines.node` is `^24.15.0`. The NestJS 12 CLI generators need 24.15+ on the 24 line.
- The local runtime is Node 24.19.0.
- `@types/node` follows the runtime major version (24.x).

### D-02A-07: Strict TypeScript, ESLint 10 and Prettier

**TypeScript (`tsconfig.base.json`):** `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `noImplicitOverride`, `noImplicitReturns`,
`noFallthroughCasesInSwitch`, `noPropertyAccessFromIndexSignature`, `isolatedModules`.
- API only: `experimentalDecorators`, `emitDecoratorMetadata`, `importHelpers`, as in the NestJS
  starter.
- The starter disables `strictPropertyInitialization`; this repo keeps it enabled.

**ESLint (`eslint.config.mjs`):**
- `@eslint/js` recommended plus typescript-eslint `strictTypeChecked` and `stylisticTypeChecked`,
  with `projectService` typed linting.
- `disableTypeChecked` applies to JS config files.
- `eslint-config-prettier` is last, so formatting is Prettier's job.
- `apps/web/eslint.config.mjs` adds `eslint-config-next/core-web-vitals` ahead of the shared
  config. ESLint 10 uses the nearest config file to each linted file, with no merging. Next's
  rules go first so the shared typed parser setup wins.
- Exception: `@typescript-eslint/no-extraneous-class` uses `allowWithDecorator` for `apps/api`,
  because Nest modules are empty decorated classes.
- NestJS's own starter now uses oxlint. This repo keeps one linter (ESLint) for consistency
  across all packages.

**Prettier:** defaults plus `singleQuote`. Hand-written docs, `CLAUDE.md`, the lockfile and
`reference-repos/` are excluded.

### D-02A-08: pnpm supply-chain settings

**Kept at pnpm defaults:**
- `minimumReleaseAge` of 1440 minutes.
- `strictDepBuilds: true`: install fails on unreviewed dependency build scripts.

**`allowBuilds`:** `esbuild: false` and `unrs-resolver: false`.
- Both postinstall scripts are fallbacks that check for, or download, a native binary.
- pnpm already installed the Windows binaries (`@esbuild/win32-x64`,
  `@unrs/resolver-binding-win32-x64-msvc`) as optional dependencies.
- Verified: `tsx` transforms TypeScript, and ESLint (which uses `unrs-resolver`) runs.

**`peerDependencyRules.allowedVersions`:** ESLint 10 is allowed for `eslint-plugin-import`,
`eslint-plugin-jsx-a11y` and `eslint-plugin-react` only.
- Next.js documents that these bundled plugins don't list ESLint 10 as a peer yet, while
  `eslint-config-next` 16.4 supports ESLint 10.
- `pnpm peers check` reports no issues.

**`saveExact: true`**, so packages added later are pinned too.

### D-02A-09: Deferred, not configured in 02A

02A adds only startup entry points. The following are part of the agreed stack (`CLAUDE.md`) but
are not configured yet. Each needs its own prompt before features depend on it:

| Item | Where | Why deferred |
|---|---|---|
| Tailwind CSS and shadcn/ui | `apps/web`, `packages/ui` | Not needed for the app to start. The shadcn monorepo layout must be chosen when UI work starts. |
| Prisma and PostgreSQL | `packages/database` | Needs the data model (01B, blocked). PostgreSQL isn't installed locally. |
| BullMQ and Redis | `apps/worker` | No queues defined yet. Redis isn't installed locally. The worker currently only stays alive. |
| Test runner | all | Not requested in 02A. |
| Runtime env validation | `apps/api`, `apps/worker` | Only `API_PORT` (default 3001) is read so far. |

### Sources (checked 2026-10-31)

- Next.js installation (updated 2026-10-02): https://nextjs.org/docs/app/getting-started/installation
- Next.js ESLint plugin (updated 2026-10-15): https://nextjs.org/docs/app/api-reference/config/eslint
- NestJS first steps: https://docs.nestjs.com/first-steps
- NestJS starter `tsconfig.json` / `package.json`: https://github.com/nestjs/typescript-starter
- Turborepo internal packages: https://turborepo.dev/docs/core-concepts/internal-packages
- Turborepo configuration: https://turborepo.dev/docs/reference/configuration
- pnpm build settings: https://pnpm.io/settings/build
- pnpm dependency-resolution settings: https://pnpm.io/settings/dependency-resolution
- TypeScript 6.0 announcement: https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/
- typescript-eslint typed linting: https://typescript-eslint.io/getting-started/typed-linting
- ESLint configuration files (v10.14.0): https://eslint.org/docs/latest/use/configure/configuration-files
- npm registry (`npm view`) for versions, publish dates, engines and peer dependencies.

---

## 02B: Local services, environment validation and health (2026-10-31)

### D-02B-01: Pinned versions added

Every new pin is at least 24 hours old (pnpm `minimumReleaseAge`).

| Package | Pinned | Published | Why |
|---|---|---|---|
| zod | 4.6.7 | 2026-10-12 | Runtime validation (D-02B-02) |
| pg | 8.23.1 | 2026-09-30 | PostgreSQL readiness probe. Ships an ESM entry. |
| @types/pg | 8.23.1 | 2026-08-17 | Types for `pg` |
| ioredis | 6.0.0 | 2026-07-31 | Redis readiness probe. BullMQ's default client. |

**BullMQ compatibility (checked, not installed):** BullMQ 6.5.3 declares `ioredis >=5` as an
optional peer, and its docs name ioredis as the default client. When queues land, workers need
`maxRetriesPerRequest: null` (BullMQ docs).

### D-02B-02: zod for runtime validation

- zod validates every app's environment now, and is the intended library for API inputs and AI
  outputs (`CLAUDE.md`), so the codebase has one validation library.
- Shared field rules live in `packages/shared/src/env.ts`, exported from
  `@lead-fennec-ai/shared`: `appEnvSchema`, `portSchema`, URL schemas,
  `healthCheckTimeoutSchema`. Each app owns its schema: `apps/api/src/env.ts`,
  `apps/worker/src/env.ts`, `apps/web/env.ts`.
- Error messages name the variable and the broken rule (for example "is required" or "must be a
  postgres:// URL") and **never echo values**. Verified with a fake secret value.

### D-02B-03: Docker images

Sources: Docker Hub tag API, the docker-library docs, and the PostgreSQL versioning policy, all
checked 2026-10-31.

| Service | Image | Notes |
|---|---|---|
| PostgreSQL | `postgres:18.6-trixie@sha256:979bccfde35445db618c65107d27d08c6c21339d8dc3ad4c830c6633947be0e4` | Newest supported major (18; EOL 2030-11-14). Debian rather than Alpine to avoid musl locale differences. |
| Redis | `redis:8.8.4-alpine@sha256:ab669f1420eaa05360a417b24f3bd210c9272e2c79a4bb35d3e50b4bfd50dbee` | Newest release on 2026-10-31. |

- **Digest pins:** patch updates are deliberate. Bump the tag and digest together.
- **PostgreSQL 18 data path:** the image keeps data in `/var/lib/postgresql/18/docker`, so the
  volume mounts at `/var/lib/postgresql` (image docs).
- **Redis 8 licensing:** Redis 8 is released under AGPLv3 / RSALv2 / SSPLv1. That's fine for local
  development. Check the terms before shipping Redis in dedicated customer deployments; the
  alternatives are a managed Redis or a Redis-compatible server.

### D-02B-04: Compose security defaults

- Host ports bind to `127.0.0.1` only.
- Both passwords are required via `${VAR:?message}`, and nothing secret is in `compose.yaml`.
- Redis runs with `--requirepass` and `--appendonly yes` for persistence.
- Data lives in named volumes. No startup path removes volumes or resets data. The only reset
  (`docker compose down --volumes`) is documented as manual and destructive.
- The Redis password is visible in the container's command line (`docker inspect`). That's
  acceptable for local development only.

### D-02B-05: One launcher loads `.env`; apps read only `process.env`

- `pnpm dev` (`scripts/dev.mjs`) reads the root `.env` with Node's `util.parseEnv`. Shell
  variables win, matching Next.js precedence.
- It passes the merged environment to Docker Compose and `turbo run dev`.
- Apps never read `.env` files themselves, so production configuration comes from the platform.
- Turborepo strict env mode passes only the variables listed in `turbo.json` →
  `tasks.dev.passThroughEnv`.
- `--skip-services` runs the apps without Docker, for your own PostgreSQL and Redis.

### D-02B-06: Health design

- **Liveness** (`/health/live`) never touches dependencies.
- **Readiness** (`/health/ready`) runs PostgreSQL `SELECT 1` and Redis `PING` in parallel. Each
  check gets `HEALTH_CHECK_TIMEOUT_MS`, plus a 250 ms guard for a check that ignores its timeout.
- A failure that took at least the timeout is reported as `timeout`; otherwise `unavailable`.
- Responses carry `Cache-Control: no-store` and contain only `status`, `durationMs` and `reason`.
  Error details are logged server-side through `redactSecrets`, which masks URL credentials.
- **Connections:** probes open short-lived connections per request. Revisit once Prisma and BullMQ
  hold long-lived pools; readiness should then check those pools.
- **Code locations:**
  - Probes (`checkPostgres`, `checkRedis`, `infrastructureReadinessChecks`) live in
    `@lead-fennec-ai/database`. It owns connections to stateful stores and is server-only.
  - The aggregator lives in `@lead-fennec-ai/shared`, which is pure code and safe for web.
- **Worker:** exposes the same endpoints from a `node:http` server on `WORKER_HEALTH_PORT` (3002).

### D-02B-07: Web environment is validated in the instrumentation hook

- `apps/web/instrumentation.ts` calls `instrumentation-node.ts` when
  `process.env.NEXT_RUNTIME === 'nodejs'`.
- **Explicit exit:** Next.js 16 only *logs* an error thrown from `register()` and keeps serving
  (observed), so validation exits with code 1 explicitly.
- **Dot access:** Next.js only replaces the dot form of `process.env.NEXT_RUNTIME` at build time.
  The bracket form left Node-only code in the Edge bundle and produced a warning.
  `apps/web/next-runtime.d.ts` declares the variable for strict TypeScript.
- **Build vs start:** `register()` doesn't run during `next build`. Builds don't need `.env`;
  `next start` and `next dev` do.

### D-02B-08: Regression fixed in 02A's dev setup

- `turbo run dev` refused to start: 10 persistent tasks (7 package watchers and 3 apps) against
  the default concurrency of 10. 02A had listed `pnpm dev` as not verified.
- `turbo.json` now sets `"concurrency": "20"`.

### Sources (checked 2026-10-31)

- Docker Hub tag API: `hub.docker.com/v2/repositories/library/{postgres,redis}/tags`
- postgres image docs: https://github.com/docker-library/docs/blob/master/postgres/content.md
- redis image docs: https://github.com/docker-library/docs/blob/master/redis/content.md
- PostgreSQL versioning policy: https://www.postgresql.org/support/versioning/
- BullMQ connections (v6): https://docs.bullmq.io/guide/connections
- Next.js instrumentation (updated 2026-08-06): https://nextjs.org/docs/app/guides/instrumentation
- Next.js environment variables (updated 2026-08-25): https://nextjs.org/docs/app/guides/environment-variables
- Turborepo configuration (`concurrency`, `passThroughEnv`): https://turborepo.dev/docs/reference/configuration
- Compose Specification JSON schema: https://github.com/compose-spec/compose-spec/blob/main/schema/compose-spec.json
- npm registry for versions, publish dates, peer dependencies and engines.

---

## 02C: Tests, CI, fake providers, structured logging (2026-11-01)

### D-02C-01: Pinned versions added

Every new pin is at least 24 hours old.

| Package | Pinned | Published | Notes |
|---|---|---|---|
| vitest | 5.0.5 | 2026-10-15 | Node `^22.12 \|\| ^24 \|\| >=26`. `vite` is now a peer, so it's pinned explicitly. |
| vite | 8.3.5 | 2026-10-21 | Its Oxc transformer emits decorator metadata (D-02C-02) |
| @nestjs/testing | 12.3.2 | 2026-10-27 | Matches NestJS 12.3.2 |
| pino | 10.4.0 | 2026-10-02 | |
| pino-http | 11.0.0 | 2025-10-04 | |
| nestjs-pino | 5.3.1 | 2026-10-02 | Peers: Nest `^11.0.8 \|\| ^12.0.2`, pino `^10`, pino-http `^11` |
| @playwright/test | 1.64.1 | 2026-10-14 | Chromium headless shell 156.0.8078.4 (`--only-shell`) |

**Not added:** `@swc/core` / `unplugin-swc`. The latest `@swc/core` (1.16.21) was under 24 hours
old, and it isn't needed (D-02C-02).

### D-02C-02: Vitest without SWC

- The official NestJS starter runs Vitest with no SWC plugin.
- Vite 8's Oxc transformer reads `experimentalDecorators` / `emitDecoratorMetadata` from
  `tsconfig.json`.
- Verified: the API integration tests resolve `HealthController(HealthService)` through emitted
  metadata.
- **Layout:**
  - Tests sit next to code as `src/**/*.test.ts`; integration tests are named
    `*.integration.test.ts`.
  - Each package's `vitest.config.mjs` merges `vitest.shared.mjs` (node environment, network
    guard setup, `APP_ENV=test`, `LOG_LEVEL=silent`).
- **Builds:** packages with tests build from `tsconfig.build.json`, which excludes tests and
  `src/testing/**`. `tsconfig.json` still type-checks and lints tests.

### D-02C-03: Real network access is impossible in tests

- `packages/shared/src/testing/network-guard.ts` wraps `net.Socket.prototype.connect`, which
  every TCP/TLS client uses: http, https, fetch/undici, pg, ioredis and SDKs.
- A non-loopback target fails with `NetworkAccessDeniedError` (`E_TEST_NETWORK_DENIED`) before
  DNS or connect. It's installed by every Vitest project's setup file.
- **Leak found and fixed during 02C:** `http.request` passes `path: null`, and an early version
  treated any defined `path` as IPC, which let the request through. The guard now treats only a
  non-empty string `path` as IPC, like Node itself. This is covered by
  `network-guard.test.ts` (fetch, `http.request`, raw `net.connect`, loopback allowed).
- **Second layer:** `createProviders(appEnv, 'live')` throws `LiveProvidersForbiddenError` when
  `APP_ENV` is `test` or `development`, before any adapter exists.

### D-02C-04: Isolated test databases

- `assertTestDatabaseUrl` requires a database name ending in `_test`; `assertTestRedisUrl`
  refuses Redis database 0.
- Real-database suites run only when `TEST_DATABASE_URL` / `TEST_REDIS_URL` are set, and are
  reported as skipped otherwise. Tests never read `.env`.
- Turborepo hashes both variables in the `test` task (`env`).
- Compose mounts `infra/postgres/initdb`, which creates `<POSTGRES_DB>_test` on first volume
  initialization.
- CI uses service containers with `leadfennec_test` and Redis `/15`.
- `.gitattributes` forces LF so the init script runs in Linux containers.

### D-02C-05: Provider interfaces and fakes (provisional)

- `packages/integrations` defines minimal, provider-agnostic interfaces:
  - `AiProvider` (OpenAI)
  - `LeadDataProvider` (Apollo)
  - `EmailVerificationProvider`
  - `MailboxProvider` (Gmail, Microsoft Graph)
  - `CrmProvider` (GoHighLevel)
  - `BillingProvider` (Stripe)
- Each has an in-memory fake that records calls and honours idempotency keys.
- **No provider-specific details:** live adapters must first check the official docs
  (`CLAUDE.md`).
- **AI output** is typed `unknown`: callers validate it.
- The shapes are provisional until the data model exists (O-07).

### D-02C-06: Structured logging with request IDs and redaction

- `@lead-fennec-ai/shared/logger` is a server-only entry point, so web never imports pino.
  `createLogger` produces pino JSON lines (`app`, text `level`, ISO `time`).
- **Request IDs:** `resolveRequestId` reuses an incoming `X-Request-Id` only if it matches
  `[A-Za-z0-9._:-]{1,128}` (log-injection safe); otherwise it generates a UUID. pino-http
  echoes it in the response header and attaches it to every log line written during the
  request.
- **Redaction:**
  1. `redact` censors auth headers, cookies and password/token/key/URL-variable fields.
  2. `hooks.streamWrite: redactSecrets` masks URL credentials in the **final JSON line**.
- **Second gap found and fixed during 02C:** pino-http child loggers use their own `err`
  serializer, which bypassed the custom serializer in my first version and logged a credential
  from an error message. Line-level redaction covers every serializer.
  - The redaction regex now excludes quotes, so a match never spans JSON fields; covered by
    tests.
- **API:** `nestjs-pino` `LoggerModule.forRoot({ pinoHttp: httpLoggerOptions(logger) })`.
  nestjs-pino 5.3 keeps one pino-http instance per process (module state). That's correct in
  production, so tests use one logger per test file.
- **Worker:** `pino-http` directly on the health server.
- **Startup errors** stay plain text, because the logger may not exist yet.

### D-02C-07: CI (GitHub Actions)

- One job on `ubuntu-24.04` with read-only permissions, no secrets, and concurrency
  cancel-in-progress.
- **Steps:** frozen install, format, lint, typecheck, test, build, Playwright Chromium with
  `--with-deps --only-shell`, smoke test, and report upload on failure.
- **Pinned to commit SHAs** (GitHub API, checked 2026-10-31):

  | Action | Version | Commit |
  |---|---|---|
  | `actions/checkout` | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
  | `pnpm/setup` | v3.1.2 | `fa36a5ef7dcdefc3a7cb25655c122e00cf6e636e` |
  | `actions/upload-artifact` | v7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` |

- **pnpm setup:** pnpm's official CI guide recommends `pnpm/setup`. It reads pnpm from
  `packageManager`, installs Node 24, and caches the store. `install: false` plus
  `require-lockfile: true` lets CI run `pnpm install --frozen-lockfile` itself.
- **Services:** the same digest-pinned PostgreSQL and Redis images as Compose. The CI Postgres
  password is a throwaway for a job-scoped container.
- **Telemetry:** Next.js and Turborepo telemetry are disabled **in CI only**. The local choice
  stays open (O-02).
- **Validation:** the workflow is valid against SchemaStore's `github-workflow` JSON schema.
  It has never run on GitHub (no GitHub remote yet).

### D-02C-08: Playwright smoke test

- `apps/web/e2e/smoke.spec.ts` runs against the production build (`next start` on
  `127.0.0.1:3100`, loopback only) with fake `APP_ENV=test` and `API_BASE_URL`.
- The `test:e2e` task depends on the web build and isn't cached.
- `CI` and `PLAYWRIGHT_BROWSERS_PATH` are passed through Turborepo's strict env mode.

### Sources (checked 2026-10-31 / 2026-11-01)

- Vitest 5 migration guide: https://vitest.dev/guide/migration
- NestJS starter (`vitest.config.ts`, `package.json`): https://github.com/nestjs/typescript-starter
- pnpm continuous integration: https://pnpm.io/continuous-integration
- pnpm/setup v3.1.2 README: https://github.com/pnpm/setup/blob/v3.1.2/README.md
- Playwright web server: https://playwright.dev/docs/test-webserver
- Turborepo configuration (`concurrency`, `env`, `inputs`): https://turborepo.dev/docs/reference/configuration
- SchemaStore GitHub workflow schema: https://json.schemastore.org/github-workflow.json
- GitHub REST API (`/repos/{owner}/{repo}/releases/latest`, `/commits/{tag}`) for action SHAs.
- npm registry for versions, publish dates, peer dependencies and engines.

---

## Open choices (need a decision from the user)

| ID | Choice | Current state | Options |
|---|---|---|---|
| O-01 | The reference plan is missing | 02A was built from the task prompt and `CLAUDE.md` alone. 01A–01C are blocked. | Supply `docs/reference-plan.docx`. If it specifies a different structure or versions, reconcile with D-02A-*. |
| O-02 | Tool telemetry | Next.js and Turborepo anonymous telemetry are **on** locally (their defaults). Disabled in CI only (D-02C-07). | Keep, or disable with `NEXT_TELEMETRY_DISABLED=1` and `pnpm exec turbo telemetry disable`. |
| O-03 | Dev server network binding | `next start` reported `Network: http://192.168.1.102:3000`. Next.js, Nest and (since 02B) the worker health server listen on all interfaces by default. PostgreSQL and Redis bind to 127.0.0.1. | Keep the defaults, or bind local dev to `127.0.0.1`. |
| O-04 | Version control | **Resolved 2026-11-01** at the user's request ("git commit"): repository initialized on `main` with an initial commit. Author `LeadFennec-Leads-Agent` (global name); email set for this repository only. No remote yet (see O-09). | — |
| O-05 | Native PostgreSQL on port 5432 | Found during 02B: Windows service `postgresql-x64-18` listens on 5432, so Docker PostgreSQL would conflict. Readiness reached it once with the placeholder credentials and was rejected; nothing else touched it. | Set `POSTGRES_PORT=5433` (and the `DATABASE_URL` port) in `.env`, or use the native server with `pnpm dev --skip-services`. |
| O-06 | Docker Desktop not installed | Compose is written and schema-validated but has never been run here. | Install Docker Desktop, then run `pnpm dev` (see the 02B manual check). |
| O-07 | Provider interfaces are provisional | `packages/integrations` has minimal capability interfaces and fakes (D-02C-05), designed without the data model (01B blocked) or provider docs. | Reconcile with 01B. Each live adapter starts with an official-docs check. |
| O-08 | Migrations and database fixtures | Not available: Prisma has no schema yet (deferred since D-02A-09). README documents the gap; the test database and its guards exist. | Add the Prisma schema, migrations and a fixture loader once the data model exists. |
| O-09 | CI has never run on GitHub | `.github/workflows/ci.yml` is schema-valid, and every step passes locally on Windows, except the real-database suites (no services here). | Create the GitHub repository and push (user action), then check the first run. |
