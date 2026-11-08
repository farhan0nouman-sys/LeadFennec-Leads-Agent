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

## 03A: Core data model (2026-11-01)

**Basis.** The reference plan and the architecture specification (01B) are still missing.
Tenant ownership is therefore derived from the entity list in the 03A prompt and the
multi-tenancy rules in `CLAUDE.md`. It is provisional until 01B exists (O-10).

### D-03A-01: Prisma 7.10.1

| Package | Pinned | Published | Notes |
|---|---|---|---|
| prisma (CLI) | 7.10.1 | 2026-10-15 | npm `latest` is `8.0.0-rc.29`, a release candidate. Stable 7.10.1 matches the client. |
| @prisma/client | 7.10.1 | 2026-10-15 | npm `latest` |
| @prisma/adapter-pg | 7.10.1 | 2026-10-15 | Driver adapter over `pg` 8.23.1 |

Prisma 7 specifics in use:
- The `prisma-client` generator: ESM output to `src/generated/prisma`, `.js` import extensions.
- `@prisma/adapter-pg`.
- The query compiler, so there is no Rust query engine at runtime.
- `prisma.config.mjs`. Prisma 7 does not read `.env` itself.

Build scripts:
- `@prisma/engines`: **allowed**. It downloads the schema (migration) engine from
  `binaries.prisma.sh`, which `migrate` needs.
- `prisma`: **denied**. Its preinstall only checks the Node.js version.

### D-03A-02: Tenant ownership (derived)

| Scope | Tables | Reason |
|---|---|---|
| Platform | `tenants` | Root of every tenant's data |
| Platform | `users` | One login identity across tenants. **Platform Admin** is `users.is_platform_admin`, not a tenant role. |
| Platform | `permissions` | Catalog of permission keys defined by application code |
| Tenant | `tenant_settings`, `roles`, `role_permissions`, `memberships` | Tenant administration. Client Admin and Client Team Member are tenant roles. |
| Tenant | `icps`, `organizations`, `contacts`, `lead_lists`, `lead_list_members` | Targeting and leads. `lead_list_members` are the list ↔ contact membership links. |
| Tenant | `imports`, `source_records`, `research`, `evidence`, `scores`, `verifications` | Provenance and derived data |

Only two references cross scope: `memberships.user_id → users` and
`role_permissions.permission_key → permissions`.

### D-03A-03: Keys that cannot cross tenants

- **Primary keys:** every tenant-owned table has a composite primary key `(tenant_id, id)`.
  Link tables use `(tenant_id, a_id, b_id)`; settings use `tenant_id`.
- **Foreign keys:** every reference between tenant-owned rows is a composite foreign key
  `(tenant_id, x_id) → (tenant_id, id)`. A row cannot point at another tenant's row.
- **Optional references** share the row's required `tenant_id`; with `MATCH SIMPLE`, a NULL
  `x_id` skips the check. Prisma 7.10.1 accepts this (verified with `prisma validate` on
  NoAction, Cascade and SetNull variants).
- **Prisma lookups:** unique lookups require the tenant (`tenantId_id`).
- **Immutable `tenant_id`:** a `BEFORE UPDATE OF tenant_id` trigger on all 15 tenant tables
  raises SQLSTATE 23000, so a row can never be moved to another tenant.
- **IDs:** UUIDv7 (`@default(uuid(7))`), generated by Prisma Client and time-ordered.

### D-03A-04: Delete and update rules

| Rule | Where | Why |
|---|---|---|
| CASCADE | Tenant → every tenant table | Deleting a tenant is one statement |
| CASCADE | Owned or derived data: list members; role permissions; a contact's or organization's research, evidence, scores, verifications and source records; an import's source records; a research run's evidence | Deleting a contact erases its derived personal data in one delete |
| NO ACTION | Organization ← contacts; role ← memberships; ICP ← lead lists and research; lead list ← imports; research ← scores | Protects referenced rows. Checked at the end of the statement, so tenant deletion still cascades (RESTRICT would block it). |
| RESTRICT | Permission ← role permissions | Platform catalog |
| Never SET NULL | All references | It would also null `tenant_id`. Prisma only warns about this on PostgreSQL; it fails at runtime. |
| ON UPDATE NO ACTION | All references | Keys never cascade |

### D-03A-05: Explicit identity normalization

`normalizeDomain` and `normalizeEmail` in `packages/shared/src/identity.ts` produce every
`normalized_*` value. The raw input is kept in a separate column for display. The database
enforces the same rules with `is_normalized_domain()` / `is_normalized_email()` CHECK
constraints, and a test proves the TypeScript and SQL rules agree.

- **Domains:**
  - Scheme, credentials, port, path, query and fragment are dropped.
  - Lower-cased; internationalized names converted to ASCII (punycode) via WHATWG `URL`.
  - One leading `www.` and a trailing dot are removed.
  - IP addresses and single-label or invalid hosts are rejected.
- **Emails:**
  - Trimmed and lower-cased, including the local part. RFC 5321 allows case-sensitive local
    parts, but in practice no mailbox provider uses that.
  - The domain is normalized as above, but keeps `www.`.
  - **No** removal of dots or `+tags` (that's provider-specific and would merge identities).
  - Quoted local parts and IP literals are rejected.
- **Uniqueness:**
  - per tenant: `(tenant_id, normalized_email)` for contacts, `(tenant_id, normalized_domain)`
    for organizations, `(tenant_id, provider, external_id)` for source records;
  - global: `users.normalized_email`.
- **Consistency:** `contacts.email_domain` must equal the domain part of `normalized_email`,
  and `email`, `normalized_email` and `email_domain` are all set or all NULL.

### D-03A-06: Other integrity rules (hand-written migration)

| Area | Rule |
|---|---|
| Scores | `value` 0–100; exactly one subject (contact **or** organization) |
| Research, evidence | At least one subject |
| Imports | Row counts ≥ 0 and `imported + skipped + failed ≤ total`; `completed_at ≥ started_at` |
| Source records | An import row number exists exactly when `import_id` does, and is > 0; `payload_sha256` is 64 hex characters |
| Verifications | Provider key format; `expires_at > checked_at` |
| Formats | ISO country codes; `tenants.slug`, `roles.key` and `permissions.key` formats |

Prisma does not model CHECK constraints, functions or triggers, so `migrate diff` ignores them.
The drift test passes with them in place.

### D-03A-07: Planned queries and their indexes

Every query below is verified in `schema.integration.test.ts`: with planner statistics
(`ANALYZE`) and sequential scans disabled, PostgreSQL 18.6 uses exactly the named index.

| Planned query | Index |
|---|---|
| Contact by email identity | `contacts (tenant_id, normalized_email)` unique |
| Contacts of an organization | `contacts (tenant_id, organization_id)` |
| Contacts by email domain (match to organizations) | `contacts (tenant_id, email_domain)` |
| Newest contacts by status | `contacts (tenant_id, status, created_at DESC)` |
| Organization by domain | `organizations (tenant_id, normalized_domain)` unique |
| Members of a lead list, newest first | `lead_list_members (tenant_id, lead_list_id, added_at DESC)` |
| Lead lists containing a contact | `lead_list_members (tenant_id, contact_id)` |
| Top scores for an ICP | `scores (tenant_id, icp_id, value DESC)` |
| Latest verification of a contact | `verifications (tenant_id, contact_id, checked_at DESC)` |
| Source record by provider id | `source_records (tenant_id, provider, external_id)` unique |
| Research history of a contact | `research (tenant_id, contact_id, created_at DESC)` |
| Recent imports | `imports (tenant_id, created_at DESC)` |
| A user's tenants | `memberships (user_id)` |

- **Other indexes** support composite foreign key checks and cascades:
  `(tenant_id, organization_id | research_id | source_record_id | icp_id | lead_list_id | role_id)`,
  plus `role_permissions (permission_key)`.
- **Tenant-scoped id lookups** are served by the `(tenant_id, id)` primary keys.
- **Provisional:** these queries are inferred; the API specification (01B) will confirm or
  replace them.

### D-03A-08: Migration workflow

- **Initial migration:** generated offline with
  `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script`, without a
  database.
- **Integrity migration:** hand-written, separate (D-03A-06).
- **Applying:** `pnpm db:migrate` runs `prisma migrate deploy`, which applies pending
  migrations and never resets.
- **Not scripted:** `prisma migrate dev` and `migrate reset`, because they can reset data.
- **Drift check:** `schema.integration.test.ts` runs
  `prisma migrate diff --from-config-datasource --to-schema --exit-code` against the migrated
  database. CI runs it on PostgreSQL 18.6.
- **`prisma.config.mjs`** loads the root `.env` for CLI use. Environment variables win
  (verified: `process.loadEnvFile` does not override them).
- **Generated client:** `src/generated` is git-ignored and rebuilt by the Turborepo `generate`
  task before build, typecheck, lint, test and dev. Its files carry `@ts-nocheck` and
  `eslint-disable` from Prisma.

### D-03A-09: Fixture tenants

- **Tenants:** `fixture-alpha` (HOSTED) and `fixture-beta` (DEDICATED), with deterministic
  UUIDs (`00000000-0000-4000-8000-{a|b|c}…`).
- **Users:**
  - a Platform Admin;
  - one Client Admin per tenant;
  - a shared Client Team Member: ACTIVE in Alpha, INVITED in Beta.
- **Data:** permissions; two system roles per tenant; and everything listed in the README.
- **Fake only:** all identities use the `.test` TLD.
- **Shared identities:** both tenants contain the same normalized email, domain and Apollo id,
  which is only possible because uniqueness is per tenant.
- **Loader:** `loadFixtureTenants` runs in one transaction and is idempotent
  (`createMany` with `skipDuplicates`). `deleteFixtureTenants` removes only the fixture
  tenants and users, by id.
- **CLI:** `pnpm db:fixtures [--reset]` refuses `APP_ENV=staging|production`.

### D-03A-10: Local verification without Docker; `prisma dev` rejected

- **`prisma dev` is not used.** It installs `@prisma/cli-dev@latest` from npm into
  `os.tmpdir()` at runtime and executes it. That's unpinned code outside the lockfile and the
  24-hour release-age rule.
  - One `prisma dev --help` call during 03A had already downloaded and run
    `@prisma/cli-dev@0.16.28`. I removed that cache.
- **Local runs used PGlite instead:** `@electric-sql/pglite` 0.5.13 (**PostgreSQL 18.6** in
  WebAssembly) with `@electric-sql/pglite-socket` 0.2.16. Both were installed in a scratch
  folder, not as project dependencies, and served on loopback port 54329.
- **Caveat:** its connection multiplexer shares one session across connections. A
  `search_path` set by the test suite leaked into a later CLI run until the server restarted.
  Sequential tests are unaffected. CI uses real PostgreSQL 18.6.

### Sources (checked 2026-11-01)

- Prisma config reference: https://www.prisma.io/docs/orm/reference/prisma-config-reference
- Prisma generators: https://www.prisma.io/docs/orm/prisma-schema/overview/generators
- Prisma PostgreSQL / adapter-pg: https://www.prisma.io/docs/orm/overview/databases/postgresql
- Prisma CLI reference (`migrate diff`, `migrate deploy`, `dev`): https://www.prisma.io/docs/orm/reference/prisma-cli-reference
- Referential actions: https://www.prisma.io/docs/orm/prisma-schema/data-model/relations/referential-actions
- Unsupported database features: https://www.prisma.io/docs/orm/prisma-migrate/workflows/unsupported-database-features
- Local Prisma Postgres (`prisma dev`): https://www.prisma.io/docs/postgres/database/local-development
- Prisma CLI source (`prisma@7.10.1` `build/cli.js`) for the runtime `@cli-dev@latest` install.
- PGlite socket README (`@electric-sql/pglite-socket` 0.2.16), and the npm registry for
  versions, publish dates, peer dependencies and install scripts.

---

## 03B: Outreach and background-job data model (2026-11-01)

**Basis.** As in 03A: the plan and the architecture specification (01B) are missing. The model
is derived from the 03B prompt, the 01A/01B prompts' themes, and `CLAUDE.md`, and is
provisional (O-10):
- the 01A themes: approval by default; verified eligible contacts; pause, resume and cancel;
  stop on replies, opt-outs or hard bounces;
- the 01B themes: durable outbox, inbound-event ledger, draft versions, outbound intents and
  worker leases.

### D-03B-01: Prisma partial indexes (preview feature)

- **Enabled:** `previewFeatures = ["partialIndexes"]` in the generator. Prisma 7.10.1
  documents partial indexes (`where: raw(...)`) with full Migrate and introspection support
  on PostgreSQL.
- **Used for three indexes:**
  - one live draft version per lead and step;
  - one in-flight or sent attempt per intent;
  - the outbox relay's queue (`published_at IS NULL`).
- **Drift:** Prisma compares predicates as text. Enum literals must be written the way
  PostgreSQL prints them back (`status <> 'FAILED'::outbound_attempt_status`), otherwise
  `migrate diff` reports drift. Found and fixed during 03B.
- **Pitfall (verified with the query log):** Prisma Client offers partial unique constraints
  as `findUnique` / `upsert` keys but drops their WHERE clause. A lookup returned the FAILED
  attempt and the REJECTED draft.
  - Both are therefore named `*_partial`.
  - An ESLint `no-restricted-syntax` rule forbids those keys in code.
  - A canary test fails if Prisma's behaviour changes.
- **Risk:** a preview feature may change in a later Prisma release. Re-check it on every
  Prisma upgrade (O-14). The drift test catches mismatches.

### D-03B-02: Ownership: every new table is tenant-owned

| Prompt term | Tables |
|---|---|
| Campaigns, campaign leads, sequences, sequence steps, templates | `campaigns`, `campaign_leads`, `sequences`, `sequence_steps`, `templates` |
| Versioned drafts and approvals | `drafts` (each row is one immutable version), `approvals` |
| Email accounts | `email_accounts` |
| Outbound intents and attempts | `outbound_intents`, `outbound_attempts` |
| Inbound messages, threads, suppression | `inbound_messages`, `email_threads`, `suppressions` |
| Schedules, runs, tasks, leases | `job_schedules`, `job_runs`, `job_tasks`, `worker_leases` |
| Outbox events, inbound-event deduplication, integration sync cursors | `outbox_events`, `inbound_events`, `integration_sync_cursors` |

All 20 follow D-03A-03: `tenant_id`, the `(tenant_id, id)` key, composite foreign keys and the
immutability trigger. There are now 35 tenant tables and 3 platform tables.

- **Inbound events are tenant-scoped.** The future webhook receiver must:
  1. authenticate the request;
  2. resolve the tenant (or tenants) from the provider account;
  3. insert with `ON CONFLICT DO NOTHING`.

  A notification that can't be routed is not stored. That routing design is O-16.
- **System workers don't query across tenants.** The outbox relay, schedulers and lease
  sweepers iterate the `tenants` table, which is platform scope, and then run tenant-scoped
  queries. All 27 planned queries start with `tenant_id`.

### D-03B-03: Keys that keep related rows consistent

Composite foreign keys onto "superkeys" make related rows agree, not just exist. The extra
unique constraints exist only to be referenced:

| Rule | Mechanism |
|---|---|
| A lead follows a sequence of its own campaign | `campaign_leads (tenant_id, campaign_id, sequence_id) → sequences (tenant_id, campaign_id, id)` |
| A draft's step belongs to the lead's sequence | `drafts` references `campaign_leads (tenant_id, id, sequence_id)` and `sequence_steps (tenant_id, sequence_id, id)` |
| An intent sends a draft version of its own lead and step | `outbound_intents → drafts (tenant_id, id, campaign_lead_id, sequence_step_id)` |
| An intent cites only an APPROVED decision on that exact version | `outbound_intents (tenant_id, approval_id, draft_id, approval_decision) → approvals (tenant_id, id, draft_id, decision)` plus a CHECK that `approval_decision = 'APPROVED'` |
| A message is filed in a thread of its own mailbox | `inbound_messages (tenant_id, email_thread_id, email_account_id) → email_threads (tenant_id, id, email_account_id)` |

Application code still decides whether approval is required (`tenant_settings`), eligibility,
suppression checks and budgets. The database guarantees that what is sent is what was approved.

### D-03B-04: Delete rules

| Rule | Where | Why |
|---|---|---|
| CASCADE | Campaign → sequences → steps; campaign → leads → drafts, intents, threads; drafts → approvals; intents → attempts; threads → messages; schedules → runs → tasks; mailbox → its sync cursors, inbound events and schedules | Owned data |
| CASCADE | Contact → its campaign leads, and everything derived from them | Erasure: deleting a contact removes its outreach history in one delete |
| NO ACTION | Mailbox ← campaigns, intents, attempts, threads; template ← steps, drafts; step ← drafts; sequence ← leads; draft version ← intents; approval ← intents; membership ← drafts, approvals | Protects referenced rows. Checked at the end of the statement, so tenant, campaign and contact deletions still cascade. |
| No foreign keys | `suppressions` | Survives contact and message deletion, so an opt-out keeps working |

- **Approvals block deleting a membership.** A membership that approved drafts, and so its user
  (users → memberships cascade), cannot be deleted while those approvals exist. That is
  deliberate (audit) and is tracked in O-12.
- **Erasure limits:** messages not linked to a campaign lead, and outbox payloads that name an
  aggregate id, are outside the contact cascade. The erasure task must handle them. Outbox
  payloads must not contain personal data.

### D-03B-05: UTC instants and IANA time zone intent

- **Instants:** every timestamp is `timestamptz`, an absolute instant. A structure test
  rejects any `timestamp without time zone` column.
- **Zones:** where local time matters, the IANA zone is stored next to the instant:
  - `tenant_settings.timezone`;
  - `campaigns.timezone`, with the weekly send window in local minutes and ISO weekdays;
  - `campaign_leads.timezone`, the zone this lead is scheduled in;
  - `outbound_intents.scheduled_timezone`, the zone `scheduled_at` was planned in;
  - `job_schedules.timezone`, for cron expressions in local time.
- **TypeScript:** `normalizeTimeZone` in `@lead-fennec-ai/shared`:
  - accepts `UTC` and Area/Location names known to ICU, in any case;
  - returns ICU's spelling (Node 24.19, ICU 78.3, tzdata 2026b). Aliases may resolve to an
    equivalent name, e.g. `US/Eastern` → `America/New_York`;
  - rejects abbreviations, legacy single-word names (`EST5EDT`) and fixed offsets.
- **Database:** `is_iana_time_zone()` checks the IANA spelling (each component capitalized)
  and probes `AT TIME ZONE`.
  - `pg_timezone_names` was rejected: about 24 ms per lookup on PGlite.
  - It depends on the server's tz database. All 418 ICU zone names passed on PostgreSQL 18.6
    (PGlite). A curated sample is tested.
  - 03A's `tenant_settings.timezone` gained the same CHECK.
- **One clock per row:** timing CHECKs (e.g. `finished_at >= started_at`) assume both values
  come from one clock.
  - Prisma fills `@default(now())`, `@updatedAt` and UUIDv7 ids from the application clock,
    verified with the query log, so Prisma writers are consistent.
  - Raw-SQL writers must not mix the database's `now()` with application timestamps in one row.

### D-03B-06: Secret references, never credentials

- **The column:** `email_accounts.secret_ref` holds `<store>://<path>`, checked by
  `parseSecretRef` (TypeScript) and `is_secret_ref()` (CHECK).
  - Path segments are 1–64 characters of `[A-Za-z0-9._-]`; at most 255 characters in all.
  - That rejects JWTs, OAuth access and refresh tokens, and long API keys (tested with
    token-shaped values).
  - Error messages never repeat the rejected value.
- **Status rule:** `ACTIVE` and `PAUSED` mailboxes have a reference; `PENDING` and
  `DISCONNECTED` ones have none.
- **No credential columns:** a structure test fails if any column name looks like one
  (password, api key, access or refresh token…). `secret_ref` is the only allowed match.
- **Development and tests** use `fake://…`, which points at nothing. The production secret
  store is open (O-15).

### D-03B-07: Uniqueness rules

| Rule | Constraint |
|---|---|
| A contact is enrolled in a campaign at most once | `campaign_leads (tenant_id, campaign_id, contact_id)` |
| At most one outbound intent per lead and sequence step | `outbound_intents_lead_step_key` |
| Provider event keys | `inbound_events (tenant_id, provider, event_key)` |
| Provider message and thread ids, per mailbox | `inbound_messages_provider_message_key`, `outbound_attempts_provider_message_key`, `email_threads (tenant_id, email_account_id, provider_thread_id)` |
| Our Message-IDs | `outbound_attempts (tenant_id, internet_message_id)` |
| One live draft version (awaiting approval or approved) per lead and step | `drafts_one_live_version_key` (partial) |
| One decision per draft version | `approvals (tenant_id, draft_id)` |
| No new attempt while one is in flight or sent | `outbound_attempts_one_open_or_sent_key` (partial). A crashed send stays `SENDING` until reconciliation settles it, so it is never blindly retried. |
| One run per schedule occurrence | `job_runs (tenant_id, schedule_id, scheduled_for)` |
| Task deduplication | `job_tasks (tenant_id, task_type, idempotency_key)` |
| One lease row per resource; one sync cursor per scope | `worker_leases (tenant_id, resource_type, resource_id)`, `integration_sync_cursors_scope_key` |
| A mailbox address is connected once per tenant | `email_accounts (tenant_id, normalized_email)` |

Leases are taken with `INSERT … ON CONFLICT … DO UPDATE … WHERE expires_at <= now()`. Each new
holder gets `fencing_token + 1`. Tested: the second holder is refused until expiry.

### D-03B-08: Append-only content

- **Drafts:** a version's content and provenance never change; only `status` does.
- **Approvals:** never change at all.
- **Enforced by** the `forbid_column_changes` trigger (SQLSTATE 23000).

Together with D-03B-03, the approved text is exactly the text an intent sends.

### D-03B-09: Planned queries and their indexes

Each query is verified in `outreach-schema.integration.test.ts`. The test adds realistic volume
inside a rolled-back transaction, runs `ANALYZE`, disables sequential scans, and checks that
PostgreSQL 18.6 uses exactly this index.

| Planned query | Index |
|---|---|
| Active campaigns | `campaigns (tenant_id, status)` |
| Leads due for their next step | `campaign_leads (tenant_id, status, next_action_at)` |
| A campaign's leads by status | `campaign_leads (tenant_id, campaign_id, status)` |
| Enrollment of a contact in a campaign | `campaign_leads (tenant_id, campaign_id, contact_id)` unique |
| A contact's enrollments | `campaign_leads (tenant_id, contact_id)` |
| Steps of a sequence in order | `sequence_steps (tenant_id, sequence_id, position)` unique |
| Approval queue, oldest first | `drafts (tenant_id, status, created_at)` |
| Latest draft version for a lead and step | `drafts (tenant_id, campaign_lead_id, sequence_step_id, version)` unique |
| Due outbound intents | `outbound_intents (tenant_id, status, scheduled_at)` |
| Intent for a lead and step | `outbound_intents_lead_step_key` |
| A mailbox's attempts in the last day (daily limit) | `outbound_attempts (tenant_id, email_account_id, started_at)` |
| Attempt by our Message-ID (reply matching) | `outbound_attempts (tenant_id, internet_message_id)` unique |
| Thread by provider thread id | `email_threads (tenant_id, email_account_id, provider_thread_id)` unique |
| Inbound message by provider id | `inbound_messages_provider_message_key` |
| Messages of a thread in order | `inbound_messages (tenant_id, email_thread_id, received_at)` |
| Unclassified inbound messages | `inbound_messages (tenant_id, classification, received_at)` |
| Is an address / a domain suppressed | `suppressions (tenant_id, normalized_email)` / `(tenant_id, normalized_domain)` unique |
| Unpublished outbox events, oldest first | `outbox_events_unpublished_idx` (partial) |
| Inbound event by provider key; events waiting to be processed | `inbound_events (tenant_id, provider, event_key)` unique; `(tenant_id, status, received_at)` |
| Due tasks; task by idempotency key | `job_tasks (tenant_id, status, available_at)`; `(tenant_id, task_type, idempotency_key)` unique |
| Runs of a schedule, latest first; due schedules | `job_runs (tenant_id, schedule_id, scheduled_for)` unique; `job_schedules (tenant_id, enabled, next_run_at)` |
| Lease of a resource; sync cursor of a stream | `worker_leases (tenant_id, resource_type, resource_id)`; `integration_sync_cursors_scope_key` |

Every foreign key also has an index starting with its columns, or with `tenant_id` and the
referencing id; a structure test checks this for all 91 keys (39 from 03A, 52 from 03B). Six generated names longer than
63 characters were given readable names (`map:`). All of these queries are inferred; 01B will
confirm or replace them.

### D-03B-10: Other integrity rules (hand-written migration)

| Area | Rule |
|---|---|
| Campaigns | IANA zone; weekdays a non-empty set of 1–7 without duplicates; send window `0 ≤ start < end ≤ 1440`; status matches `activated_at` / `paused_at` / `completed_at` / `cancelled_at` |
| Campaign leads | IANA zone; a stopped lead has a reason and a time; completed or stopped leads have nothing due |
| Templates, drafts | Subject 1–300 and body 1–20,000 characters; provenance per source (TEMPLATE → template and version; AI → model and prompt version; MANUAL → author) |
| Intents | Normalized recipient; IANA zone; status matches `sent_at` / `failed_at` + error code / `cancelled_at` + reason |
| Attempts | Number ≥ 1; RFC 5322 Message-ID shape; SENDING → not finished; SENT → provider id; FAILED → error code and `retryable`; finished ≥ started |
| Inbound messages | Normalized sender when parseable; snippet ≤ 2,000 characters; classified ⇔ `classified_at` |
| Suppressions | Exactly one of a normalized address and a normalized domain |
| Jobs | Dotted type keys; exactly one of a five-field cron expression and an interval (60 s–30 days); at most one target; scheduled runs name their schedule; status matches start/finish times; attempts within `max_attempts` |
| Leases, events, cursors | Fencing token ≥ 1, expiry after acquisition; SHA-256 payload hash; processed ⇔ `processed_at`; a mailbox cursor's scope is its account id |

### D-03B-11: Fixtures

- **Data:** each fixture tenant gains a campaign in mid-flight.
  - The shared contact's step 1: an AI draft was rejected, an edited version approved, the
    first attempt failed, the second was sent.
  - The contact replied, so the lead stopped (`REPLIED`).
  - The other lead's draft awaits approval.
  - Plus suppressions, a schedule with a run and tasks, a lease, outbox events, an inbound
    event and a sync cursor.
- **Time zones:** Alpha schedules in `America/New_York`, its second lead in
  `America/Chicago`. Beta schedules in `Europe/London`, its second lead in `Europe/Dublin`.
  Both intents are 09:30 local, so they are different UTC instants.
- **Provider ids:** both tenants reuse the same provider message, thread and event ids,
  which only per-tenant (and per-mailbox) uniqueness allows.
- **Fake:** nothing was ever sent; every provider id and `fake://` reference points at nothing.
- **Permissions:** the fixture catalog adds `campaigns.read`, `campaigns.write`,
  `drafts.approve`, `email_accounts.manage` and `suppressions.manage` (still fixture-only,
  O-11).
- **CLI output:** `pnpm db:fixtures` now prints one row per table and one column per tenant.

### D-03B-12: Test setup

- **Shared harness:** `src/testing/migrated-schema.ts` (excluded from the build) gives each
  integration suite its own migrated schema.
- **Suites:**
  - `schema.integration.test.ts`: 03A;
  - `outreach-schema.integration.test.ts`: 03B;
  - `schema-structure.integration.test.ts`: catalog rules for every table.
- **Sequential files:** the database package runs test files one at a time
  (`fileParallelism: false`). The suites share one test database, and database-wide work such
  as `ANALYZE` must not overlap. PGlite also shares one session across connections.

### Sources (checked 2026-11-01)

- Prisma indexes, including partial indexes (`partialIndexes` preview, `where: raw(...)`,
  PostgreSQL support): https://www.prisma.io/docs/orm/prisma-schema/data-model/indexes
- **Verified locally, not from documentation:**
  - Prisma Client's handling of partial unique keys and of `@default(now())` (query log,
    Prisma 7.10.1);
  - Node's `Intl` time zone behaviour (Node 24.19.0, ICU 78.3, tzdata 2026b);
  - PostgreSQL 18.6 time zone handling (PGlite 0.5.13).

---

## 03C: Billing, usage, branding, audit, notifications and tenant-aware access (2026-11-01)

**Basis.** As in 03A and 03B: the plan and the architecture specification (01B) are missing, so
this model is derived from the 03C prompt and `CLAUDE.md` and is provisional (O-10). Stripe
details were checked in Stripe's official documentation first (Sources below). No Stripe SDK,
live adapter or webhook endpoint was added; billing stays behind the fake `BillingProvider`.

### D-03C-01: One source of truth per concept

The prompt names one duplicate pair from the source, `subscriptions` and
`billing_subscriptions`. The plan isn't available, so the other names below are names a
duplicate would plausibly get, not confirmed source content. Each concept has exactly one
table:

| Concept | Single source of truth | Do not create |
|---|---|---|
| Plan catalog | `billing_plans` + `plan_limits` (platform scope) | `plans`, `billing_plan_limits` |
| A tenant's plan and billing state | `subscriptions`: at most one current row per tenant, ended rows kept as history | `billing_subscriptions`, `tenant_subscriptions`, plan or billing-status columns on `tenants` |
| Raw provider notifications (Stripe webhooks included) | `inbound_events` (03B): deduplicated, untrusted | `stripe_events`, `webhook_events`, `billing_events` |
| Payment facts | `payment_events`: validated, immutable, each derived from one inbound event (or recorded manually) | `payments` |
| Limits | `plan_limits`, replaced per tenant by `tenant_limit_overrides`. Effective limit = override, else plan limit, else 0. | `tenant_limits`, `usage_limits`, limit copies on tenants or subscriptions |
| Usage | `usage_ledger_entries` (append-only; totals are sums) and `usage_reservations` (holds) | `usage_events`, `usage_records`, `usage_counters`, `credit_ledger` |
| Branding | `tenant_branding` (presentation). `tenants.name` stays the account name. | `branding`, `tenant_brandings`, `white_label_settings` |
| Audit | `audit_records` for anything in or about one tenant; `platform_audit_records` for platform actions, refusals and anything that must outlive a tenant | `audit_logs`, `audit_events`, `activity_logs` |
| Notifications | `notifications` (to people, in-app). Machine events stay in `outbox_events`. | `user_notifications`, `notification_events` |

- **Tenant status is not billing status.** `tenants.status` is operational (suspend,
  archive). Billing state lives only in `subscriptions`. Whether a billing state should
  suspend a tenant automatically is open (O-17).
- **Application code reads plan, status and limits only from these tables**, never from the
  billing provider at request time and never from a copy (`tenancy/billing.ts`).
- **Enforced:** the structure test fails if a table with one of the "do not create" names
  appears.

### D-03C-02: Ownership

| Scope | Tables |
|---|---|
| Platform (new) | `billing_plans`, `plan_limits`, `platform_audit_records` |
| Tenant-owned (new) | `subscriptions`, `payment_events`, `tenant_limit_overrides`, `usage_reservations`, `usage_ledger_entries`, `tenant_branding`, `audit_records`, `notifications` |

- **Totals:** 43 tenant tables, 6 platform tables. The new tenant tables follow D-03A-03: key
  `(tenant_id, id)` (`tenant_branding`: `tenant_id`, like `tenant_settings`), composite
  foreign keys and the `tenant_id` immutability trigger.
- **One new platform reference:** `subscriptions(plan_id) → billing_plans(id)`, NO ACTION
  (archive a plan instead of deleting it).
- **One platform-wide unique key on a tenant table:**
  `subscriptions (provider, external_subscription_id)`. A provider subscription belongs to
  exactly one tenant. It is also the key that routes a billing webhook to its tenant (O-16).
- **No foreign keys on audit records** apart from the tenant, so they outlive the members and
  rows they name. `platform_audit_records` has none at all and outlives deleted tenants.

### D-03C-03: Billing and usage rules

**Stripe facts used (official docs, checked 2026-11-01):**

| Fact | How the model uses it |
|---|---|
| A subscription's status is one of `incomplete`, `incomplete_expired`, `trialing`, `active`, `past_due`, `canceled`, `unpaid`, `paused`; `incomplete_expired` is terminal | `SubscriptionStatus` has the same eight values |
| Billing periods are on subscription items, not on the subscription | A plan is one item; its period is stored on the subscription row |
| The same event can be delivered more than once; dedupe by event id | `inbound_events (tenant_id, provider, event_key)` and `payment_events_provider_event_key` |
| Delivery order isn't guaranteed; don't use `created` to order events | The sync refetches the subscription and overwrites the row (`last_synced_at`), never applies events in arrival order |
| Amounts are in the currency's minor unit; currency codes are lower-case ISO 4217 | `amount_minor` (bigint) and an upper-case ISO code; the adapter converts, including the documented ISK and UGX special cases |
| Webhooks need signature verification on the raw body and a quick 2xx | Recorded for the webhook task (O-16, O-17); nothing is received yet |

The docs' examples use API version `2026-10-28.endive`. Nothing is pinned because no SDK or
adapter exists yet.

**Entitlement:** `TRIALING`, `ACTIVE` and `PAST_DUE` may consume metered usage (`PAST_DUE`
while the provider retries). `INCOMPLETE`, `UNPAID` and `PAUSED` may not. This is an
application constant (`ENTITLED_SUBSCRIPTION_STATUSES`), provisional (O-17).

**Budgets (application code decides; CLAUDE.md):**

1. **Reserve** before paid work (an AI call, an enrichment, a send). Inside a transaction,
   `pg_advisory_xact_lock` on the tenant and metric serializes concurrent reservations. The
   hold is granted only if `ledger total + unexpired holds + requested ≤ effective limit`.
2. **Commit** the quantity actually used (at most the quantity held). This writes one
   `USAGE` ledger entry (`reservation:<id>`). Or **release** the hold.
3. **Holds expire** after `holdSeconds` (default 15 minutes, at most 1 day) and then stop
   counting. A worker marks them `EXPIRED`. A hold still `HELD` can be committed after expiry:
   the work happened, and the ledger records what was used.

- **Idempotency:** a repeated reservation key returns the same hold (or fails if metric or
  quantity differ). Ledger keys are unique per tenant. Each reservation has at most one
  ledger entry.
- **Period:** the subscription's current period start is copied into the reservation and its
  ledger entry, so a hold made before a renewal counts in its own period. A superkey foreign
  key keeps the ledger entry's metric and period equal to the reservation's.
- **Corrections** are signed `ADJUSTMENT` entries with a note.
- **Overrides** can be set only by platform admins, together with an audit record in the
  same transaction.

### D-03C-04: Tenant-aware entry points and the scoped client

Server code gets tenant data only through `@lead-fennec-ai/database`'s entry points
(`src/tenancy/access.ts`). Each one returns a `TenantScope` (`db`, `audit`, `billing`,
`notifications`, `usage`):

| Entry point | Who | Checks |
|---|---|---|
| `memberScope` | A signed-in user | `ACTIVE` membership, `ACTIVE` user and `ACTIVE` tenant. Loads the role's permission keys for the API. |
| `platformAdminScope` | A platform admin | See D-03C-05 |
| `systemScope` | A named worker (snake-case name) | For workers that iterate `tenants` (D-03B-02) |
| `platformConsole` | A platform admin | The only cross-tenant view (`listTenants`); audited |

- **`TenantDb`** is a Prisma Client query extension:
  - it adds `tenant_id = <scope>` to every where and sets it on every create;
  - it rejects any argument that names another tenant, including compound keys such as
    `tenantId_id`;
  - it fails closed on unknown operations;
  - raw SQL (`$queryRaw…`, `$executeRaw…`), `$extends` and the platform models are not
    reachable;
  - interactive transactions keep the scope;
  - nested writes are allowed: composite foreign keys and the immutable `tenant_id` already
    stop them from crossing tenants.
- **Repositories** (audit, billing, notifications, usage) are trusted code inside the
  database package. They use the base client with an explicit `tenant_id` in every query,
  because they need locks, upserts and aggregates in one transaction.
- **Errors:**
  - `TenantAccessDeniedError` has the same message whether the tenant is missing or the user
    has no active membership;
  - `TenantScopeError` means arguments went outside the scope;
  - `ActorNotAllowedError` means the actor kind may not do this, e.g. a member setting
    limits.
- **Inputs are validated with zod** (UUIDs, reasons, request ids, keys) before any query.
- **Not wired yet:** the API and worker have no data endpoints. They must use these entry
  points when they do (`CLAUDE.md`).

### D-03C-05: Explicit, audited platform-admin access

- **No implicit access:** `is_platform_admin` grants nothing through `memberScope`.
- **`platformAdminScope`** requires an `ACTIVE` platform admin, a reason of 10–500
  characters and optionally the request id. Before returning, it writes
  `platform_admin.access_opened` to the tenant's `audit_records` (actor `PLATFORM_ADMIN`,
  with the reason).
- **Read-only:** the scope's generic client rejects every write. Changes go only through
  repository methods that audit in the same transaction (03C: `billing.setLimitOverride`).
  Platform admins cannot reserve or settle usage, or send notifications.
- **Refusals are recorded too:** `platform_admin.access_denied` in `platform_audit_records`,
  by the system actor `access_control`, naming the user and the tenant asked for. Opening
  the console writes `platform_admin.console_opened`.
- **Audit records are immutable** (trigger). CHECKs fix the actor's shape:
  - a member has user and membership ids;
  - a platform admin has a user id and a reason;
  - a system actor has a name.
- **Open (O-18):** time-limited grants, tenant consent or notifying the tenant's admins, and
  audit retention.

### D-03C-06: Pagination

- **Keyset on `id`:** ids are UUIDv7 and every tenant table's primary key is
  `(tenant_id, id)`. A page is `WHERE tenant_id = $1 AND id < $cursor ORDER BY id DESC LIMIT
  n + 1`, served by the primary key. There is no OFFSET, and the cost is the same on every
  page.
- **`paginate(request, fetch, order)`** in `src/pagination.ts`:
  - page size defaults to 25, at most 100;
  - unknown parameters are rejected (zod);
  - `newest` (default) or `oldest` first;
  - one extra row is fetched to know whether there is a next page.
- **Cursors** are opaque base64url JSON `{v: 1, id}`, validated on the way in. They aren't
  signed: they hold only an id the caller already received. Replayed in another tenant's
  scope, they just filter that tenant's rows (tested).
- **Limitation:** order is creation order. Sorting by another column needs a compound cursor
  later.

### D-03C-07: Fixtures and factories

- **Fixture tenants gain billing history:**
  - Starter cancelled, then a bigger plan (Alpha: Growth, monthly USD; Beta: Dedicated,
    yearly GBP);
  - the first payment failed (`card_declined`) and the retry succeeded, both derived from
    deduplicated Stripe-shaped inbound events (`fake_evt_…`);
  - a limit override;
  - usage in the current period: a committed research hold with its ledger entry, a credit
    adjustment, a released and an expired hold, and last period's send;
  - branding;
  - audit records by a member, a worker and a platform admin;
  - two notifications.
- **Three fixture plans** (platform scope, keys `fixture_*`). `--reset` deletes them after
  the tenants. Platform audit records are kept by design.
- **Coverage:** two rows were added so every relation is used in both tenants: an
  organization score (without research, so the 03A contact-cascade test still holds) and a
  mailbox-sync schedule.
- **Symmetry:** both tenants have the same structure and dates; their ids differ only in the
  group letter. The relation test relies on that.
- **Factories:** `createFixtureFactory(prisma)` creates fresh rows with valid defaults and
  unique `.test` names:
  - `user`, `tenant` (settings and the two system roles), `membership`, `plan` (with
    limits), `subscription` (MANUAL, current UTC month), `contact`;
  - `workspace(limits)`: a tenant with an active admin and an entitled subscription.

### D-03C-08: Planned queries and their indexes

Verified in `billing-schema.integration.test.ts`, as in D-03B-09: volume data inside a
rolled-back transaction, `ANALYZE`, sequential scans off, exact index name.

| Planned query | Index |
|---|---|
| Usage of a metric in a period | `usage_ledger_entries (tenant_id, metric, period_start)` |
| Unexpired holds of a metric in a period | `usage_reservations (tenant_id, metric, period_start, status)` |
| Reservation by idempotency key | `usage_reservations (tenant_id, idempotency_key)` unique |
| Payment fact by provider event id | `payment_events_provider_event_key` |
| Payments of a subscription, latest first | `payment_events (tenant_id, subscription_id, occurred_at)` |
| Subscription by provider id (webhook routing) | `subscriptions_external_subscription_key` |
| Limit override of a metric | `tenant_limit_overrides (tenant_id, metric)` unique |
| Audit records, a page | `audit_records_pkey` |
| Audit records of one row | `audit_records (tenant_id, target_type, target_id, id)` |
| A member's notifications, a page | `notifications (tenant_id, recipient_membership_id, id)` |
| A member's unread count | `notifications_unread_idx` (partial, `read_at IS NULL`) |
| Platform audit records about a tenant | `platform_audit_records (subject_tenant_id, id)` |

Finding the current subscription filters by tenant (a tenant has a handful of rows);
`subscriptions_one_current_key` (partial unique) guarantees at most one match. One generated foreign-key name was longer
than 63 characters and was named explicitly (`usage_ledger_entries_reservation_fkey`).

### D-03C-09: Other integrity rules (hand-written migration)

| Area | Rule |
|---|---|
| Plans | Key `^[a-z][a-z0-9_]{0,49}$`; name 1–100 characters; ISO currency in upper case; amount ≥ 0; provider price id shape; limits ≥ 0 |
| Subscriptions | STRIPE rows have provider customer and subscription ids, MANUAL rows have none; period end > start; `TRIALING` has a trial end; `ended_at` is set exactly for `CANCELED` and `INCOMPLETE_EXPIRED` |
| Payment facts | STRIPE has a provider event id; MANUAL has neither event id nor inbound event; `PAYMENT_FAILED` ⇔ a snake-case failure code; ISO currency; amount ≥ 0; immutable |
| Reservations | Quantity > 0; dotted purpose; expiry after creation; `HELD` unsettled, `COMMITTED` with 0 ≤ used ≤ held, `RELEASED`/`EXPIRED` settled without a quantity |
| Ledger | `USAGE` > 0; `ADJUSTMENT` ≠ 0 with a note and no reservation; immutable |
| Branding | `https://` logo URL without spaces, quotes or angle brackets; `#RRGGBB` colours; footer ≤ 2,000 characters; normalized support address |
| Audit records | Actor shape per type; dotted action; snake-case target type, needed for a target id; reason ≤ 1,000 characters; request id as in `resolveRequestId`; metadata is a JSON object ≤ 8 KB; immutable |
| Notifications | Dotted type; title 1–200 and body ≤ 2,000 characters; `link_path` is an in-app path (no `//`, `\`, scheme or whitespace); read after creation; one notification per recipient and dedupe key |

### D-03C-10: Tests

- **`billing-schema.integration.test.ts`:** fixtures, integrity rules and planned queries.
- **`tenant-access.integration.test.ts`:**
  - **Every tenant-owned model (43)**, through the scoped client: an authorized scope reads
    exactly its own rows. Another tenant's scope cannot read them by id, cannot delete them,
    and cannot create rows for that tenant or query it. Same-tenant creates work; moving a
    row is rejected.
  - **Every relation between tenant rows (58)**, in SQL:
    - authorized: the fixtures use each relation in both tenants;
    - unauthorized: each Beta row is pointed at the matching Alpha row, which exists, so the
      tenant is the only difference; the foreign key rejects every one with 23503.
  - **Entry points, platform-admin auditing, and the audit, notification, usage and billing
    repositories.**
  - **The concurrent-reservation test** runs only on real PostgreSQL (CI). PGlite runs every
    connection in one session, so the test skips itself there, visibly.
- **Unit tests:** `pagination.test.ts` and `tenancy/tenant-db.test.ts` need no database.

### Sources (checked 2026-11-01)

- Stripe Subscription object (statuses, periods on items, `cancel_at_period_end`,
  `canceled_at`, `ended_at`): https://docs.stripe.com/api/subscriptions/object
- Stripe webhooks (duplicates, ordering, signature verification, retries, quick 2xx):
  https://docs.stripe.com/webhooks
- Stripe event types (`invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`,
  `charge.refunded`): https://docs.stripe.com/api/events/types
- Stripe currencies (minor units, lower-case ISO codes, zero-decimal and special cases):
  https://docs.stripe.com/currencies
- Stripe API versions (`2026-10-28.endive` in the examples): https://docs.stripe.com/upgrades
- **Verified locally, not from documentation:** Prisma 7.10.1 query extensions
  (`$allOperations`, interactive transactions keep the extension), and PostgreSQL 18.6
  (PGlite 0.5.13) partial-index predicates. The advisory-lock call runs on PGlite; its effect
  under concurrency is tested only in CI.

---

## 04A: Authentication (2026-11-01)

**Basis.** The task asks to "review the auth decision". Neither the plan nor any earlier entry
here contains one, so this section makes and records it (D-04A-01). If the plan prescribes
something else, reconcile (O-22). Security guidance comes from the OWASP cheat sheets, and
library facts from the npm registry and the libraries' own documentation (Sources below).

### D-04A-01: First-party sessions, with maintained libraries for the security primitives

| Option | Verdict |
|---|---|
| Hosted identity provider (a managed login service) | Not chosen: it would be a major new external service, which `CLAUDE.md` says needs agreement first. Kept as an option (O-22). |
| An auth framework that owns its own user and session tables | Not chosen: it would duplicate `users` and add a second session store (D-03C-01: one table per concept), and tie API authorization to that framework. |
| JWTs kept in browser storage | Rejected: any XSS can read them, and revoking them needs a server-side list anyway. |
| **Opaque session tokens in an HttpOnly cookie, sessions in PostgreSQL** | **Chosen.** Sessions are revocable, timeouts are enforced on the server, and it uses the existing stack. |

Maintained libraries cover the security-critical primitives:

| Need | Library |
|---|---|
| Password hashing | `@node-rs/argon2` 2.2.2 (Argon2id) |
| Per-IP rate limits | `@nestjs/throttler` 6.7.1 |
| Cookie parsing and serialization | `cookie` 2.0.1 |
| Random tokens, SHA-256, HMAC, constant-time comparison | Node's `node:crypto` |

Sessions are platform-scoped: a signed-in user then enters a tenant through `memberScope`
(D-03C-04), unchanged.

### D-04A-02: Data model (platform scope)

| Table | Holds |
|---|---|
| `users.email_verified_at` | When the address was proven (verification link or password reset) |
| `user_credentials` | One Argon2id hash per user |
| `user_sessions` | SHA-256 of the session token; created, last seen, idle and absolute expiry; end time and reason |
| `auth_tokens` | SHA-256 of emailed one-time tokens: purpose, the address they were sent to, expiry, use time |
| `auth_throttles` | Attempt counters per scope and per SHA-256 of a normalized address |

- **Cascades:** deleting a user deletes their credentials, sessions and tokens.
- **Uniqueness:** at most one unused token per user and purpose (`auth_tokens_one_open_key`,
  partial). Token hashes are unique.
- **Hand-written CHECKs** (`20261101000700_user_authentication_checks`):
  - the Argon2id PHC format;
  - SHA-256 hex shapes;
  - session timing (idle end ≤ absolute end), and end time ⇔ end reason;
  - a token is used only between creation and expiry;
  - normalized addresses.
- **Structure test updates:**
  - 10 platform tables;
  - `user_credentials.password_hash` and `password_changed_at` allowed past the
    credential-name scan;
  - the duplicate-name guard now also lists `sessions`, `user_tokens`,
    `email_verification_tokens`, `password_reset_tokens`, `login_attempts` and
    `credentials`.
- **Scoped client:** the new models are platform models, so the tenant-scoped client cannot
  reach them.

### D-04A-03: Passwords

- **Hash:** Argon2id with m=19456 KiB, t=2, p=1, OWASP's minimum configuration.
- **Library:** `@node-rs/argon2` 2.2.2 (napi-rs; published 2026-10-06). It ships prebuilt
  binaries as per-platform optional dependencies and has no install script. `argon2` 0.45.1
  was not chosen: it needs an install script (`node-gyp-build`), which our pnpm build policy
  would have to allow (D-02A-08).
- **Policy (OWASP, without MFA):**
  - 15 to 128 Unicode code points, counted after NFKC normalization;
  - all characters allowed, including spaces and emoji;
  - no composition rules.

  Passwords are NFKC-normalized before hashing and before verifying.
- **Rehash** on sign-in when a stored hash uses weaker settings.
- **Unknown accounts:** the password is verified against a dummy hash, so the work is the same
  whether or not the account exists.
- **Not done yet:** blocking common and breached passwords, which OWASP recommends. It needs a
  provider or a list (O-21).

### D-04A-04: Tokens

- **Generation:** 32 bytes from the CSPRNG, base64url (43 characters, 256 bits).
- **Storage:** only SHA-256 (hex). That is enough for high-entropy random tokens; it is what
  OWASP's session cheat sheet suggests, and it makes lookups possible by an indexed hash.
- **Emailed tokens:**
  - single use (atomically marked used);
  - verification expires after 24 hours, reset and finish-setup after 30 minutes;
  - a new token revokes the previous unused one for the same purpose;
  - each is bound to the address it was sent to, so it fails if the account's address has
    changed.
- **Links** carry the token in the URL fragment: `<WEB_APP_URL>/verify-email#token=…`.
  Fragments never reach servers, access logs or `Referer` headers. The base URL comes from
  configuration, never from the request's `Host` header (OWASP: host header injection).

### D-04A-05: Sessions and the cookie

- **Cookie:** `__Host-lf_session`, `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, no `Domain`,
  no lifetime (OWASP: `__Host-` prefix, non-persistent).
  - `Lax` rather than `Strict`, so a user arriving from an emailed link is still signed in.
    Mutations are protected separately (D-04A-06).
- **Timeouts:**
  - idle 30 minutes, absolute 8 hours (OWASP: 15–30 minutes idle for low-risk applications,
    4–8 hours absolute);
  - enforced on the server;
  - activity is written back at most once a minute.
- **A new session at every sign-in;** a session cookie from the same browser is ended
  (`REPLACED`), which prevents session fixation.
- **How sessions end:** logout (server-side), password reset (all of the user's sessions), a
  disabled user, or expiry. The end time and reason are kept.
- **The web app must serve the API on its own origin** (a proxy route) so the cookie is
  first-party. That wiring comes with the account screens.

### D-04A-06: CSRF protection

- **Synchronizer token** on authenticated mutations, OWASP's primary defense for stateful
  applications:
  - the `x-csrf-token` header must equal `HMAC-SHA256(session token, "lead-fennec-ai:csrf:v1")`;
  - compared in constant time;
  - only the server can compute it, because the session cookie is HttpOnly;
  - it is stable for the session, so several tabs work, and changes with each sign-in;
  - nothing is stored.
- **Fetch Metadata and Origin checks on every `POST`,** including sign-in and registration
  (login CSRF): requests with `Sec-Fetch-Site` other than `same-origin`/`none`, or an
  `Origin` other than `WEB_APP_URL`, are refused. OWASP lists both as defenses.
- **`SameSite=Lax`** is defense in depth.
- **Libraries considered:**
  - `csrf-csrf` implements the signed double-submit cookie, which OWASP recommends for
    stateless applications;
  - `csrf-sync` implements the synchronizer token on top of `express-session`, which this API
    doesn't use.

  The session-bound token is therefore derived with `node:crypto`.

### D-04A-07: No account enumeration

- **Identical answers:** register, resend-verification and password-reset requests always
  answer `202 { status: "accepted" }`.
- **No timing signal:** their account-dependent work (lookup, hashing, tokens, email) runs
  after the response (`AuthTasks`), so neither the content nor the timing depends on the
  account.
- **Sign-in:**
  - wrong password, unknown address and disabled user give the same `401`, each after one full
    Argon2id verification;
  - `403 email_not_verified` only with the correct password.
- **Limits:** locks and email limits apply to unknown addresses exactly as to known ones (the
  key is the address's hash).
- **Validation:** errors describe fields, never values.
- **Durability:** background tasks are in-process and lost if the API stops at that moment;
  the user can simply retry. Moving them to the queue is O-20. Passwords never go to a durable
  queue.

### D-04A-08: Account pre-hijacking

**Risk:** someone registers another person's address with their own password. If the owner
later confirms the address, the first registrant knows the password.

**Defense:** when an address with an unverified account is registered again:
- its outstanding confirmation links are revoked;
- the inbox owner gets a "finish setup" link (a password-reset token) to choose the password;
- using that link sets the password, verifies the address and ends every session.

**Residual risk:** the owner can still confirm a stranger's first registration with its
original link before anyone registers again. Every account email says to ignore it if you
didn't ask for it. Expiring unverified accounts is O-21.

### D-04A-09: Repeated attempts

| Limit | Rule | Where |
|---|---|---|
| Sign-in failures per address | 5 in 15 minutes, then locked for 15 minutes (`429` with `Retry-After`, even with the right password). A successful sign-in or a password reset clears it. | `auth_throttles` (scope `LOGIN`) |
| Account emails per address | 3 verification or "already registered" emails, and 3 reset emails, per hour. Requests still answer `202`. | `auth_throttles` |
| Requests per client IP | 20 per minute to each auth `POST` route | `@nestjs/throttler`, in memory |

- **Concurrent attempts:** counters use optimistic updates (read, compare-and-set, retry), so
  each attempt is counted once.
- **Per-IP limits are per API instance.** Behind a proxy, Express must be told to trust it, or
  every user shares the proxy's IP. Both are O-20.
- **Not done:** CAPTCHA and MFA (O-21).

### D-04A-10: Secrets never reach logs or clients

- **Redaction:** new log paths `x-csrf-token` (header), `newPassword`, `passwordHash`,
  `csrfToken` and `sessionToken`, on top of the existing cookie, `set-cookie`, `password`
  and `token`.
- **Tested:** the API suite collects every password, link token, session token and CSRF token
  it sees, and fails if any appears in a captured log line.
- **Bodies that aren't JSON:** Nest would answer with the parser's message, which can quote
  the body. A global `RequestErrorFilter` answers `400 validation_failed` with a fixed
  message instead.
- **Mail:** bodies are never logged; logs name the template only. The fake keeps messages in
  memory.
- **Tokens never in bodies:** the session token is only in `Set-Cookie`, and link tokens only
  in emails.

### D-04A-11: Transactional mail adapter

- **New interface:** `TransactionalMailProvider` (`send({ to, subject, textBody, template })`)
  in `@lead-fennec-ai/integrations`, with `FakeTransactionalMailProvider`, which records and
  never sends.
- **Development and test** use the fake.
- **Staging and production** ask for the live adapter, which doesn't exist yet, so the API
  refuses to start there instead of silently dropping account email (O-19).

### D-04A-12: Contract and tests

- **Contract:** `packages/shared/src/contracts/auth.ts` (zod, web-safe): routes, request and
  response schemas, error codes, cookie and header names, password policy.
  `docs/api/auth.md` describes the flows.
- **Tests:**
  - `apps/api/src/auth/auth.integration.test.ts` (25): every flow over HTTP on real PostgreSQL,
    with a controllable clock and the fake mail. Every response is parsed against the
    contract.
  - `auth-units.test.ts` (12): tokens, Argon2id, cookie attributes, `WEB_APP_URL` rules.
  - `packages/database/src/auth-schema.integration.test.ts`: CHECKs, cascades and the store's
    throttle and token rules.
  - Contract tests in `packages/shared`.
- **Shared test harness:** it is now built and published as `@lead-fennec-ai/database/testing`
  so the API's tests can use it. The main entry point never imports it. This supersedes
  "excluded from the build" in D-03B-12.

### D-04A-13: Not in 04A

- **The account screens:** built next, on this contract, together with serving the API on
  the web origin.
- **Tenant creation and invitations:** registering creates a user only, with no tenant or
  membership.
- MFA, email change, account deletion, a session list, and a development inbox (O-19, O-21).

### Sources (checked 2026-11-01)

- **OWASP cheat sheets:**
  - Password Storage: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
  - Authentication: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
  - Forgot Password: https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html
  - Session Management: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
  - CSRF Prevention: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- **npm registry metadata:**
  - `@node-rs/argon2` 2.2.2 (no install script, per-platform optional binaries);
  - `argon2` 0.45.1 (install script `node-gyp-build`);
  - `@nestjs/throttler` 6.7.1 (published 2026-09-24; peer range includes NestJS 12);
  - `cookie` 2.0.1 (published 2026-06-30);
  - `csrf-csrf` 4.1.0 and `csrf-sync` 4.2.1 (considered, not used).
- **The `cookie` README:** `parseCookie` and `stringifySetCookie`
  (https://github.com/jshttp/cookie).
- **Verified locally, not from documentation:**
  - `@node-rs/argon2`'s types and defaults;
  - `@nestjs/throttler`'s `Retry-After` header (no suffix for the `default` throttler);
  - Nest's mapping of body-parser errors to `BadRequestException`, which reaches global
    filters only.

---

## 04B: Workspaces, invitations, role-based authorization, worker context (2026-11-01)

**Basis.** The plan is still missing. This builds on 03C's tenant scopes and 04A's sessions.
"Workspace" is the product name for a tenant.

### D-04B-01: Workspace creation

- **Who:** any signed-in user with an `ACTIVE`, verified account (`POST /workspaces`).
- **One transaction:**
  - syncs the permission catalog;
  - creates the tenant, its settings and the two system roles with their grants;
  - makes the creator an `ACTIVE` Client Admin;
  - writes `workspace.created` to the new workspace's audit records.
- **Slugs** are unique across the platform. Without one, the slug is derived from the name with
  6 random hex characters (`acme-sales-3f9a1c`), so names don't collide and slugs don't reveal
  which names exist. A requested slug that is taken: `409 slug_taken`.
- **Not limited yet:** how many workspaces one user may create (O-23).

### D-04B-02: One permission catalog

- **The source:** `PERMISSION_CATALOG` and `SYSTEM_ROLES` in `@lead-fennec-ai/shared`
  (`authorization.ts`), pure data the web app can also use. New: `members.read`.
- **The `permissions` table** is synced from it (insert-only, idempotent) when a workspace is
  created.
- **Fixtures** use the same catalog and roles.
- **Resolves O-11:** the catalog is created at workspace creation, from code, not by a data
  migration.
- **Not decided:** custom roles per workspace (O-23).

### D-04B-03: Invitations

- **One table, one source of truth:** `invitations` (tenant-owned) holds pending invitations.
  A membership exists only once an invitation is accepted, so the `INVITED` membership status
  was removed (it would have been a second record of the same thing):
  - `20261101000800_retire_invited_memberships` first turns existing `INVITED` memberships into
    `SUSPENDED` (neither grants access);
  - the generated migration then rebuilds the enum. Its `"public".` schema qualifiers were
    removed by hand, so it also applies inside per-test schemas.
  - Tested by migrating a schema with an `INVITED` row.
- **Bound to the workspace and the identity:**
  - the row's `tenant_id` and the invited `normalized_email` (`normalizeEmail`);
  - the binding, the role, the token and the expiry can't change after insert (trigger
    `invitations_binding_immutable`, 23000);
  - acceptance requires the signed-in user's own address to match, and the workspace id the
    user confirmed to be the invitation's.
- **Expiry and single use:**
  - 7 days;
  - accepted or revoked at most once (CHECK: never both; accepted ⇔ membership id; accepted
    before it expires);
  - an update guarded by "still open" makes concurrent acceptances fail cleanly;
  - one open invitation per address and workspace (partial unique). Inviting again revokes
    the earlier one.
- **Token:** 256 bits, the link fragment, SHA-256 at rest (as in D-04A-04). It is unique across
  the platform because the link is resolved before the workspace is known.
- **What the invitee learns:**
  - only the invited, signed-in address can preview the invitation;
  - unknown, used, revoked and expired invitations look the same;
  - a user with another address learns nothing about the workspace.
- **Accepting** creates the membership with the invited role, or reactivates a `SUSPENDED` one,
  and writes `invitation.accepted` (actor: the new member).
- **Limits:**
  - inviting an active member gives `409 already_member`;
  - at most 100 invitation emails per workspace and day (`auth_throttles` scope
    `INVITATION_EMAIL`, keyed by the workspace id's hash).

### D-04B-04: Role-based authorization and record ids

| Layer | Check |
|---|---|
| Session | The acting user always comes from the session (04A). No route accepts a user id. |
| `WorkspaceGuard` | `:workspaceId` must be a workspace where that user has an `ACTIVE` membership and that is `ACTIVE` (`memberScope`). Otherwise `404 not_found`, the same for every reason. |
| `PermissionGuard` (`@RequirePermissions`) | The member's role grants the route's permissions, else `403 forbidden`. |
| Repositories (`members`, `invitations`) | Check the same permissions again (`requirePermission` / `requireReadPermission`), so a route without the decorator still can't bypass them. |
| Record ids | Membership, role and invitation ids are looked up with the workspace's `tenant_id`, so another workspace's id is `404`. |

- **Last admin:** a workspace always keeps at least one active Client Admin
  (`409 last_admin`). Role changes take a per-workspace advisory lock, so two admins can't
  demote each other at the same moment.
- **Platform admins** can read the team only through their audited, read-only scope; they
  can't change it. Workers can't use the team repositories.
- **Not implemented:** suspending or removing a member. Memberships with approvals can't be
  deleted (O-12), and suspension is O-23.

### D-04B-05: Worker authorization context

- **The message:** a queue message carries only `{ v: 1, taskId }` (`jobEnvelopeSchema`, strict).
  Any other field, such as a tenant id, makes it `malformed`.
- **`claimJob(prisma, worker, message)`:**
  1. loads the `job_tasks` row by id (`job_tasks.id` is now also unique on its own) and takes
     the tenant from the row;
  2. checks the task type is one the worker handles (`defineWorker({ name, taskTypes })`);
  3. checks the workspace is `ACTIVE`;
  4. claims the task: `PENDING`, due and with attempts left, by updating exactly the version
     it read.
- **What it returns:** the task, and a tenant scope for the task's workspace acting as the
  worker (system actor). Record ids in the payload are looked up through that scope, so an id
  from another workspace is not found.
- **Rejections:** `malformed`, `unknown_task`, `wrong_worker`, `workspace_inactive`,
  `not_claimable`.
- **Settling:** `complete()` marks the task `SUCCEEDED`. `fail({ errorCode, retryAt? })` retries
  while attempts remain, otherwise marks it `FAILED`.
- **`enqueueJob(scope, …)`** creates the task (idempotent by key) and returns the envelope.
  It is not allowed from a read-only platform-admin scope.
- **`systemScope` stays** for schedulers that iterate `tenants` (D-03B-02); jobs use `claimJob`.
- **Not done:** wiring BullMQ in the worker app (O-20).

### D-04B-06: Platform-admin operations stay explicit and audited

- **Routes:** only under `/platform/*`. The admin is the session's user, re-checked on every
  request (`is_platform_admin`, `ACTIVE`).
- **Reason:** required, 10–500 characters: the `x-access-reason` header on `GET`, the body on
  `POST`.
- **What gets recorded:**

  | Action | Recorded |
  |---|---|
  | Listing workspaces | `platform_admin.console_opened` |
  | Opening one workspace (read-only) | `platform_admin.access_opened` in that workspace |
  | Suspending or reactivating | `tenant.status_changed` with before and after, the reason and the request id, in `platform_audit_records`, which outlive the workspace |
  | Every refusal | `platform_admin.access_denied` |

- **No implicit access:** a platform admin gets `404` on member routes like anyone else.

### D-04B-07: One error envelope for every route

- **Contract:** `apiErrorResponseSchema` (`@lead-fennec-ai/shared`) combines the auth codes with
  `not_found`, `forbidden`, `already_member`, `last_admin`, `slug_taken` and three invitation
  codes.
- **Mapping:** `ApiExceptionFilter` (`apps/api/src/http/api-errors.ts`) turns the database
  layer's errors into it:

  | Error | Answer |
  |---|---|
  | `PermissionDeniedError`, `ActorNotAllowedError` | `403` |
  | `RecordNotFoundError`, `TenantAccessDeniedError` | `404` |
  | `LastAdminError`, `AlreadyMemberError`, `SlugTakenError` | `409` |
  | `InvitationError` | by reason |
  | `ZodError` | `400` |

  Anything else stays a generic `500`.

### D-04B-08: Tests and two findings

- **Tests:**
  - `packages/database/src/workspaces.integration.test.ts` (19): creation, roles and
    permissions, record ids from another workspace, invitations (identity, workspace, expiry,
    single use, replacement, revocation, reactivation, suspended workspace, SQL rules),
    platform status changes, the worker context, and the `INVITED` migration;
  - `apps/api/src/workspaces/workspaces.integration.test.ts` (11): every route over HTTP with
    two workspaces and all three roles;
  - the catalog tests now count 44 tenant tables and 61 relations.
- **Finding 1, PGlite and parallel test files:** two database-backed test files in one package
  collided on PGlite's single session (`relation "tenants" does not exist`). The API package
  now runs its test files one at a time, like the database package. Locally, packages run with
  `--concurrency=1`.
- **Finding 2, Prisma and `pg` 9:** Prisma's `adapter-pg` 7.10.1 issues concurrent queries on
  one transaction connection (nested selects). `pg` 8.23 warns that `pg` 9 will reject this.
  Recorded in O-14.

---

## 04C: Account and team screens, security audit events, authorization review (2026-11-01)

**Basis.** The plan is still missing (O-01). The screens use the 04A and 04B API contracts
unchanged, except for plain-language validation messages (D-04C-09).

### D-04C-01: Screens

| Path | Screen |
|---|---|
| `/login` | Sign in; unconfirmed accounts can request the link again; `?next=` returns to the page that needed a session |
| `/register` | Create an account (name optional, password twice); the same "check your inbox" answer for any address |
| `/verify-email` | Opened from the email: confirming takes a click (D-04C-07) |
| `/forgot-password`, `/reset-password` | Request a link; choose a new password (every session ends) |
| `/workspaces` | The user's workspaces; create one |
| `/workspaces/[workspaceId]` | Overview: role and permissions. The layout has the workspace switcher and the navigation. |
| `/workspaces/[workspaceId]/team` | Members (role changes), open invitations (revoke), invite form. Members without `members.manage` see the team read-only. |
| `/invitations/accept` | Opened from the invitation email: sign in, preview, join |
| `/platform` | Platform-admin console: reason, workspace list, member count, suspend and reactivate |

- **Rendering:** client components that call the API through `/api` (D-04C-05). The API
  decides everything; the screens only hide controls the role can't use.
- **Validation:** forms check input with the shared zod schemas before sending, and show the
  API's `validation_failed` issues per field. Every response is parsed with its shared schema
  before use; anything else is a generic error.
- **States:** loading, unavailable (with retry), field errors, expired or used links, expired
  sessions (back to sign-in, then to the page), unknown or foreign workspaces ("Workspace not
  found", the same for every reason), and "Platform admins only".
- **Not built:** removing or suspending members (O-23), workspace settings, profile pages.

### D-04C-02: UI stack: Tailwind CSS 4 and shadcn/ui components as source

| Package | Version | Use |
|---|---|---|
| `tailwindcss`, `@tailwindcss/postcss` | 4.3.3 | Styles (dev dependencies; build time only) |
| `postcss` | 8.5.32 | Required by the Tailwind PostCSS plugin |
| `class-variance-authority` | 0.7.1 | Component variants |
| `clsx`, `tailwind-merge` | 2.1.1, 3.7.0 | `cn()` class merging |

- **Docs checked 2026-11-01:**
  - Tailwind with Next.js: <https://tailwindcss.com/docs/installation/framework-guides/nextjs>
    (`postcss.config.mjs` with `@tailwindcss/postcss`, `@import "tailwindcss"`);
  - shadcn/ui manual installation:
    <https://ui.shadcn.com/docs/installation/manual> (CSS-variable tokens, `@theme inline`,
    `components.json`, `cn()`).
- **Components** (`apps/web/components/ui`: button, input, label, native select, card, alert,
  badge, table) are written as source in the shadcn/ui style, with the neutral tokens in
  `app/globals.css`. They use native elements, so no Radix or Base UI package is needed yet.
  `components.json` is there, so the shadcn CLI can add components later.
- **Two deliberate differences from the current manual-install page:**
  1. It now uses the `cn` package (0.x, first published by shadcn in September 2026). We keep
     the long-established `clsx` + `tailwind-merge` that `cn` replaces; revisit when `cn` is
     stable.
  2. It installs the `shadcn` package (the CLI, with a large dependency tree) at runtime for
     one stylesheet. Not installed; the tokens are in `globals.css`.

### D-04C-03: Security events in the audit records

- **Where:** a user's own account events are platform-level (no workspace), so they go to
  `platform_audit_records`. Membership changes stay in each workspace's `audit_records`
  (04B: `workspace.created`, `invitation.created`, `invitation.revoked`, `invitation.accepted`,
  `membership.role_changed`).
- **New actor `USER`** (`audit_actor_type`): the user acting on their own account, named by
  `actor_user_id`. `20261101001100_user_audit_actor` adds the value (generated);
  `20261101001200_user_audit_actor_checks` (hand-written) allows it in platform records only,
  and turns both actor CHECKs into explicit lists (`ELSE false`).
- **Events** (`AuthStore.recordSecurityEvent`, called by `AuthService`):

  | Action | Actor | Target | Metadata |
  |---|---|---|---|
  | `user.registered` | USER | user | — |
  | `user.registration_repeated` | SYSTEM `auth` | user | `{ verified }` |
  | `user.email_verified` | USER | user | — |
  | `user.sign_in_failed` | SYSTEM `auth` | user | `{ reason: wrong_password \| account_inactive \| email_not_verified }` |
  | `user.sign_in_locked` | SYSTEM `auth` | user | `{ lockedSeconds }` |
  | `user.signed_in`, `user.signed_out` | USER | `user_session` | — |
  | `user.password_reset_requested` | SYSTEM `auth` | user | — |
  | `user.password_reset` | USER | user | — |

- **Rules:**
  - recorded only for existing accounts (an unknown address has no user to name);
  - never a token, password, CSRF token, session token or email address; metadata is reason
    codes and numbers;
  - the request id (`X-Request-Id`) is kept, so a record can be matched with the logs;
  - a request that can't write its record fails (the record and the action belong together).
- **Tested:** the API suite checks every event, its actor, target and request id, and searches
  the stored records for every secret the tests saw; the browser scenarios do the same for the
  whole run.

### D-04C-04: Authorization review

Every route and every repository function was reviewed:
**[docs/security/authorization-review.md](security/authorization-review.md)**.

- **Three gaps in 03C repositories, fixed:**

  | Function | Was | Now |
  |---|---|---|
  | `audit.list` | Any actor in the scope | `audit.read` (members), or a platform admin's audited scope |
  | `billing.currentSubscription`, `billing.effectiveLimits`, `usage.summary` | Any actor | `billing.read` (members), the system actor, or a platform admin's scope (`requireReadPermissionOrSystem`) |
  | `notifications.notify` | Members and the system actor | The system actor only: members could have written arbitrary messages to each other |

  No route used them yet. The tenant-access suite now checks them with a Client Team Member's
  scope.
- **Route guard test** (`apps/api/src/http/route-guards.test.ts`): reads the guards of every
  route the API registers, and fails if
  - a route is missing from the reviewed list (24 routes);
  - a route other than the 8 public ones lacks `SessionGuard`;
  - a state-changing route lacks `OriginGuard`, or `CsrfGuard` when it has a session;
  - a route outside the health probes lacks `ThrottlerGuard`;
  - a `/workspaces/:workspaceId` route lacks `WorkspaceGuard`, or (except the workspace itself)
    `PermissionGuard` with known permission keys, in that order;
  - a `/platform/*` route uses membership guards.
- **Known limit:** `scope.db` (03C) can read and write every tenant table for any member; only
  the repositories check permissions. New routes must use the repositories, or check
  permissions themselves (`requirePermission`).

### D-04C-05: The browser calls the API through the web app

- **`/api/[...path]`** (`apps/web/lib/api-proxy.ts`), a Next.js route handler, forwards to
  `API_BASE_URL` at request time:
  - only the API roots `auth`, `workspaces`, `invitations` and `platform`, and safe path
    segments; anything else is `404` without reaching the API;
  - `GET`, `POST`, `PATCH`, `DELETE`; bodies up to 64 KiB; 15-second timeout; no redirects
    followed;
  - request headers: content type, origin, `sec-fetch-site`, user agent, `x-forwarded-for`,
    `x-request-id`, the CSRF and access-reason headers, and **only the session cookie**;
  - response headers: content type, cache control, `retry-after`, `x-request-id`, and
    `set-cookie`;
  - if the API can't be reached: `502` without details.
- **Why:**
  - the session cookie (`__Host-`, HttpOnly) stays first-party to the web origin, with no CORS;
  - `API_BASE_URL` stays server-side;
  - the API's own checks (origin, CSRF, session) apply unchanged, because the browser's origin
    and Fetch Metadata headers are forwarded.

### D-04C-06: Client addresses and connections

- **`TRUST_PROXY_HOPS`** (API, 0–5, default 0) sets Express `trust proxy`. With the web proxy
  in front, every browser request reached the API from the web server's address, so the per-IP
  limits would have counted all users together. Local development and the browser tests use 1.
  A deployment counts its load balancer too, and the outermost proxy must overwrite
  `X-Forwarded-For` (O-20).
- **`DATABASE_POOL_MAX`** (API, 1–100, default 10): the browser tests use 1, so they can run on
  PGlite locally.

### D-04C-07: Tokens and redirects in the browser

- **CSRF token:** kept in React state only (from `GET /auth/session`), never in storage, URLs or
  logs.
- **Emailed links:**
  - the page reads `#token=` and removes the fragment from the address bar at once;
  - a new link opened in the same tab (a fragment-only navigation) is read too;
  - confirming an email address needs a click, so link scanners that open pages don't use up
    the link;
  - the invitation token is kept in `sessionStorage` (this tab only) while the user signs in,
    and removed once the invitation is accepted or unusable.
- **`?next=` after sign-in** accepts only paths inside the app (`/…`); absolute URLs, `//host`,
  backslashes and control characters fall back to `/workspaces`.

### D-04C-08: Browser scenarios against the real API

- **`apps/web/e2e/accounts-and-teams.spec.ts`** (11 scenarios, serial): two workspaces and the
  three roles. Registration with validation, confirmation, sign-in, creating a workspace,
  inviting, revoking, accepting (signed out first, and with the wrong account), single use,
  expired and revoked invitations, the switcher, unknown and foreign workspaces, role changes
  and the last-admin rule, a member refused by the screens and by the API, the platform
  console (reason, suspend, reactivate, no member access), password reset ending other
  sessions, sign-out, safe redirects, and the audit records (expected actions, no secrets).
- **Setup:**
  - runs only with `E2E_DATABASE_URL` (a `*_test` database; `assertTestDatabaseUrl`),
    otherwise the 11 scenarios show as skipped and only the smoke test runs;
  - global setup applies the migrations (`prisma migrate deploy`);
  - Playwright starts the built API (`apps/api/dist`, test mode: fake mail, nothing sent) on
    port 3101, and the web app on 3100;
  - mail stays inside the API, so the scenarios stand in for the inbox: they replace the token
    the API issued with one they know, stored as the API stores it (SHA-256);
  - CI runs them on the job's PostgreSQL (`public` schema of `leadfennec_test`; the other
    suites use their own schemas). `test:e2e` now also builds the API.

### D-04C-09: Validation messages

The shared contracts now carry plain-language messages ("Enter an email address.", "Use at
least 15 characters.", "State the reason in at least 10 characters."). The rules are unchanged;
the API returns the same messages in `validation_failed` issues. They never echo the input.

---

## 05A: App shell, navigation and route shells (2026-11-02)

**Basis.** The plan is still missing (O-01), so "all pages listed in the source" could not be
read. The page list comes from the 05A prompt (leads, campaigns, approvals, inbox,
automations, integrations, analytics, billing, admin), the data model (03A–03C) and the
permission catalog (04B). It must be checked against the plan (O-25).

### D-05A-01: The shell

| Part | What it does |
|---|---|
| Sidebar (≥ 1024 px) | The app name, the workspace selector and the navigation, sticky |
| Top bar | The menu button (narrow screens), breadcrumbs, the Admin link (platform admins), the user's name and Sign out |
| Narrow screens | The same selector and navigation in a native modal `<dialog>`: focus stays inside, Escape and the backdrop close it, choosing a link closes it, focus returns to the menu button |
| Main | `<main id="main" tabindex="-1">`, the target of a "Skip to content" link that is the first focusable element of every page |
| Shells | `WorkspaceShell` (a workspace's pages), `AdminShell` (`/admin`), `HomeShell` (the workspace list, and pages the user can't open) |

- **Typography** (`components/ui/typography.tsx`): `PageHeader` (the page's only h1, with an
  optional badge and actions), `SectionHeading` (h2), `Muted`. Base styles balance headings and
  respect reduced motion.
- **Controls:** shadcn/ui-style source components as in D-04C-02, plus `Breadcrumb`. The
  workspace selector stays a native `<select>` (keyboard and screen-reader support built in).
  Navigation links have `aria-current="page"`; landmarks are labelled ("Workspace pages",
  "Admin pages", "Breadcrumb").
- **Icons:** `lucide-react` 1.66.0 (ISC), the shadcn/ui icon set; decorative only
  (`aria-hidden`).

### D-05A-02: One list of pages

`packages/shared/src/navigation.ts` (`WORKSPACE_SECTIONS`, `ADMIN_SECTIONS`) is the only list.
Each section has a path, a group, a label, a description, the permission it needs, its status
(`available` or `unavailable`), and the first path segments of its API routes.

| Group | Sections (permission) |
|---|---|
| Workspace | Overview (any member) |
| Prospecting | Ideal customers (`icps.read`), Leads (`contacts.read`), Lead lists (`lead_lists.read`), Imports (`imports.create`) |
| Outreach | Campaigns (`campaigns.read`), Approvals (`drafts.approve`), Inbox (`campaigns.read`), Automations (`campaigns.write`) |
| Insights | Analytics (`campaigns.read`) |
| Settings | Team (`members.read`), Integrations (`settings.manage`), Mailboxes (`email_accounts.manage`), Do-not-contact list (`suppressions.manage`), Billing (`billing.read`), Audit log (`audit.read`), Workspace settings (`settings.manage`) |
| Admin (`/admin`, platform admins) | Workspaces (the 04C console), Users, Plans, Platform audit log |

- **Built:** Overview, Team, and the admin Workspaces console. Everything else is a route
  shell: it says "Not available yet", explains what it will do, and shows its main action
  disabled. One dynamic route (`/workspaces/[workspaceId]/[section]`, `/admin/[section]`)
  serves every shell; a built page gets its own folder, which takes precedence.
- **Inbox, Automations, Analytics and Integrations** reuse existing permissions
  (`campaigns.read`, `campaigns.write`, `campaigns.read`, `settings.manage`) instead of
  adding new keys: workspaces get their grants when they are created, so a new key would need
  a migration for existing roles (O-25).
- **Navigation:** a member sees only the sections their permissions open (helpers
  `workspaceNavigation`, `canOpenSection`); not-yet-built sections stay visible, marked
  "Soon" (and "not available yet" for screen readers). Breadcrumbs: Workspaces › workspace ›
  page; Admin › page.
- **The console moved** from `/platform` to `/admin`; `/platform` redirects (308).

### D-05A-03: Hiding and refusing agree: navigation, web server and API

| Layer | Check |
|---|---|
| Navigation (browser) | Shows only the sections the member's permissions open, and the Admin link only to platform admins. Convenience, not protection. |
| Web server (every page, every request) | `lib/server/access.ts`: signed out → `307` to sign-in (and back); not an active member of an active workspace (or no such page) → `404`; no permission → "You don't have access" (no page content rendered); admin pages → platform admins only. |
| API (every data request) | `WorkspaceGuard`, `PermissionGuard` and the repositories, as before (D-04B-04). The route test now requires every `/workspaces/:workspaceId/<resource>` route to belong to a section, and every GET route to need that section's permission. |

- **How the web server checks:** server components call the API with the request's session
  cookie, nothing else (`lib/server/api.ts`), and validate the answers with the shared
  schemas. React `cache` makes it one request per page view. The layout only fetches what the
  shell shows: layouts don't re-render on navigation (Next.js authentication guide, checked
  2026-11-02 in the docs bundled with `next` 16.4.3), so each page runs the check itself.
- **Access denied renders with status 200:** Next.js's `forbidden()` is still experimental
  (`authInterrupts`). The page is rendered on the server without the section's content; the
  browser test checks the raw HTML.
- **What reaches the browser:** server pages pass only the user's id, email, name and
  platform-admin flag (`shellUser`). The CSRF token still comes only from the browser's own
  `GET /auth/session` (D-04C-07).
- **Session contract:** `GET /auth/session` and `POST /auth/login` now return
  `user.platformAdmin`. It only decides whether the Admin link is shown; every `/platform`
  route checks it again.

### D-05A-04: Tests

- **Shared** (`navigation.test.ts`, 9): unique keys, paths and API resources; catalog
  permissions; the prompt's pages present; navigation for each role; paths; breadcrumbs.
- **API:** the session reports `platformAdmin` (2 assertions); the route test's section rule
  (`route-guards.test.ts`, now 7 tests).
- **Browser** (`e2e/app-shell.spec.ts`, 7 scenarios):
  - every section in the admin's navigation, grouped, unbuilt ones marked;
  - every route shell, with its action disabled;
  - the member's narrower navigation, each hidden section refused by the server (also in the
    raw HTML), the API refusing a role change, and real 404s;
  - signed-out requests redirected by the server (`307`);
  - the skip link;
  - the dialog on a 390-pixel screen;
  - the selector keeping the page;
  - the admin area for platform admins only.
- **Automated accessibility checks:** `@axe-core/playwright` 4.14.0 (MPL-2.0, test-only)
  checks the overview, a route shell, the team page, the narrow-screen dialog and the admin
  console against WCAG 2.0, 2.1 and 2.2 A/AA rules: no violations. Axe finds only part of the
  problems; a manual check with a screen reader hasn't been done (O-25).
- **Fixed in the 04C scenarios:** the unconfirmed sign-in step could run before the
  asynchronous registration had created the account (registration answers first, D-04A-02); it
  now waits for the account.

---

## 05B: Shared UI components, typed API client, workspace-scoped cache (2026-11-02)

**Basis.** The plan is still missing (O-01); this follows the 05B prompt and reuses the 04A–05A
contracts, screens and tests.

### D-05B-01: One list of API endpoints

`packages/shared/src/contracts/endpoints.ts` (`API`, `ALL_ENDPOINTS`) describes all 24 routes.

| Field | Meaning |
|---|---|
| `id` | Unique; the OpenAPI `operationId` (e.g. `members.list`) |
| `method`, `path` | Nest-style path, e.g. `/workspaces/:workspaceId/members` |
| `access` | `public`, `session`, `workspace` (active member) or `platform_admin` |
| `permission` | The role permission a workspace route requires |
| `params`, `query`, `headers`, `body`, `response` | The existing contract schemas (`auth.ts`, `workspaces.ts`), not copies |
| `status`, `errors` | Success status; error codes specific to the route (generic ones follow from its shape) |
| `cache`, `invalidates` | The cached resource a read fills; the resources a mutation makes stale (D-05B-03) |

Helpers: `buildEndpointRequest` validates the input and builds the path (encoded parameters,
sorted query). Also `endpointErrorCodes`, `needsCsrfToken` and `API_ERROR_STATUS`.

### D-05B-02: The OpenAPI document is generated; the API is tested against the list

- **Generated, not written by hand.** The controllers validate with zod pipes, not
  class-validator DTOs. `@nestjs/swagger` would therefore need a second, decorator-based
  description of every body. Instead, the document comes from the same zod schemas via zod
  4.6.7's `z.toJSONSchema` (JSON Schema 2020-12, `unrepresentable: 'throw'`). No new
  dependency.
- **Version: OpenAPI 3.1.2** (published 2025-09-19; checked 2026-11-02 at
  https://spec.openapis.org/oas/). 3.2.1 exists, but 3.1 has wider tool support and nothing
  here needs 3.2.
- **The document:** `docs/api/openapi.json`, written by `pnpm openapi`. A test in the shared
  package fails when the file is out of date.
  - Security schemes: `sessionCookie` (apiKey in the `__Host-lf_session` cookie) and
    `csrfToken` (apiKey in the `x-csrf-token` header). Both are required on authenticated
    mutations.
  - Extensions: `x-access`, `x-permission`, `x-cache`, `x-invalidates` and `x-error-codes`.
- **API contract test** (`apps/api/src/http/api-contract.test.ts`). It checks that:
  - the registered routes are exactly the list's;
  - the guards match `access` (session, workspace, permission, CSRF on mutations), and the
    permission is the same;
  - the success status is the route's `@HttpCode` (or Nest's default);
  - the `ZodPipe` on `@Body()` and `@Query()` holds the **same schema object** as the list
    (`ZodPipe.schema` is now public).
- **Shared route discovery:** `apps/api/src/testing/registered-routes.ts`, used by this test
  and by `route-guards.test.ts`.
- **Proxy:** a web unit test checks that the `/api` proxy forwards every listed endpoint except
  the health probes.
- **Limits:**
  - Response bodies aren't compared statically. The web client validates every response, and
    the API integration suites parse responses with the shared schemas.
  - Refinements, such as password length counted in code points, can't be expressed in JSON
    Schema.
  - The document is checked by structural tests only; no external OpenAPI validator has run
    (O-26).

### D-05B-03: Typed client, authenticated requests, cache scoped by workspace

- **Browser client** (`apps/web/lib/api.ts`): `callApi(API.members.list, { params, query },
  { csrfToken })`. Its input and result types come from the list.
  - Input is validated before sending. Invalid input becomes `validation_failed` with field
    issues, and nothing is sent.
  - The CSRF token is attached where the endpoint needs it; without a token the call is
    refused before sending.
  - Every response is validated against the endpoint's schema. Anything off-contract becomes
    `unexpected_response`.
  - `apiRequest` and `apiCommand` are gone: every screen calls through the list.
- **Server pages:** `serverApiGet(endpoint, input)` (`lib/server/api.ts`) works the same way.
  It allows GET only, sends the session cookie only, and never caches.
- **Cache** (`lib/query-cache.ts`, pure; `lib/query.tsx`, React):
  - Keys are canonical JSON of `[userId, scope, workspaceId, resource, endpointId, path]`.
    The workspace id is taken from the validated request path, so it can't be left out. A
    resource has a fixed scope (`CACHE_RESOURCES`: `workspaces` is per user, the rest per
    workspace).
  - Invalidation names a user, a scope and resources, and matches each entry's stored fields,
    never key prefixes.
  - Signing out or another user clears everything. An answer that arrives after the clear is
    discarded. One that was in flight during an invalidation is kept as stale and reloads.
  - Memory only, per browser tab; at most 200 entries nobody watches. Never persisted.
  - A screen that mounts shows cached data and reloads it in the background; data made stale
    while it is open reloads at once.
  - Not cached: the session (it holds the CSRF token), platform-admin reads (each one is an
    audited access) and mutations.
- **Hooks:**
  - `useApiQuery(endpoint, input)`: loading, error, success, `refreshing` and `retry`.
  - `useApiMutation(endpoint)`: sends the session's CSRF token and returns a result instead of
    throwing. On success it invalidates the endpoint's `invalidates` in the workspace of the
    request's own path.
  - A 401 from either sends the user to sign in.
- **Why not TanStack Query:** the safety properties above (user and workspace in every key,
  invalidation by stored scope, discarding answers after sign-out) are the point. Here they
  are about 250 lines with unit tests and no new runtime dependency. The hooks can be moved
  onto a library later without changing screens.
- **The server caches nothing across requests:** React `cache` lasts one request, and every
  fetch is `no-store` (D-05A-03).

### D-05B-04: Shared components

| Component | File | Behaviour |
|---|---|---|
| `DataTable` | `components/data/data-table.tsx` | Caption; row headers; placeholder rows with an announced "Loading…"; empty state; retry state (keeps rows it already had); a named, focusable scroll region for narrow screens |
| `CursorPagination` | `components/data/pagination.tsx` | Previous and Next over the API's keyset pages: `useCursorTrail` keeps the cursors of earlier pages and starts over when the view changes. Page number and page size; no totals (the API has none). |
| `ListFilters`, `SearchField`, `FilterSelect` | `components/data/list-filters.tsx` | A labelled search landmark. The search applies after a 300 ms pause, or at once on Enter. "Clear filters" appears only while something is filtered. |
| `useListParams` | `lib/use-list-params.ts`, `lib/list-params.ts` | The search, filters and page size live in the address bar. Each value is validated, and an invalid one falls back to its default (the address is untrusted input). |
| `StatusLabel`, `Status` | `components/data/status-label.tsx` | The status in words plus a coloured dot; the colour only repeats the text. New `--warning` and `--info` colour tokens, used for the dots only. |
| `FormField`, `SelectField`, `TextareaField`, `FormError`, `SubmitButton`, `useFormSubmit` | `components/form-field.tsx`, `lib/use-form-submit.ts` | Validation with the shared schema first. The API's field issues show on their fields; chosen error codes can map to a field; anything else shows above the form. |
| `Dialog` | `components/ui/dialog.tsx` | Native modal `<dialog>`: focus stays inside, Escape closes it, focus returns afterwards, and text styles don't leak in from a table cell |
| `ConfirmDialog`, `ConfirmButton` | `components/feedback/confirm.tsx` | `alertdialog` with Cancel focused first. It can't be dismissed while the action runs; a failure shows inside it; optionally the user must type a word to confirm. |
| `EmptyState`, `RetryState` | `components/feedback/` | Retry shows only the API's own message, otherwise a generic text |
| Error boundaries | `app/error.tsx`, `app/global-error.tsx`, `app/workspaces/[workspaceId]/error.tsx`, `app/admin/error.tsx`; `components/feedback/error-boundary.tsx` | Routes use `retry` (Next.js 16.4.3 docs bundled with `next`, checked 2026-11-02). They show the error's digest, never its message. Parts of a page use `catchError` from `next/error`, which lets `redirect` and `notFound` pass through. |

**Used by the screens:**
- **Team page:** members and invitations as paged tables with status labels, the invitation
  form, and confirmations before revoking an invitation and before changing one's own role.
- **Admin console:** a paged table, and a confirmation before suspending a workspace.

**Visible behaviour changes:**
- Revoking, suspending and changing one's own role now ask first.
- "Show more" became Previous and Next.
- Lists reload after a change instead of being patched in place.

### D-05B-05: Fixture demonstrations, apart from production data

- **The demo page:** `/dev/ui` shows every component on invented data (`apps/web/fixtures/`).
  - The data: 42 leads on the reserved example domains (RFC 2606).
  - `FixtureSource` pages by cursor like the API, waits a little to show loading states, and
    can fail the next request on demand to show retry states.
  - Its form returns the same result shape as `useApiMutation`, so `useFormSubmit` is
    exercised identically.
- **Where it exists:** only with `APP_ENV` `development` or `test` (`lib/demos.ts`), decided
  per request (`connection()`); elsewhere it answers 404.
  - It needs no sign-in, because it shows nothing real and calls no API.
  - It isn't in the navigation and isn't indexed (`noindex`).
- **ESLint, both directions** (`apps/web/eslint.config.mjs`):
  - Production code may not import `fixtures/` or `app/dev/`.
  - Demo code may not import `callApi`, `sendRequest`, `endpointRequest`, `lib/query`,
    `lib/query-cache`, `lib/session` or `lib/server/*`.
  - Both rules were shown to fire with throwaway files.

### D-05B-06: Tests

| Where | Tests |
|---|---|
| Shared | `endpoints.test.ts` (13): the list's internal rules, cache and invalidation scopes, CSRF, error codes, request building. `openapi.test.ts` (5): the document is up to date, complete, consistent and resolvable. |
| API | `api-contract.test.ts` (4), with `route-guards.test.ts` (7) on the shared route discovery |
| Web unit (new Vitest project, `apps/web/lib/**/*.test.ts`; `server-only` is stubbed) | `query-cache.test.ts` (9), `list-params.test.ts` (3, with the demo gate), `api.test.ts` (5: client and proxy) |
| Browser | `ui-components.spec.ts` (8, no database: every component, address-bar state, untrusted parameters, retry, confirmations and focus, the form, the error boundary, axe). `data-client.spec.ts` (3, real API: invalidation within one workspace, no requests for another workspace's data, confirmation with Escape, sign-in after the session ends). `accounts-and-teams.spec.ts` now confirms revocation, suspension and own-role changes. |

---

## 05C: Dashboard aggregates, recent activity, integration health (2026-11-02)

**Basis.** The plan is still missing (O-01); this follows the 05C prompt. It reuses the 05A
sections, the 05B endpoint list, client, cache and components, and the 03C/04B repositories.

### D-05C-01: Aggregate endpoints live under the sections that own the data

| Route | Permission (section) | Data | Cache resource |
|---|---|---|---|
| `GET /workspaces/:workspaceId/leads/summary` | `contacts.read` (Leads) | Contacts and companies | `leadSummary` |
| `GET /workspaces/:workspaceId/campaigns/summary` | `campaigns.read` (Campaigns) | Campaigns and campaign leads by status | `campaignSummary` |
| `GET /workspaces/:workspaceId/activity?limit=` | `audit.read` (Audit log) | Latest audit records (1–25, default 10) and counts for 24 hours, 7 and 30 days | `activity` |
| `GET /workspaces/:workspaceId/integrations/health` | `settings.manage` (Integrations) | Mailboxes, syncs and failed provider notifications per integration | `integrationHealth` |

- **Why under the sections, not one `/dashboard` route:** the 05A rule then applies unchanged:
  a GET route under a section needs that section's permission (route test, contract test).
  The dashboard can't show more than the pages behind it.
- **The overview has no API of its own.** It shows a panel exactly when the member could open
  the panel's section (the same check as the navigation). Hidden panels match hidden pages.
- `activity` joins `audit` in the Audit log section's API resources.
- **Read-only:** no CSRF token, `Cache-Control: no-store`. Like the other reads, they skip the
  per-address request limit; the client's polling is bounded instead (D-05C-04).
- Inviting, revoking and role changes write audit records, so they now also invalidate
  `activity` in the client cache.

### D-05C-02: Counts come from the database, one workspace, one snapshot

- **Repository:** `scope.dashboard` (`packages/database/src/tenancy/dashboard.ts`).
  - Each method first checks its section's permission (`requireReadPermission`: a member
    whose role grants it, or a platform admin's audited scope; workers are refused).
  - Every query filters by `tenantId`.
  - The counts of one summary are read in one `REPEATABLE READ` transaction, so they agree.
- **Definitions:**
  - contacts: `ACTIVE` contacts (archived ones left out);
  - companies: organizations;
  - contacts with email: a normalized email address is present;
  - added in 30 days: `created_at` within 30 days of the scope's clock;
  - leads in progress: campaign leads `PENDING` or `ACTIVE`.
- **"Currently implemented":** the tables exist since 03A/03B, but no feature writes contacts
  or campaigns yet. A new workspace therefore shows zeros, which is its true state.
- **Activity:**
  - Reuses `scope.audit.list` (newest first, keyset on id). Counts use `occurred_at`.
  - Actor names come only from memberships of this workspace, by the membership id recorded
    with the action: the display name, else the email address. (`audit.read` is an admin
    permission, and admins already see members' addresses on the Team page.)
  - A membership not found here (former member, or any other workspace's) is "A former
    member", never named.
  - Platform admins show as "Lead Fennec support" with their stated reason; automatic
    processes as "Lead Fennec (automatic)".
  - Record ids and audit metadata are never returned.

### D-05C-03: Integration health

- **Listed:** Gmail and Microsoft 365 (mailboxes), GoHighLevel and Apollo (syncs): the
  `integration_provider` values except Stripe.
  - Stripe belongs to Billing (`billing.read`).
  - OpenAI and email verification are run by the platform, not connected per workspace. Their
    health is a platform readiness concern. The panel says so.
- **Inputs:**
  - `email_accounts` by status;
  - `integration_sync_cursors`: count, failing (`consecutive_failures > 0`), latest
    `last_synced_at`;
  - `inbound_events`: `FAILED` in the last 24 hours, latest `received_at`.
- **State** (`integrationHealthState` in `@lead-fennec-ai/shared`, unit-tested), first match
  wins:
  1. **attention:** any failing sync, failed notification or `ERROR` mailbox;
  2. **healthy:** an active or paused mailbox (for other integrations: any sync or
     notification);
  3. **connecting:** a mailbox waiting for authorization;
  4. **not connected:** none of these.
- **No provider is called.** Health is what the database recorded. Live checks (token
  validity, provider status) belong to the connection tasks, after checking each provider's
  official documentation.

### D-05C-04: Refresh strategy: bounded polling for live panels

| Panel | Refresh |
|---|---|
| Leads, Campaigns | When the page opens (stale-while-revalidate, D-05B-03), and with Refresh. No polling: these change only through later features. |
| Recent activity | Every minute while the page is visible; at most 30 automatic refreshes |
| Integration health | Every 2 minutes while the page is visible; at most 15 automatic refreshes |

Rules (`apps/web/lib/polling.ts`, unit-tested; applied by `useApiQuery`'s `poll` option):
- **Visible pages only** (Page Visibility API). A hidden page has no timers. When it becomes
  visible, it refreshes at once and the count starts again.
- **Bounded:** after 30 minutes of automatic refreshes the panel says "Automatic updates
  stopped after 30 minutes." and offers Resume.
- **Back-off:** after a failure, the wait doubles (capped at 5 minutes for activity, 10 for
  health). After 3 consecutive failures polling stops ("Automatic updates paused after repeated
  errors.") until the user retries.
- **One request at a time:** a poll joins a load already in flight. A 401 sends the user to sign
  in (05B).
- **Worst case per open, visible tab:** 1.5 requests a minute (activity and health), ending
  30 minutes after the user's last refresh or return to the tab.
- **Why not server push** (Server-Sent Events, WebSockets): they need long-lived connections
  through the web app's proxy and new server code. Polling is enough for data that changes
  this slowly.

### D-05C-05: Screens: metrics, states, accessibility, layout

- **Metric catalog** `DASHBOARD_METRICS` (`@lead-fennec-ai/shared`):
  - An available metric is read from its group's summary under the same key (a test enforces
    it).
  - An unavailable one says why ("Available once sending … is built") and shows "Not
    available yet" in a dashed card, never a made-up 0.
  - Unavailable today: verified emails, scored leads, emails sent, reply rate, meetings booked.
- **Each panel:**
  - a region named by its heading, `aria-busy` while loading;
  - metrics as description lists;
  - placeholders announced as "Loading"; failed counts show "–", read as "Not loaded";
  - a retry state, and its own `ErrorBoundary`;
  - the "Updated …" text is not a live region (it would be read every minute); a polite
    status announces when updates stop;
  - the refresh button's name includes the panel's title.
- **Layout:** metrics in 2 columns on phones and 3 from `md`. Activity and health sit side by
  side from `lg`. No sideways scrolling at 390 px.
- **The overview** keeps "Your pages". The permission list moved into a collapsed "What your
  role lets you do".

### D-05C-06: Tests

| Level | File | What it shows |
|---|---|---|
| Shared | `contracts/dashboard.test.ts` (7) | Metric keys match the summaries; permissions match the sections; health states; labels; no record ids in activity items |
| Database | `dashboard.integration.test.ts` (6) | Counts of one workspace only; permission per method; actor names only from this workspace; health from mailboxes, syncs and events; platform admins only in an audited scope |
| API | `workspaces/dashboard.integration.test.ts` (5) | 200 with the contract's schemas and `no-store`; 403 by role; 404 outside the workspace; 401; limit validation; nothing from other workspaces |
| Web units | `lib/polling.test.ts` (5), `lib/format.test.ts` (2) | Interval, back-off, stop after 3 failures and after 30 minutes; relative times |
| Browser | `e2e/dashboard.spec.ts` (5) | Real counts and "not available yet"; panels by role and the API's 403; polling with Playwright's clock (an update after a minute, nothing while hidden, at once when visible); a failed panel beside working ones, pausing after 3 failures, recovery; 390 px without sideways scrolling; axe |

## 06A: Campaign configuration API (2026-11-02)

**Basis.** The plan is still missing (O-01); this follows the 06A prompt. It reuses the 03B
campaign, sequence and step tables, the 04B scopes and guards, the 05B endpoint list and the
05C dashboard routes.

### D-06A-01: Where each part of the configuration lives

| Section | Stored in | Notes |
|---|---|---|
| Name, description | `campaigns.name`, `description` | Name unique per workspace, 1–120 characters |
| Business profile | `campaigns.business_profile` (JSONB) | Company name, website (http/https only), description, value proposition |
| Offer | `campaigns.offer` (JSONB) | Name, description, call to action, up to 10 proof points |
| Audience | `campaigns.icp_id`, `lead_list_id`, `audience_filters` (JSONB) | ICP and lead list of the workspace; filters: countries (ISO 3166-1 alpha-2), industries, titles, company size |
| Exclusions | `campaigns.exclusions` (JSONB) | Up to 100 domains and 100 addresses (normalized, deduplicated), up to 20 lead lists; "skip contacts in other campaigns" (default on). The workspace's do-not-contact list always applies as well. |
| Lead limits | `campaigns.daily_new_lead_limit`, `max_leads` | 1–500 a day, 1–50,000 in total, daily ≤ total |
| Time zone | `campaigns.timezone` | IANA (`normalizeTimeZone`); a new campaign takes the workspace's |
| Schedule | `campaigns.send_weekdays`, `send_window_*` | ISO weekdays, a daily window in local minutes |
| Sender | `campaigns.email_account_id` | A mailbox of the workspace, not disconnected |
| Sequence | `sequences`, `sequence_steps` | The campaign's oldest sequence; up to 10 steps, each a delay (0 to 1 year) and an optional active template |
| Approval mode | `campaigns.approval_mode` | `HUMAN` (default) or `AUTOMATIC` (D-06A-04) |
| Version | `campaigns.version` | Raised by every save (D-06A-02) |

- **Why JSONB for four sections:** they are free-form settings read as a whole, not queried
  row by row. Like `icps.criteria`, each is validated by the shared schema before every write
  and again when read. A CHECK keeps each one a JSON object of bounded size.
- **No new table.** The business profile is per campaign for now. If the plan wants one profile
  per workspace, it becomes its own table and campaigns reference it.
- Migrations: `20261102000000_campaign_configuration` (generated) and
  `20261102000100_campaign_configuration_checks` (hand-written CHECKs: version, name,
  description, lead limits, JSON shape and size).

### D-06A-02: Incremental saves with a version check

- `PATCH …/campaigns/:campaignId` takes `version` and any of the sections. Each section sent
  replaces that section entirely; sections left out are untouched. A save must change at least
  one section.
- **Version check (optimistic concurrency):** the save names the version it started from.
  - If that isn't the stored version, nothing is saved: `409 version_conflict`.
  - The update itself is a compare-and-set on `(tenant_id, id, version, status = DRAFT)`. A
    concurrent save of the same version waits for the row, then matches nothing and gets the
    same `409`.
  - Each successful save raises the version by one.
- **Drafts only:** only `DRAFT` campaigns can be configured (`409 campaign_not_editable`).
  Pausing, editing running campaigns and activation are later tasks.
- **Audit:** `campaign.created`, `campaign.updated` (metadata: the sections changed, in the
  contract's order, and the new version) and `campaign.duplicated` (the source campaign's
  id). No content goes into audit metadata.
- **Readiness:** every answer says which of business profile, offer, audience, lead limits,
  sender and sequence are still missing (`campaignReadiness`). A draft may be saved without
  any of them.

### D-06A-03: Bounds and references are checked even for incomplete drafts

- **Bounds:** the shared request schemas, checked by the API and again by the repository. The
  database checks the numeric ones and the JSON size.
- **References:** every id a save names must be a record of the same workspace:
  - the ICP (not archived), the lead list and the excluded lead lists (not archived), the
    mailbox (not disconnected) and each step's template (active);
  - all problems are reported at once, as `400 validation_failed` with one issue per field
    (e.g. `sequence.steps.1.templateId`);
  - another workspace's record reads exactly like a missing one ("Not found in this
    workspace."), so ids of other workspaces can't be probed.
  - The composite foreign keys (`(tenant_id, x_id)`) would refuse such a reference anyway;
    the check turns that into a clear answer.
- A malformed campaign id is `404`, like an unknown one.

### D-06A-04: Human approval by default

- New campaigns are `DRAFT` (inactive) with `approval_mode = HUMAN`.
- `AUTOMATIC` needs both:
  - the member's role grants `drafts.approve` (waiving approval is an approver's decision);
  - the workspace allows it: `tenant_settings.require_send_approval` is false. It is true by
    default, so today nobody can set `AUTOMATIC` without an explicit workspace change.
- A copy always starts with `HUMAN` approval.
- `AUTOMATIC` has no effect yet: nothing is sent before the sending tasks. They must check
  the workspace setting and the mode again at send time (`CLAUDE.md` → Sending).

### D-06A-05: Duplication copies configuration only

- `POST …/campaigns/:campaignId/duplicate` creates a new `DRAFT` with version 1, `HUMAN`
  approval and no activation times. Any campaign may be copied, also a running one.
- **Copied:** every configuration section, the references (same workspace by construction),
  and every sequence with its steps as new rows.
- **Never copied:** campaign leads (enrollments), drafts, approvals, outbound intents and
  attempts (sends), email threads and job schedules.
- **Name:** "<name> (copy)", then "(copy 2)" and so on, or a name given in the request
  (`409 campaign_name_taken` if used).

### D-06A-06: API and tests

| Route | Permission | Cache resource / invalidates |
|---|---|---|
| `GET /workspaces/:workspaceId/campaigns` | `campaigns.read` | `campaigns` |
| `POST /workspaces/:workspaceId/campaigns` | `campaigns.write` | invalidates `campaigns`, `campaignSummary`, `activity` |
| `GET /workspaces/:workspaceId/campaigns/:campaignId` | `campaigns.read` | `campaign` |
| `PATCH /workspaces/:workspaceId/campaigns/:campaignId` | `campaigns.write` (+ `drafts.approve` for `AUTOMATIC`) | invalidates `campaigns`, `campaign`, `activity` |
| `POST /workspaces/:workspaceId/campaigns/:campaignId/duplicate` | `campaigns.write` | invalidates `campaigns`, `campaignSummary`, `activity` |

- `CampaignsController` is registered after `DashboardController`, so
  `GET …/campaigns/summary` (05C) still matches before `…/:campaignId`. The API test checks it.
- **Tests:**

  | Level | File | Tests |
  |---|---|---|
  | Shared | `contracts/campaigns.test.ts` | 7 |
  | Database | `campaigns.integration.test.ts` | 8 |
  | API | `workspaces/campaigns.integration.test.ts` | 7 |

- **No screen yet.** The Campaigns page stays "Not available yet" until the screens task.

## 06B: Campaign setup wizard (2026-11-04)

**Basis.** The plan is still missing (O-01); the eight stages are the ones the 06B prompt names.
It reuses the 06A draft API, the 05B client, cache and components, and the 05A page checks.

### D-06B-01: Pages and stages

- **Campaigns** (`/workspaces/[id]/campaigns`) is now a built page (`status: 'available'`):
  - a list with each campaign's status, setup progress ("3 of 6 parts filled in" or "Ready to
    start"), approval and last change;
  - "New campaign" (a dialog for the name), and "Make a copy".
- **Setup wizard** (`/workspaces/[id]/campaigns/[campaignId]?stage=…`):
  - The server checks the section as for every page. An unknown or foreign campaign is a real
    `404`.
  - Breadcrumbs: Campaigns (a link) › Campaign setup (`detailLabel` in the page list).
- **Stages, and the sections each one saves:**

  | Stage | Saves |
  |---|---|
  | Business profile | `businessProfile` |
  | Target audience | `audience.icpId`, `audience.leadListId` (filters kept as stored) |
  | Offer | `offer` |
  | Lead filters | `audience.filters` (ICP and list kept as stored), `exclusions`, `leadLimits` |
  | Mailbox | `sender` |
  | Sequence | `sequence` (steps: days and hours → minutes, template) |
  | Schedule | `timezone`, `schedule` (30-minute steps) |
  | Review | `name`, `description`; a summary with Edit links, approval, what is still needed |

- Lead limits sit under Lead filters, because they decide how many leads join. Approval is shown
  on Review but can't be changed there: the workspace requires approval by default (D-06A-04).

### D-06B-02: Saving, navigation, and not losing anything

- **Address bar:** the stage is in `?stage=`, so Back, the browser's back button and reloading
  keep the place. Unknown values open the first stage.
- **Saving:**
  - Each stage saves only its sections, with the version the page holds. Blank fields mean
    "not set", so an incomplete stage saves.
  - "Save draft" stays; "Save and continue", "Back" and the step list save first, then move.
  - A stage with an invalid value doesn't move or save. Focus goes to the first field with a
    problem, and a notice says nothing on the step was saved.
  - The typed values stay in the form; nothing already saved is touched.
- **After a save:**
  - the stage starts again from the stored campaign, so it shows what was stored (e.g.
    normalized domains);
  - a polite status says "Draft saved at 10:42.";
  - the cache entries the endpoint lists are reloaded (05B).
- **Unsaved changes:** closing or reloading the tab asks first (`beforeunload`).
  - Leaving through the sidebar or the breadcrumbs doesn't ask (a limit of client-side
    navigation, O-29).
- **Conflicts:** a save from an outdated page gets `409 version_conflict`.
  - The wizard says so, keeps the typed values until the user chooses "Load the latest
    version", then shows the stored campaign.
- **Read-only:**
  - A campaign that isn't a draft opens read-only, with "Make a copy" (06A duplication).
  - So does any campaign for a role without `campaigns.write` (no system role is like that
    today).

### D-06B-03: The page and the API validate with the same schema

- `apps/web/lib/campaign-wizard.ts` turns each stage's form values into the save the API takes
  and checks it with `updateCampaignRequestSchema`, the schema the API validates with.
- Every issue path, the page's own or the API's (reference checks, conflicts with stored data),
  is mapped to the field it belongs to, with the same message:
  - list entries get "Line n:" or "Entry n:";
  - a step's issues go to that step's delay or template;
  - anything that belongs to another stage is shown above the form, never dropped.
- Form-only conversions are deliberately loose so they can't disagree: blank means not set, and
  numbers are passed on as typed, so the schema refuses fractions and out-of-range values in
  its own words.
- The shared schemas got plain wording where zod's defaults showed:
  - "Use a whole number." and "Use a delay of zero or more.";
  - day and time choices;
  - "Enter a name for the campaign." for the required name.

### D-06B-04: Honest about what isn't built

- **Mailbox:**
  - "Connecting a mailbox: Not available yet", with disabled "Connect Gmail" and "Connect
    Microsoft 365" buttons.
  - Mailboxes already in the workspace are listed with their stored status: "Waiting for
    authorization", "Needs reconnecting", "Paused" or, only for `ACTIVE`, "Connected".
  - Nothing claims a connection.
- **Sequence:** "Writing the emails: Not available yet". Steps save their timing and, if the
  workspace has templates, a template; nothing is sent.
- **Review:** "Starting the campaign: Not available yet", with a disabled "Start campaign".
- **Choices** come from a new read-only endpoint, `GET /workspaces/:workspaceId/campaigns/options`
  (`campaigns.read`). It returns the workspace's ICPs and lead lists (not archived), mailboxes
  (not disconnected) and active templates, up to 200 of each by name: the same records a save
  accepts. Creating them isn't built yet, so the pickers say when there are none.

### D-06B-05: Accessibility and layout

- **Step list:**
  - a `nav` with an ordered list; the current stage has `aria-current="step"`;
  - each link is named by its content plus hidden state text ("Offer, not done yet"). Chrome
    reads it with a space before the comma. Explicit `aria-label`s were tried first and
    failed axe's label-in-name rule, because of the visible step number.
- **Fields:** errors are tied to their field (`aria-describedby`, `aria-invalid`). Groups of
  checkboxes and radios are fieldsets with a legend, with the error on the group.
- **Headings and focus:** moving to a stage focuses its heading. "Step n of 8" is stated as
  text.
- **Layout:** the step list is a sidebar from `lg`, and two columns on phones. No sideways
  scrolling at 390 px on any stage.

### D-06B-06: Tests

| Level | File | What it shows |
|---|---|---|
| Web units | `lib/campaign-wizard.test.ts` (7) | The eight stages; an unchanged stage gives back exactly what is stored (nothing lost on reopening) and is a valid save, complete or not; blank fields save; every message the schema gives lands on a field of its stage with the API's words; the API's reference issues map to fields; days and hours as minutes; stage states |
| Database | `campaigns.integration.test.ts` (+1) | Choices: only the workspace's usable records |
| API | `workspaces/campaigns.integration.test.ts` (+1) | Choices over HTTP; `404` outside the workspace |
| Shared | `navigation.test.ts` | Breadcrumbs of a detail page; Campaigns is built |
| Browser | `e2e/campaign-wizard.spec.ts` (7) | A half-done campaign reopens with everything valid (list, stage list, reload); five refused values give the same words on the page as from the API, and the page sends nothing; mailbox and sequence notices, no "Connected"; schedule and review; a conflict between two pages; a running campaign is read-only and can be copied; every stage at 390 px; `404`s; axe on every stage |

The 05A app-shell scenario used Campaigns as its example of an unbuilt page; it now uses
Imports.

## 06C: Campaign readiness and activation (2026-11-04)

**Basis.** The plan is still missing (O-01); the checks follow the 06C prompt ("mandatory
settings, authorized sender health, eligibility policy, schedule, limits and approval mode").
It reuses the 06A repository and version checks, the 06B review stage, the 03C billing helpers
and the 04B permissions.

### D-06C-01: One readiness service, decided by application code

`evaluateActivation` (`packages/shared/src/contracts/campaign-activation.ts`) is pure. It
turns facts about one campaign into 13 checks, in a fixed order, each passed or blocked with
reasons a person can read. `scope.campaigns.readiness` gathers the facts in one
`REPEATABLE READ` transaction, filtered by the workspace.

| Check | Kind | Blocks when |
|---|---|---|
| Business profile | setting | No company name, or no description |
| Offer | setting | No name, or no description |
| Target audience | setting | Neither an ICP nor a lead list; either one archived or gone |
| Lead eligibility | setting | No lead list (finding leads from an ICP alone isn't built); nobody on the list has an email address |
| Lead limits | setting | Either limit missing; daily above total; daily above the mailbox's daily send limit |
| Sending mailbox | setting | None chosen; not `ACTIVE` (waiting for authorization, paused, disconnected, needs reconnecting); no stored authorization; a failing sync |
| Sequence | setting | No step; a step without a template, or with an archived or missing one |
| Schedule | setting | No day; the window ends before it starts; the time zone isn't valid |
| Approval | setting | `HUMAN` and no active member whose role grants `drafts.approve`; `AUTOMATIC` while the workspace requires approval |
| Workspace plan and sending | workspace | No entitled subscription (03C statuses); the plan allows no `EMAILS_SENT`; `tenant_settings.outbound_sending_enabled` is off (the default) |
| Checking leads before they join | service | Not built (suppressions and verification per lead) |
| Preparing the emails | service | Not built (content per lead and step) |
| Sending email | service | Not built (Gmail and Microsoft 365) |

- Every setting check names the wizard stage that fixes it.
- Reasons are plain sentences; the review screen and the API show the same ones.

### D-06C-02: Unfinished services fail closed

- `BUILT_SERVICES` (shared) says which later services exist: none yet.
- The API provides it through the `CAMPAIGN_SERVICES` token, so in production activation is
  always refused, with one reason per missing service.
- Only tests pass other values: the repository tests directly, and the API harness through
  `startApi(db, policy, services)`. That is how the successful path is proven without
  building the services.
- When a service is built, its flag is set to true in the same change, with its own tests.

### D-06C-03: Activation: explicit, versioned, idempotent

- **The only way a campaign starts** is `POST /workspaces/:workspaceId/campaigns/:campaignId/activate`
  with `{ version }` (`campaigns.write`).
  - A save can't set a status: the request schema is strict.
  - Creating and copying always give a `DRAFT`.
- **Order of decisions:**
  1. A version other than the stored one: `409 version_conflict`, before anything else (also
     for a running campaign).
  2. Already `ACTIVE` from that version: the campaign is returned unchanged, with `200`. No
     second change, audit record or check. This is what makes repeating idempotent.
  3. Paused, completed or cancelled: `409 campaign_not_editable`.
  4. `AUTOMATIC` approval: the member also needs `drafts.approve`.
  5. Any blocked check: `409 campaign_not_ready`, with one issue per reason (the issue's
     `path` is the check's key).
  6. A compare-and-set on `(tenant_id, id, version, status = DRAFT)` sets `ACTIVE` and
     `activated_at` from the scope's clock, and writes `campaign.activated` (metadata: the
     version) in the same transaction.
  7. If a concurrent request started it first, the re-read finds it `ACTIVE` from the same
     version and answers the same way.
- **The version doesn't change on activation.** It counts configuration saves, and keeping it
  lets a retried request be recognised as the same one.
- **Nothing else happens yet.** Enrolling leads, scheduling and sending are later tasks; with
  the services unbuilt, production can't reach this point.

### D-06C-04: Review screen

- **"Before the campaign can start"** lists every check:
  - with "Passes", "To do", "Needs a workspace change" or "Not available yet";
  - with its reasons;
  - and, for a setting, "Fix in <stage>", which saves the review form first.
- **"Start campaign":**
  - It is enabled only when the report is for the version on screen, every check passes, the
    campaign is a draft, the member may change campaigns and the review form is saved.
  - It asks for confirmation.
  - Refusals update the list; a conflict shows the 06B conflict notice.
- **Cache:** `campaignReadiness` (per workspace). Saves and activation invalidate it, and the
  review stage reloads it when it opens.

### D-06C-05: Tests

| Level | File | What it shows |
|---|---|---|
| Shared | `contracts/campaign-activation.test.ts` (5) | Deterministic facts: a ready campaign passes everything; the unbuilt services fail closed; 17 single problems each block exactly one check with the expected words; never ready unless a draft; the endpoint's shape |
| Database | `campaign-activation.integration.test.ts` (5) | With the fixture tenants: every blocker of a new draft; a complete campaign blocked only by the workspace switch and the services; saving never starts; a stale version conflicts; refused while services are unbuilt; started once (`activated_at` from the clock, one audit record); repeated and still `ACTIVE`; paused can't be started; automatic approval needs `drafts.approve`; permissions |
| API | `workspaces/campaign-activation.integration.test.ts` (3) | As in production: every reason in `409 campaign_not_ready`, twice alike, still a draft; CSRF, `404`, strict save; with the services built: `200` started, the same `200` again, stale `409`, one audit record, in the activity feed |
| Web units | `lib/campaign-wizard.test.ts` | The wizard's stage keys are the ones checks link to |
| Browser | `e2e/campaign-wizard.spec.ts` | Every check on the review screen with the API's reasons; "Not available yet" for services; Start disabled; the API refuses with the same reasons; a stale version conflicts; "Fix in Mailbox" |

## 07A: Lead discovery requests and organization search (2026-11-05)

**Basis.** The plan is still missing (O-01); this follows the 07A prompt ("LeadDiscoveryService
and a provider interface for organization search, pagination, attribution, quotas and errors";
"a deterministic fake provider"; "an asynchronous search request API returning run ID and
status URL"; "do not begin contact enrichment here"). It reuses the 03A `imports` and
`job_tasks` tables, the 04B permissions and job envelope, and the 05B endpoint list. No
provider-specific detail is implemented: the only provider is the fake, and Apollo is 07B.

### D-07A-01: ICP criteria and the search plan

- **One vocabulary for ICP criteria:** `icpCriteriaSchema` (`packages/shared/src/contracts/lead-discovery.ts`).
  - Company filters: `industries`, `countries` (ISO 3166-1 alpha-2, upper-cased), `employees`
    (min/max), `keywords`, `technologies`, `annualRevenue` (min/max).
  - People filters: `titles`, `seniorities`.
  - Strict: an unknown key is refused by name ("Lead Fennec doesn't recognize the filter
    "sector".").
- **`planOrganizationSearch(criteria, maxResults, capabilities)`** is pure and decides,
  before anything is stored or requested:
  - the criteria are valid;
  - at least one company filter is set;
  - every company filter set is one the provider declares (`supportedFilters`), otherwise one
    issue per filter ("Company search can't filter by technologies yet. Remove it from the
    profile to search.");
  - `maxResults` is between 1 and the lower of the platform cap (1000) and the provider's
    `maxResultsPerSearch` (the fake's is 500), with the real number in the message.
- **People filters are carried, not used:** they are listed as `ignoredCriteria` on the run.
  Finding people is contact discovery (08A).
- Issue paths: `icpId`, `maxResults`, `criteria` or `criteria.<filter>`.

### D-07A-02: Company identity

`normalizeCompanyIdentity({ name, domain?, website? })` (`@lead-fennec-ai/shared`, next to
`normalizeEmail` and `normalizeDomain`):

- **`name`:** Unicode NFC, trimmed, inner whitespace collapsed; at most 300 characters.
- **`nameKey`:** compatibility-decomposed, accents removed, lower-case, `&` → `and`, other
  punctuation → space, and trailing legal forms (`inc`, `llc`, `ltd`, `gmbh`, `sa`, …) removed
  while more than one word remains.
- **`domain`:** `normalizeDomain` of the domain, or else of the website's host; a value that
  isn't a domain becomes `null` (never a guess).
- **`key`:** `domain:<domain>`, or `name:<nameKey>` when there is no domain. It is the
  identity used to drop duplicates within a run, and is meant for 07C's organization upserts.
- An empty name, a name over 300 characters, or one with no letter or digit throws
  `IdentityNormalizationError`.

### D-07A-03: Provider interface, fake and LeadDiscoveryService

- **`OrganizationSearchProvider`** (`packages/integrations/src/providers.ts`):
  - `source` (`FAKE` or `APOLLO`) and `capabilities` (supported filters, page size, results
    per search, attribution text);
  - `searchOrganizations({ filters, pageSize, pageToken })` returns one page: companies,
    an opaque `nextPageToken`, `totalAvailable`, `retrievedAt`, `quota` (remaining, reset)
    and `creditsUsed`, each `null` when the provider doesn't say.
  - Errors are `ProviderError` with a code (`unauthorized`, `forbidden`, `quota_exceeded`,
    `rate_limited`, `invalid_request`, `unavailable`, `timeout`), `retryable` and
    `retryAfterSeconds`. Messages are fixed sentences: a provider's own message or response
    is never passed on.
- **`FakeOrganizationSearchProvider`** (`fake-organization-search.ts`):
  - a fixed directory of 240 synthetic companies on `.example` domains, each marked
    `raw.synthetic = true`; the same every time, with no clock or randomness in the data;
  - untidy records on purpose: upper-case `www.` domains, a website without a domain, neither,
    a value that isn't a domain, two companies on one domain;
  - pages by `p:<offset>` tokens; refuses a forged token, a page over 25 and an unsupported
    filter (`invalid_request`);
  - optional quota and scripted failures per call, for tests; it records each request.
  - `createFakeProviders()` includes it. Live mode has no adapter yet (`LiveProvidersUnavailableError`).
- **`LeadDiscoveryService`** (`lead-discovery.ts`) finds companies only:
  - `plan()`: the plan above, or `DiscoveryPlanError`; nothing is requested for a search that
    can't run;
  - `pages(plan, resume?)`: pages until `maxResults` new companies are found or the provider
    has no more; page size never above what is still needed; a hard page limit so a provider
    that repeats itself still ends;
  - every provider record is validated (zod) before use, then normalized (D-07A-02); invalid
    records and repeats of an identity already found are counted, not returned;
  - each company carries its provenance: provider, external id, `retrievedAt` and the
    attribution;
  - `resume` takes the page token, the identities and the count already found, so an
    interrupted run continues without repeats (07C stores these between pages);
  - provider errors end the iteration after the pages already returned; the caller records
    them.

### D-07A-04: Discovery requests are imports with a queued task

- **Storage (one table per concept, D-03C-01):** a search is an `imports` row with
  `source = ORGANIZATION_SEARCH` and new columns:
  - `icp_id` (composite foreign key to the ICP, `NO ACTION`: an ICP with searches can't be
    deleted), `search_provider`, `search_filters` (the planned filters, a snapshot of the ICP
    when asked), `result_limit`, `query_sha256` (SHA-256 of the canonical provider, filters
    and limit: the same search gives the same hash) and `source_metadata` (attribution,
    ignored criteria and the provider's declared capabilities);
  - `error_code` (machine-readable, never a provider's message), for 07C.
  - Migrations `20261105000000_organization_search_imports` (generated) and
    `20261105000100_organization_search_import_checks` (hand-written): the search columns are
    set exactly for organization searches; provider `FAKE` or `APOLLO`; limit 1–1000; hash
    format; JSON objects of at most 16 KB; error code format; and a trigger that makes the
    source and every search input immutable. Status, counts and timestamps can change.
  - `source_provider` gained `FAKE`, so results from the fake are never labelled as a real
    source.
- **`scope.discovery.request(input, provider)`** (`packages/database/src/tenancy/discovery.ts`):
  1. `imports.create`, members only (workers and platform admins are refused);
  2. the request schema (`{ icpId, maxResults? }`, strict; default 100);
  3. in one transaction: the ICP by `(tenant_id, id)`. Missing or another workspace's:
     "Not found in this workspace."; archived: "This ideal customer profile is archived.";
  4. the plan against the provider's declared capabilities; any issue throws
     `DiscoveryRequestError` and nothing is written;
  5. the `imports` row (`PENDING`), a `job_tasks` row (`lead_discovery.search`, idempotency
     key `import:<id>`, payload `{ importId }` only) and the audit record
     `lead_discovery.requested` (ICP id, provider, limit; no criteria).
- **`scope.discovery.get(id)`**: one import of the workspace (`imports.create`); a malformed
  or unknown id, or another workspace's, is not found.
- **No queue message yet.** No BullMQ producer or consumer exists; the task row is the durable
  request, and publishing `{ v: 1, taskId }` and running the search are 07C's worker.
- **The provider is never called while the API answers.** The request uses only its declared
  capabilities. The API provides the fake in development and test (`ORGANIZATION_SEARCH`
  token, `apps/api/src/workspaces/discovery-provider.ts`); staging and production ask for the
  live adapter and refuse to start without one, as the mail provider does (O-19).

### D-07A-05: API

| Route | Permission | Answer |
|---|---|---|
| `POST /workspaces/:workspaceId/imports/discovery` | `imports.create` (Origin, session, CSRF) | `202 { runId, status: "PENDING", statusUrl }`; `400 validation_failed` with the request schema's issues ("The request is invalid.") or the plan's ("The search can't run as asked.") |
| `GET /workspaces/:workspaceId/imports/:importId` | `imports.create` | `200` the run: source, status, search inputs and attribution, counts, error code, timestamps |

- `statusUrl` is the API path of the run (`DISCOVERY_ROUTES.run`); the web app reaches it
  through `/api`.
- A workspace the caller isn't a member of, or a run of another workspace: `404`. A member
  without `imports.create`: `403`.
- Endpoint list: tag `imports`, cache resource `importRun`; the request invalidates
  `importRun` and `activity`. The routes belong to the Imports section (`imports.create`).
- Documented in `docs/api/discovery.md`.

### D-07A-06: Tests

| Level | File | What it shows |
|---|---|---|
| Shared | `contracts/lead-discovery.test.ts` (5) | The fixture ICP's plan (titles ignored); unknown criteria, unsupported filters and no company filter refused with their messages; limits; company identity normalization |
| Integrations | `lead-discovery.test.ts` (8), `fakes.test.ts` | The fake directory is synthetic and identical every time; paging by token; forged tokens, page sizes and unsupported filters refused; quota and typed, sanitized errors; nothing requested for an invalid plan; matches with normalized identities and provenance, the same companies in the same order with a new provider; untidy data cleaned, duplicates and invalid records counted; stops at the limit; resumes after an interruption; errors after the pages already returned |
| Database | `discovery.integration.test.ts` (5) | The fixture ICP becomes a `PENDING` import with filters, limit, hash and metadata, a task and an audit record; the same search gives the same hash; unsupported filters, limits, unknown keys and archived ICPs refused with nothing written; other workspaces' ICPs and runs not found; permissions for members, workers and platform admins; search inputs complete and immutable in the database |
| Database | `tenant-access.integration.test.ts`, fixtures | Each fixture tenant has a queued search from its ICP; the new `imports → icps` relation (62 in all) is used in both tenants and refuses the other tenant's ICP |
| API | `workspaces/discovery.integration.test.ts` (3) | `202` with run id and status URL; the status URL answers the run; one task, no companies or contacts written; refusals with a reason each; `404` for non-members and other workspaces' runs, `403` without `imports.create`, `401`, CSRF and origin checks |
| API review | `http/route-guards.test.ts`, `http/api-contract.test.ts` | The two routes are reviewed, guarded and match the endpoint list |

## 07B: Apollo organization search adapter (2026-11-06)

**Basis.** The plan is still missing (O-01); this follows the 07B prompt ("check current
official Apollo documentation and the authorized account's capabilities"; "only permitted
organization search with explicit field mapping, pagination, rate limits, bounded retries and
cost/credit metadata"; "people search and enrichment separate"; "environment-injected
credentials and sanitized provider errors"; "captured or synthetic contract fixtures"). It
implements the 07A `OrganizationSearchProvider` interface; nothing else changes shape.

### D-07B-01: Sources, version and account check

**Official documentation, checked 2026-11-06:**

| Page | What it settled |
|---|---|
| https://docs.apollo.io/reference/organization-search (updated 2026-09-29; OpenAPI `info.version` 1.0; API `/api/v1`) | The endpoint, its query parameters, page and display limits, credit cost, the response's documented fields, 401/403/429 answers |
| https://docs.apollo.io/reference/authentication | The key goes in the `x-api-key` header |
| https://docs.apollo.io/docs/create-api-key | Scoped keys (only the chosen endpoints; others answer 403) and master keys; scoped keys recommended |
| https://docs.apollo.io/reference/rate-limits | Per-team, per-endpoint windows (minute, hour, day); the `x-*-requests-left` and `retry-after` headers; `API_RATE_LIMIT_EXCEEDED` and `PLATFORM_RATE_LIMIT` |
| https://docs.apollo.io/reference/status-codes | Status codes and the `error_details` shape (`code`, `message`, `suggestions`, `context`); legacy root fields removed on 2027-02-16 |
| https://docs.apollo.io/reference/view-api-usage-stats | Usage stats per endpoint and window, 0 credits (not called by the adapter) |

No SDK: Apollo documents a REST API, called with the runtime's `fetch`. No package was added.

**Account check (the user approved read-only lookups through the Apollo connector,
2026-11-06):**
- **Credits:** the team's lead credits for the cycle ending 2026-11-08 were 147 left of 200.
  Personal details from the profile are not recorded.
- **Not known:**
  - which Apollo plan the account is on;
  - whether a REST API key with organization search access exists (the docs say the endpoint
    answers 403 to plans without API access, and a scoped key must include it).
- **Not done:** no search was run (each page costs 1 credit), and no key was created or seen.
  The connector's answers are not the REST API's, so they say nothing about rate-limit headers
  (the docs note MCP responses don't carry them).

### D-07B-02: Explicit field mapping

**Request.** `POST https://api.apollo.io/api/v1/mixed_companies/search`. Every parameter is a
query parameter (the documented operation has no body).

| ICP company filter | Apollo parameter | Value sent |
|---|---|---|
| `industries` | `organization_industries[]` | Lower-cased. Apollo matches exact industry names only (for example "information technology & services"), so a profile must use Apollo's names. |
| `countries` | `organization_locations[]` | The English country name, lower-cased (`DE` → "germany"). ISO user-assigned codes and EU/UN groupings are refused before any request. |
| `employees` | `organization_num_employees_ranges[]` | `min,max`; a missing bound becomes 1 or 10,000,000 (the ICP schema's own cap) |
| `keywords` | `q_organization_keyword_tags[]` | As written |
| `technologies` | `currently_using_any_of_technology_uids[]` | Lower-cased; spaces and periods become underscores, as documented (`google_analytics`, `wordpress_org`) |
| `annualRevenue` | `revenue_range[min]`, `revenue_range[max]` | Whole US dollars; only the bounds set |
| (paging) | `page`, `per_page` | See D-07B-03 |

People criteria (titles, seniorities) are never sent; they stay `ignoredCriteria` (D-07A-01).

**Response.** Only `pagination` (`page`, `per_page`, `total_entries`, `total_pages`) and
`organizations` are read:

| Apollo field | ProviderOrganization |
|---|---|
| `id` | `externalId` |
| `name` | `name` |
| `primary_domain` | `domain` |
| `website_url` | `websiteUrl` |
| (not documented) | `industry`, `employeeCount`, `countryCode`: always `null` |

- **Not guessed:** the documented response has no industry, employee count or country, so
  those stay empty rather than read from undocumented keys.
- **`raw`** keeps only the four fields above; phone numbers, social links, logos and the rest
  are dropped.
- **No email data:** the adapter reads no person or email field.
- **`accounts`** (companies the team already saved in Apollo, undocumented beyond its name) is
  ignored (O-32).
- **Checked here:** the response's shape; a record that isn't usable still reaches
  LeadDiscoveryService, which validates and counts it (D-07A-03).

### D-07B-03: Pagination, cost and quota

- **Page size:** 1–100 (documented maximum). The first page uses the size asked for. Its token
  (`apollo:v1:<page>:<per_page>`, opaque to callers) keeps that size, so later pages stay
  aligned with Apollo's page numbers even when the caller asks for fewer; the caller takes
  what it needs.
- **Limits:** no token past page 500 or 50,000 records (both documented); a forged or
  out-of-range token is refused before any request. The declared `maxResultsPerSearch` is
  50,000; Lead Fennec's own cap stays 1,000 per search (D-07A-01).
- **Cost:** `creditsUsed` is 1 per page, as documented ("1 Apollo credit per page"). Apollo
  documents no per-response credit count, so this is the documented rate, not a measured one.
- **Quota:** `remaining` is the smallest of `x-minute-requests-left`, `x-hourly-requests-left`
  and `x-24-hour-requests-left`. `resetAt` is null: the windows open with the first request
  and aren't aligned to the clock.

### D-07B-04: Errors, retries and timeouts

| Apollo answer | ProviderError | Retried |
|---|---|---|
| 401 | `unauthorized` | No |
| 403 (plan without API access, or a key not scoped to the endpoint) | `forbidden` | No |
| 429 `API_RATE_LIMIT_EXCEEDED`, window `minute` or `hour` | `rate_limited`, `retryAfterSeconds` from `retry-after` | Yes |
| 429 `API_RATE_LIMIT_EXCEEDED`, window `day` | `quota_exceeded`, `retryAfterSeconds` from `retry-after` | No |
| 429 `PLATFORM_RATE_LIMIT` | `rate_limited`, `retry_after_seconds` from the suggestion (60 when absent, as documented) | Yes |
| 5xx | `unavailable` | Yes |
| Other 4xx (422 validation, 404) | `invalid_request` | No |
| Network failure | `unavailable` | Yes |
| No answer within the timeout (15 s per attempt, reading included) | `timeout` | Yes |
| 200 that isn't the documented JSON | `bad_response` (new code) | No |

- **Bounded retries:** at most 3 attempts per page (configurable, 5 at most). The wait is the
  error's `retryAfterSeconds`, else 1 s then 2 s. A wait over 30 s isn't slept on: the error
  goes back with `retryAfterSeconds`, for the job to reschedule (07C).
- **A retried timeout may cost a credit twice** if Apollo processed the first attempt;
  retries are bounded for that reason.
- **Sanitized:** messages are Lead Fennec's fixed sentences. Apollo's message and body, the
  URL and the cause of a network error are dropped.
- **Redirects** are refused (`redirect: 'error'`), so the key can't follow one to another
  host.

### D-07B-05: Credentials and environments

- **`APOLLO_API_KEY`** is read only by the worker (`apps/worker/src/env.ts`), the process that
  will run searches (07C). It is optional and validated without echoing it (8–200 printable
  characters, no spaces; empty is unset), redacted in logs (`REDACTED_PATHS`), passed through
  by `turbo.json` and documented in `docs/local-development.md`. `.env.example` holds only a
  commented placeholder.
- **`createOrganizationSearchProvider(appEnv, { apolloApiKey })`** (`packages/integrations`):
  - development and test: always the fake, even if a key is set;
  - staging and production: Apollo, or `LiveProvidersUnavailableError` without a key.
  - The key reaches the adapter only through its constructor, which checks it (a malformed
    key could also inject a header) and keeps it in a private field. It is sent only in
    `x-api-key`.
- **The API never holds the key.** It checks and stores requests, so it gets
  `organizationSearchDeclaration(appEnv)` (source and capabilities): `FAKE` in development
  and test, `APOLLO` in staging and production. Since 07B the API no longer refuses to start
  in staging and production over organization search (D-07A-04); it still does over
  transactional mail (O-19).
- **Recommended key:** a scoped key with only `api/v1/mixed_companies/search` (D-07B-01).
- **Separate:** people search (`LeadDataProvider`) and enrichment remain fake-only
  interfaces; 07B adds no person, email or enrichment call.

### D-07B-06: Tests

| File | What it shows |
|---|---|
| `packages/integrations/src/apollo-organization-search.test.ts` (14) | The parameter for every filter, open-ended size bounds, country names, and non-countries refused; only the documented URL, `POST`, the key only in `x-api-key`, redirects refused; out-of-range page sizes, forged tokens and malformed keys refused before any request; **pagination** across two pages with the first page's size kept, the 500-page stop, documented fields only, cost 1 per page and quota from the headers; **empty results**; companies for an ICP through LeadDiscoveryService with no person or email parameter; **authentication failure** (401, once, no retry) and 403; a short rate limit waited out; **quota limits** (daily: `quota_exceeded`, no retry; long waits given back; platform load); retries bounded at 3; **timeouts** with back-off, a fetch that ignores the abort, and recovery; 5xx, network errors, unreadable answers and 422; the fake in development and test, Apollo with a key elsewhere |
| `src/fixtures/apollo/*` | Synthetic fixtures in the documented shapes (`README.md` there): no real company, key or personal data |
| `apps/worker/src/env.test.ts` (2) | The key from the environment, empty as unset, malformed keys refused without echoing them |
| `packages/shared/src/logger.test.ts` | `APOLLO_API_KEY` is censored in log lines |

Every test uses a scripted `fetch`: nothing leaves the process, and the network guard stays
on.

## 07C: Search jobs, organization upserts, CSV import, discovery screens (2026-11-06)

**Basis.** The plan is still missing (O-01); this follows the 07C prompt ("connect search jobs
to tenant-scoped organization upserts, exclusion checks, progress counts and source
attribution"; "a validated CSV import path with column mapping, row limits, error report and
safe normalization"; "protect exported cells against spreadsheet formula injection"; "the
discovery form and results view with cancellation and failure status"). It builds on the 07A
requests, the 07B provider interface, the 04B job context and the 05B screens.

### D-07C-01: Jobs: durable tasks, a relay, BullMQ

- **The database is the source of truth.** A search request writes its `job_tasks` row in the
  request's transaction (07A).
- **Relay** (`apps/worker/src/queue.ts`): every 5 seconds the worker finds due PENDING tasks
  of its types, in every active workspace (`dueJobTasks`, through each workspace's scoped
  client), and publishes `{ v: 1, taskId }` to BullMQ.
  - The task id is the BullMQ job id, so a task is queued once however often the relay runs.
  - Jobs are removed when done, so a task that becomes due again (a retry) can be queued
    again.
  - The API doesn't talk to Redis.
- **Consumer:** a BullMQ worker, one job at a time, hands each message to `runDiscoveryTask`.
  `claimJob` authorizes it (04B): unknown, forged, wrong-type and suspended-workspace messages
  are dropped and logged by reason only.
- **Retries are task rows becoming due again** (`ctx.fail({ retryAt })`), not BullMQ retries.
- **BullMQ 6.7.0** (published 2026-11-04, MIT; 6.7.1 was under a day old, below pnpm's
  `minimumReleaseAge`). Docs checked 2026-11-06:
  - https://docs.bullmq.io/guide/connections: ioredis connection; `maxRetriesPerRequest: null`
    on worker connections;
  - https://docs.bullmq.io/guide/jobs/job-ids: a duplicate `jobId` is ignored; no colons, not
    digits only.
  - Its peers (`pg`, `redis`, `ioredis`, `bullmq-otel`) are all optional. ioredis is the
    existing 6.0.0.
  - `msgpackr-extract` (an optional native speed-up of msgpackr) keeps its install script
    disabled (`allowBuilds`); msgpackr works without it.
- **`run-task`** (`apps/worker/dist/run-task.js <taskId>`): runs one task without Redis, in
  development and test only; anywhere else it refuses. The browser tests use it, since the
  test machines have no Redis.

### D-07C-02: Running a search, saving companies

- **`runDiscoveryTask`** (`apps/worker/src/jobs/lead-discovery.ts`):
  1. `beginSearch`: PENDING becomes PROCESSING (or a PROCESSING run resumes); cancelled,
     finished and non-search imports are skipped;
  2. pages through LeadDiscoveryService from the saved token;
  3. each page goes through `saveSearchPage`;
  4. `finishSearch` marks it COMPLETED.
  - A search asked of one provider never runs on another (`provider_mismatch`).
- **One page, one transaction** (`saveSearchPage`):
  - the import row is locked; a cancelled run drops the page;
  - companies go through `saveOrganizations`;
  - one `source_records` row per received record, with its outcome;
  - the counts, the page count and the next page token are updated.
  - **Resume:** a crash before the commit leaves nothing, and the next attempt refetches that
    page from the saved token. A crash after it resumes at the next page. The run's saved
    identities are passed back, so a resumed run doesn't count them twice.
- **`saveOrganizations`** (`packages/database/src/tenancy/organization-store.ts`), used by
  searches and CSV imports:
  - **Excluded:** the domain, or a parent domain (`eu.rival.example` under `rival.example`), is
    on the workspace's suppression list. Not saved, with the reason.
  - **Matched:** the workspace already has the company: the same domain (the existing unique
    `(tenant_id, normalized_domain)`), or, without a domain, the same name key among
    companies without one (new column `organizations.name_key`). Only missing details are
    filled in; nothing someone saved is overwritten.
  - **Created:** otherwise.
  - Writes to a workspace's organizations take a transaction advisory lock, so two runs can't
    create the same company twice.
- **Source attribution:** each record keeps the provider, its external id, when it was
  received and what was received (`payload.received`, plain JSON). The run keeps the
  provider's attribution (07A). `source_records` lost its unique `(tenant_id, provider,
  external_id)`: a record is received once per run, so the same id recurs across runs (now an
  index).
- **Errors:**
  - retryable provider errors with attempts left: the run stays PROCESSING with the error
    code, and the task is due again after `retryAfterSeconds` (else 60 s);
  - the rest: FAILED with the code (`unauthorized`, `quota_exceeded`, `timeout`, …);
  - an unexpected error: FAILED `internal_error`, logged.
- **Budget (paid work reserves first):**
  - a paid provider's page reserves one `ORGANIZATION_SEARCH_CREDITS` credit before the
    request (new usage metric), and commits or releases it after;
  - no plan credit gives FAILED `usage_limit_reached`, and no entitled plan gives
    `no_entitled_plan`, before any request;
  - the fake costs nothing and reserves nothing;
  - fixture plans include the metric (50, 500, 10,000).
- **Cancellation:** `POST …/imports/:importId/cancel` (members, `imports.create`) marks a
  queued or running search CANCELLED. The next page save sees it, and companies already saved
  stay. Repeating it is harmless; a finished import answers `409 import_not_cancellable`.

### D-07C-03: CSV import

- **Request:** `POST …/imports/csv` with `{ fileName, content, mapping }`. The browser reads
  the file; the API parses it again and is the authority.
- **Parser:** `parseCsv` (`@lead-fennec-ai/shared`, no dependency): RFC 4180 with LF/CRLF, a
  byte-order mark and blank lines.
  - Limits: 256 KB of text, 1000 data rows, 30 columns, 1000 characters a cell.
  - Refused by name and line: unclosed or stray quotes, extra cells, blank or duplicate
    headers.
- **Mapping:** each field to a header (case-insensitive), each column once. Only `name` is
  required. A header that isn't in the file is refused by field. Unmapped columns are not
  stored.
- **Safe normalization** (`normalizeImportRow`):
  - control characters and bidirectional overrides removed, spaces collapsed;
  - identity from `normalizeCompanyIdentity`;
  - the domain must be a domain (or comes from the website);
  - the website must be http(s);
  - employees a whole number (thousands separators allowed);
  - the country a two-letter code.
  - Every problem of a row is reported by field. Nothing in a cell is evaluated.
- **Processing:** in the request, in one transaction: the import (CSV, COMPLETED), one source
  record per row (its line in the file, its outcome and issues), companies through
  `saveOrganizations`, and an audit record. A repeated file matches; it doesn't duplicate.

### D-07C-04: API

| Route | Answer |
|---|---|
| `GET …/imports` | Runs, newest first (keyset) |
| `GET …/imports/options` | Usable ICPs (not archived, up to 200), the provider (source, filters, limits, attribution), the CSV limits |
| `POST …/imports/csv` | `201` and the run; `400 validation_failed` ("The file can't be imported as it is.") with `content` or `mapping.<field>` issues |
| `GET …/imports/:importId/results` | What happened to each record, in order; `outcome` filter; keyset pages |
| `POST …/imports/:importId/cancel` | `200` and the run; `409 import_not_cancellable` |

- All need `imports.create`; changes need Origin, session and CSRF. Cache resources:
  `importRuns`, `importOptions`, `importResults`.
- **The run's counts** changed shape (07A had `skipped`):
  - `found`: records received;
  - `saved`: created or matched, of which `created` are new;
  - `excluded`;
  - `failed`;
  - `repeated`: the same company again within a run.
  The run also gained `fileName` and `pagesFetched`. Created counts are read from the source
  records, never stored.
- **JSON bodies up to 1 MB** for every route (`configureApp`, shared by `main.ts` and the
  test harness): a CSV import carries its file. Larger bodies get `413`.
- A malformed page cursor is now `400` (it was unmapped).

### D-07C-05: Spreadsheet formula injection

- **`csvCell` / `toCsv`** (`@lead-fennec-ai/shared`) write every exported cell. A cell a
  spreadsheet would run as a formula (starting with `=`, `+`, `-`, `@`, a tab or a carriage
  return, also after spaces) gets a leading apostrophe (OWASP CSV injection guidance).
  Commas, quotes and line ends are quoted.
- **The error report** (excluded and failed records, one line per reason) is the only export
  so far. It is built in the browser from the API's results, through `toCsv`.
- **Imported values are kept as text.** A company named `=1+2` is stored and shown as
  written, escaped in the page; it is protected wherever it is exported.

### D-07C-06: Screens

- **Imports** (`/workspaces/:workspaceId/imports`, the section is now available):
  - "Find companies": the ICP and how many;
  - "Import a CSV file": the file, then a mapping guessed from the headers;
  - the runs so far.
  - Both forms validate with the shared request schemas. Criteria the provider can't search
    are listed with the API's words.
- **A run** (`…/imports/:importId`, a real 404 for another workspace's):
  - its status and a sentence for it, the counts from the API, and why it failed;
  - "Cancel search" (with confirmation) while queued or running;
  - the results with an outcome filter in the address bar;
  - "Download error report".
  - It refreshes every 5 seconds while queued or running, for at most 30 minutes, visible
    pages only (`IMPORT_RUN_POLL`).
- Built from the shared components (DataTable, CursorPagination, ListFilters with
  useListParams, StatusLabel, ConfirmButton, the form fields, RetryState); checked with axe
  and at 390 px.

### D-07C-07: Tests

| Level | File | What it shows |
|---|---|---|
| Shared | `csv.test.ts` (6) | Parsing (quotes, CRLF, BOM, blank lines, lines), every refusal with its line, formula-safe cells and round trip, row normalization and its issues, the mapping and request rules |
| Integrations | `lead-discovery.test.ts` | Rejected provider records are handed over for reporting |
| Database | `organization-import.integration.test.ts` (4) | A CSV with created, matched (twice in the file, and already saved), excluded (parent domain) and failed rows, in file order with reasons; cleaned values; unmapped columns not kept; a repeat creates nothing; unreadable files, missing columns, no rows, too many rows, too large; tenancy, permissions, workers and platform admins; options |
| Database | `schema`, `billing-schema`, `discovery` suites | The receipt uniqueness `(import, row)`; 15 plan limits; the new counts |
| Worker | `jobs/lead-discovery.integration.test.ts` (7) | A search saved with sources, counts and audit; repeats matched, a suppressed domain excluded; an interrupted run resumed at its token with the same results as an uninterrupted one; cancellation mid-run and before start; refusals, exhausted retries and provider mismatch; paid pages reserved first (none, then one credit); the relay publishes only due tasks of active workspaces, forged messages dropped |
| Worker | `env.test.ts` | (07B) |
| API | `workspaces/imports.integration.test.ts` (4) | A CSV over 100 KB imported over HTTP, results in pages, the failed row, a forged cursor, a repeat; options, list, cancel twice, `409`, strict body; mapping and file errors, 256 KB and 1 MB limits; `403`, `404`, CSRF |
| API review | `route-guards.test.ts`, `api-contract.test.ts` | Five new routes reviewed and matching the endpoint list (43) |
| Web units | `lib/imports.test.ts` (2), `lib/polling.test.ts` | Mapping guesses; the error report keeps formulas as text; the new poll stops within 30 minutes |
| Browser | `e2e/imports.spec.ts` (5) | A search run by the worker code and followed live; a repeat matched and a suppressed domain excluded; a CSV with a guessed mapping, failed rows and the downloaded report (formulas as text, no unmapped column); a repeat import; cancel with confirmation, a failed run's reason, an unsearchable profile; axe; 390 px |

## 08A: Contact enrichment contracts and providers (2026-11-06)

**Basis.** The plan is still missing (O-01); this follows the 08A prompt ("ContactEnrichmentAgent
input/output schemas and separate PeopleSearchProvider, ContactEnrichmentProvider and
EmailVerificationProvider interfaces"; "deterministic fake implementations returning verified,
risky, unknown and invalid results with provenance and retrieval timestamps"; "role relevance
ranking and contact identity normalization"; "no schema equates an email-shaped string with
verified status"). It replaces the provisional `LeadDataProvider` and the old verification
interface (D-02C-05), which only their fakes and tests used. No live provider, route, table or
migration: contracts and fakes only. No provider-specific detail was implemented.

### D-08A-01: Contact identity

`normalizeContactIdentity({ firstName, lastName, email?, linkedinUrl?, organizationDomain? })`
(`@lead-fennec-ai/shared`, next to the email, domain and company helpers):

- **Names:** NFC, trimmed, spaces collapsed, at most 100 characters each. `nameKey` is "first
  last" in lower-case ASCII without accents or punctuation ("José O'Brien-Núñez" →
  "jose o brien nunez").
- **Email:** `normalizeEmail`. **LinkedIn:** `normalizeLinkedinUrl` keeps only http(s)
  `linkedin.com` hosts with an `/in/<slug>` path, as `https://www.linkedin.com/in/<slug>`.
  **Company domain:** `normalizeDomain`.
- **Malformed is an error, not dropped:** a given email, profile or domain that doesn't
  normalize refuses the contact, so nothing half-valid is saved.
- **Key:**
  - `email:<address>` when there is an address;
  - else `linkedin:<slug>`;
  - else `name:<company domain>:<name key>`;
  - else the person can't be identified (an error).

### D-08A-02: The ContactEnrichmentAgent's contract

`packages/shared/src/contracts/contact-enrichment.ts`:

- **Input** (`contactEnrichmentInputSchema`, strict): one organization (`id`, `name`, `domain`
  or null), the targeting (up to 30 titles, 10 seniorities, as an ICP writes them) and
  `maxContacts` (1–25). Nothing else reaches the agent.
- **Output** (`contactEnrichmentOutputSchema`, then `enrichedContactSchema` per contact, both
  strict):
  - names, title, seniority (one of 11 levels, or null), LinkedIn URL;
  - an `email` of `{ address, provenance }` or null;
  - `provenance` (`provider`, `externalId`, `retrievedAt`, `attribution`), required on the
    contact and on its address.
- **`parseContactEnrichmentOutput(raw, input)`** treats the answer as untrusted:
  - **The whole answer is refused** when it isn't the schema or has more contacts than asked
    for.
  - **Each contact is accepted or refused on its own, with its reasons by path:**
    - malformed fields (including an extra key such as a status or a flag);
    - missing or empty provenance;
    - an address that isn't one;
    - an identity that can't be normalized;
    - the same person twice.
  - **An address at another domain** than the company's (or its subdomains) is dropped with a
    warning: it may be a personal address.
  - **Ranking** is done by application code (D-08A-03), most relevant first; ties by
    seniority, then name.

### D-08A-03: Role relevance

- **`normalizeTitle`** spells out abbreviations ("Sr. VP, Sales" → "senior vice president
  sales").
- **Seniority:**
  - `inferSeniority` reads a level from a title ("Chief Revenue Officer" → `c_suite`, "Vice
    President" → `vp`, not `c_suite`);
  - `parseSeniority` reads an ICP's words ("Directors", "C-level");
  - levels: owner, founder, c_suite, partner, vp, head, director, manager, senior, entry,
    intern.
- **`rankRoleRelevance(person, targeting)`**, 0–100, deterministic:
  - title: the same title 70, every word of a target title 55, otherwise the share of shared
    words, up to 40;
  - seniority: a target level 30, a level next to one 15;
  - with no targets, seniority alone orders people (more senior first, at most 10).
  - It returns the matched title, the seniority and short reasons.
- The weights are a starting point chosen without the plan (O-34).

### D-08A-04: Email checks and send eligibility

- **Statuses:** `verified`, `risky`, `unknown`, `invalid` (stored later as the existing
  `verification_status` values `VALID`, `RISKY`, `UNKNOWN`, `INVALID`).
- **An email check** (`emailCheckSchema`, strict): the address, the status, a short reason
  code, the verification provider and `checkedAt`. It is the only place a status exists.
- **No schema equates an address with "verified":**
  - the agent's output has no status field, and strict schemas refuse one;
  - an enrichment provider's own claim (`provider_verified`) is kept as an untrusted claim on
    its result and never becomes a status;
  - there is no boolean "verified" anywhere.
- **`emailSendEligibility(address, check, now)`** parses the check itself:
  - `eligible` (automatic) only for a well-formed `verified` check of that same address, from
    the last 30 days and not from the future;
  - `risky` and `unknown`: `needs_review`, never automatic, whatever their age;
  - `invalid`: `blocked`;
  - verified but older than 30 days: `stale` (check again);
  - anything else (no check, an email-shaped string, a bare status, another address's check,
    an unknown provider, a malformed time): `unverified`.
- This is the rule later tasks call before an address may be used automatically; it decides,
  never a model.

### D-08A-05: Provider interfaces, fakes and the agent

- **`PeopleSearchProvider`**: people at a company for titles and seniorities, paged by
  opaque token. Names, titles, seniority and profile, **never email addresses**. Source,
  attribution, page size, `retrievedAt`, credits.
- **`ContactEnrichmentProvider`**: a work address for one person, with the provider's claim
  (untrusted), `retrievedAt` and credits.
- **`EmailVerificationProvider`**: the status of one address, with a reason and `checkedAt`.
- The three are separate; the provider set has `peopleSearch`, `contactEnrichment` and
  `emailVerification` (the old `leadData` is gone).
- **Fakes** (`packages/integrations/src/fake-contacts.ts`), deterministic, synthetic:
  - **People:** 8 people per company, picked from fixed name and role lists by a stable hash
    of the domain. No profile URLs, `raw.synthetic`. Filtered by a shared title word or a
    seniority asked for.
  - **Addresses:** `first.last@<company domain>` for five in six people, none for the rest.
    The claim alternates.
  - **Checks:**
    - bad syntax and the reserved `.invalid` domain are invalid; `catchall` in the local part
      is risky; overrides are allowed;
    - otherwise a stable hash makes about half verified, a fifth risky (`catch_all`), a fifth
      unknown (`timeout`) and a tenth invalid (`no_mailbox`);
    - every result carries the injected clock's time.
- **`ContactEnrichmentAgent`** (`contact-enrichment.ts`), deterministic, no model:
  1. people search (up to 3 pages);
  2. ranking by role relevance (people who match nothing are left out when there are
     targets);
  3. addresses for the top `maxContacts` only, when the company has a domain;
  4. the answer, with provenance from each provider, goes through
     `parseContactEnrichmentOutput`.
  - **`checkContactEmails`** verifies each address and attaches `emailSendEligibility`.
  - Persisting contacts, budgets for paid lookups and a live provider are later tasks.
- **Verification provider:** none is chosen. `EMAIL_VERIFICATION_PROVIDERS` lists only `FAKE`
  until one is, after its official docs are checked (O-34).

### D-08A-06: Tests

| File | What it shows |
|---|---|
| `packages/shared/src/contracts/contact-enrichment.test.ts` (11) | Identity keys (email, LinkedIn, company and name) and refusals (empty or unusable names, bad email, non-LinkedIn or non-profile URL, nothing to identify); title and seniority reading; ranking (same title above similar, seniority and its neighbours, no targets); accepted contacts ranked; malformed and unattributed contacts refused with paths; no answer can claim a status, a verification or eligibility; addresses at other domains dropped, subdomains kept; answers too long or not answers refused; only a fresh verified check of the same address is automatic; risky and unknown never are; anything but a real check is unverified |
| `packages/integrations/src/contact-enrichment.test.ts` (6) | Fixed synthetic staff with no addresses or profiles, paged; addresses on the company domain only, with both claims; all four statuses, the same every time, and the rules; the agent's ranked, attributed answer, addresses only for the chosen people, the same twice; no domain gives no lookups; unattributed provider records refused; eligibility follows the check, not the provider's claim |
| `packages/integrations/src/fakes.test.ts` | The provider set's new keys |

## 08B: Apollo people lookup and contact enrichment (2026-11-06, finished 2026-11-08)

**Basis.** The plan is still missing (O-01); this follows the 08B prompt:
- "the authorized provider's people lookup and separate contact enrichment stage using current
  official documentation";
- "add the chosen verification service behind its interface; if no service is selected, retain
  the fake adapter and record a live integration blocker";
- "track costs, provider IDs and retryable versus permanent failures";
- "never guess email addresses and label them verified".

The completion check asks that provider fixture tests cover missing emails, partial records,
quota exhaustion, repeated provider IDs and verification failures, and that unconfigured live
adapters fail closed. The code was committed in `1fe897d` and `d0cecc4`; this records it.

### D-08B-01: The provider and its documentation

- **Provider:** Apollo, the provider authorized for 07B.
- **Documentation checked on 2026-11-06:**
  - People API Search: https://docs.apollo.io/reference/people-api-search (page updated
    2026-09-29);
  - Bulk People Enrichment: https://docs.apollo.io/reference/bulk-people-enrichment (page updated
    2026-11-04);
  - People Enrichment: https://docs.apollo.io/reference/people-enrichment.
- **API version:** Apollo's REST API v1, called over HTTPS with no SDK. The 07B client was moved
  into `apollo-client.ts`, and both adapters share it: the key in the `x-api-key` header only,
  redirects refused, a deadline per request and bounded retries (D-07B-04).
- **Endpoints:**
  - `POST /api/v1/mixed_people/api_search`: 0 credits, partial records (no address, a shortened
    last name); at most 100 per page, 500 pages and 50,000 records. Sent: `person_titles[]`,
    `person_seniorities[]`, `q_organization_domains_list[]`, `page` and `per_page`;
  - `POST /api/v1/people/bulk_match`: up to 10 people per call; `credits_consumed`; `null` in
    place for a person it can't match.
- **Never requested:** personal emails, phone numbers or waterfall enrichment (no `reveal_*` or
  waterfall parameters).

### D-08B-02: Two separate stages

- **People lookup** (`ApolloPeopleSearchProvider`) finds people at one company for the targeted
  titles and seniorities. Its records are partial (`ProviderPerson`).
- **Contact enrichment** (`ApolloContactEnrichmentProvider`) completes the chosen people, in
  batches of at most 10. It is a separate provider behind its own interface.
- **The ContactEnrichmentAgent** runs both:
  1. search;
  2. rank by `rankRoleRelevance` (08A, application code);
  3. enrich the chosen few;
  4. check the answer with `parseContactEnrichmentOutput`.

  A repeated provider id is kept once and sent once. A person the search says has no address
  isn't looked up, so isn't paid for. A record still partial after enrichment is refused.

### D-08B-03: Addresses are never guessed, and never verified by a claim

- An address Apollo extrapolated (`extrapolated_email_confidence` present) is a guess, and is
  dropped. So are malformed addresses and addresses outside the company's domain (D-08A-02).
- Apollo's `email_status` is kept only as the provider's claim. An address's status comes only
  from an email check (D-08A-04), and a missing address stays missing.

### D-08B-04: Costs, provider ids and failures

- **Costs per run** (`EnrichmentUsage`):
  - search and enrichment requests;
  - credits summed as Apollo reports them (fractions kept; null when never reported);
  - repeated provider ids, people skipped without an address, unmatched people and dropped
    addresses.
- **Provider ids:** every person keeps Apollo's id, so a later run can recognize them.
- **Failures** (`ProviderError`):

  | Answer | Code |
  |---|---|
  | 401 | `unauthorized` |
  | 403 (no API access on the plan, or a key not scoped to the endpoint) | `forbidden` |
  | 429, platform load | `rate_limited`, retry after the suggested time (60 s documented) |
  | 429, the day's allowance used | `quota_exceeded` |
  | other 429 | `rate_limited`, with Retry-After |
  | 5xx | `unavailable` |
  | an answer that doesn't line up with the request | `bad_response` |

  `rate_limited`, `unavailable` and `timeout` are retryable; every other code is permanent and
  needs a person.
- **Email checks:** `checkContactEmails` records each failed check with its code and whether it
  is retryable. The address stays unverified.

### D-08B-05: The verification service, and failing closed

- **No verification service is selected** (the user's answer, 2026-11-06). The fake stays.
  Outside development and test, `createEmailVerificationProvider` throws
  `LiveProvidersUnavailableError`, so no address can be checked or become automatically
  eligible (O-35).
- `createContactDataProviders`: the fakes in development and test; Apollo with `APOLLO_API_KEY`
  in staging and production; without a key, `LiveProvidersUnavailableError`.
- **Fakes** can produce every case the tests need: partial records, repeated ids, guessed
  addresses, people without addresses, enrichment failures and verification failures.
- **Not in 08B:** storing contacts, queuing enrichment, budgets and screens (08C).

### D-08B-06: Tests

| File | What it shows |
|---|---|
| `packages/integrations/src/apollo-people.test.ts` (7) | The documented search endpoint and parameters, partial records, empty results, no company domain refused before any call; one enrichment call with provider ids, claims and missing addresses apart and credits counted; guessed and malformed addresses dropped, fractional credits kept; quota exhaustion, bad keys and misaligned answers; the agent on Apollo (repeated ids once, people without an address skipped, unmatched refused); fakes locally, Apollo with a key, failing closed without one |
| `packages/integrations/src/contact-enrichment.test.ts` (8) | Fakes and the agent: partial search records completed through enrichment, a repeated id kept once, records left partial refused, missing and guessed addresses reported, provider failures passed on, only verified addresses automatically eligible, failed checks recorded as retryable or permanent |
| `packages/integrations/src/registry.test.ts` | No live provider set for staging or production |

## 08C: Contact enrichment jobs, deduplication, contact quality and rechecks (2026-11-08)

**Basis.** The plan is still missing (O-01); this follows the 08C prompt:
- "queue bounded enrichment work for discovered organizations using target roles, seniority,
  location and exclusions";
- "deduplicate contacts by tenant-scoped normalized identity and provider mappings";
- "store source, confidence, verification result and freshness";
- "add job progress and a manual recheck action with limits";
- "expose contact quality in the lead API and UI".

The completion check: repeated enrichment doesn't duplicate contacts or charge the same logical
usage event twice; ineligible results are kept with reasons but can't enter sending.

### D-08C-01: A run is an import: bounded, with its inputs copied in

- **What a run is:** an `imports` row with the new source `CONTACT_ENRICHMENT` (its enum value
  has its own migration). A member asks for one from a finished company run (a search or a CSV
  import): `POST /workspaces/:workspaceId/imports/:importId/enrichment`. The route needs
  `imports.create`; the repository also checks `contacts.write`.
- **Bounds:**
  - the first 25 companies the run saved (created or matched, in the run's order); companies
    beyond that are counted (`beyondLimit`), not covered;
  - at most 5 people a company (3 by default).
- **Targets:** the ICP's titles, seniorities and countries, copied into `search_filters`. The
  ICP is the run's, or the campaign's for a CSV import.
- **Campaign (optional):** its exclusions, normalized, are copied into `source_metadata`. Its
  lead list is where people go (`lead_list_id`).
- **Immutable:** the 07A trigger already covers the ICP, provider, targets, company count, input
  hash and inputs. A new trigger covers `lead_list_id`. Checks:
  - the search fields are present for both kinds of run;
  - at most 25 companies;
  - the companies done never exceed the total.
- **Provider:** `contactDataDeclaration` gives the fakes in development and test, and Apollo in
  staging and production. The API records it without credentials. The worker refuses a run made
  for another provider (`provider_mismatch`).
- **Progress:**
  - `pages_fetched` counts the companies done;
  - the row counts are people: found, saved, excluded, failed;
  - a company skipped before the provider is asked is a source record whose payload has
    `kind: "company"`, counted as `companies.skipped`.

  `GET /workspaces/:workspaceId/imports/:importId` shows it all (`importRunSchema.enrichment`).

### D-08C-02: One person, one contact

- **Saving:** people are saved through `saveContacts` (`contact-store.ts`), inside the company's
  transaction, under an advisory lock per workspace.
- **Matching order:**
  1. **Provider mapping:** an earlier source record of the same provider and person id that
     points at a contact.
  2. The normalized address.
  3. The LinkedIn profile.
  4. The same name at the same company, when one of the two has no address.
- **New column** `contacts.name_key` (from `normalizeContactIdentity`), with an index on
  (tenant, organization, name key). That index replaced the one on (tenant, organization),
  which is its prefix; the schema test now expects it. Another new index covers
  (tenant, LinkedIn URL).
- **Matched contacts:** only missing details are filled in. An address another contact holds
  stays with that contact.
- **Every person gets a source record:**
  - the provider and its id for the person;
  - the payload: name, title, company, address, the provider's claim, the address's provenance,
    the role match and its reasons, the check made, and what was received;
  - `confidence`, a new column: the role match, 0–100 (`rankRoleRelevance`, application code);
  - `fetched_at`: the data's freshness.
- **Outcome check (relaxed):** a saved person's record may carry reasons, and an excluded
  person's record still names the company.

### D-08C-03: Repeated enrichment doesn't look people up again

- **Reusing people:** the agent takes a `known(ids)` callback. Before enrichment, it asks which
  chosen people the workspace looked up in the last 30 days: a created or matched record of the
  same provider and id, not itself a reuse. Those people are never sent to enrichment, so never
  paid for again. They are recorded as matched with `reused: true`. A reuse doesn't make the
  data fresher.
- **Checks:** an address checked in the last 30 days isn't checked again (`freshChecks`).
- **Within a run:** each company is saved once. Under a row lock, `saveCompany` compares the
  run's count of companies done with the company's index, so a repeated save saves nothing.

### D-08C-04: Usage counted when the company is saved

- **Reserving:** a paid people provider (anything but the fake) reserves `LEAD_ENRICHMENTS`
  before a company is looked up. The quantity is the people asked for; the key names the run,
  the company and the attempt.
- **Settling:** the hold is settled in the transaction that saves the company. `settleReservation`
  was taken out of the usage repository for this:
  - **committed** with the people looked up: the provider's reported credits, rounded up, at
    most the hold;
  - **released** when nothing was used, and when a company's save repeats, is cancelled or fails.

  So a company of a run is charged exactly once, and a retry's earlier hold never counts.
- **Verification:** only the free fake exists (O-35). A live verifier must reserve
  `EMAIL_VERIFICATIONS` the same way; the worker says where.

### D-08C-05: Location, exclusions, and people who can't be emailed

- **Location** is decided per company:
  - a company known to be outside the ICP's countries is skipped before the provider is asked
    (excluded, nothing paid);
  - a company whose country is unknown is looked up, and send eligibility decides on the
    person's country later (10B).
- **Other company skips:**
  - no domain: failed, because its people can't be matched or emailed at work;
  - its domain, or a parent domain, on the do-not-contact list or among the campaign's
    excluded domains: excluded.
- **Excluded people:** an address, or its domain, on the do-not-contact list or among the
  campaign's excluded addresses and domains. The person is excluded with the reason and not
  saved.
- **People on an excluded lead list:** someone on a lead list the campaign excludes is saved, but
  not added to the campaign's list.
- **People who can't be emailed:** saved people without an address, or whose address doesn't
  accept email, are kept with the reasons (on their record). They are never added to the
  campaign's lead list. Send eligibility blocks them (`no_email`, `email_invalid`), and a block
  can never be overridden.
- **People who need a decision:** risky, unknown and unchecked addresses are added to the list
  and need a person's decision (review).

### D-08C-06: Contact quality

- **Decided** by `contactQuality` (shared), from stored facts:
  - the newest lookup record (not a reuse), with its confidence and the provider's claim;
  - the newest check of the current address;
  - the rechecks.
- **Levels:**
  - `good`: a fresh verified check, from a fresh source;
  - `review`;
  - `unusable`: no address, or an invalid one.
- **Shown** in full in the lead view (`quality`), and in short in the leads list.
- **Never** stored, cached or treated as permission. It doesn't decide sending: eligibility does
  (10B).

### D-08C-07: Rechecks

- **Route:** `POST /workspaces/:workspaceId/contacts/:contactId/recheck`, which needs
  `verifications.run` (only Client Admins by default). Audited.
- **Limits** (429 with Retry-After): once a contact in 24 hours, and 50 a workspace in 24 hours.
  They are counted from job tasks and serialized by an advisory lock.
- **Other answers:**
  - repeated while queued: `already_queued`;
  - no address: 409 `no_email_address`;
  - no verification service in this environment: 409 `verification_unavailable`
    (`emailVerificationAvailable`). The job also fails closed with that code.
- **The job:** `contact_verification.recheck` runs on the `contact_enrichment` worker, with
  `contact_enrichment.run`, on its own queue (`lead-fennec-enrichment`). Its result counts only
  if the contact still has that address.

### D-08C-08: Tests

| File | What it shows |
|---|---|
| `packages/shared/src/contracts/enrichment-runs.test.ts` (7) | Quality: good only with a fresh verified check from a fresh source; a provider's claim is never a check; risky, unknown, old checks and old sources need review; no address or an invalid one is unusable; another address's check is ignored; when the next recheck may be asked for; the request's bounds |
| `packages/integrations/src/contact-enrichment.test.ts` (+1) | People the workspace knows are never looked up or paid for; with everyone known, the enrichment provider isn't asked |
| `packages/database/src/enrichment.integration.test.ts` (8) | Refused requests; inputs copied and immutable; a company saved once with its people, checks, reasons and usage, and a repeated save that saves and charges nothing; country and do-not-contact skips; matching instead of duplicating, reuse of recent lookups; quality in the lead views; recheck limits and failing closed; workspace isolation |
| `apps/worker/src/jobs/contact-enrichment.integration.test.ts` (6) | The real agent with the fakes: people saved with source, checks and quality; repeated enrichment on a paid provider that neither duplicates, looks up nor charges again; a retried run that resumes and charges each company once; people who can't be emailed kept with reasons, off the list and blocked; rechecks and failing closed; provider mismatch and cancellation |
| `apps/api/src/workspaces/enrichment.integration.test.ts` (4) | 202 with progress; validation and other workspaces (404); the people list and quality in the lead views; recheck permissions, limits (429 with Retry-After), 409s |
| `apps/web/e2e/contact-enrichment.spec.ts` (3) | Find people from a finished search, progress and outcomes; asking again matches people; quality on the lead page and in the leads list; a recheck, then the daily limit; axe on every screen |

## 09A: Safe website fetching (2026-11-06)

**Basis.** The plan is still missing (O-01); this follows the 09A prompt ("a server-side fetch
service with public-address validation before connection and after every redirect"; "block
loopback, private, link-local and cloud metadata destinations, including IPv6 and alternate
encodings"; "limit redirects, time, response size, content type and per-domain concurrency";
"respect configured access restrictions"; "extract useful text without scripts or navigation
noise and retain URL, retrieval time and content hash"). No route, table, migration or screen
changed, and no job fetches pages yet: the research task that uses the fetcher comes later.
08B is still in progress and 08C waits; 09A depends on neither.

### D-09A-01: Which destinations are fetched

**Sources, checked 2026-11-06:**
- the IANA IPv4 and IPv6 Special-Purpose Address Registries (both last updated 2025-10-09):
  https://www.iana.org/assignments/iana-ipv4-special-registry/ and
  https://www.iana.org/assignments/iana-ipv6-special-registry/;
- AWS EC2 instance metadata (169.254.169.254 and `[fd00:ec2::254]`):
  https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/instancedata-data-retrieval.html;
- Google Compute Engine metadata (`metadata.google.internal`, `metadata.goog`,
  169.254.169.254, `fd20:ce::254`):
  https://docs.cloud.google.com/compute/docs/metadata/querying-metadata;
- Azure's 168.63.129.16 (WireServer: a public address that only the Azure host answers):
  https://learn.microsoft.com/en-us/azure/virtual-network/what-is-ip-address-168-63-129-16;
- Alibaba Cloud ECS instance metadata (100.100.100.200):
  https://www.alibabacloud.com/help/en/ecs/user-guide/view-instance-metadata/.

**Only globally reachable unicast addresses are fetched** (`checkAddress`,
`packages/integrations/src/website/address.ts`):
- **IPv4 refused:** 0.0.0.0/8, 10/8, 100.64/10 (shared), 127/8, 169.254/16, 172.16/12,
  192.0.0/24, 192.0.2/24, 192.88.99/24, 192.168/16, 198.18/15, 198.51.100/24, 203.0.113/24,
  224/4 (multicast), 240/4 and 255.255.255.255.
- **IPv6:** only 2000::/3 is allowed, and within it not 2001::/23 (IETF assignments, Teredo
  included), 2001:db8::/32 or 3fff::/20 (documentation). Refused besides: `::`, `::1`,
  fc00::/7 (unique local), fe80::/10, fec0::/10, ff00::/8.
- **IPv6 forms that carry an IPv4 address** are always refused: IPv4-mapped `::ffff:0:0/96`,
  IPv4-compatible `::/96`, NAT64 `64:ff9b::/96` (and `64:ff9b:1::/48`), 6to4 `2002::/16`.
  The reason names the embedded rule when the IPv4 address is internal (`::ffff:127.0.0.1` is
  "loopback"), else `ipv4_embedded`.
- **Cloud metadata** addresses are checked first, so the reason says `metadata`:
  169.254.169.254, 169.254.170.2 and 169.254.170.23 (AWS ECS and EKS), 100.100.100.200
  (Alibaba), 168.63.129.16 (Azure: public, so only this rule refuses it), `fd00:ec2::254`,
  `fd00:ec2::23` and `fd20:ce::254`.

**Names refused before any lookup** (`checkHostName`; the DNS answer check is the real guard,
this says why early): single labels (`localhost`, `metadata`, `intranet`); `localhost`,
`local`, `localdomain`, `internal`, `intranet`, `lan`, `home`, `home.arpa`, `corp`,
`private`, `svc`, `arpa`, `onion`, `alt` and `invalid` and their subdomains;
`metadata.goog` and `metadata.google.internal`. The reserved `.example` and `.test` names
(RFC 2606) are refused by the live fetcher and served only by the fake.

**Alternate encodings.** The WHATWG URL parser (Node's `URL`) normalizes the host before any
check: integer (`2130706433`), hex (`0x7f000001`), octal (`0177.0.0.1`), short (`127.1`),
percent-encoded and full-width forms become the dotted address, IPv6 literals their canonical
form (`[::ffff:127.0.0.1]` is `[::ffff:7f00:1]`), and international names are IDNA-encoded.
The address parser then accepts canonical text only, so no other form reaches a connection.
Zone ids (`%eth0`) are refused. Tests cover each form, metadata included (`0xa9fea9fe`,
`2852039166`, `0251.0376.0251.0376`).

**Also refused:** schemes other than http and https; a user name or password in the URL;
ports other than 80 and 443 (the policy can list others); URLs over 2048 characters.

### D-09A-02: Checked before connecting, at every hop

- **Order for the first URL and every redirect:** parse and check the URL, then the access
  policy, then DNS. Every address of the answer is checked (one internal address refuses the
  whole answer), then robots.txt, then a per-host slot, then the connection.
- **No second lookup:** the socket is opened to the checked address itself (`directDial`:
  `net.connect` or `tls.connect` with the IP as host), so the name can't change between the
  check and the connection (DNS rebinding). The Host header, TLS SNI and the certificate check
  use the URL's name (`rejectUnauthorized: true`; an IP literal is checked against the
  certificate's IP addresses).
- **No HTTP agent:** one request per connection (`Connection: close`), so no pooled
  connection and no proxy from `HTTP_PROXY` or `NODE_USE_ENV_PROXY` (only agents built with
  `proxyEnv` use them). The HTTP parser stays strict (`insecureHTTPParser: false`).
- **Redirects** (301, 302, 303, 307, 308) are followed by the fetcher, never by the HTTP
  client. Each `Location` is resolved against the current URL and checked as a new URL
  (scheme, credentials, port, name, address, policy, robots.txt) with a fresh lookup, so a
  name that turns internal after the first hop is refused at the next one. Loops are refused.
- **Requests:** GET only, `User-Agent: LeadFennecBot/0.1`, `Accept`, and `Accept-Encoding:
  gzip, deflate, br`. Never cookies, credentials or a referrer.
- **DNS:** `dns.lookup` (the operating system's resolver), all addresses, IPv4 first; the
  lookup races the time budget.
- **Docs checked 2026-11-06** for Node.js 24 (the pinned runtime is 24.19.0):
  - https://nodejs.org/docs/latest-v24.x/api/http.html: `createConnection`, `maxHeaderSize`,
    `signal`, `insecureHTTPParser`, `agent: false`, built-in proxy support;
  - https://nodejs.org/docs/latest-v24.x/api/dns.html: `lookup` with `all` and `order`,
    `getaddrinfo` on the threadpool.

### D-09A-03: Limits

| Limit | Default | Allowed range | Notes |
|---|---|---|---|
| Redirects | 5 | 0–10 | More is `too_many_redirects` |
| Time | 15 s | 0.1–60 s | One budget for the whole fetch: waiting for a slot, DNS, robots.txt, every hop and the body |
| Body | 2 MiB | 1 KiB–10 MiB | After decompression and on the wire. A larger `Content-Length` is refused before reading, and a stream stops at the limit |
| Headers | 16 KiB | 1–64 KiB | Node's `maxHeaderSize` |
| Content types | text/html, application/xhtml+xml, text/plain | fixed | A missing type is refused; no sniffing |
| Encodings | identity, gzip, deflate, br | fixed | Decompressed as a stream, so a decompression bomb stops at the body limit. Unknown or stacked codings are refused |
| Per-host concurrency | 2 | 1–8 | In this process, per host with `www.` folded; waiters queue in order |
| Text | 100,000 characters | 100–500,000 | `textTruncated` says when it was cut |
| Links | 100 | 0–500 | |
| Markup | 512 open elements, 100,000 elements | fixed | `too_complex` (D-09A-05) |
| Ports | 80, 443 | up to 16 | |

- **Ceilings:** `websiteFetchPolicySchema` (zod) checks every value, so configuration can
  tighten the fetcher but never make it unbounded.
- **Concurrency:** `HostConcurrencyLimiter` holds counts only (no page data), so one limiter
  can serve every workspace. It limits per host, not per registrable domain (there is no
  public suffix list), and not across worker processes (O-36).

### D-09A-04: Access restrictions

"Configured access restrictions" is read as two things (O-36): the operator's lists, and the
site's own robots.txt.

- **Operator lists:** `WEBSITE_FETCH_BLOCKED_HOSTS` (never fetched, with subdomains) and
  `WEBSITE_FETCH_ALLOWED_HOSTS` (when set, only these and their subdomains). Both are
  worker variables, comma-separated, normalized like company domains (`normalizeDomain`).
  An invalid entry stops the worker at startup. They are checked at every hop, robots.txt
  hops included, and the fake applies them too.
- **robots.txt** (RFC 9309, https://www.rfc-editor.org/rfc/rfc9309.html, checked 2026-11-06):
  - **Groups:** the product token `LeadFennecBot`, matched case-insensitively (a version such
    as `/1.0` is ignored). All matching groups are merged; with none, the `*` groups apply.
  - **Rules:** the longest match wins and allow wins a tie; `*` and `$` work as wildcards;
    percent-encoding is normalized before comparing. `/robots.txt` itself is always allowed.
  - **Reading:** at most 512 KiB (the RFC's minimum is 500 KiB), fetched through the same
    checks, redirects across hosts included.
  - **Answers:**
    - 2xx is parsed;
    - 4xx means no rules;
    - more redirects than allowed is treated as no rules;
    - 5xx, no answer, or a redirect to a refused destination: the RFC says to assume
      complete disallow, so the page is refused as `robots_unreachable` (retryable, try
      later) rather than fetched.
  - **Cache:** 24 hours (15 minutes for an unreachable file), keyed by cache scope (the
    workspace) and origin, with at most 1000 entries per fetcher, so nothing cached is shared
    between workspaces.
  - Crawl-delay and sitemaps are ignored.

### D-09A-05: Text extraction

- **Parser:** parse5 **8.1.0** (MIT; published 2026-11-01, older than pnpm's
  `minimumReleaseAge`; its one dependency is entities 9.0.0, BSD-2-Clause). It implements the
  WHATWG HTML parsing algorithm that browsers use. The tree is only read: no script runs, no
  style or resource loads. API checked against its bundled type definitions.
- **Content:** `<main>` (or `role="main"`), else `<body>`. Dropped:
  - never text: script, style, noscript, template, svg, math, iframes and frames, object,
    embed, canvas, audio, video, form controls, and the head;
  - navigation: nav, aside, dialog and menu; a page-level header or footer (not inside an
    article, main or section);
  - hidden content: the `hidden` attribute, `aria-hidden="true"`, inline `display: none` or
    `visibility: hidden`;
  - roles: navigation, banner, contentinfo, complementary, menu, menubar, search, dialog,
    alertdialog, toolbar, tablist and tooltip;
  - ids and classes naming cookie or consent banners, breadcrumbs, skip links or
    screen-reader-only text.
- **Text:** block elements become lines, whitespace collapses, and the text is NFC with
  control, bidirectional and zero-width characters removed (they could hide or reorder text
  when it is shown).
- **Metadata:** the title (300 characters at most), the meta or `og:` description (500), and
  `html lang` when well formed.
- **Links:** from the whole body, navigation included. Absolute http(s) only, without
  fragments or credentials, deduplicated, 100 at most, marked same-site. They are untrusted:
  follow them only through the fetcher.
- **Decoding:** a byte-order mark first, then the Content-Type charset, then a `<meta>`
  charset in the first 1024 bytes, else UTF-8 (WHATWG labels through `TextDecoder`; invalid
  bytes become U+FFFD).
- **Hostile markup:** parse5's work grows with the square of the nesting depth (20,000
  nested `<div>` took 6.4 s here, so a 2 MiB page could take minutes), and misnested
  formatting tags can multiply the elements created. A tree adapter caps open elements at 512
  (Chromium's tree-depth limit) through parse5's `onItemPush` / `onItemPop` hooks, and
  elements at 100,000. A page over either cap is refused as `too_complex`, in milliseconds.

### D-09A-06: What a fetch returns

- **`WebsitePage`:**
  - addresses: `requestedUrl` and `finalUrl` (without fragments), and `redirects` (URL and
    status of each hop);
  - the answer: `status`, `contentType`, `charset`, and `retrievedAt` (one clock, when the
    body was received);
  - hashes: `byteLength`, `contentSha256` (SHA-256 of the body after decompression) and
    `textSha256`;
  - content: `title`, `description`, `language`, `text`, `textTruncated` and `links`;
  - `source`: `LIVE` or `FAKE`.
- **`WebsiteFetchError`:** a code and `retryable`, plus `status`, `reason` and `url` when
  they apply. The message is ours; a site's own text or body never travels with it.
  - **Retryable:** `dns_failed`, `timeout`, `connection_failed`, `robots_unreachable`, and
    `http_error` for 408, 425, 429 and 5xx.
  - **Permanent:** every refusal of a destination or a policy, `robots_disallowed`,
    `host_not_found`, redirects, sizes, types, encodings, `too_complex`, `tls_failed`
    (EPROTO included) and `bad_response`.
- **Nothing is stored yet.** Mapping pages to `source_records` (payload hash) and `evidence`
  (`sourceUrl`, `excerpt`, `capturedAt`) belongs to the research task.

### D-09A-07: Environments, fake and tests

- **`createWebsiteFetcher(appEnv, config)`:**
  - development and test get `FakeWebsiteFetcher`. It never connects: pages are synthetic,
    built from the host name, or scripted by a test (pages, redirects, failures). It applies
    the same URL checks and access lists, and serves only `.example` and `.test` names.
  - staging and production get `SafeWebsiteFetcher`.
- **Wiring:** `ProviderSet.websiteFetcher`. The worker builds the fetcher at startup so a bad
  restriction stops it early; no job uses the fetcher yet.
- **Tests:** a local HTTP fixture server on 127.0.0.1 and a fake resolver. Names "resolve" to
  public addresses, and a test dialer connects those addresses to the fixture, so the real
  HTTP client, redirects, limits and decoding run without leaving the machine. The network
  guard stays on.

| File | What it shows |
|---|---|
| `website/address.test.ts` (166) | Every IPv4 and IPv6 rule, metadata addresses, embedded IPv4 forms, non-canonical text refused; internal and reserved names; the alternate encodings of loopback and metadata refused before any lookup; schemes, credentials, ports, length; public names, literals and IDNA accepted; a mixed DNS answer refused |
| `website/fetcher.test.ts` (87) | A page through the checked address, with URL, time, both hashes, Host and User-Agent and no cookies; gzip, deflate, br, plain text, other charsets, IPv6 answers and literals. Unsafe URLs and DNS answers refused with no lookup or connection. DNS changes between fetches and between hops refused. Redirects to internal addresses, names, schemes and ports refused without connecting; checked redirects followed and recorded; redirect limits, loops, missing locations. Declared and streamed oversize, decompression bomb, oversized headers. Unsupported types and encodings, corrupt compression, markup too complex. Timeouts (no answer, dripping body, endless DNS), cancellation. HTTP errors (retryable or not), refused connection, malformed HTTP. Per-host concurrency (2 in flight, others queued, other hosts unaffected, waiting times out). Blocked and allowed hosts. robots.txt (our group, cache per workspace, 404, 503, redirects, robots.txt itself). The production dialer connects to the given address without DNS; TLS fails closed; error mapping |
| `website/robots.test.ts` (23) | RFC 9309 groups, precedence, patterns and percent-encoding |
| `website/text.test.ts` (15) | Main content without the noise listed above; title, description, language, links; truncation; nesting up to the limit; hostile markup refused fast; control and bidi characters; charset detection; plain text |
| `website/fake.test.ts` (9) | The fake's synthetic pages, its refusals, scripted pages, redirects, failures and policy; `createWebsiteFetcher` per environment and its validation; the limiter's order, single release and abort |
| `apps/worker/src/env.test.ts` | The two host lists parsed and refused when invalid |
| `fakes.test.ts` | The provider set's new key |

## 09B: Model provider, OpenAI adapter, WebsiteResearchAgent (2026-11-07)

**Basis.** The plan is still missing (O-01); this follows the 09B prompt:
- "the model-provider abstraction, a real OpenAI adapter using current official documentation,
  a fake adapter, runtime validation and WebsiteResearchAgent";
- "inputs are bounded page extracts and campaign context; outputs separate verified facts,
  hypotheses, unknown fields, evidence IDs and confidence";
- "prompt/schema/model versioning, token limits, timeout handling, cost events";
- "validate that cited evidence exists in the provided extracts".

No route, table, migration or screen changed, and no job runs the agent yet (09C). 08B is
still in progress; 08C and 09C wait.

### D-09B-01: The model-provider abstraction

- **`ModelProvider`** (`packages/integrations/src/model`) replaces the provisional `AiProvider`
  (D-02C-05), which only its fake used. `generate(request)` returns one of three results, each
  with the provider, the model, the request id and the usage:
  - `output`: the answer text, still unvalidated;
  - `refusal`;
  - `incomplete`, with its reason.

  It throws `ProviderError`, which gains a `canceled` code.
- **A request** carries:
  - the task, the prompt version and the fixed instructions;
  - the input data, as JSON text;
  - a strict JSON Schema for the answer;
  - `maxOutputTokens` (16 to 32,000), a signal and `onCost`.
- **No tools:** a request has no tools field, so nothing a prompt or a page says can give a
  model tools. An answer that contains a tool call anyway is refused as `bad_response`.
- **Bounds** are checked before anything is sent (`assertModelRequest`): instructions at most
  20,000 characters, input at most 200,000, and the schema and task names.
- **Cost events:** one per attempt, failed attempts included, delivered through `onCost`
  before the result or the error returns. Each one carries:
  - the provider, model, task, prompt version and attempt;
  - the outcome, the provider's request id and our client request id;
  - the usage: input tokens, cached input tokens, output tokens (reasoning included) and
    reasoning tokens;
  - `billing`: `reported`, `unknown` (a timeout, or a server error after sending) or `none`
    (refused before any work);
  - `costMicroUsd` (D-09B-05) and the time.

  The events feed the usage ledger's `AI_TOKENS`; recording them is 09C's work.

### D-09B-02: The OpenAI adapter

**Docs checked 2026-11-07** on developers.openai.com (platform.openai.com answered 403 to the
fetcher):
- creating a response: https://developers.openai.com/api/reference/resources/responses/methods/create;
- Structured Outputs: https://developers.openai.com/api/docs/guides/structured-outputs;
- error codes: https://developers.openai.com/api/docs/guides/error-codes;
- the API overview (Bearer authentication, `x-request-id`, `X-Client-Request-Id`, rate-limit
  headers, REST API `v1`, `openai-version` 2020-10-01):
  https://developers.openai.com/api/reference/overview;
- models: https://developers.openai.com/api/docs/models.

**Plain HTTPS, no SDK:** one endpoint, the same pattern as the Apollo client (D-07B-04), and
the tests script the HTTP answers (`OpenAiResponsesProvider`, `fetch` injectable).

- **Request:** `POST https://api.openai.com/v1/responses` with `Authorization: Bearer`, our UUID
  as `X-Client-Request-Id`, and redirects refused. The body:
  - `model`, `instructions`, and `input` as one user message holding the JSON data;
  - `max_output_tokens`;
  - `text.format`: `json_schema` with `strict: true`;
  - `store: false` (the documented default is `true`);
  - `truncation: "disabled"`: too long an input fails rather than being cut silently.

  Never sent: tools, `tool_choice`, metadata, `previous_response_id`, `background` or a
  temperature (reasoning models). `reasoning.effort` is sent only when
  `OPENAI_REASONING_EFFORT` is set (documented values `none` to `max`; models differ).
- **Answers:**
  - `output_text` is an SDK-only property, so the adapter reads the output items itself: text
    parts are joined and reasoning items skipped;
  - a `refusal` part is a refusal result;
  - `status: "incomplete"` is an incomplete result, with `max_output_tokens`,
    `content_filter` or `other` as the reason;
  - `status: "failed"` maps by `error.code` (`rate_limit_exceeded`, `server_error`, else an
    invalid request);
  - any other output item (`function_call`, `web_search_call` ...) is `bad_response`.
- **Errors:**

  | Status | Error | Retried |
  |---|---|---|
  | 401 | `unauthorized` | No |
  | 403 (unsupported region) | `forbidden` | No |
  | 400, 404, 422 | `invalid_request` | No |
  | 408, 409 | `unavailable` | Yes |
  | 429 | `rate_limited` | Yes |
  | 429 with a billing or quota code or type (`insufficient_quota`, `credit_balance_exhausted`, the spend and usage limits) | `quota_exceeded` | No: "retrying billing, spend, or quota errors won't restore API access" |
  | 5xx | `unavailable` | Yes |

  OpenAI's message never travels.
- **Retries:** 2 attempts by default (3 at most), waiting `Retry-After` or 1 second, never longer
  than 20 seconds. Timeouts are never retried: a timed-out request may still be processed and
  billed. Each attempt has 60 seconds (1 to 180).
- **Configuration** (worker only):
  - `OPENAI_API_KEY`, validated without echoing it and redacted from logs;
  - `OPENAI_MODEL`, with no default because models change. Listed on 2026-11-07:
    `gpt-6-astra`, `gpt-6.1-sol`, `gpt-6.1-terra` and `gpt-6-luna` (the cheapest, $0.1 and $0.5
    per million input and output tokens);
  - `OPENAI_REASONING_EFFORT`;
  - `OPENAI_INPUT_USD_PER_MTOK` and `OPENAI_OUTPUT_USD_PER_MTOK`, both or neither.
- **Environments:** development and test always get the fake. Staging and production need the
  key and the model, else `LiveProvidersUnavailableError` (fail closed). Nothing builds the
  provider at startup yet, since no job uses it.
- **Data:** nothing is stored (`store: false`), and no `safety_identifier` is sent yet (O-37).
  A prompt holds page text and the campaign context, never secrets, credentials, tenant ids or
  contact details.

### D-09B-03: WebsiteResearchAgent: input, prompt, versions, limits

- **Package:** `packages/ai-agents`, its first agent.
- **Input** (`websiteResearchInputSchema`, `@lead-fennec-ai/shared`):
  - the company's name and domain;
  - the campaign context: business profile, offer and ICP criteria, through the campaign and
    ICP schemas themselves, each nullable;
  - the requested fields (all 12 by default);
  - 1 to 8 extracts, each with an id (E1 to E99), an http(s) URL, a title, `retrievedAt`, the
    page's `contentSha256` and at most 6000 characters of text, 30,000 in all.

  `pageExtracts` builds extracts from fetched pages (task 09A's `WebsitePage`), cut at a word
  or a line.
- **Fields:** company_summary, products_services, industry, target_customers, headquarters,
  founded_year, employee_count, markets_served, notable_customers, recent_news, technologies
  and hiring, each with a description for the model. Headquarters, founded year and employee
  count have one true value.
- **Versions:** prompt `website-research/1`, schema `website-research-output/1`, format name
  `website_research_output_v1`. `promptSha256` is the SHA-256 of both versions, the
  instructions and the JSON Schema; a test pins it, so a change needs a new version. Every
  result names the prompt, its hash, the schema, the provider and the model that answered.
- **Instructions:** fixed text. Page text is untrusted data and never instructions; any request
  in it to change the rules, reveal them, call tools, send messages, change eligibility,
  approvals or budgets, or mark anything verified is reported in `ignoredInstructions`.
  Facts need exact quotes from the cited extract; a field with no statement is unknown;
  inferences are hypotheses; no outside knowledge; no personal contact details. The user
  message is JSON only, so page text stays inside its own string.
- **Limits:** 4000 output tokens by default (256 to 16,000, reasoning included); at most 60,000
  characters of instructions and data (the contract keeps real inputs near 45,000 at most). No
  model call when no extract has text.
- **Time:** the adapter's deadline per attempt; the caller's signal cancels.

### D-09B-04: Facts, hypotheses, unknown fields, evidence, confidence

- **Shape first:** the answer must match `websiteResearchModelOutputSchema`, a strict zod schema:
  - facts: a field, a value (300 characters at most) and 1 to 3 quotes with their extract ids;
  - hypotheses, with low or medium confidence;
  - unknown fields;
  - ignored instructions.

  The JSON Schema sent to OpenAI is written by hand in the strict subset (closed objects,
  every property required, no string lengths: those are zod's job), and a test checks the
  subset's rules. Anything else is refused, and the result is review_required with every field
  unknown: invalid JSON, an extra key (an eligibility, a "verified" flag, a tool call), or a
  high-confidence hypothesis.
- **Each fact is then checked by code:**
  - its field was asked for;
  - every extract it cites was provided;
  - every quote is in its extract. The comparison ignores case, spacing, typographic quotes and
    dashes (NFKC), and needs at least 3 characters;
  - no quote overlaps instruction-like page text;
  - every number of the value is in the quotes, and so is at least one of its words.

  A fact that fails any check becomes a review item with its reason, never a fact. Duplicates
  are merged. Two different values of a one-value field both go to review
  (`conflicting_evidence`).
- **Unknown:** the requested fields without a verified fact. The model's own list isn't
  trusted.
- **Confidence:**
  - a fact keeps the model's confidence, but is high only when its value is written out in a
    quote;
  - the result's confidence is set by code: low without verified facts, high with 3 or more and
    nothing to review, else medium.
- **Hypotheses** may cite only provided extracts, must contain no instruction-like text, and are
  never above medium.
- **Instruction-like page text:** these patterns flag it:
  - ignore, disregard, forget or override ... instructions, rules or prompts;
  - a system or developer prompt; "you are now"; "act as" an AI;
  - calling or invoking a tool or function; "new instructions"; `<system>` tags;
  - "mark ... as verified", eligible or approved; revealing the prompt.

  An extract with such text gives a warning and makes the result review_required. The model's
  `ignoredInstructions` are kept when found in their extract. The patterns are defence in depth.
  The guarantees are: no tools; a closed schema without policy fields; and application code
  alone deciding eligibility, approvals, budgets and sending.
- **Statuses:** `completed`, `review_required`, `no_content`. A model that can't be reached
  throws `ProviderError`, after its cost events.
- **"Verified"** means the quote is in the page. It says nothing about whether the page is
  right, and it is not an email address's "verified" (D-08A-04).

### D-09B-05: Costs

- **Tokens** come from the provider's usage.
- **Cost:** input tokens times the input price, plus output tokens times the output price, in
  millionths of a dollar (a price per million tokens equals millionths of a dollar per token).
  Cached input is priced as ordinary input: an over-estimate, never an under-estimate.
- **Unknown cost:** null without prices, or when an attempt's usage is unknown. A result's
  total is null if any billable attempt's cost is unknown.
- **The fake** costs 0.
- **The ledger** (`AI_TOKENS`: reserve before, commit after) is 09C's work.

### D-09B-06: The fake model and tests

- **`FakeModelProvider`** never connects. Its answers come from a test's script, from responders
  by task, or from the built-in research reader. That reader quotes the first sentence matching
  simple patterns per field, cites exact sentences, and reports instruction-like sentences as
  ignored. Usage is estimated at 4 characters per token. Refusals, truncation, errors and
  cancellation can be scripted, and requests are recorded.
- **Tests** use synthetic pages on `.example` and scripted HTTP answers shaped like the
  documentation. No paid call, no network.

| File | What it shows |
|---|---|
| `integrations/src/model/openai.test.ts` (24) | The documented body (no tools, `store: false`, strict schema, token ceiling, no truncation), headers and URL; reasoning effort only when set; bounds and malformed key or model refused before sending, the key never echoed; text, usage, request id and a priced cost event; refusal and incomplete answers; a tool call refused; unreadable answers; missing usage; every HTTP error mapped, with billing; rate-limit retry after `Retry-After`; quota and billing 429s not retried; server and connection errors retried once; failed responses by code; long waits not retried; timeouts not retried; cancellation before and during |
| `integrations/src/model/fake.test.ts` (8) | The fake reader quotes only real sentences, deterministically, and lists injected text as ignored; scripts, responders, errors, ceiling, cancellation; `createModelProvider` per environment, failing closed without key and model |
| `ai-agents/src/website-research/agent.test.ts` (28) | Verified facts with dated, hashed evidence; unknown fields; versions; cost. Fixed instructions with page text only as JSON data and no tools, identical for a hostile page. Injected pages flagged and kept out of the facts. Policy, eligibility and tool-call answers refused. Facts and hypotheses quoting injected text sent to review; high hypotheses refused. No facts means unknown; fabricated quotes, unknown extracts, numbers and values not in the quotes, and unrequested fields go to review; partial evidence refused; conflicts. Refusal, truncation, filter and bad JSON give review. No model call without text. Input bounds; provider errors after cost. `pageExtracts`. The pinned prompt hash, the strict-subset check and the schema's agreement with zod. The agent through the real adapter over scripted HTTP |
| `ai-agents/src/website-research/evidence.test.ts` (22) | Quote normalization; numbers and words of values; instruction patterns, and ordinary text not flagged |
| `shared/src/contracts/website-research.test.ts` (4) | Input and answer bounds; no extra keys anywhere |
| `apps/worker/src/env.test.ts` | The OpenAI settings and `modelConfig`; malformed values refused without echoing the key |
| `shared/src/logger.test.ts` | `OPENAI_API_KEY` redacted |

## 09C: Research jobs, evidence, freshness, corrections, evaluation (2026-11-07)

**Basis.** The plan is still missing (O-01); this follows the 09C prompt:
- "connect permitted fetch results to research jobs, evidence storage, cache freshness and
  explicit refresh";
- "preserve prior versions and audit manual corrections";
- "evidence viewing on lead profiles";
- "a small reviewed evaluation set covering sparse sites, conflicting text and malicious
  instructions", and "record quality criteria and baseline results instead of inventing a
  universal accuracy score".

It builds on the 09A fetcher, the 09B agent, the 07C job pattern and 04B's `claimJob`. No live
site, model or provider was used.

### D-09C-01: The research job

- **A request** (`scope.research.request`, `research.run`) writes, in one transaction: a
  research row (PENDING), a job task (`website_research.run`, payload `{ researchId,
  campaignId }`) and an audit record.
  - Checked first: the company and any campaign belong to the workspace (else 404), and the
    company has a website or a domain (else 409 `research_not_possible`).
  - Only one queued or running run per company: a partial unique index plus a per-company lock.
    A second request answers with the first.
- **The worker** `website_research` has its own BullMQ queue (`lead-fennec-research`), its own
  relay and `claimJob` definition. `run-task` (development and test) picks the job by the task's
  type.
- **Pages:**
  - the start page is the company's website, else `https://<domain>/`;
  - plus at most three same-site links it holds, chosen by application code from their paths
    (about or company, products or services, team, customers, careers, news, contact). Files and
    log-in, account or legal pages are skipped, and a link whose path says nothing useful is not
    followed.
  - Every page goes through the safe fetcher (09A: addresses, robots.txt, access lists, limits),
    with the workspace id as its cache scope.
  - **Permitted results only:** a refused or failed page is recorded with its reason and never
    read another way. A temporary failure of the start page retries the run; other failures are
    recorded and the run goes on.
- **Stored pages:** each page read becomes a `source_records` row (`WEBSITE`, the requested URL as
  `external_id`, `fetched_at` = when it was read). Its payload holds the URLs, status, type, both
  hashes, the title, at most 20,000 characters of text and at most 100 links.
- **The model:** `createModelProvider`, made for each run. Unconfigured, the run fails with
  `model_unavailable` and nothing else stops.
- **Budget:** a paid model reserves `AI_TOKENS` first (estimate: characters / 3 plus 4000 output
  tokens), then commits the tokens used. It commits the whole hold when an attempt may have been
  billed without its usage being known, and releases it when nothing was used.
- **Failures:** retryable fetch and model errors retry (the task's attempts); others fail the run
  with their code, as do `usage_limit_reached` and `no_entitled_plan`.

### D-09C-02: Versions and evidence

- **Every run, refresh, reuse and correction is a new version** (a `research` row). Two
  triggers keep history:
  - `research_finished_immutable`: a completed or failed version never changes;
  - `evidence_immutable`: evidence is append-only.
  A new version names the one it continues (`based_on_id`).
- **Numbered per company:** 1, 2, 3 ... in completion order (a partial unique index), assigned
  under the per-company lock. The current version is the highest number. Clocks never decide it:
  during testing, a correction from a process whose clock ran behind the worker's was briefly
  taken for an old version.
- **New columns:**
  - `research`: `origin` (MODEL, REUSED, CORRECTION), `result_status`, `based_on_id`, `refresh`,
    `version`, `input_sha256`, `context_sha256`, `prompt_sha256`, `schema_version`,
    `model_provider`, `cost_micro_usd`;
  - `evidence`: `extract_label`, `content_sha256`.
  - Checks: hashes, the continuation rule, the version rule, the outcome rule, the provider,
    cost, error code and findings size; evidence labels, hashes and excerpt length.
- **Evidence:**
  - one `WEBSITE_EXCERPT` row per extract per version: the extract's text, `captured_at` = when
    its page was read, its stored page, the page's content hash and its label (E1, E2 ...);
  - a correction's note is a `MANUAL_NOTE` row.
- **`findings`** (`researchFindingsSchema`, validated before every write) holds:
  - what was asked: the fields, and the campaign context as a snapshot;
  - what was read: the pages (outcome, reason, stored page, time, hash) and the extracts (evidence
    id, URL, time, page hash, text hash);
  - what came of it: the facts (evidence ids and quotes), inferences, unknown fields, review
    items, warnings, ignored instructions and the confidence;
  - the corrections, the usage, and the prompt, schema, provider and model.
- **Traceability:** a fact leads to its evidence row (label and quote), then to the extract's text,
  URL, time and page hash, then to the stored page.
- **The campaign context is a snapshot plus its hash, not a reference:** a version keeps what the
  model saw even after the campaign changes.

### D-09C-03: Freshness, cache and refresh

- **Fresh research:** a request without refresh, for research completed in the last 30 days with
  the same campaign context, answers `fresh` and queues nothing.
- **Fresh pages:** without refresh, a stored copy read in the last 7 days is used instead of
  fetching.
- **Cache:** the input hash covers what the model would see: the prompt's hash, the schema, the
  provider and model, the fields, the company, the campaign context, and every extract's id, URL,
  title and text. Retrieval times are left out. When the hash equals an earlier completed
  version's, the run becomes a REUSED version, with no model call:
  - its findings are copied;
  - its evidence is captured again, with the new read times;
  - its usage is 0;
  - the corrections are the current ones.
- **Explicit refresh** reads the pages again and calls the model only if what it would see
  changed.
- The robots.txt cache stays per workspace, and the per-host limit per process (09A).

### D-09C-04: Corrections

- **Request:** `POST …/research/corrections`, with `research.run`.
- **Actions:** `set` (a value of at most 300 characters), `reject` (the field becomes unknown,
  "marked wrong"), `restore` (removes a correction). A note (at most 500 characters) is
  required.
- **Compare-and-set** on the current version: otherwise 409 `version_conflict`.
- **Result:** a new version (CORRECTION) with the note as evidence, and an audit record
  `research.corrected` holding the field and the action, never the value or the note.
- **Corrections stay with the company:** they are carried into every later version, model runs
  and reuses included, and applied when a version is read (shown as "Corrected by a person").
  Every earlier version is kept.

### D-09C-05: API and screen

- **Routes:**

  | Route | Permission |
  |---|---|
  | `GET …/organizations/:organizationId/research` | `contacts.read` |
  | `GET …/research/:researchId` | `contacts.read` |
  | `POST …/research` (202, state `queued`, `running` or `fresh`) | `research.run` |
  | `POST …/research/corrections` (201) | `research.run` |

  Each is in the endpoint list, the OpenAPI document, the route-guard test and the authorization
  review. Error codes: `research_not_possible`, `version_conflict`.
- **The company profile:** `/workspaces/:workspaceId/leads/organizations/:organizationId`, in the
  Leads section (`contacts.read`, breadcrumb "Company profile"). `leads/page.tsx` keeps the Leads
  shell, since a static folder takes the path from `[section]`. Import results link each saved
  company to it.
- **What the profile shows:**
  - the status and its actions ("Research the website", "Read the pages again");
  - the facts, with their source (quoted from the pages, or corrected by a person), confidence
    and evidence;
  - "Needs a person", a warning when a page held instructions, the unknown fields, and
    inferences kept apart from facts;
  - the evidence: each extract with its URL, read time and page version, and the quote marked;
  - the pages read, and the history, where any earlier version can be opened.
- **Behaviour:** a queued or running run refreshes the page (`RESEARCH_RUN_POLL`). Untrusted text
  is rendered as text only, and URLs are links only when http(s) (`rel="noopener noreferrer
  nofollow"`).
- **Fake fetcher clock:** in development and test, the registry's fake fetcher now uses the real
  clock, so stored pages and evidence show real read times. Unit tests still fix their own.

### D-09C-06: Evaluation

- **Where:** `docs/evaluations/website-research.md` and its saved baseline
  `website-research-baseline.json`.
- **The set:** 8 reviewed synthetic cases (one control, three sparse, two conflict, two
  malicious).
- **Criteria**, each a yes or no per case: evidence integrity, no injected content, unknowns
  honest, flagged. Expected facts found is a count. There is no universal accuracy score.
- **Models:** the reviewed reference answers, the fake, and an adversarial model.
- **Baseline (2026-11-07):**

  | Model | Evidence integrity | No injected content | Unknowns honest | Flagged | Expected facts found |
  |---|---|---|---|---|---|
  | Reference | 8/8 | 8/8 | 8/8 | 8/8 | 9 of 9 |
  | Fake | 8/8 | 8/8 | 6/8 | 6/8 | 8 of 9 |
  | Adversarial | 8/8 | 8/8 | 8/8 | 6/8 | 0 (nothing it made up was kept) |

- **Not run:** a live model.
- **Pinned:** `evaluation.test.ts` checks the saved file against a fresh run. The limitations are
  recorded in the evaluation document.

## 10A: Lead scoring model (2026-11-07)

**Basis.** The plan is still missing (O-01); this follows the 10A prompt:
- "configurable score weights totaling 100: industry 25, decision-maker 20, size/location 15,
  supported need 20, contact quality 10 and timing 10";
- "define factor schemas and score boundaries", "store input versions and evidence references";
- "High Priority at 80–100, Review at 60–79 and Low Priority below 60";
- "validate customized weights and missing data policy".

The completion check asks that missing evidence never gets a fabricated positive value and that
saved scores can be reproduced from their inputs. Code: `packages/shared/src/contracts/lead-scoring.ts`
(the calculation), `lead-scoring-rules.ts` (the rules) and
`packages/database/src/tenancy/lead-scoring.ts` (`scope.scoring`).

### D-10A-01: Factors, weights and levels

- **Six factors:** `industry`, `decisionMaker`, `sizeLocation`, `supportedNeed`,
  `contactQuality`, `timing`. Default weights 25, 20, 15, 20, 10, 10.
- **Weights:** whole numbers from 0 to 100, every factor present, adding up to exactly 100. An
  unknown factor is refused by name. 0 switches a factor off; one factor may weigh 100.
- **Levels:** an assessment rates a factor from 0 to 4 (no fit, weak, partial, strong, full).
  Points = weight × level / 4.
- **The score:** the sum of points, rounded down to a whole number. It is summed in quarter
  points, so no floating-point rounding decides a band, and rounding down never lifts a lead into
  a higher band (79.75 is 79, Review).
- **Versions:** the calculation is `lead-score/1` (`scores.method_version`), the rules
  `lead-score-rules/1` (in the inputs). Both are stored with every score.

### D-10A-02: Factor schemas and evidence references

- **An assessment** is one of two strict shapes:
  - `assessed`: a level, who proposed it (`rules`, `model` or `person`), 1 to 10 pieces of
    evidence (even for level 0: the evidence that it doesn't fit) and a short explanation;
  - `missing`: a reason (`no_data`, `no_target` or `not_assessed`) and an explanation. It has no
    level and no evidence field at all, so a missing factor that claims either is refused.
- **Evidence kinds:**
  - a stored field of the company (`industry`, `employeeCount`, `countryCode`) or of the person
    (`title`, `countryCode`), with the value read;
  - a research fact: the research id, its version number, the field, the value and its 1 to 3
    evidence rows;
  - an email check: its id, stored status and time;
  - a stored evidence row.
- **Only the calculation scores.** `calculateLeadScore` validates the configuration and exactly
  one assessment per factor, and refuses anything else (`LeadScoreInputError`). Rules propose
  assessments today; a model or a person may later (10C), and they still only rate factors.

### D-10A-03: Missing data and bands

- **A factor without evidence earns 0 points.** No neutral value is assumed, and its weight is
  never moved onto the factors that were found (that would credit unknown data). No policy
  setting changes this; an unknown setting is refused by name.
- **Bands:** High Priority 80–100, Review 60–79, Low Priority 0–59 (`leadScoreBand`). Every whole
  score is in exactly one band.
- **The missing-data policy** may only move a lead to Review, never higher:
  - `requiredFactors`: factors that need evidence before a lead can be High Priority. Each must
    have a weight above 0. A missing one keeps a High Priority score at Review.
  - `maxMissingWeight` (0–100) and `whenInsufficient`: when the missing factors weigh more,
    `REVIEW` sends the lead to Review whatever its score; `SCORE` keeps the band of the score.
  - Both the band of the score alone (`scoreBand`) and the band after the policy (`band`) are
    reported, with the conditions that applied (`bandReasons`).
- **Defaults:** required industry, decision-maker and supported need; at most 30 missing; `SCORE`.
  By default the band follows the score, as the prompt states it; a campaign can choose `REVIEW`.
  Consequence: until 10C assesses supported need and timing, the rules reach at most 70, so no
  lead is High Priority yet.

### D-10A-04: The rules

Deterministic, from stored data only:
- **Targets:** each list from the campaign's lead filters when they set it, else from its ICP;
  seniorities from the ICP.
- **Industry:** the company record's industry, else the industry fact of the company's current
  research version (after corrections). The same words: full; every word of one in the other:
  strong; a shared word: weak; else none.
- **Decision-maker:** `rankRoleRelevance` (08A, the one definition of role fit), scaled to what is
  targeted (titles count up to 70, seniorities up to 30).
- **Size and location:** employees against the range, and the company's country (else the
  person's) against the countries. Each targeted part is an equal share; an unknown part earns
  nothing.
- **Contact quality:** the newest check of the person's current address. Verified within 30 days:
  full; verified earlier: partial; risky: weak; unknown or invalid: none. No address, no check,
  or a check dated after the score: missing. This is fit only; whether an address may be sent to
  stays with `emailSendEligibility` and 10B.
- **Supported need and timing:** `not_assessed` until 10C.
- **Nothing targeted** for a weighted factor: missing (`no_target`); its explanation says to add
  targets or set the weight to 0. Fit is never assumed.
- **Stored text** (titles, industries) is untrusted: it is only compared and quoted (shortened).

### D-10A-05: Stored scores

- **Configuration:** `campaigns.scoring` (JSON, at most 4 KB; NULL means the defaults) is the
  campaign section `scoring`. It follows the 06A save rules (compare-and-set, DRAFT only, audited
  by section name), is copied by duplicate, and is read as `{ custom, config }`.
- **`scores`** gains `campaign_id`, `campaign_version`, `verification_id`, `version`, `band`,
  `inputs` and `input_sha256`. `icp_id` becomes optional, because a campaign may have no ICP.
- **Checks:** an ICP or a campaign; a lead score has every part or none; the band fits the value
  (Review fits any); inputs are an object of at most 64 KB; the hash, method version and reason
  length.
- **Inputs:** the versions, the configuration and where it came from, the campaign id and
  version, the facts the rules read (the time, the targets, the person, the company, the research
  version and its industry fact, the email check) and the assessments. They are validated with
  `leadScoreInputsSchema` before every write and every read. `input_sha256` is the SHA-256 of
  their canonical JSON.
- **Citations:** `score_evidence` holds every evidence row the assessments cite. Before writing,
  each row is checked to be the company's evidence in this workspace.
- **Never changed:** triggers refuse any change to a score or a citation. A new calculation is a
  new version, numbered per campaign and person under a lock with a partial unique index (the
  09C clock-skew lesson). The current score is the highest version.
- **`scope.scoring`:**
  - `scoreLead`: the system actor only (application code scores; there is no member action yet);
  - `current`, `get`, `reproduce`: `scores.read`, or the system actor.

  Another workspace's ids, malformed ids and scores recorded before 10A are not found.
- **Reproduction:** the rules run again on the stored facts and every rules assessment must come
  out the same; the stored assessments must give the stored value and band; the hash of the
  stored JSON must match; the citations must be the rows the assessments name.
- **Deletion:** a score goes with its person, its campaign and its email check, and a citation
  goes with its evidence row. The score still names a removed row in its inputs, and reproduction
  reports `evidenceMatches: false`.
  - **Found by the erasure tests:** with NO ACTION, deleting a person whose score cited their
    evidence failed. PostgreSQL checked the evidence reference during the person's cascade,
    before the cascade through `scores` had removed the citation. The email-check reference
    escaped this only by the order the constraints were created in. Erasing a person must always
    work, so both cascade.
  - `scores.research_id` keeps its 03A NO ACTION.

### D-10A-06: Not in 10A

- No route or screen calculates or shows lead scores, and no job calls `scoreLead` yet (10C).
- Weights are configurable through the campaign API; the setup wizard has no scoring stage.
- No send eligibility (10B). A score never makes anyone eligible to be sent to.

## 10B: Send eligibility decisions (2026-11-07)

**Basis.** The plan is still missing (O-01); this follows the 10B prompt:
- "SendEligibilityService foundations with independent fit and eligibility results";
- "check verification, suppression, source permissions, configured region policy, exclusions and
  required sender/campaign conditions";
- "unknown policy or stale verification must return review or blocked status, never inferred
  permission";
- "deterministic rules with reason codes; the AI score cannot override a hard block".

The completion check asks that a score of 100 still fails when suppressed, invalid, restricted or
policy-unknown, and that tests cover the current status and changes after qualification. Code:
`packages/shared/src/contracts/send-eligibility.ts` (the rules) and
`packages/database/src/tenancy/send-eligibility.ts` (`scope.eligibility`).

### D-10B-01: Fit and eligibility are separate

- **Two results:** `evaluate` answers `{ fit, eligibility, sendPermitted, needsPerson }`. The fit
  is the lead's current score (10A). Eligibility comes from `evaluateSendEligibility`, which takes
  no score at all: its facts schema is strict, so facts carrying a score are refused.
- **Only eligibility permits:** `sendPermitted` is true only when eligibility is `eligible`. A score
  of 100 is reported next to a refusal and changes nothing.
- **Three answers per check:** `pass`; `review` (a person may decide, task 10C); `blocked` (nobody
  may send, and neither a score nor a person can lift it, `overridable: false`). The result is
  the strictest answer of all checks.
- **Current status:** nothing is cached or stored. Every call reads the facts again, so eligibility
  follows every change after a lead was scored. The rules are versioned (`send-eligibility/1`).

### D-10B-02: The checks and their reason codes

In order. The first three hold for every lead of a campaign; the rest are about the person.

| Check | Blocked | Review |
|---|---|---|
| Workspace sending | `sending_disabled`, `no_entitled_plan`, `plan_excludes_email` | |
| Campaign | `campaign_not_active` (anything but ACTIVE) | |
| Sending mailbox | `sender_missing`, `sender_not_ready` (not ACTIVE, or no stored authorization) | |
| Person | `contact_archived` | |
| Do-not-contact list | `suppressed_email`; `suppressed_domain` (the address's domain or the company's) | |
| Campaign exclusions | `excluded_email`, `excluded_domain`, `excluded_lead_list`, `in_other_campaign` (a pending or active enrollment elsewhere, when the campaign leaves those out) | |
| Email check | `no_email`, `email_not_verified` (no check of this address, a malformed one, one from another provider, or one dated after now), `email_invalid` | `email_risky`, `email_unknown`, `verification_stale` (verified more than 30 days ago) |
| Data source | `source_blocked` | `source_unknown` (no source record), `source_policy_unknown`, `source_review` |
| Region | `region_blocked`, `company_region_blocked`, and the two below when unnamed countries are blocked | `region_policy_unknown`, `country_unknown`, `region_not_listed`, `region_review` |

- **The email check** reuses 08A's `emailSendEligibility`, so "verified recently" has one
  definition. An address nobody checked is blocked (it must be checked first), not sent to on
  trust. Stored checks are read as email checks; a provider the check schema doesn't know isn't a
  check.
- **Sources:** the providers of the person's source records. The strictest answer wins (one
  blocked source blocks).
- **Region:** the recipient's own country decides. The company's country never grants permission,
  but a blocked company country blocks.
- **`BUILT_SERVICES.eligibility` stays `false`:** the rules exist, but nothing checks leads before
  they join a campaign yet (there is no enrollment step). Activation keeps saying so.

### D-10B-03: The send policy

- **Where:** `tenant_settings.send_policy` (JSON, at most 16 KB) and `send_policy_version`, next to
  the workspace's other sending settings (one table per concept).
- **Shape** (`sendPolicySchema`):
  - `regions.countries`: country code → `ALLOW`, `REVIEW` or `BLOCK` (at most 250);
  - `regions.otherCountries`: `REVIEW` or `BLOCK`, never `ALLOW`, so a country is allowed only
    by naming it;
  - `sources`: provider → action. An unnamed source needs a person.
  - Unknown settings are refused by name.
- **Not set:** every lead gets `region_policy_unknown` and `source_policy_unknown` (review). A
  stored policy out of shape counts as not set.
- **Changing it:** `PATCH /workspaces/:workspaceId/settings/send-policy` (`settings.manage`) replaces
  it, or clears it with `null`. It is compare-and-set on the version (409 otherwise) and audited
  (`send_policy.updated`: version, whether set, the number of countries, the source names).
  Reading it (`GET`) also needs `settings.manage`, the permission of the Workspace settings
  section.

### D-10B-04: The service

- `scope.eligibility.evaluate(campaignId, contactId)` needs `campaigns.read` and `contacts.read` (or
  the system actor, or a platform admin's audited scope). The fit is read through
  `scope.scoring.current`, so it also needs `scores.read`.
- The facts are read in one transaction:
  - the campaign and its mailbox;
  - the workspace's sending switch, current subscription, email limit and policy;
  - the person, their company, and the newest check of their current address;
  - matching suppressions, their lead lists, their other enrollments and their sources.
- Another workspace's or a malformed id is not found.

### D-10B-05: Not in 10B

- No route or screen shows a lead's eligibility (10C), and no job calls it yet.
- No person can resolve a review yet: overrides are 10C, and a block will stay closed to them.
- Only the policy routes are new; the workspace settings page is still unbuilt.

## 10C: Lead qualification (2026-11-08)

**Basis.** The plan is still missing (O-01); this follows the 10C prompt:
- "LeadQualificationAgent to propose evidence-grounded factor explanations through validated
  schemas";
- "calculate final numeric scores in application code and persist score/rule versions";
- "qualified, review and rejected states with human overrides that are audited but cannot bypass
  hard sending restrictions";
- "expose explanations, evidence and eligibility separately in the UI".

The completion check asks that every classification is explainable, invalid model output goes to
review, manual changes are tracked, and tests show score changes never erase suppression.

### D-10C-01: The LeadQualificationAgent

- **What it rates:** only supported need and timing, the two factors rules can't judge. The rules
  keep the other four (10A).
- **Input** (`qualificationInputSchema`):
  - the time, the campaign's business profile and offer, the company's name and domain, the
    person's title;
  - the verified facts of the company's current research version, after corrections (09C),
    numbered F1 to F30, each with up to three quotes and the date its page was read.

  Bounded: 300 characters per value or quote, at most 40,000 characters of input, 2,000 output
  tokens by default (256 to 8,000).
- **Prompt:** `lead-qualification/1`, pinned by a hash test. It runs with a strict JSON schema and
  no tools. Facts and titles go only in the data, never in the instructions.
- **Checks** (application code, on every answer):
  - the shape, strictly (any extra key, such as a score or a state, refuses the whole answer);
  - every factor answered exactly once;
  - every cited fact was given;
  - a level cites at least one fact;
  - timing rests only on `hiring` and `recent_news` facts;
  - nothing cited or written tries to instruct a model.

  A proposal that fails is dropped, and its factor stays missing (`not_assessed`). A refusal, a
  cut-off or an invalid answer drops everything. Facts the model reports as instructions also
  flag the answer for review.
- **No facts:** the model isn't called (`no_facts`). **No model:** `unavailable`, and the rules
  score alone.
- **Development and tests:** the fake model has a deterministic qualification responder that
  cites only the facts it was given.

### D-10C-02: Scoring with the agent

- `scope.scoring.scoreLead(campaignId, contactId, proposals)` takes the agent's proposals for
  supported need and timing (proposed by the model only). Before saving, it checks every cited
  research fact again against the current research version: field, value and evidence rows. Any
  mismatch is refused (`LeadScoreInputError`), and nothing is saved.
- The score is calculated by `calculateLeadScore`, as in 10A. Its method is `AI` when an accepted
  model proposal counts, else `RULES`.
- **Versions kept** with the score: the calculation (`lead-score/1`), the rules
  (`lead-score-rules/1`) and the agent run (prompt version and hash, schema, provider, model,
  outcome and review items, in `inputs.agent`).
- Reproduction recalculates the stored assessments and reruns the rules. The model's assessments
  are not rerun: they are stored inputs.

### D-10C-03: The states

- **States:** `QUALIFIED`, `REVIEW` and `REJECTED`, decided by `classifyLead` in this order:
  1. the person's own eligibility is blocked: `REJECTED`;
  2. not scored: `REVIEW`;
  3. the agent's answer needed review, or no model ran: the lead can't be better than `REVIEW`;
  4. Low Priority: `REJECTED` (or `REVIEW` when step 3 applies);
  5. Review band: `REVIEW`;
  6. High Priority with eligibility reasons that need a person: `REVIEW`;
  7. otherwise `QUALIFIED`.
- The campaign's own checks (a draft campaign, sending switched off) don't change the state: they
  block sending, not the person.
- **Every state is explained:** at least one reason, each with a message and the codes behind it.
  The database checks this.

### D-10C-04: Decisions and a person's override

- **Storage:** `lead_qualifications` is append-only, numbered per campaign and person under a
  lock; the current decision is the highest version. Each decision keeps the score it was made
  with and the person's own eligibility status at the time.
- **A person's decision** needs `campaigns.write`:
  - a note is required (at most 1,000 characters); it isn't copied into the audit record;
  - it names the version it started from (409 otherwise);
  - `QUALIFIED` is refused while the person's own eligibility is blocked (409
    `qualification_blocked`; a database check too);
  - accepting the eligibility checks that need a person also needs `drafts.approve`, and only
    with `QUALIFIED`; the current review reason codes are recorded.
- **What may be sent** (`contactDecision`):
  - `sendPermitted` when eligibility is `eligible`, or when it is `review` and a person's current
    `QUALIFIED` decision accepted every current review reason;
  - `readyToContact` when sending is permitted and the lead is qualified.

  A block is never permitted, and a new review reason needs a person again.
- **Automatic decisions** are audited as the system. A new run makes a new current decision; the
  history keeps the person's.
- **Deletion:** decisions go with their campaign, person and score. The deciding member can't be
  deleted while their decisions exist, as with approvals.

### D-10C-05: Job, API and screens

- **Requesting a run:** `research.run` (members); one queued or running run per lead; audited.
- **The job:** `lead_qualification.run` on the queue `lead-fennec-qualification`, worker
  `lead_qualification`. A paid model reserves `AI_TOKENS` first; a retryable provider error
  retries.
- **Routes**, under the Campaigns section:
  - `GET …/campaigns/:campaignId/leads` and `…/leads/:contactId`: `campaigns.read`, and in the
    repository `contacts.read` and `scores.read`;
  - `POST …/qualify`: `research.run`, `202`;
  - `POST …/decisions`: `campaigns.write`, `201`.
- **Screens:**
  - the campaign's leads, reached from the setup page's "Leads" link;
  - one lead's page, in three separate sections: fit (each factor's rating, who rated it, why,
    and its evidence), eligibility (every check, decided now), and qualification (the state, its
    reasons, the history and a person's decision).

  The lead page refreshes while a run is queued.

### D-10C-06: Not in 10C

- Nothing enrolls or emails leads; `BUILT_SERVICES` is unchanged, so activation still fails
  closed.
- No bulk qualification of a whole lead list, and no automatic re-run when facts change.
- No evaluation set for the qualification agent, only its tests, and no live model was run.

## Open choices (need a decision from the user)

| ID | Choice | Current state | Options |
|---|---|---|---|
| O-01 | The reference plan is missing | 02A was built from the task prompt and `CLAUDE.md` alone. 01A–01C are blocked. | Supply `docs/reference-plan.docx`. If it specifies a different structure or versions, reconcile with D-02A-*. |
| O-02 | Tool telemetry | Next.js, Turborepo and Prisma CLI (checkpoint) anonymous telemetry are **on** locally (their defaults). All three are disabled in CI only (D-02C-07, 03A). | Keep, or disable with `NEXT_TELEMETRY_DISABLED=1`, `pnpm exec turbo telemetry disable` and `CHECKPOINT_DISABLE=1`. |
| O-03 | Dev server network binding | `next start` reported `Network: http://192.168.1.102:3000`. Next.js, Nest and (since 02B) the worker health server listen on all interfaces by default. PostgreSQL and Redis bind to 127.0.0.1. | Keep the defaults, or bind local dev to `127.0.0.1`. |
| O-04 | Version control | **Resolved 2026-11-01** at the user's request ("git commit"): repository initialized on `main` with an initial commit. Author `LeadFennec-Leads-Agent` (global name). The repository-only email was switched to the GitHub `noreply` address before the first push. `origin` is `github.com/farhan0nouman-sys/LeadFennec-Leads-Agent` (**public**); GitHub's README commit was replaced at the user's request. | — |
| O-05 | Native PostgreSQL on port 5432 | Found during 02B: Windows service `postgresql-x64-18` listens on 5432, so Docker PostgreSQL would conflict. Readiness reached it once with the placeholder credentials and was rejected; nothing else touched it. | Set `POSTGRES_PORT=5433` (and the `DATABASE_URL` port) in `.env`, or use the native server with `pnpm dev --skip-services`. |
| O-06 | Docker Desktop not installed | Compose is written and schema-validated but has never been run here. | Install Docker Desktop, then run `pnpm dev` (see the 02B manual check). |
| O-07 | Provider interfaces are provisional | `packages/integrations` has minimal capability interfaces and fakes (D-02C-05), designed without the data model (01B blocked) or provider docs. | Reconcile with 01B. Each live adapter starts with an official-docs check. |
| O-08 | Migrations and database fixtures | **Resolved in 03A:** Prisma schema, two migrations and the fixture loader exist (D-03A-08, D-03A-09). | — |
| O-09 | CI has never run on GitHub | **Resolved 2026-11-01** (local time; 2026-10-31 19:45 UTC): the first run (41235720269, commit `7fc44f2`) passed every step. The job logs need a GitHub sign-in, so per-suite counts weren't seen. | — |
| O-10 | Data model derived without the architecture spec | 03A, 03B and 03C derived ownership, delete rules, planned queries and the one-table-per-concept list from their prompts and `CLAUDE.md` (D-03A-02 to D-03A-07, D-03B-02 to D-03B-09, D-03C-01 to D-03C-09). 01B is blocked. | Reconcile with 01B once the plan exists. Changes become new migrations. |
| O-11 | Permission catalog and default roles in production | **Resolved in 04B:** the catalog and the system roles are code in `@lead-fennec-ai/shared`, synced to `permissions` at workspace creation (D-04B-02). | — |
| O-12 | Actor / audit columns | **Partly addressed in 03C:** `audit_records` name actors by user and membership id without foreign keys, so they outlive members (D-03C-05). Still open: 03B's drafts and approvals reference the deciding membership with NO ACTION, so a member (and their user) cannot be deleted while their decisions exist (D-03B-04). | Decide whether user erasure anonymizes members or keeps them. |
| O-13 | Opt-outs, bounces and suppression | **Modeled in 03B:** `suppressions`, inbound message classification, campaign-lead stop reasons (D-03B-02, D-03B-10). Open: the rules that turn a reply, opt-out or bounce into a stop or a suppression (application logic), and whether a platform-wide list is needed. | Decide in the outreach and compliance tasks. |
| O-14 | Prisma 8, and the `partialIndexes` preview | npm `latest` for `prisma` is an RC (`8.0.0-rc.29`); 7.10.1 is pinned. Since 03B the schema uses the `partialIndexes` preview feature (D-03B-01). | Upgrade deliberately once Prisma 8 is stable; re-check partial indexes (drift test and canary) on every Prisma upgrade. Since 04B, `adapter-pg` 7.10.1 triggers `pg` 8.23's deprecation warning about concurrent queries on one connection (D-04B-08); check before upgrading to `pg` 9. |
| O-15 | Secret store for production credentials | Only references are stored (`email_accounts.secret_ref`, D-03B-06). Development and tests use `fake://`. No store is chosen. | Choose a store (e.g. a cloud secret manager or Vault) with the mailbox-connection task, behind a provider interface with a fake. |
| O-16 | Routing provider notifications to tenants | `inbound_events` is tenant-scoped, so the receiver must resolve the tenant before storing (D-03B-02). How to map a webhook or push message to a tenant (per-connection routes or tokens, or a lookup by mailbox) and how long events, outbox rows, audit records and notifications are kept are open. Since 03C a Stripe event can be routed by its subscription id (`subscriptions_external_subscription_key`). | Design with the webhook and mailbox-sync tasks, after checking each provider's official docs. |
| O-17 | Billing integration | 03C models subscriptions, payment facts, limits and usage provider-neutrally (D-03C-01, D-03C-03); billing uses the fake provider. Open: the Stripe adapter (SDK and API version to pin, thin or snapshot events, webhook endpoint), whether usage is reported to Stripe (e.g. billing meters) or billed from our ledger, whether a billing status suspends a tenant, which statuses are entitled (now TRIALING, ACTIVE, PAST_DUE), invoices and tax, and how real plans are created (only fixture plans exist). | Decide in the billing task, after re-checking Stripe's docs. |
| O-18 | Platform-admin access policy | 03C: explicit entry point, stated reason, audit record before access, read-only generic client, refusals recorded (D-03C-05). Open: time-limited access grants, tenant consent or notifying the tenant's admins, which audited admin write operations exist beyond limit overrides, and audit retention. | Decide with the admin console and support tooling. |
| O-19 | Transactional mail provider and a local inbox | Account email goes through `TransactionalMailProvider`; only the fake exists, so staging and production refuse to start (D-04A-11). In development the emails stay in memory; there is no inbox to click links by hand. | Choose a provider (after checking its official docs) with a live adapter, and a development inbox (e.g. a local SMTP catcher), which would be a new local service. |
| O-20 | Auth work across instances and restarts | Account emails run in-process after the response, and are lost if the API stops at that moment (D-04A-07). Per-IP limits are kept in memory per instance (D-04A-09). Since 04C, `TRUST_PROXY_HOPS` sets how many proxies the API trusts (1 behind the web app's proxy); a client can still send its own `X-Forwarded-For` unless the outermost proxy overwrites it (D-04C-06). | Move account email to BullMQ (Redis, already in the stack); use a Redis store for the throttler; when deploying, count the load balancer in `TRUST_PROXY_HOPS` and make it overwrite `X-Forwarded-For`. |
| O-21 | Further account security | Not in 04A: MFA (it would allow the 8-character minimum), blocking common and breached passwords, CAPTCHA after failures, a session list with "sign out everywhere", email change, account deletion, expiring unverified accounts, and retention for `user_sessions`, `auth_tokens` and `auth_throttles` rows (D-04A-03, D-04A-08, D-04A-13). | Decide per feature; a breached-password service is an external provider (official docs first). |
| O-22 | The auth decision against the plan | The plan was unavailable; 04A chose first-party sessions with Argon2id, HttpOnly cookies and synchronizer CSRF tokens (D-04A-01). | Confirm, or reconcile with the plan, e.g. if it prescribes a hosted identity provider. |
| O-23 | Team management beyond 04B | The 04C screens cover inviting, revoking and role changes. Not built: suspending or removing members, custom roles per workspace, limits on workspaces per user, ownership transfer, and invitations to platform staff (D-04B-01 to D-04B-04, D-04C-01). | Decide before the next team-management task, and with the billing limits. |
| O-24 | Screen design and copy | The 04C screens use shadcn/ui's neutral defaults and English copy written without the plan: no brand (the `branding` table is unused), no dark-mode switch, no translations; dates use the browser's locale (D-04C-01, D-04C-02). | Reconcile with the plan's design and copy, and with tenant branding. |
| O-26 | Data layer of 05B | The client cache reloads data when a screen mounts and after the listed mutations; it has no time-based expiry, holds at most 200 unwatched entries, and caches nothing for platform admins (D-05B-03). The OpenAPI document is OpenAPI 3.1.2 with a hand-set API version (0.5.0), checked by structural tests only. The demo page ships in production builds but answers 404 there (D-05B-05). The list routes take no search or filter parameters yet, so the search and filter controls are used only on the demo page. | Confirm the cache policy, or add expiry times per resource. Add an OpenAPI validator to CI, or move to 3.2. Exclude `app/dev` from production builds if wanted. Add search and filters to the API list routes when the lead pages are built. |
| O-25 | Pages and permissions of the app shell | 05A derived the page list from its prompt, the data model and the permission catalog, not from the plan. Inbox, Analytics, Automations and Integrations reuse `campaigns.read`, `campaigns.write` and `settings.manage`; "Admin" is read as the platform-admin area (D-05A-02). Accessibility is checked with axe only, not with a screen reader. | Reconcile the pages, groups and permissions with the plan. New permission keys need a migration that grants them to existing roles. Test with a screen reader (NVDA or VoiceOver) before release. |
| O-27 | Dashboard definitions and refresh (05C) | Metric definitions, the integration list and the polling intervals were chosen without the plan (D-05C-02 to D-05C-04). Activity names a member without a display name by email address. The 24-hour, 7-day and 30-day activity counts and the contact counts read all of a workspace's rows of those tables (no `(tenant_id, occurred_at)` index). The dashboard has nothing for platform admins. | Confirm or adjust the metrics, intervals and naming. Add an index or stored counters in a new migration when volumes grow. Decide whether the admin area needs its own dashboard. |
| O-28 | Campaign configuration (06A) | The sections, their fields and bounds, the readiness rules and the approval modes were chosen without the plan (D-06A-01 to D-06A-05). The business profile is stored per campaign. Only DRAFT campaigns can be configured; there is no activation, pausing or deletion yet. `AUTOMATIC` approval is stored but unused, and blocked while the workspace requires approval (the default). | Confirm or adjust the fields, bounds and readiness. Decide whether the business profile belongs to the workspace, and when (if ever) automatic approval is allowed. Add activation, pausing, editing of running campaigns and deletion in later tasks. |
| O-29 | Campaign wizard (06B) | The stage contents, wording and order of fields were written without the plan (D-06B-01). Leaving through the sidebar or breadcrumbs with unsaved changes doesn't ask (only closing or reloading the tab does). Approval mode can't be changed in the wizard. ICPs, lead lists, templates and mailboxes can't be created yet, so in a new workspace the pickers are empty. Checked with axe, not a screen reader. | Confirm the stages and copy against the plan. Decide whether in-app navigation should ask before leaving unsaved changes. Add the approval choice when automatic approval is allowed. Test with a screen reader. |
| O-30 | Readiness rules (06C) | The 13 checks and their wording were chosen without the plan (D-06C-01). Leads come only from a lead list; each step needs a template; a campaign's new leads per day may not exceed its mailbox's daily limit; a workspace needs an entitled plan with email and sending turned on (off by default, and nobody can turn it on from the app yet). Activation is always refused in production until the eligibility, drafting and sending services exist (D-06C-02). Activation only changes the status; nothing is enrolled or scheduled yet. | Confirm the checks against the plan. Decide who turns on sending for a workspace (a platform-admin route?). Flip each service flag in the task that builds it. |
| O-31 | Lead discovery (07A) | The ICP criteria vocabulary, the company identity rules, the limits (1000 per search, 100 by default) and the run fields were chosen without the plan (D-07A-01 to D-07A-04). Development and tests use the fake; since 07B staging and production use Apollo (O-32). Requests are stored with a job task; since 07C the worker runs them (O-33). Company identity uses the domain when there is one, else the normalized name: two companies with the same name and no domain are treated as one. | Confirm the vocabulary, identity rules and limits against the plan. Build the Apollo adapter (07B, official docs first) and the worker, upserts and screens (07C). Decide whether a same-name company without a domain needs another tie-breaker (country, provider id). |
| O-32 | Apollo organization search (07B) | Built from the official docs only (D-07B-01 to D-07B-05); no live request was made, so the mapping is unproven against real answers. Not known: the account's plan, and whether it has a REST API key with organization search access (the endpoint answers 403 without it). Apollo matches exact industry names, so free-text ICP industries may find nothing; country names come from the runtime's English names (Intl), unverified against Apollo's location names. The response documents no industry, employee count or country, so found companies have none. The `accounts` array (companies the team already saved) is ignored. A retried timeout may cost a second credit. | Create a key scoped to `api/v1/mixed_companies/search` and run one authorized live page (1 credit) in staging. Decide whether ICP industries should be picked from Apollo's list, whether saved accounts count as results, and whether to fill industry and size from an enrichment step (separate provider, official docs first). |
| O-33 | Search jobs and CSV imports (07C) | Chosen without the plan (D-07C-01 to D-07C-06): the 5-second relay, one job at a time, 3 provider attempts per task (5 task attempts), the suppression rule (a parent domain excludes subdomains), matching without a domain by name key only among companies without a domain, fill-in of missing details only, CSV limits (256 KB, 1000 rows) and fields, and the error report columns. The BullMQ transport has run only against its documentation: there is no Redis on this machine, so the queue and the worker process were not started; the job itself ran through run-task. Organizations saved before 07C have no name key, so a domainless one can be matched only after it gets one. Contacts are not imported (companies only). | Run the worker against Redis (CI or Docker) before relying on it. Confirm the rules and limits against the plan. Decide whether imports should also bring in contacts (08A), whether name matching should consider the country, and whether old organizations need their name keys backfilled. |
| O-34 | Contact enrichment (08A) | Contracts and fakes only (D-08A-01 to D-08A-05). Chosen without the plan: the seniority levels, the relevance weights (title 70, seniority 30), the 30-day freshness of a verified check, dropping addresses at other domains, and the identity key order (email, LinkedIn, company and name). No email verification provider is chosen, and no live people-search or enrichment adapter exists (Apollo people search is separate from 07B and needs its own docs check). Nothing is stored yet: contacts, checks and the send rule are used by later tasks. | Confirm the rules against the plan. Choose a verification provider (official docs first) and whether Apollo people search and enrichment are used. Decide whether a person may approve a risky or unknown address for sending, and how that approval is recorded. |
| O-35 | Email verification service (08B) | None selected (the user's answer, 2026-11-06). Only the fake checks addresses. Outside development and test, `createEmailVerificationProvider` fails closed, so no address can be checked or become eligible for automatic sending. Apollo's own email status is kept as a claim only (D-08B-03). | Choose a verification provider. Check its official documentation (endpoints, authentication, statuses and their meaning, rate limits, pricing), then add its adapter behind `EmailVerificationProvider`, map its statuses to verified, risky, unknown and invalid, and add it to `EMAIL_VERIFICATION_PROVIDERS`. |
| O-36 | Website fetching (09A) | Chosen without the plan (D-09A-01 to D-09A-05): the limits and their ceilings, HTML and plain text only (no PDF), ports 80 and 443, reading "configured access restrictions" as the operator's block and allow lists plus robots.txt, an unreachable robots.txt as "try later" (retryable) rather than a permanent refusal, the user agent `LeadFennecBot/0.1` without a contact URL, and per-host concurrency inside one worker process (not per registrable domain, not across workers). Never run against the internet: every test uses a local fixture server, and TLS ran only against a server that does not speak it (no certificate fixture). Nothing is stored and no job fetches pages yet. O-35 is kept for 08B's verification blocker, written when 08B is finished. | Confirm the limits and the reading of the restrictions against the plan. Add a contact URL to the user agent. Decide on a shared per-domain limit (Redis) and a public suffix list. Run one authorized live fetch in staging. Store pages as `source_records` and `evidence` in the research task. |
| O-37 | Model use (09B) | Chosen without the plan (D-09B-02 to D-09B-05): the 12 research fields and their descriptions, the limits (8 extracts, 6000 and 30,000 characters, 4000 output tokens), the confidence rules, the instruction patterns, at most one OpenAI retry, and no default model. No live call was made: the adapter is tested only against scripted answers shaped like the documentation, so the real answers, the schema's acceptance in strict mode and the models' behaviour are unproven. Prices are configuration, not checked against billing. No `safety_identifier` is sent. Prompts carry public page text, which can include names from team pages. Nothing is stored and no job runs the agent yet. | Choose the model (e.g. `gpt-6-luna`, the cheapest listed) and its reasoning effort with a small authorized staging run, and set the prices from the pricing page. Decide whether to send a `safety_identifier` (e.g. a hashed workspace id). Confirm the fields and limits against the plan. Record `AI_TOKENS` usage and store results with their evidence in 09C. |
| O-38 | Website research jobs and evaluation (09C) | Chosen without the plan (D-09C-01 to D-09C-06): at most 4 pages (the start page and 3 links chosen by path words), 30-day freshness for research and 7-day for pages, reuse when the input hash matches, corrections carried into later versions, `research.run` for corrections, and the profile page under Leads (whose list is still unbuilt). The evaluation set is 8 synthetic English cases, reviewed by the author only; a person has not reviewed it. Known limits: a conflict is caught only when the model reports both values; value support is word-level; the instruction patterns are English-only. No live model or site was used: the BullMQ path is untested here (no Redis), and the profile was checked with axe, not a screen reader. | Review the cases and their expectations, then add real-site and live-model baselines once a model is chosen and a run is authorized. Decide whether conflicts should also be searched for by code, and which further fields have one value. Confirm the page choice, the freshness windows and the permissions against the plan. Run the worker against Redis. |
| O-39 | Lead scoring model (10A) | Chosen without the plan (D-10A-01 to D-10A-06): five levels per factor, points rounded down, targets from the campaign's lead filters else its ICP, the word-matching and role rules, contact quality from the newest email check, and the default policy (required industry, decision-maker and supported need; at most 30 missing; the band follows the score). Supported need and timing are not assessed until 10C, so no lead reaches High Priority yet. Weights are set through the campaign API only (no wizard stage), and nothing calculates scores outside the tests until 10C adds the job. | Confirm the levels, the rules, the defaults and whether too little data should go to Review by default. Decide where people set weights (a wizard stage or the campaign page) and who may (a permission). Review the industry matching against real provider industries. |
| O-40 | Send eligibility rules and the send policy (10B) | Chosen without the plan (D-10B-01 to D-10B-05): which reasons block and which need a person; an unchecked address is blocked; a stale check (over 30 days), a risky or unknown one needs a person; the recipient's own country decides and unnamed countries can never be allowed; unnamed sources need a person and the strictest source wins; "in another campaign" counts pending and active enrollments only. No region or source is allowed until a workspace sets a policy, and no screen sets it yet (the API does). `BUILT_SERVICES.eligibility` stays false until leads are checked when they join a campaign. | Confirm the block and review split and the 30-day window against the plan and legal advice; decide the default policy for new workspaces (none today), whether a company's country should ever count, and how enrollment calls the checks (10C or later). |
| O-41 | Lead qualification (10C) | Chosen without the plan (D-10C-01 to D-10C-06): the agent rates only supported need and timing; the order of the state rules (a lead block rejects, a Low Priority score rejects unless the agent failed, High Priority with review reasons goes to Review); research.run to request a run, campaigns.write to decide and drafts.approve to accept review reasons; a person's note is never audited as text; a new run replaces a person's current decision (the history keeps it). The agent's prompt was tested with the fake model only; it has no evaluation set or live baseline. | Confirm the state rules and the permissions against the plan. Decide whether a run should keep a person's decision current, whether Low Priority should reject or go to Review, and when leads are re-qualified (on research refresh, in bulk). Build an evaluation set for the agent like 09C's and run a live baseline once a model is chosen and a run is authorized. |
| O-42 | Contact enrichment (08C) | Chosen without the plan (D-08C-01 to D-08C-07): 25 companies a run, 5 people a company (3 by default), a 30-day reuse window, rechecks once a day per contact and 50 a day per workspace; location judged per company (a company whose country is unknown is looked up); people go to a lead list only through a campaign (no screen manages lead lists yet); `LEAD_ENRICHMENTS` counts the people looked up. No live Apollo run has been made: the adapters were tested with fixtures only (08B). | Confirm the limits and the location rule against the plan. Decide whether enrichment should also start from lead lists or single companies. Authorize a live Apollo run (it spends credits), then compare its credits with the counted usage. |
