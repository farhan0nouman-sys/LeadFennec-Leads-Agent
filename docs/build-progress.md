# Build progress — Lead Fennec AI

Newest entry first. A check is listed as passed only if it ran and succeeded.

---

## GIT-03: Commit 03A–03C (2026-11-01)

**Status: Done (local commit only).** The request was `git commit`.

| Step | Actual result |
|---|---|
| Branch and author | `feat/03a-data-model`; author `LeadFennec-Leads-Agent` with the GitHub `noreply` address (repository config) |
| Content | One commit for 03A, 03B and 03C together. They share `schema.prisma`, the fixtures and the docs, so splitting them would have produced commits that don't build. 56 files: 6 migrations, the schema, the tenancy, pagination and fixture code, tests, shared helpers and docs. |
| Excluded | The generated Prisma client and `dist/` (git-ignored); `reference-repos/` (git-ignored); scratch files outside the repository |
| Checks before committing | The 03C regression (see the 03C entry), then `pnpm format:check` (exit 0). A scan of the staged files for credentials and the personal email found nothing. |
| Commit | The commit that contains this entry. Its id is shown by `git log`. |

- **Not pushed:** CI therefore hasn't run on 03A–03C. Pushing the branch (and opening a pull
  request into `main`) is the user's decision.

### Next prompt

**03D**, if the numbering continues. That can't be confirmed without the plan.

---

## 03C: Billing, usage, branding, audit, notifications and tenant-aware access (2026-11-01)

**Status: Passed (local checks). Incomplete live checks:**
- **Real PostgreSQL:** not run on a real server, in Docker or in CI. Local runs used PGlite
  (PostgreSQL 18.6 in WebAssembly).
- **Concurrency:** the concurrent-reservation test skips itself on PGlite and has not run.
- **Redis:** the Redis integration test was skipped (`TEST_REDIS_URL` unset).
- **Not committed:** 03A, 03B and 03C are all uncommitted on `feat/03a-data-model`, so CI
  hasn't run on any of them.

The reference plan is still missing. The model is derived from the 03C prompt and `CLAUDE.md`
and is provisional (O-10). Stripe details were checked in Stripe's official docs before use
(D-03C-03). No Stripe SDK or adapter was added.

### Changed components

| Area | Files |
|---|---|
| Prisma schema | `schema.prisma`: 11 tables (3 platform: `billing_plans`, `plan_limits`, `platform_audit_records`; 8 tenant-owned), 9 enums, back-relations on `Tenant`, `Membership` and `InboundEvent`, and a readable name for one long foreign key |
| Migrations | `20261101000400_billing_audit_notifications`: generated. `20261101000500_billing_integrity_checks`: hand-written. It adds four predicate functions (`is_provider_id`, `is_currency_code`, `is_snake_key`, `is_request_id`), 51 CHECK constraints, append-only triggers for payment facts, the usage ledger and both audit tables, and 8 `tenant_id` triggers. |
| Tenant-aware access (new) | `src/tenancy/`: `access.ts` (`memberScope`, `platformAdminScope`, `systemScope`, `platformConsole`), `tenant-db.ts` (tenant-scoped Prisma client), `actors.ts` (actors, errors, input schemas), and the repositories `audit.ts`, `billing.ts`, `notifications.ts` and `usage.ts` |
| Pagination (new) | `src/pagination.ts`: keyset pagination on UUIDv7 ids, opaque validated cursors |
| Fixtures | `fixture-data.ts`: 3 fixture plans with 12 limits, billing history per tenant, 3 permissions, plus an organization score and a mailbox-sync schedule so every relation is used. `load.ts`: 8 more tables and counts; reset also deletes the fixture plans. `cli.ts`: reset message. New `factories.ts` (`createFixtureFactory`). |
| Tests | New: `billing-schema.integration.test.ts` (72), `tenant-access.integration.test.ts` (112), `pagination.test.ts` (13), `tenancy/tenant-db.test.ts` (23). Updated: the structure test (6 platform tables, 43 tenant tables, a new platform reference, a duplicate-concept guard; 8 tests) and the fixture counts in the 03A and 03B suites, plus the 03B campaign-deletion test (the mailbox schedule stays). |
| Exports | `src/index.ts`: tenancy, pagination and factories |
| Docs | `docs/decisions.md`: D-03C-01 to 10; O-10, O-12 and O-16 updated; O-17 and O-18 new. `README.md`: suites, migrations, fixtures, factories and a "Tenant-aware data access" section. `CLAUDE.md`: entry points, one table per concept, budgets, append-only rows. This entry. |

### Passed local checks

**Database used:** PGlite 0.5.13 (PostgreSQL 18.6) on 127.0.0.1:54329, run from the scratch
folder. It was restarted fresh before each run and stopped at the end (port released).

| Command / check | Actual result |
|---|---|
| Stripe documentation (WebFetch) | Subscription object, webhooks, event types, currencies and API versions read; facts recorded in D-03C-03 |
| `prisma validate`; `prisma format` | Valid; formatted |
| `prisma migrate diff … --script` against a database with 4 migrations | Generated migration: 11 tables, 9 types, 12 unique and 13 other indexes, 14 foreign keys. No `SET NULL`, no `ON UPDATE CASCADE`. One foreign-key name over 63 characters was named explicitly and the migration regenerated. |
| `pnpm db:migrate` (`prisma migrate deploy`) on an empty database | 6 migrations applied; exit 0 |
| `prisma migrate status`, then deploy again | "Database schema is up to date!", then "No pending migrations to apply." |
| Drift: `prisma migrate diff --exit-code` | Exit 0 (the partial-index predicate matched PostgreSQL's form the first time) |
| Fixture CLI (`node dist/fixtures/cli.js`): load, load again, `--reset` | Exit 0 each time. The summary lists 37 tables, identical in both tenants. 03C adds: subscriptions 2, payment events 2, limit overrides 1, reservations 3, ledger entries 3, branding 1, audit records 3, notifications 2. Coverage rows change scores 1 → 2, schedules 1 → 2, inbound events 1 → 3. The reload and reset tables were identical. After reset: 3 plans, 12 limits, 2 tenants. |
| Fixture CLI with `APP_ENV=production`; without `DATABASE_URL` | Both refused; exit 1 |
| Catalog after all migrations | 49 tables, 105 foreign keys, 137 CHECK constraints, 181 indexes, 49 triggers |

**Final regression.** The generated client was deleted first; Turborepo ran without its cache.

| Command | Actual result |
|---|---|
| `pnpm install --frozen-lockfile` / `pnpm peers check` | Exit 0; lockfile up to date; no peer issues. No packages were added. |
| `pnpm format:check` | **First run: exit 1** (12 new or changed files). After `prettier --write` on those files: exit 0. The later `cli.ts` change was formatted the same way; exit 0. |
| `pnpm typecheck --force` | Exit 0; 13/13, 0 cached; the deleted client was regenerated |
| `pnpm exec turbo run lint --force`, then root ESLint | Exit 0; 13/13, 0 cached (includes `prisma validate` and `format --check`); root ESLint exit 0. Earlier, 3 lint findings in new code were fixed. |
| `pnpm test --force`, no `TEST_*` variables | Exit 0; 8/8, 0 cached: shared **130**, integrations **12**, database **46 passed, 270 skipped** (all six real-database files skipped), worker **4**, api **6** |
| `pnpm test --force`, with `TEST_DATABASE_URL` (PGlite) | Exit 0; 8/8, 0 cached: shared **130**, integrations **12**, database **314 passed, 2 skipped** (Redis; concurrency on PGlite), worker **4**, api **6** |
| Database files | test-database 8, probes 2, pagination 13, tenant-db 23, infrastructure 1 + 1 skipped, schema (03A) **28**, outreach (03B) **48**, billing (03C) **72**, structure **8**, tenant access **111 + 1 skipped** |
| `pnpm build --force` | Exit 0; 11/11, 0 cached |
| `pnpm test:e2e` | Exit 0; Playwright **1 passed** |
| `git status --porcelain` in the 9 `reference-repos/*` | 0 changed files in each |
| Credential scan of changed areas (Stripe keys, webhook secrets, private keys, tokens, personal email) | No matches |

### What the 03C tests prove (on PGlite)

- **Every tenant-owned model (43), through the scoped client:**
  - an authorized scope reads exactly its own rows;
  - another tenant's scope cannot find them by id, delete them, query that tenant, or
    create rows for it;
  - same-tenant creates work; moving a row to another tenant is rejected;
  - the scope holds inside interactive transactions;
  - raw SQL and platform models are unreachable.
- **Every relation between tenant rows (58):**
  - the fixtures use each one in both tenants;
  - pointing a Beta row at the matching Alpha row (which exists) is rejected by the foreign
    key (23503) for all 58.
- **Entry points:**
  - active members get in with their role's permissions;
  - refused: other tenants, invited members, platform admins via `memberScope`, unknown or
    suspended tenants, disabled users;
  - malformed ids fail validation before any query.
- **Platform-admin access:**
  - an audit record with the reason is written before access;
  - the client is read-only, and admins cannot reserve usage;
  - refusals and console openings go to `platform_audit_records`;
  - a short reason is rejected with nothing written.
- **Repositories:**
  - audit pages without gaps, with a bad cursor rejected and a foreign cursor harmless;
  - members see and mark only their own notifications; dedupe keys work; external links and
    cross-tenant recipients are rejected;
  - usage holds respect the limit (held plus used), are idempotent, commit at most the held
    quantity into one ledger entry, release, expire, and are never settled from another
    tenant;
  - only platform admins set overrides, audited in the same transaction;
  - no usage without an entitled subscription.
- **Schema:**
  - one current subscription per tenant;
  - provider subscriptions unique across tenants;
  - payment facts deduplicated by provider event;
  - ledger entries keep their reservation's metric and period;
  - CHECK rules for every new table (45 rejection cases);
  - append-only rows (23000);
  - plan protection;
  - platform audit records survive tenant deletion;
  - 12 planned queries, each using its named index;
  - no table named like a duplicate concept.

### Defects found and fixed during 03C

1. **Organization score and contact erasure:** the first coverage score referenced the
   shared contact's research. Deleting the contact would then have failed (NO ACTION). The
   score now has no research link, and the 03A contact-cascade test passes.
2. **Synchronous throws:** a few repository methods threw before returning a promise.
   They are now `async`, so callers always get a rejected promise.
3. **Test parameter typing:** one relation case needed `::uuid::text` for a reused parameter
   (42P08).
4. **03B test expectations:** fixture counts, and the campaign-deletion test now keeps the new
   mailbox-sync schedule.
5. **Doc edit mishap (fixed):** a JavaScript `replace` treated `` $` `` in the inserted text as
   a pattern and duplicated part of `docs/decisions.md`. The file was rebuilt from its
   original parts plus the new section and checked.
6. **Command mistake (no effect):** one doc-edit command put Markdown backticks inside a
   double-quoted bash string. Bash ran them as commands, including `pnpm db:fixtures --reset`.
   That stopped at startup because `DATABASE_URL` was unset and no `.env` exists, so no
   database was touched. `git status` showed no stray files. Later edits used script files.

### Incomplete live checks (not passed)

- **Real PostgreSQL 18.6 never ran 03A, 03B or 03C:** no Docker (O-06), and CI hasn't run
  (not pushed).
- **Concurrent reservations:** the advisory lock's effect is untested. Its test skips itself on
  PGlite and should pass in CI.
- **Redis integration test:** skipped.
- **The API and worker don't use the entry points yet:** they have no data endpoints.

### Live checks (external services)

None. Nothing was sent, charged or published, and no packages were installed. The only network
use was reading Stripe's documentation (5 pages).

### Blockers

1. **The reference plan is missing** (O-01). The model stays provisional until 01B (O-10).
   The duplicate-concept list is anticipated, not taken from the source.
2. **No Docker** (O-06), and native PostgreSQL holds 5432 (O-05).
3. **03A, 03B and 03C are uncommitted together** on `feat/03a-data-model`. CI hasn't run;
   committing and pushing are the user's decision.
4. **Open for later tasks:**
   - billing integration (O-17);
   - platform-admin access policy (O-18);
   - retention and webhook routing (O-16);
   - member erasure versus approvals (O-12).
   Still open from earlier: O-02, O-03, O-07, O-11, O-13 to O-15.

### Manual check

- **With Docker Desktop:** `pnpm dev`, `pnpm db:migrate`, `pnpm db:fixtures`, then `pnpm test`
  with `TEST_DATABASE_URL` and `TEST_REDIS_URL`. Expect database **316 passed, 0 skipped**
  (the concurrency test runs on real PostgreSQL).
- **Or, once the branch is committed and pushed:** confirm CI is green on PostgreSQL 18.6.

### Next prompt

**03D**, if the numbering continues. That can't be confirmed without the plan.

---

## 03B: Outreach and background-job data model (2026-11-01)

**Status: Passed (local checks). Incomplete live checks:**
- **Real PostgreSQL:** not run on a real server, in Docker or in CI. Local runs used PGlite
  (PostgreSQL 18.6 in WebAssembly).
- **Redis:** the Redis integration test was skipped (`TEST_REDIS_URL` unset).
- **Not committed:** 03A and 03B are both uncommitted on `feat/03a-data-model`, so CI hasn't
  run on either.

The reference plan and the architecture specification (01B) are still missing. The model is
derived from the 03B prompt, the 01A/01B themes and `CLAUDE.md`, and is provisional (O-10).

### Changed components

| Area | Files |
|---|---|
| Prisma schema | `packages/database/prisma/schema.prisma`: 20 new tenant tables and 21 enums (D-03B-02); back-relations on 03A models; `partialIndexes` preview; readable names for six long index names |
| Migrations | `20261101000200_outreach_and_jobs`: generated. `20261101000300_outreach_integrity_checks`: hand-written. It adds four predicate functions (`is_iana_time_zone`, `is_secret_ref`, `is_iso_weekday_set`, `is_dotted_key`), the CHECK constraints (including `tenant_settings.timezone` from 03A), the append-only triggers for drafts and approvals, and 20 `tenant_id` triggers. |
| Shared | `packages/shared/src/time-zone.ts` (`normalizeTimeZone`) and `secret-ref.ts` (`parseSecretRef`, `isSecretRef`), with tests (48); exported from `index.ts` |
| Fixtures | `fixture-data.ts`: outreach history per tenant and 5 outreach permissions. `load.ts`: 20 more tables and summary counts. `cli.ts`: one row per table. |
| Tests | New: `outreach-schema.integration.test.ts` (48), `schema-structure.integration.test.ts` (7), and the harness `src/testing/migrated-schema.ts`. The 03A suite now uses the harness, reads its tenant table list from the catalog, and counts rows one query at a time. `vitest.config.mjs`: `fileParallelism: false`. `tsconfig.build.json` excludes `src/testing`. |
| Lint | `eslint.config.mjs`: `no-restricted-syntax` forbids `*_partial` lookup keys (D-03B-01) |
| Docs | `docs/decisions.md`: D-03B-01 to 12; O-10 to O-14 updated; O-15 and O-16 new. `README.md`: tests, migrations, partial indexes, fixtures. `CLAUDE.md`: database rules for time, credentials, sending and partial keys. This entry. |

### Passed local checks

**Database used:** PGlite 0.5.13 (PostgreSQL 18.6) on 127.0.0.1:54329, run from the scratch
folder. It was restarted fresh before each run and stopped at the end (port released).

| Command / check | Actual result |
|---|---|
| `prisma validate`; `prisma format` | Valid; format changed nothing |
| `prisma migrate diff --from-config-datasource --to-schema … --script` against a database with only 03A applied | Generated migration: 20 tables, 21 types, 33 unique and 34 other indexes, 52 foreign keys. No `SET NULL`, no `ON UPDATE CASCADE`. |
| SQL predicate probes | All match the design: `is_iana_time_zone` (10 values), `is_secret_ref` (6), `is_iso_weekday_set` (8) |
| ICU against PostgreSQL time zones | All 418 `Intl` zone names are known to PostgreSQL 18.6 and match the stored format. `pg_timezone_names` takes about 24 ms per query, so it is not used in CHECKs. |
| `pnpm db:migrate` on an empty database | 4 migrations applied; exit 0 |
| `prisma migrate status`, then `pnpm db:migrate` again | "Database schema is up to date!", then "No pending migrations to apply." |
| Drift: `prisma migrate diff --exit-code` | Exit 0, "No difference detected." (after defect 1 was fixed) |
| `pnpm db:fixtures`, run twice, then `--reset` | The summary lists 29 tables, with identical counts in both tenants. 03B adds: email accounts 1, templates 2, campaigns 1, sequences 1, steps 2, leads 2, drafts 3, approvals 2, intents 1, attempts 2, threads 1, inbound messages 1, suppressions 2, schedules 1, runs 1, tasks 2, leases 1, outbox events 2, inbound events 1, sync cursors 1. The reload and the reset printed identical counts. |
| `pnpm db:fixtures` with `APP_ENV=production`; without `DATABASE_URL` | Both refused; exit 1 |
| Catalog after all migrations | 38 tables, 91 foreign keys, 86 CHECK constraints, 145 indexes, 37 triggers |
| ESLint guard probe (temporary file, deleted) | `findUnique({ where: { openOrSentAttempt_partial: … } })`: 1 error, `no-restricted-syntax` |

**Final regression.** The generated client was deleted first; Turborepo ran without its cache.

| Command | Actual result |
|---|---|
| `pnpm install --frozen-lockfile` / `pnpm peers check` | Exit 0; lockfile up to date; no peer issues. No packages were added. |
| `pnpm format:check` | **First run: exit 1** (`README.md`). After `prettier --write README.md`, which added one blank line: exit 0. |
| `pnpm typecheck --force` | Exit 0; 13/13; the deleted client was regenerated |
| `pnpm lint --force` | **Exit 2, a command mistake:** pnpm appended `--force` to the root ESLint command, and Turborepo used its cache (7 of 13). Re-run as `turbo run lint --force` plus the root ESLint step: exit 0; 13/13, 0 cached; `prisma validate` and `format --check` passed. |
| `pnpm test --force`, no `TEST_*` variables | Exit 0; 8/8, 0 cached: shared **130**, integrations **12**, database **10 passed, 85 skipped** (all four real-database files skipped), worker **4**, api **6** |
| `pnpm test --force`, with `TEST_DATABASE_URL` (PGlite) | Exit 0; 8/8, 0 cached: shared **130**, integrations **12**, database **94 passed, 1 skipped** (the Redis test), worker **4**, api **6** |
| Database files (verbose run) | test-database 8, probes 2, infrastructure 1 passed and 1 skipped, schema (03A) **28**, outreach (03B) **48**, structure **7**; no deprecation warnings |
| `pnpm build --force` | Exit 0; 11/11, 0 cached; `src/testing` is not in `dist` |
| `pnpm test:e2e` | Exit 0; Playwright **1 passed** (12 tasks) |
| `git status --porcelain` in the 9 `reference-repos/*` | 0 changed files in each |
| Credential scan of changed and new files | Only the CI throwaway password (from 02C). The personal email appears in no file. |

### What the 03B tests prove (on PGlite)

- **Fixtures:**
  - both tenants hold the same outreach history;
  - loading is idempotent;
  - provider ids repeat across tenants without mixing;
  - 09:30 local is stored as different UTC instants (13:30Z New York, 08:30Z London);
  - mailboxes keep only `fake://` references.
- **Planned queries:** 27, each using its named index.
- **Integrity:**
  - references to another tenant's rows are rejected (6 cases);
  - lead, sequence, step and draft stay consistent;
  - only the exact approved version can be sent, and a REJECTED decision cannot be cited;
  - unique enrollment, step intent and provider keys;
  - provider ids are scoped per mailbox;
  - no new attempt while one is in flight or sent;
  - one live draft version;
  - IANA zones only;
  - no token-shaped secret references;
  - value rules;
  - lease hand-over with a new fencing token;
  - immutable `tenant_id`;
  - NO ACTION protections;
  - deleting a contact erases its outreach but keeps suppressions;
  - deleting a campaign cascades; deleting a tenant removes only that tenant's rows.
- **Structure, for all 38 tables and 91 foreign keys:**
  - tenant keys and triggers;
  - same-tenant references;
  - no SET NULL;
  - an index for every foreign key;
  - only `timestamptz`;
  - no credential columns.
- **Canary:** Prisma still ignores a partial unique key's WHERE clause.

### Defects found and fixed during 03B

1. **Drift on partial indexes:** Prisma compares predicates as text, and PostgreSQL rewrites
   `IN (…)` with casts. The predicates are now written in PostgreSQL's form; migration
   regenerated.
2. **Prisma pitfall:** Prisma Client offers partial unique keys to `findUnique` but drops their
   WHERE clause; a lookup returned the FAILED attempt and the REJECTED draft. Fixed with:
   - `*_partial` key names and an ESLint rule;
   - a canary test;
   - D-03B-01 and a `CLAUDE.md` rule.
3. **Planner ties:** on one- or two-row tables, 5 of the 27 index tests picked another
   equally cheap index. The suite now adds realistic volume inside a rolled-back transaction
   before `ANALYZE`. The daily-limit query counts the last day.
4. **Test bugs:**
   - 3 tests set `finished_at` from the test clock before `started_at` was filled. Now
     explicit.
   - 2 tests hit a unique constraint before the foreign key under test. Now use unreferenced
     rows.
   - The credential-name pattern matched AI token counts. Narrowed.
5. **Deprecated `pg` usage:** concurrent queries on one client in the tenant-deletion tests
   (the 03A test too). Now sequential.
6. **Long names:** six generated index names were truncated at 63 characters. They now have
   explicit, readable names (migration regenerated before any use).

### Incomplete live checks (not passed)

- **Real PostgreSQL 18.6 never ran 03A or 03B:** no Docker (O-06), and CI hasn't run (not
  pushed).
  - PGlite shares one session, so the test files ran one at a time.
  - Concurrency is not exercised, e.g. two workers taking a lease at once.
- **The CI image's tz database** was not compared with ICU. The tests use a curated sample of
  zones.
- **Redis integration test:** skipped.

### Live checks (external services)

None. Nothing was sent, charged or published, and no packages were installed. The only network
use was fetching the Prisma indexes documentation (twice).

### Blockers

1. **The reference plan is missing** (O-01). The data model stays provisional until 01B (O-10).
2. **No Docker** (O-06), and native PostgreSQL holds 5432 (O-05).
3. **03A and 03B are uncommitted together** on `feat/03a-data-model`. CI hasn't run on
   either; committing and pushing are the user's decision.
4. **Open for later tasks:**
   - permission catalog (O-11);
   - audit actors, now including approvals that block member deletion (O-12);
   - stop and suppression rules (O-13);
   - Prisma upgrades and the preview feature (O-14);
   - secret store (O-15);
   - routing provider notifications to tenants, and retention (O-16).
   Still open from earlier: O-02, O-03, O-07.

### Manual check

- **With Docker Desktop:** as for 03A (`pnpm dev`, `pnpm db:migrate`, `pnpm db:fixtures`, then
  `pnpm test` with `TEST_DATABASE_URL` / `TEST_REDIS_URL`). Expect database **95 passed,
  0 skipped**.
- **Or, once the branch is committed and pushed:** confirm CI is green on PostgreSQL 18.6.

### Next prompt

**03C.** This assumes the numbering continues; it can't be confirmed without the plan.

---

## 03A: Core data model: Prisma schema, migrations and fixture tenants (2026-11-01)

**Status: Passed (local checks). Incomplete live checks:**
- **Real PostgreSQL:** the migrations, schema suite and fixture command have not run on a real
  server, in Docker or in CI. Local runs used PGlite: PostgreSQL 18.6 compiled to
  WebAssembly (D-03A-10).
- **Not in CI:** the work is uncommitted on `feat/03a-data-model`, so CI hasn't run on it.
- **Redis:** the Redis integration test was skipped locally (`TEST_REDIS_URL` unset).

The reference plan and the architecture specification (01B) are still missing. Tenant
ownership, delete rules and planned queries were derived from the 03A prompt and `CLAUDE.md`,
and are provisional (O-10).

### Changed components

| Area | Files |
|---|---|
| Identity normalization | `packages/shared/src/identity.ts` (new): `normalizeDomain`, `normalizeEmail`, `IdentityNormalizationError`; exported from `index.ts`. `identity.test.ts` (42 tests). |
| Prisma schema | `packages/database/prisma/schema.prisma` (new): 3 platform tables, 15 tenant tables, 14 enums. `prisma.config.mjs` (new). |
| Migrations | `prisma/migrations/20261101000000_core_data_model`: generated offline. `20261101000100_tenant_integrity_checks`: hand-written normalization predicates, CHECK constraints and `tenant_id` immutability triggers. `migration_lock.toml`. |
| Database package | `src/client.ts` (`createPrismaClient` with `@prisma/adapter-pg`), `src/payload-hash.ts`, `src/fixtures/{fixture-data,load,cli}.ts`, `src/index.ts` exports, `src/schema.integration.test.ts` (28 tests). `package.json`: `generate`, `db:migrate` and `db:fixtures` scripts; `lint` also runs `prisma validate` and `prisma format --check`. |
| Workspace | Catalog: `prisma`, `@prisma/client` and `@prisma/adapter-pg` 7.10.1. `allowBuilds`: `@prisma/engines` allowed, `prisma` denied. `turbo.json`: a `generate` task that runs before build, typecheck, lint, test and dev. Root scripts `db:migrate` and `db:fixtures`. `pnpm-lock.yaml`. The generated client is ignored by git, Prettier and ESLint. |
| CI | `.github/workflows/ci.yml`: `CHECKPOINT_DISABLE: '1'`, which turns off Prisma CLI telemetry in CI |
| Docs | `docs/decisions.md`: D-03A-01 to 10; O-02, O-04, O-08 and O-09 updated; O-10 to O-14 new. `README.md`: startup, layout, commands, tests, migrations, fixtures. `docs/local-development.md`: schema and fixtures section, startup-error row. `CLAUDE.md`: git note, new "Database" section. This entry. |

### Passed local checks

**Database used:** PGlite 0.5.13 (PostgreSQL 18.6) with pglite-socket 0.2.16, served on
127.0.0.1:54329.
- It was installed in the session scratch folder, not as a project dependency, and was
  stopped afterwards (port released).
- The native PostgreSQL on 5432 wasn't touched (O-05).

| Command / check | Actual result |
|---|---|
| `prisma validate`; `prisma format --check` | Pass. Both are now part of the database package's `lint`. |
| `prisma migrate diff --from-empty --to-schema prisma/schema.prisma --script` | Initial migration generated without a database: 14 types, 18 tables, 10 unique indexes, 30 other indexes, 39 foreign keys. No `SET NULL`, no `ON UPDATE CASCADE`. |
| Catalog query after migrating | All 15 tenant tables have the `tenant_id` immutability trigger. The 3 platform tables (`tenants`, `users`, `permissions`) have none. |
| `pnpm db:migrate` on an empty database | Both migrations applied; exit 0 |
| `prisma migrate status`, then `pnpm db:migrate` again | "Database schema is up to date!", then "No pending migrations to apply." |
| `pnpm db:fixtures`, run twice | Per tenant: 2 memberships, 2 organizations, 3 contacts, 3 list members, 3 source records, 1 research, 1 evidence, 1 score, 1 verification. The second run printed identical counts (idempotent). |
| `pnpm db:fixtures --reset` | "deleted the fixture tenants and fixture users", then reloaded with the same counts |
| `pnpm db:fixtures` with `APP_ENV=production` | Refused: `Fixture tenants are for development and test databases only (APP_ENV=production).` |
| `pnpm db:fixtures` without `DATABASE_URL` | Refused: `Invalid environment configuration: DATABASE_URL: is required` |
| `pnpm test` with `TEST_DATABASE_URL` (PGlite) | Exit 0; 8/8 tasks: shared **82**, integrations **12**, database **39 passed, 1 skipped** (the Redis test), api **6**, worker **4** |
| `schema.integration.test.ts`, within that run | **28/28.** See the breakdown below. |

The 28 schema tests:
- **Drift (1):** no drift between the migrations and `schema.prisma` (`migrate diff --exit-code`).
- **Fixtures (5):** shape; idempotence; identities kept separate per tenant; raw vs normalized
  values; settings defaults.
- **Planned queries (13):** each uses its named index (D-03A-07).
- **Integrity (9):**
  - cross-tenant foreign keys rejected (23503);
  - per-tenant uniqueness (23505);
  - normalization and value CHECKs (23514);
  - `tenant_id` immutable (23000);
  - NO ACTION delete blocked (23503);
  - cascades stay inside one tenant.

**Final regression run.** No `TEST_*` variables were set. The generated client was deleted
first, so Turborepo had to regenerate it.

| Command | Actual result |
|---|---|
| `pnpm install --frozen-lockfile` / `pnpm peers check` | Exit 0; lockfile up to date; no peer issues |
| `pnpm format:check` | Exit 0 |
| `pnpm typecheck` | Exit 0; 13/13 tasks (now including `generate`); client regenerated |
| `pnpm lint` | Exit 0; 13/13 |
| `pnpm test` | Exit 0; 8/8: shared **82**, integrations **12**, database **10 passed, 30 skipped** (both real-database files), api **6**, worker **4** |
| `pnpm build --force` | Exit 0; 11/11 |
| `pnpm test:e2e` | Exit 0; Playwright **1 passed** |
| `git status --porcelain` in the 9 `reference-repos/*` | 0 changed files in each |
| Credential scan of changed and new files | Only the CI throwaway password (from 02C). The user's personal email appears in no file. |

### Defects found and fixed during 03A

1. **Unpinned download:** `prisma dev --help` installed and ran `@prisma/cli-dev@latest`
   (0.16.28) in the temp folder, outside the lockfile. Fixed: removed the cache. `prisma dev`
   is now ruled out in `CLAUDE.md` and D-03A-10.
2. **Blocked install scripts:** pnpm's `ERR_PNPM_IGNORED_BUILDS` for `@prisma/engines` and
   `prisma`. Fixed: reviewed both scripts, allowed the engines, denied `prisma` (D-03A-01).
3. **Index ties in tests:** 4 of the 13 planned-query tests picked a tenant-prefix index,
   because without planner statistics the costs tied. Fixed: `ANALYZE` before the plan checks.
   All 13 then used their intended index.
4. **Test environment only (no code change):**
   - `ECONNRESET` when Prisma disconnected: PGlite was serving one connection. Fixed by
     restarting it with `maxConnections: 4`.
   - `migrate deploy` failed with "no schema has been selected to create in": PGlite's shared
     session kept the dropped test schema's `search_path`. Fixed by restarting the server.

### Incomplete live checks (not passed)

- **Real PostgreSQL 18.6 never ran 03A:** neither Docker (not installed, O-06) nor CI (not
  pushed). PGlite has the same version, but it runs as WebAssembly with one shared session, so
  concurrent connections weren't exercised.
- **Redis integration test:** skipped locally; no Redis here.
- **`pnpm dev` with `pnpm db:migrate`** against the Docker PostgreSQL: not possible without
  Docker.

### Live checks (external services)

None. Nothing was sent, charged or published. Network use:
- npm registry installs: the Prisma 7.10.1 packages, and PGlite in the scratch folder;
- the Prisma schema engine, downloaded by the `@prisma/engines` install script from
  `binaries.prisma.sh`;
- Prisma documentation pages;
- the unintended `@prisma/cli-dev` download (defect 1, removed).

### Blockers

1. **The reference plan is missing** (O-01). Ownership and planned queries stay provisional
   until 01B (O-10).
2. **No Docker** (O-06), and native PostgreSQL holds 5432 (O-05). Live database checks need
   Docker or CI.
3. **Not committed or pushed**, so CI hasn't run on 03A. Committing and pushing are the
   user's decision.
4. **Open for later tasks:**
   - permission catalog and default roles in production (O-11);
   - actor and audit columns (O-12);
   - opt-outs, bounces and suppression (O-13);
   - Prisma 8 (O-14).
   Still open from earlier: O-02, O-03, O-07.

### Manual check

- **With Docker Desktop:**
  1. Run `pnpm dev`.
  2. In a second terminal: `pnpm db:migrate`, then
     `pnpm --filter @lead-fennec-ai/database exec prisma migrate status`, then `pnpm db:fixtures`.
  3. Run `pnpm test` with `TEST_DATABASE_URL` / `TEST_REDIS_URL` exported (see README).
  4. Expect database **40 passed, 0 skipped**.
- **Or, when you choose to commit and push the branch:** confirm CI is green. CI runs the
  schema suite on PostgreSQL 18.6.

### Next prompt

**03B.** This assumes the numbering continues; it can't be confirmed without the plan.

---

## GIT-02: First push to GitHub (2026-11-01)

**Status: Done.** The requests were:
- `git push`
- `git init -b main`
- `git commit -m "02 Development environment"`
- `git push`
- then "nothing is pushed ? what's missing", with a screenshot of the new GitHub repository.

This entry was written during 03A; it had been missing.

| Step | Actual result |
|---|---|
| `git init -b main` | No-op: "Reinitialized existing Git repository", `--initial-branch` ignored. HEAD unchanged (`439e1f1`). |
| `git commit -m "02 Development environment"` | "nothing to commit, working tree clean" (exit 1). 02A–02C were already in `439e1f1`. |
| GitHub repository | `farhan0nouman-sys/LeadFennec-Leads-Agent`, **public**. It held only GitHub's README commit `dd2d8de`, which showed the account's personal email. `origin` had the placeholder URL from the GIT-01 instructions; it now points at this repository. |
| The user's choices | Commit email: the GitHub `noreply` address. GitHub's README commit: drop it. |
| `git commit --amend --no-edit --reset-author` | `439e1f1` → `7fc44f2`: the same tree, now authored with the `noreply` address |
| `git push --force-with-lease=main:dd2d8de… -u origin main` | `+ dd2d8de...7fc44f2 main -> main (forced update)`; exit 0; `main` tracks `origin/main` |
| GitHub `main` vs local `main` | Both `7fc44f2` |
| CI run 41235720269 on `7fc44f2` | Completed, **success** (2026-10-31 19:45–19:47 UTC, i.e. 2026-11-01 local). The public jobs API shows every step passed. |

Effects:
- Resolves 02C's "GitHub Actions has never run" and O-09.
- CI sets `TEST_DATABASE_URL` / `TEST_REDIS_URL`, so 02C's real-database suite should have run
  there. That isn't confirmed: the job logs need a GitHub sign-in.
- GitHub may keep `dd2d8de` viewable by its exact ID for a while.

### Next prompt

**03A.**

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
