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
| O-31 | Lead discovery (07A) | The ICP criteria vocabulary, the company identity rules, the limits (1000 per search, 100 by default) and the run fields were chosen without the plan (D-07A-01 to D-07A-04). Only the fake provider exists; staging and production refuse to start until a live adapter does (07B). Requests are stored with a job task, but no queue message is published and no worker runs them yet (07C), so runs stay PENDING. Company identity uses the domain when there is one, else the normalized name: two companies with the same name and no domain are treated as one. | Confirm the vocabulary, identity rules and limits against the plan. Build the Apollo adapter (07B, official docs first) and the worker, upserts and screens (07C). Decide whether a same-name company without a domain needs another tie-breaker (country, provider id). |
