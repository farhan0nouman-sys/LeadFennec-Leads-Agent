# Build progress — Lead Fennec AI

Newest entry first. A check is listed as passed only if it ran and succeeded.

---

## GIT-07: Commit 05A–05C (2026-11-02)

**Status: Done (local commit only).** The request was `git commit`.

| Step | Actual result |
|---|---|
| Branch and author | `feat/05a-app-shell` (on top of `3e0b418`); author `LeadFennec-Leads-Agent` with the GitHub `noreply` address |
| Content | One commit for 05A (app shell, navigation, route shells), 05B (endpoint list, OpenAPI, typed client, workspace-scoped cache, shared components) and 05C (dashboard aggregates, recent activity, integration health), with the GIT-06 log entry |
| Checks before committing | The 05C regression (see the 05C entry), which covers 05A and 05B; format check exit 0; a scan of the staged files for credentials and the personal email found nothing |
| Commit | The commit that contains this entry (`git log`) |

- **Not pushed:** CI hasn't run on 05A–05C. The workflow runs on pushes to `main`, pull
  requests and manual dispatch.

---

## 05C: Dashboard aggregates, recent activity, integration health (2026-11-02)

**Status: Passed (local checks). Incomplete live checks:**
- **Real PostgreSQL:** the API, database and browser suites ran on PGlite only. Nothing has
  been pushed since GIT-06, so CI has not run.
- **Plan:** the metrics, their definitions and the refresh intervals could not be checked
  against the missing plan (O-01, O-27).
- **Accessibility:** axe only, no screen reader (O-25).
- **Not committed:** still on branch `feat/05a-app-shell`, together with the uncommitted 05A,
  05B and GIT-06 work.

### Changed components

| Area | Files |
|---|---|
| Shared | `contracts/dashboard.ts` (new): routes, response schemas, `DASHBOARD_METRICS` (available and unavailable metrics), `ACTIVITY_LABELS` / `activityLabel`, `HEALTH_PROVIDERS`, `integrationHealthState`. `contracts/endpoints.ts`: 4 endpoints (tag `dashboard`), 4 cache resources; invite, revoke and role change also invalidate `activity`. `navigation.ts`: `activity` in the Audit log section, the overview's description. `contracts/dashboard.test.ts` (new, 7 tests); endpoint count 24 → 28. |
| Database | `tenancy/dashboard.ts` (new): `scope.dashboard` with `leadSummary`, `campaignSummary`, `activity` (via `audit.list`), `integrationHealth`; each checks its section's permission. `tenancy/access.ts`, `tenancy/index.ts`. `dashboard.integration.test.ts` (new, 6 tests). |
| API | `workspaces/dashboard.controller.ts` (new, 4 GET routes), registered in `workspaces.module.ts`. `workspaces/dashboard.integration.test.ts` (new, 5 tests). `http/route-guards.test.ts`: the 4 routes reviewed. |
| Web: data | `lib/polling.ts` (new): bounded polling rules and the two policies. `lib/query.tsx`: `useApiQuery(…, { poll })`, `PollingState`, page visibility. `lib/format.ts` (new): counts and relative times. Tests: `lib/polling.test.ts` (5), `lib/format.test.ts` (2). |
| Web: screens | `components/dashboard/` (new): `DashboardPanel` / `PanelFooter`, `LeadMetrics`, `CampaignMetrics`, `RecentActivity`, `IntegrationHealth`. `app/workspaces/[workspaceId]/page.tsx`: the overview is the dashboard (panels by permission, one error boundary each; "Your pages" kept; permissions in a collapsed list). `components/data/status-label.tsx`: integration states. |
| Web: browser tests | `e2e/dashboard.spec.ts` (new, 5 scenarios). `e2e/support/db.ts`: `seedDashboard` (fake contacts, companies, campaigns, a broken mailbox). |
| Root | `docs/api/openapi.json` regenerated (28 operations). |
| Docs | `docs/decisions.md` D-05C-01 to 06 and O-27; `docs/api/dashboard.md` (new); `docs/security/authorization-review.md` (28 routes, the repository); `docs/local-development.md`; README (status, tests, screens); `CLAUDE.md` (dashboard rule). This entry. |

### Passed local checks

**Database used:** PGlite 0.5.13 (PostgreSQL 18.6) on 127.0.0.1:54329. It was restarted fresh
before each database run and stopped at the end; ports 54329, 3100 and 3101 are free.

**Final regression.** The generated Prisma client was deleted first, and Turborepo ran without
its cache.

| Command | Actual result |
|---|---|
| `pnpm install --frozen-lockfile` / `pnpm peers check` | Exit 0 / no peer issues |
| `pnpm format:check` | First run: **failed**, 3 new files unformatted. Formatted with Prettier; then exit 0 (and again after the last spec change). |
| `pnpm typecheck --force` | Exit 0; 14/14 tasks, 0 cached (run again after the lint fixes: same) |
| `turbo run lint --force` + root ESLint | First two runs: **failed**, 1 finding each (see below). Then exit 0; 14/14 tasks, 0 cached; root ESLint OK. |
| `pnpm test --force`, no `TEST_*` variables | Exit 0; 10/10 tasks, 0 cached: shared **168**, integrations **13**, database **46 passed, 309 skipped**, web **24**, worker **4**, api **31 passed, 43 skipped** |
| `turbo run test --force --concurrency=1` with `TEST_DATABASE_URL` (PGlite) | Exit 0; 10/10 tasks, 0 cached: shared **168**, integrations **13**, database **353 passed, 2 skipped**, web **24**, worker **4**, api **74** |
| `prisma migrate deploy` (fresh database), `migrate status`, drift `--exit-code` | 13 migrations (none new); up to date; exit 0 |
| `pnpm build --force` | Exit 0; 11/11 tasks, 0 cached |
| `pnpm openapi --check` | Up to date |
| `pnpm test:e2e` with `E2E_DATABASE_URL` (PGlite) | First full run: **31 passed, 2 failed** (see below). After the fix: **35 passed** (11 accounts and teams, 7 app shell, 3 data client, 5 dashboard, 8 components, 1 smoke), axe included: no violations. |
| `pnpm test:e2e` without it | **9 passed** (smoke and the 8 component scenarios), **26 skipped** |
| Screens, by eye | The dashboard at 1280 px, with two panels failing, and at 390 px (throwaway screenshot spec, deleted) |
| Reference repos / credential and personal-email scan of the 05C files | 0 changes in each of the 9 / no credentials; the only match is the public GitHub repository name already in `CLAUDE.md` and `docs/decisions.md` |

**Earlier failures in this task (logged honestly):**
1. **Database test data:** the first run of the new database suite had 2 of 6 failing on
   integrity rules. A member's audit record needs its membership id, and a secret reference
   can't contain "@". The repository now names actors by the recorded membership id (only
   this workspace's memberships), which is stricter than by user id. The test now also checks
   that another workspace's membership is never named.
2. **Lint:** a mapped type where a `Record` is preferred (shared), and a comment between two
   `case` labels (`no-fallthrough`, database). Both fixed.
3. **Visual check:**
   - failed counts showed loading placeholders: they now show "–", read as "Not loaded";
   - a failed panel offered both Try again and Refresh: the footer button is now hidden
     while the retry message is shown;
   - metrics took one full-width column on phones: they now use 2 columns.
4. **Full browser run, 2 failures caused by this task:** the new spec signed in 7 times from
   127.0.0.1. The API's per-address sign-in limit ("Too many attempts") then refused the
   spec's last sign-in and the next spec's (`data-client`). The new spec passed on its own.
   It now signs each account in once and reuses the saved session.

### What 05C proves (local)

- **Real data, one workspace:**
  - The counts come from the database and include only the workspace's own rows (another
    workspace with more rows changes nothing).
  - Archived contacts and contacts without email are counted as defined.
  - The counts of one summary are read in one snapshot.
- **Same rules as the pages:**
  - Each aggregate needs its section's permission, in the route (route test, contract test)
    and in the repository.
  - A Client Team Member gets leads and campaigns but `403` for activity and integration
    health, and the dashboard doesn't show those panels.
  - Outside the workspace: `404`; signed out: `401`; workers are refused.
- **Activity:**
  - Newest first, at most 25, with counts for 24 hours, 7 and 30 days.
  - Only members of this workspace are named. Platform admins appear as Lead Fennec support,
    with their reason.
  - No record ids or metadata are returned.
- **Integration health:** derived from mailboxes, syncs and failed notifications of the
  workspace (healthy, connecting, needs attention, not connected). No provider is contacted.
- **Unavailable metrics:** verified emails, scored leads, emails sent, reply rate and meetings
  booked say "Not available yet", never a number. A test ties every available metric to a
  field of its summary.
- **Bounded polling (Playwright's clock in the browser):**
  - A change made elsewhere appears after a minute without a reload.
  - A hidden page makes no requests in 20 minutes, and refreshes at once when it is visible
    again.
  - Three failed refreshes pause polling, with a polite announcement; nothing is requested in
    the next 30 minutes.
  - Retrying recovers. The 30-minute limit and the back-off are unit-tested.
- **Error recovery:** one failing panel leaves the others working, shows a generic message,
  and recovers with Try again.
- **Layout and accessibility:** at 390 px the panels stack without sideways scrolling, and axe
  finds no WCAG 2.2 A/AA violations on desktop or narrow screens.

### Incomplete live checks (not passed)

- Real PostgreSQL and CI.
- A screen-reader pass (O-25): the live region for stopped updates and the description lists
  were checked with axe and the accessibility tree only.
- The `pg` 8.23 deprecation warning from Prisma's `adapter-pg` still appears in runs (O-14).

### Blockers

1. The reference plan is missing (O-01).
2. No Docker (O-06).
3. Open: O-19 to O-27.

### Manual check

Optional:
- With `pnpm dev`, open a workspace's overview as an admin and as a team member, and compare
  the panels.
- Leave the page open, invite someone from another tab, and check that Recent activity shows
  it within a minute.
- Switch to another tab for a few minutes and back: the panel refreshes at once.

### Next prompt

Not known: the plan is missing (O-01).

---

## 05B: Shared UI components, typed API client, workspace-scoped cache (2026-11-02)

**Status: Passed (local checks). Incomplete live checks:**
- **Real PostgreSQL:** the API, database and browser suites ran on PGlite only. Nothing has
  been pushed since GIT-06, so CI has not run.
- **Plan:** the components and their behaviour could not be checked against the missing plan
  (O-01).
- **Accessibility:** axe only, no screen reader (O-25).
- **OpenAPI:** checked by structural tests only, not by an external validator (O-26).
- **Not committed:** still on branch `feat/05a-app-shell`, together with the uncommitted 05A
  and GIT-06 work.

### Changed components

| Area | Files |
|---|---|
| Shared | `contracts/endpoints.ts` (new): the list of all 24 endpoints (`API`, `ALL_ENDPOINTS`) with access, permission, the contract's own schemas, status, error codes, cache resource and invalidations; `buildEndpointRequest`; health response schemas. `contracts/openapi.ts` (new): the OpenAPI 3.1.2 generator. Exported from `index.ts`. |
| API | `http/api-contract.test.ts` (new): routes against the list. `testing/registered-routes.ts` (new): route discovery shared with `route-guards.test.ts`, which now uses it. `http/api-errors.ts`: `ZodPipe.schema` made public. |
| Web: data | `lib/api.ts` rewritten as the typed client (`callApi`, `sendRequest`, `endpointRequest`; `apiRequest` and `apiCommand` removed). `lib/query-cache.ts`, `lib/query.tsx` (new): the cache, `ApiCacheProvider` (root layout), `useApiQuery`, `useApiMutation`. `lib/list-params.ts`, `lib/use-list-params.ts`, `lib/use-form-submit.ts`, `lib/demos.ts` (new). `lib/server/api.ts` and `access.ts` call endpoints of the list. `lib/session.tsx` and all auth, invitation and workspace screens migrated to the client. |
| Web: components | `components/data/` (new): `DataTable`, `CursorPagination`, `ListFilters` / `SearchField` / `FilterSelect`, `StatusLabel` / `Status`. `components/feedback/` (new): `ConfirmDialog` / `ConfirmButton`, `EmptyState`, `RetryState`, `ErrorBoundary` (`catchError`), `RouteError`. `components/ui/`: `dialog.tsx`, `skeleton.tsx`, `textarea.tsx` (new); `table.tsx` gains a focusable scroll region. `components/form-field.tsx`: `SelectField`, `TextareaField`, `FormError`, `SubmitButton`. `app/globals.css`: `--warning` and `--info` tokens. |
| Web: pages | `app/error.tsx`, `app/global-error.tsx`, `app/workspaces/[workspaceId]/error.tsx`, `app/admin/error.tsx` (new). Team page (`team-panel.tsx`) and admin console (`components/platform-console.tsx`) rebuilt on the shared components. Revoking, suspending and changing one's own role now ask for confirmation. |
| Web: fixtures | `app/dev/ui/` (new): the component demo, development and test only. `fixtures/demo-leads.ts`, `fixtures/fixture-source.ts` (new). `eslint.config.mjs`: import restrictions in both directions. |
| Web: tests | Vitest project added (`vitest.config.mjs`, `vitest.server-only.mjs`; `test` script; dev dependencies `vitest`, `vite` from the catalog). `lib/query-cache.test.ts`, `lib/list-params.test.ts`, `lib/api.test.ts`. Browser: `e2e/ui-components.spec.ts`, `e2e/data-client.spec.ts` (new); `e2e/accounts-and-teams.spec.ts` confirms the new dialogs; `e2e/support/db.ts` gains `expireSessions`. |
| Root | `scripts/openapi.mjs` and `pnpm openapi`. `docs/api/openapi.json` (generated). |
| Docs | `docs/decisions.md` D-05B-01 to 06 and O-26; `docs/security/authorization-review.md`; `docs/api/auth.md`, `docs/api/workspaces.md`; `docs/local-development.md`; README; `CLAUDE.md` (endpoint list, screens, fixtures, tests). This entry. |

### Passed local checks

**Database used:** PGlite 0.5.13 (PostgreSQL 18.6) on 127.0.0.1:54329. It was restarted fresh
before each database run and stopped at the end; ports 54329, 3100 and 3101 are free.

**Final regression.** The generated Prisma client was deleted first, and Turborepo ran without
its cache.

| Command | Actual result |
|---|---|
| `pnpm install --frozen-lockfile` / `pnpm peers check` / `pnpm format:check` | Exit 0 / no peer issues / exit 0. Before that, 23 new or changed files were formatted with Prettier. |
| `pnpm typecheck --force` | Exit 0; 14/14 tasks, 0 cached |
| `turbo run lint --force` + root ESLint | Exit 0; 14/14 tasks, 0 cached. Earlier in the task: 9 findings fixed (see below). |
| `pnpm test --force`, no `TEST_*` variables | Exit 0; 10/10 tasks, 0 cached: shared **161**, integrations **13**, database **46 passed, 303 skipped**, web **17** (new), worker **4**, api **31 passed, 38 skipped** |
| `turbo run test --force --concurrency=1` with `TEST_DATABASE_URL` (PGlite) | Exit 0; 10/10 tasks, 0 cached: shared **161**, integrations **13**, database **347 passed, 2 skipped**, web **17**, worker **4**, api **69** |
| `prisma migrate deploy` (fresh database), `migrate status`, drift `--exit-code` | 13 migrations (none new); up to date; exit 0 |
| `pnpm build --force` | Exit 0; 11/11 tasks, 0 cached; web routes include `ƒ /dev/ui` (rendered per request) |
| `pnpm test:e2e` with `E2E_DATABASE_URL` (PGlite) | **30 passed**: 11 accounts and teams, 7 app shell, 3 data client, 8 components, 1 smoke. Includes axe checks on the demo page, both dialogs, the form dialog, the empty state and the team page's confirmation: no violations. |
| `pnpm test:e2e` without it | **9 passed** (smoke and the 8 component scenarios), **21 skipped** |
| Lint rules for fixtures | Two throwaway files (a production import of a fixture; `callApi` and `lib/query` imported in `app/dev`) gave 3 `no-restricted-imports` errors; both files deleted |
| Screens, by eye | The demo at 1280 px (table, confirmation, form dialog, retry and boundary states) and at 390 px; the team page at 1280 px, its confirmation, and at 390 px. Throwaway screenshot specs, deleted. |
| Reference repos / credential and personal-email scan of the 121 changed files (05A and 05B) | 0 changes in each of the 9 / only deliberate fake passwords in tests |

**Earlier failures in this task (logged honestly):**
1. **First full browser run:** 29 passed, 1 failed. "Clear filters" remounted the search box
   before the address had changed, so the box showed the old text. `SearchField` now follows
   outside changes to its value instead of relying on a remount. A Back-navigation check added
   with the fix was then removed: Playwright's and the router's history entries made it land
   on `about:blank`, which isn't behaviour of this app.
2. **Lint (9 findings, all fixed):**
   - Two conflicting rules on value stringification (`no-unnecessary-type-assertion` against
     `no-base-to-string`), in the web and shared packages.
   - A void-typed `await` in `useApiMutation`. `EndpointResponse` collapsed to `undefined`
     inside generic code; it is now written so it stays deferred.
   - An optional chain, two unused mock parameters, a non-null assertion style, and an
     unnecessary type argument.
3. **Visual check:**
   - The confirmation dialog inherited right alignment from the table cell it opens from.
   - Next wrapped alone on narrow screens.
   - The demo said "Loading…" next to a failed load.
   All three are fixed.
4. **A doc-edit heredoc failed in bash; nothing was written.** The script was rewritten as a
   file.
5. **Screenshot path:** a screenshot spec's MSYS-style path (`/c/Users/…`) made Node write to
   `D:\c\Users\…`. The 5 files were moved into the scratchpad and the stray folder (only those
   files) was removed.

### What 05B proves (local)

- **One contract:**
  - The 24 registered routes are exactly the endpoint list's, with the guards their access
    needs, the same permission, the same success status, and the same schema objects in their
    validation pipes.
  - `docs/api/openapi.json` is regenerated from that list and checked for being current,
    complete, consistent and resolvable.
  - The `/api` proxy forwards every listed endpoint except the health probes.
- **Typed client:**
  - Invalid input is refused before anything is sent.
  - The CSRF token is sent on authenticated mutations, and such a mutation is never sent
    without one.
  - Every response is validated, and error envelopes, off-contract answers and network
    failures each become a typed error.
- **Cache scoped by workspace:**
  - Keys carry the user and the workspace.
  - Invalidation touches only the named resources of the named workspace and user.
  - Answers that arrive after sign-out are discarded; answers loaded during a change are
    reloaded.
  - In the browser: a mutation reloads its list without a page reload; another workspace's
    screen makes no request for, and shows none of, the first workspace's data; an ended
    session sends the user to sign in and nothing of the workspace stays on screen.
- **Components:**
  - The table pages by cursor, and the page size, search and status filter are kept in the
    address. Invalid address values fall back to defaults.
  - Empty, retry and error-boundary states work; the boundary shows no thrown message.
  - Confirmations focus Cancel first, close on Escape and return focus, and can require a
    typed word. The form shows field, server-side and form-level errors.
- **Fixtures apart:**
  - The demo exists only in development and test.
  - ESLint stops production code from importing fixtures, and demo code from calling the API
    or using its cache.

### Incomplete live checks (not passed)

- Real PostgreSQL and CI.
- A screen-reader pass (O-25).
- An external OpenAPI validator (O-26).
- The `pg` 8.23 deprecation warning from Prisma's `adapter-pg` still appears in runs (O-14).

### Blockers

1. The reference plan is missing (O-01).
2. No Docker (O-06).
3. Open: O-19 to O-26.

### Manual check

Optional:
- Open http://localhost:3000/dev/ui (`pnpm dev`) and try the table, filters, dialogs and
  states with the keyboard only.
- On the Team page, check that revoking an invitation asks first and that the list updates
  without a reload.

### Next prompt

Not known: the plan is missing (O-01).

---

## 05A: App shell, navigation, breadcrumbs, route shells (2026-11-02)

**Status: Passed (local checks). Incomplete live checks:**
- **Real PostgreSQL:** the API, database and browser suites ran on PGlite only (nothing pushed
  since GIT-06; CI has not run).
- **Plan:** the page list could not be checked against the missing plan (O-01, O-25).
- **Accessibility:** automated (axe) only; no screen-reader test (O-25).
- **Not committed:** on branch `feat/05a-app-shell` (from `3e0b418`). The uncommitted GIT-06
  log entry is carried along.

### Changed components

| Area | Files |
|---|---|
| Shared | `navigation.ts` (new): `WORKSPACE_SECTIONS` (17), `ADMIN_SECTIONS` (4), groups, `workspaceNavigation`, `canOpenSection`, paths, breadcrumbs. `contracts/auth.ts`: `user.platformAdmin` in the session response. |
| Database | `auth/store.ts`: sessions and sign-in candidates carry `isPlatformAdmin` |
| API | `AuthService`: `platformAdmin` in session responses. Tests: the session flag (workspaces and auth suites), the section rule in `http/route-guards.test.ts` |
| Web: shell | `components/shell/` (new): `AppShell`, `WorkspaceShell` (selector, grouped navigation by permission, context), `AdminShell`, `HomeShell`, `MobileNav` (native modal dialog), `UserMenu`, `NavList`, `Breadcrumbs`, icons. `components/ui/`: `breadcrumb.tsx`, `typography.tsx` (new). Skip link in the root layout; every page's `<main id="main">`; base typography and reduced-motion CSS. Removed: `components/app-header.tsx`. |
| Web: server checks | `lib/server/` (new): `api.ts` (API calls with the session cookie only), `access.ts` (`getSession`, `getWorkspace`, `getWorkspaces`, `requireUser`, `requireWorkspaceSection`, `requirePlatformAdmin`), `config.ts`. `lib/shell-user.ts`. `lib/links.ts` split; the hook moved to `lib/link-token.ts`. |
| Web: pages | Server-rendered: `/workspaces`, `/workspaces/[id]` (layout and overview), `/workspaces/[id]/team` (content moved to `team-panel.tsx`), `/workspaces/[id]/[section]` (15 route shells), `/workspaces/[id]` not-found (`404`), `/admin` (console moved from `/platform`), `/admin/[section]` (3 route shells); `/platform` redirects. `components/section-states.tsx` (route shell, access denied). |
| Dependencies | `lucide-react` 1.66.0; dev: `@axe-core/playwright` 4.14.0 |
| Browser tests | `e2e/app-shell.spec.ts` (7 scenarios, new), `e2e/support/accounts.ts` (new); `accounts-and-teams.spec.ts` adjusted (`/admin`, "Page not found", combobox selector, a timing fix) |
| Docs | `docs/decisions.md` D-05A-01 to 04, O-25; `docs/security/authorization-review.md`; `docs/api/auth.md`; `docs/local-development.md`; README (status, layout, browser tests, "Screens"); `CLAUDE.md` (pages, server components, browser tests). This entry. |

### Passed local checks

**Database used:** PGlite 0.5.13 (PostgreSQL 18.6) on 127.0.0.1:54329, restarted fresh before
each database run and stopped at the end.

**Final regression.** The generated Prisma client was deleted first; Turborepo ran without its
cache.

| Command | Actual result |
|---|---|
| `pnpm install --frozen-lockfile` / `pnpm peers check` / `pnpm format:check` | Exit 0 / no peer issues / exit 0 (first run) |
| `pnpm typecheck --force` | Exit 0; 14/14, 0 cached |
| `turbo run lint --force` + root ESLint | Exit 0; 14/14, 0 cached. Earlier in the task: 3 findings fixed (2 optional chains, 1 arrow returning `expect`). |
| `pnpm test --force`, no `TEST_*` variables | Exit 0; 9/9, 0 cached: shared **143**, integrations **13**, database **46 passed, 303 skipped**, worker **4**, api **27 passed, 38 skipped** |
| `turbo run test --force --concurrency=1` with `TEST_DATABASE_URL` (PGlite) | Exit 0; 9/9, 0 cached: shared **143**, integrations **13**, database **347 passed, 2 skipped**, worker **4**, api **65** |
| `prisma migrate deploy` (fresh database), `migrate status`, drift `--exit-code` | 13 migrations (none new); up to date; exit 0 |
| `pnpm build --force` | Exit 0; 11/11, 0 cached; web routes include `ƒ /workspaces/[workspaceId]/[section]`, `ƒ /admin`, `ƒ /admin/[section]` |
| `pnpm test:e2e` with `E2E_DATABASE_URL` (PGlite) | **19 passed** (11 + 7 scenarios + smoke), including the axe checks: no violations |
| `pnpm test:e2e` without it | **1 passed, 18 skipped** |
| Screens, by eye | Overview, a route shell and access denied at 1280 px; the drawer at 390 px (temporary spec, deleted) |
| Reference repos / credential and personal-email scan of the 67 changed files | 0 changes in each of the 9 / no matches |

**Earlier failures in this task (logged honestly):**
1. First browser run: 2 failures.
   - The 04C test "registers…" signed in before the asynchronous registration had created the
     account (`invalid_credentials`). It had passed in 04C by timing. The test now waits for
     the account.
   - The narrow-screen scenario's `getByLabel('Workspace')` also matched the navigation list
     labelled by the "Workspace" group heading. Both specs now use the combobox role.
2. Type errors in the new spec (the `as const` registry's literal union lacks `primaryAction`
   on some entries): the loop is typed as `WorkspaceSection`.

### What 05A proves (local)

- **Permission-aware navigation:** an admin sees all 17 sections in 5 groups; a Client Team
  Member sees 10, without Approvals, Integrations, Mailboxes, Do-not-contact list, Billing,
  Audit log and Workspace settings.
- **Server enforcement:**
  - each hidden section is refused by the web server when opened directly, in the raw HTML;
  - signed-out requests get a `307` to sign-in (and back);
  - unknown pages and foreign workspaces get a `404`;
  - the admin area is refused to non-admins;
  - the API refuses a member's role change (`403`).
- **API enforcement tied to navigation:** the route test fails if a workspace API route isn't
  in a section, or if a GET route doesn't need its section's permission.
- **Unavailable features:** all 15 workspace and 3 admin route shells say "Not available
  yet" and disable their action.
- **Accessibility:**
  - the skip link reaches `#main`;
  - the dialog keeps focus, closes on Escape and returns focus;
  - `aria-current` on the current page;
  - axe finds no WCAG 2.0, 2.1 or 2.2 A/AA violations on five screens.

### Incomplete live checks (not passed)

- Real PostgreSQL and CI.
- A screen-reader pass (O-25).
- The `pg` 8.23 deprecation warning from Prisma's `adapter-pg` still appears in runs (O-14).

### Blockers

1. The reference plan is missing (O-01): the page list is derived (O-25).
2. No Docker (O-06).
3. Open: O-19 to O-25.

### Manual check

Optional: with a screen reader (NVDA or VoiceOver), sign in, open the workspace navigation
(wide and narrow screens), and check that the "Soon" marker and the breadcrumbs are read
clearly.

### Next prompt

Not known: the plan is missing (O-01).

---

## GIT-06: Push `feat/04a-auth` (2026-11-01)

**Status: Done.** The request was `git push`.

| Step | Actual result |
|---|---|
| Pushed | `feat/04a-auth` → `origin/feat/04a-auth` (new remote branch, tracking set), head `3e0b418`. It carries 03A–03C (`a1ba33e`), 04A–04B (`9ef306e`) and 04C (`3e0b418`). |
| Remote | `github.com/farhan0nouman-sys/LeadFennec-Leads-Agent` (**public**); `main` unchanged at `7fc44f2` |

- **CI has not run:** the workflow runs on pushes to `main`, on pull requests and on manual
  dispatch, not on pushes to other branches. A pull request into `main` (or a manual run)
  would give the first real-PostgreSQL results for 03A–04C. That is the user's decision.
- This entry is not in the pushed commit; it is a local change to the log.

---

## GIT-05: Commit 04C (2026-11-01)

**Status: Done (local commit only).** The request was `git commit`.

| Step | Actual result |
|---|---|
| Branch and author | `feat/04a-auth` (on top of `9ef306e`); author `LeadFennec-Leads-Agent` with the GitHub `noreply` address |
| Content | One commit for 04C: screens, security audit events, authorization review, browser scenarios, docs |
| Checks before committing | The 04C regression (see the 04C entry); format check exit 0; a scan of the staged files for credentials and the personal email found nothing |
| Commit | The commit that contains this entry (`git log`) |

- **Not pushed:** CI hasn't run on 03A–04C.

---

## 04C: Account and team screens, security audit events, authorization review (2026-11-01)

**Status: Passed (local checks). Incomplete live checks:**
- **Real PostgreSQL:** the API, database and browser suites ran on PGlite only, not on a real
  server, in Docker or in CI (not pushed).
- **Concurrency:** the two concurrency tests skip themselves on PGlite.
- **Not pushed:** committed locally (GIT-05); CI hasn't run on it.

### Changed components

| Area | Files |
|---|---|
| Schema and migrations | `audit_actor_type` gains `USER`. `20261101001100_user_audit_actor` (generated), `20261101001200_user_audit_actor_checks` (hand-written: `USER` only in platform records, explicit actor lists). |
| Database package | `auth/store.ts`: `recordSecurityEvent`; `verifyEmailWithToken` returns the user id. Authorization fixes: `audit.list` needs `audit.read`; billing reads and `usage.summary` need `billing.read` (or the system actor, or a platform admin; `requireReadPermissionOrSystem`); `notifications.notify` is system-only. |
| Shared | Plain-language validation messages in the auth and workspace contracts (rules unchanged). |
| API | `AuthService` records 9 security events with the request id; `http/request-id.ts` (moved from the workspace guards); `REQUIRED_PERMISSIONS` exported; new env `DATABASE_POOL_MAX` and `TRUST_PROXY_HOPS` (Express `trust proxy`), in the env schema, `.env.example`, `turbo.json` and `docs/local-development.md`. |
| Web | Tailwind CSS 4 and shadcn/ui-style components (`components/ui`, `components.json`, `app/globals.css`); `/api/[...path]` proxy (`lib/api-proxy.ts`); `lib/api.ts`, `lib/session.tsx`, `lib/forms.ts`, `lib/links.ts`, `lib/workspace.tsx`; 10 screens: `/login`, `/register`, `/verify-email`, `/forgot-password`, `/reset-password`, `/workspaces`, `/workspaces/[id]` (switcher, navigation), `/workspaces/[id]/team`, `/invitations/accept`, `/platform`; `not-found`. New dependencies: `tailwindcss`, `@tailwindcss/postcss` 4.3.3, `postcss` 8.5.32, `class-variance-authority` 0.7.1, `clsx` 2.1.1, `tailwind-merge` 3.7.0; dev: `@lead-fennec-ai/database`, `pg`, `@types/pg`. |
| Tests | API: security-event tests (2), `http/route-guards.test.ts` (6, every route's guards), env tests (2). Database: tenant-access authorization test (1), `USER` actor CHECKs (1); the audit pagination test now reads as a member. Browser: `e2e/accounts-and-teams.spec.ts` (11 scenarios) with `e2e/support/` (global setup migrates; `db.ts` stands in for the inbox). |
| CI and Turborepo | The browser step gets `E2E_DATABASE_URL` (job database, `public` schema); `test:e2e` also builds the API and passes `E2E_DATABASE_URL` through. |
| Docs | `docs/decisions.md` D-04C-01 to 09, O-20 and O-23 updated, O-24 new; `docs/security/authorization-review.md` (new); `docs/api/auth.md` (security events); `docs/local-development.md` (variables, browser tests); README (status, layout, browser tests, migrations, "Screens"); `CLAUDE.md` (new routes, audit, web app, browser tests). This entry. |

### Passed local checks

**Database used:** PGlite 0.5.13 (PostgreSQL 18.6) on 127.0.0.1:54329, restarted fresh before
each database run and stopped at the end.

| Command / check | Actual result |
|---|---|
| `prisma migrate diff … --script` (`USER` value) | One `ALTER TYPE … ADD VALUE 'USER'`; the CHECK changes are in the hand-written migration after it |
| `prisma migrate deploy` (fresh database), `migrate status`, drift `--exit-code` | 13 migrations applied; "Database schema is up to date!"; drift exit 0 |
| Catalog after all migrations | 54 tables, 112 foreign keys, 152 CHECK constraints, 198 indexes, 51 triggers (unchanged: the two actor CHECKs were replaced) |
| Web screens, by eye | Screenshots of sign-in (with an error), the overview and the team page at 1200 px and 390 px wide, taken with a temporary spec (deleted afterwards) |

**Final regression.** The generated Prisma client was deleted first; Turborepo ran without its
cache.

| Command | Actual result |
|---|---|
| `pnpm install --frozen-lockfile` / `pnpm peers check` | Exit 0 / no peer issues |
| `pnpm format:check` | **First run: exit 1** (`packages/database/src/auth/store.ts`, from this task); formatted, then exit 0 |
| `pnpm typecheck --force` | Exit 0; 14/14, 0 cached |
| `turbo run lint --force` + root ESLint | Exit 0; 14/14, 0 cached. Earlier in the task, 18 web lint findings were fixed (deprecated `FormEvent`, state set synchronously in effects, a control-character regex), and 4 in the route test. |
| `pnpm test --force`, no `TEST_*` variables | Exit 0; 9/9, 0 cached: shared **134**, integrations **13**, database **46 passed, 302 skipped**, worker **4**, api **26 passed, 38 skipped** |
| `turbo run test --force --concurrency=1` with `TEST_DATABASE_URL` (PGlite) | Exit 0; 9/9, 0 cached: shared **134**, integrations **13**, database **346 passed, 2 skipped**, worker **4**, api **64** |
| Database package again, after adding the `USER` CHECK test | **347 passed, 2 skipped** with the database; 46 passed, 303 skipped without |
| `pnpm build --force` | Exit 0; 11/11, 0 cached; 13 web routes |
| `pnpm test:e2e` with `E2E_DATABASE_URL` (PGlite) | **12 passed** (11 scenarios + smoke) |
| `pnpm test:e2e` without it | **1 passed, 11 skipped** |
| Reference repos / credential and personal-email scan of the 80 changed files | 0 changes in each of the 9 / no matches |

**Earlier failures in this task (logged honestly):**
1. Browser run 1: re-opening a second emailed link in an open page didn't re-read the token
   (a fragment-only navigation). Fixed in the app: `useLinkToken` follows `hashchange`, and
   the link pages reset their state per token.
2. Browser run 2: the test re-opened the same token in the same page; it now navigates away
   first, as a second click from an email would.
3. Browser run 3: an ambiguous "Team" link selector in the test.
4. The route test first expected at least 25 routes; there are 24. It now pins the exact list.

### What 04C proves (local)

- **Screens against the real API:** every screen in the browser scenarios talks to the built
  API and a migrated database through the web app's proxy, with two workspaces and the three
  roles (D-04C-08).
- **Membership and security audit:** workspace records for creation, invitations (created,
  revoked, accepted) and role changes; platform records for registration, confirmation,
  sign-in (and failures and locks), sign-out, and password reset. No password, token, CSRF or
  session token appears in any audit record (API suite and the whole browser run).
- **Authorization review:** 24 routes and every repository function reviewed; three gaps fixed;
  the route test fails on any unreviewed route or missing guard.

### Incomplete live checks (not passed)

- Real PostgreSQL (CI not run: nothing pushed); the concurrency tests (PGlite).
- `pg` 8.23's deprecation warning from Prisma's `adapter-pg` also appears in the browser runs
  (O-14).

### Blockers

1. The reference plan is missing (O-01).
2. No Docker (O-06).
3. Open: O-19 (mail provider), O-20 (queue, instances, proxies), O-21 (account security),
   O-22 (auth decision), O-23 (member suspension and removal, custom roles), O-24 (screen
   design and copy).

### Manual check

With Docker running (O-06): `pnpm dev`, register at `http://localhost:3000/register`. Emails
stay in the API process (O-19), so confirm the address by issuing a token as
`apps/web/e2e/support/db.ts` does, or run the browser tests with
`E2E_DATABASE_URL=postgresql://leadfennec:<password>@127.0.0.1:5432/leadfennec_test pnpm test:e2e`.

### Next prompt

Not known: the plan is missing (O-01).

---

## GIT-04: Commit 04A–04B (2026-11-01)

**Status: Done (local commit only).** The request was `git commit` (sent together with the
04C prompt).

| Step | Actual result |
|---|---|
| Branch and author | `feat/04a-auth` (from `a1ba33e`); author `LeadFennec-Leads-Agent` with the GitHub `noreply` address |
| Content | One commit for 04A and 04B: they share the schema, the docs and the API modules. |
| Checks before committing | The 04B regression (see the 04B entry); format check exit 0; a scan of the staged files for credentials and the personal email found nothing |
| Commit | The commit that contains this entry (`git log`) |

- **Not pushed:** CI hasn't run on 03A–04B.

---

## 04B: Workspaces, invitations, role-based authorization, worker context (2026-11-01)

**Status: Passed (local checks). Incomplete live checks:**
- **Real PostgreSQL:** not run on a real server, in Docker or in CI. Local runs used PGlite.
- **Concurrency:** the concurrency tests can't run on PGlite (one session).
- **Interrupted:** the work stopped partway through (the user's usage limit) and was resumed.
  Nothing was lost; the database layer was done, the API part was added afterwards.

### Changed components

| Area | Files |
|---|---|
| Shared | `authorization.ts`: `PERMISSION_CATALOG` (adds `members.read`), `SYSTEM_ROLES`. `contracts/workspaces.ts`: routes, schemas, `apiErrorResponseSchema` with the workspace error codes. |
| Schema and migrations | `invitations` (tenant-owned); `INVITED` removed from `membership_status` (default `ACTIVE`); `auth_throttle_scope` gains `INVITATION_EMAIL`; `job_tasks.id` unique. `20261101000800_retire_invited_memberships` (data step), `20261101000900_workspaces_and_invitations` (generated, `"public".` removed), `20261101001000_invitation_integrity_checks` (CHECKs, binding trigger, `tenant_id` trigger). |
| Database package | `tenancy/workspaces.ts` (`createWorkspace`, `listUserWorkspaces`, `syncPermissionCatalog`), `members.ts`, `invitations.ts` (repository; `previewInvitation`, `acceptInvitation`), `authorization.ts`, `worker-context.ts` (`defineWorker`, `enqueueJob`, `claimJob`); `TenantScope` gains `members` and `invitations`; `platformConsole.setTenantStatus`; the test harness can migrate in steps |
| Fixtures | The shared catalog; Beta's shared member is now `SUSPENDED` (was `INVITED`); two invitations per tenant (one accepted, one open) |
| API | `http/api-errors.ts` (`ApiHttpException`, `ZodPipe`, `ApiExceptionFilter` mapping database errors; replaces `auth/auth-errors.ts`); `workspaces/`: `WorkspaceGuard`, `PermissionGuard`, `@RequirePermissions`, the workspace, invitation and platform controllers, the invitation email, slugs. Policy: invitation validity (7 days) and email budget (100 per workspace and day). Test harness `src/testing/api-harness.ts` (excluded from the build); `vitest.config.mjs` runs files one at a time. |
| Tests | New: database `workspaces.integration.test.ts` (19), API `workspaces.integration.test.ts` (11). Updated: 44 tenant tables, 61 relations, "a suspended member". |
| Docs | `docs/api/workspaces.md`; `docs/decisions.md` D-04B-01 to 08, O-11 resolved, O-14 updated, O-23 new; README (status, layout, tests, migrations, "Workspaces and teams"); `CLAUDE.md` (workspace routes, permissions, jobs, platform admins). This entry. |

### Passed local checks

**Database used:** PGlite 0.5.13 (PostgreSQL 18.6), restarted fresh before each run and stopped
at the end.

| Command / check | Actual result |
|---|---|
| `prisma migrate diff … --script` | Generated: `invitations` with 6 indexes (2 partial) and 4 foreign keys, the enum rebuild, the `job_tasks.id` unique index. Edited only to remove `"public".` qualifiers; the data step went into its own earlier migration. |
| `prisma migrate deploy` on an empty database; `migrate status`; drift | 11 migrations; "Database schema is up to date!"; `migrate diff --exit-code` exit 0 |
| `INVITED` data migration | Tested: a schema migrated through 0700 with an `INVITED` membership ends `SUSPENDED` after the rest |
| Fixture CLI load and `--reset` | Exit 0; memberships 2 and invitations 2 per tenant |
| Catalog after all migrations | 54 tables, 112 foreign keys, 152 CHECK constraints, 198 indexes, 51 triggers |

**Final regression.** The generated client was deleted first; Turborepo ran without its cache.

| Command | Actual result |
|---|---|
| `pnpm install --frozen-lockfile` / `pnpm peers check` | Exit 0; no peer issues; no packages added |
| `pnpm format:check` | **First run: exit 1** (`apps/api/tsconfig.build.json`); formatted, exit 0 |
| `pnpm typecheck --force` | Exit 0; 14/14, 0 cached |
| `turbo run lint --force` + root ESLint | Exit 0; 14/14, 0 cached. Earlier, 7 lint findings were fixed (a deprecated alias in 6 places, 1 optional chain). |
| `pnpm test --force`, no `TEST_*` variables | Exit 0; 9/9: shared **134**, integrations **13**, database **46 passed, 301 skipped**, worker **4**, api **18 passed, 36 skipped** |
| `turbo run test --force --concurrency=1`, with `TEST_DATABASE_URL` (PGlite) | Exit 0; 9/9, 0 cached: shared **134**, integrations **13**, database **345 passed, 2 skipped**, worker **4**, api **54** |
| `pnpm build --force` / `pnpm test:e2e` | 11/11, 0 cached / **1 passed** |
| Reference repos / credential scan | 0 changes in each of the 9 / no matches |

**Earlier run (logged honestly):** with packages running in parallel and two database-backed API
files in parallel, every API workspace test failed on PGlite (`relation "tenants" does not
exist`; PGlite shares one session). Fixed by running the API's files one at a time; locally,
packages also run one at a time.

### What the 04B tests prove (on PGlite)

- **Workspace creation:** a verified user becomes Client Admin with the catalog's grants; the
  system roles are created; an audit record; a taken slug `409`; unverified users refused.
- **Roles:**
  - members read the team but can't invite or change roles (`403` from the guard and from the
    repository);
  - admins promote and demote;
  - the last admin is kept (`409`);
  - role changes are audited with their before and after.
- **Isolation:**
  - another workspace (or an invalid id) is `404`;
  - another workspace's membership, role or invitation id is `404`, by route and by repository.
- **Invitations:**
  - the token is never in a response;
  - only the invited, signed-in address may preview or accept, and others learn nothing;
  - the confirmed workspace must match;
  - single use, 7-day expiry, replacement by a new invitation, and revocation;
  - an active member can't be invited;
  - a suspended member is reactivated with the new role;
  - a suspended workspace's invitations are unusable;
  - binding changes are rejected by the trigger, and the state rules by CHECKs.
- **Platform admins:**
  - refused to everyone else, with the refusals recorded;
  - a reason is required;
  - no access to member routes;
  - console, access and status changes are recorded with reason and request id;
  - suspending locks members out, reactivating lets them back.
- **Worker context:**
  - the tenant comes from the task row;
  - envelopes naming a tenant are refused, as are unknown tasks, wrong workers and inactive
    workspaces;
  - a task is claimed once;
  - a payload id from another workspace is not found in the scope;
  - retry, then fail;
  - no enqueueing from a platform-admin scope.
- **Audit:** no secret seen by the tests appears in audit records or logs.

### Incomplete live checks (not passed)

- Real PostgreSQL (O-06, not pushed); the concurrency tests (PGlite).
- `pg` 8.23 warns that Prisma's `adapter-pg` sends concurrent queries on one transaction
  connection, which `pg` 9 will reject. Upstream behaviour; tracked in O-14.
- The worker app does not process jobs yet (O-20).

### Blockers

1. The reference plan is missing (O-01).
2. No Docker (O-06).
3. Open: O-19 (mail provider), O-20 (queue and instances), O-21 (account security), O-22 (auth
   decision), O-23 (member suspension, custom roles, workspace limits).

### Next prompt

**04C** (already requested): the account and team screens.

---

## 04A: Authentication API: registration, verification, sessions, password reset (2026-11-01)

**Status: Passed (local checks). Incomplete live checks:**
- **Real PostgreSQL:** not run on a real server, in Docker or in CI. Local runs used PGlite
  (PostgreSQL 18.6 in WebAssembly).
- **Browsers:** no real browser exercised the cookie, `SameSite` or the Fetch Metadata headers.
  The tests send those headers themselves.
- **Email:** no real email was sent; the fake mail provider records messages.
- **Not committed:** branch `feat/04a-auth` (created from `feat/03a-data-model` at `a1ba33e`).

**Scope.** I read the task as backend, contract and tests only: the account screens are the
next prompt ("before building the account screens"). The reference plan is still missing,
and no earlier auth decision existed, so 04A made and recorded one (D-04A-01, O-22).

### Changed components

| Area | Files |
|---|---|
| Contract (new) | `packages/shared/src/contracts/auth.ts`: routes, zod request and response schemas, error codes, cookie and header names, password policy; tests (4). `docs/api/auth.md`. |
| Schema | `schema.prisma`: `users.email_verified_at`; platform tables `user_credentials`, `user_sessions`, `auth_tokens`, `auth_throttles`; 3 enums |
| Migrations | `20261101000600_user_authentication` (generated). `20261101000700_user_authentication_checks` (hand-written): `is_sha256_hex` and CHECKs for the Argon2id format, token shapes and timing. |
| Database package | `src/auth/store.ts` (auth data access, optimistic attempt counters); new models added to the platform list of the scoped client; the test harness is built and exported as `@lead-fennec-ai/database/testing`; new `auth-schema.integration.test.ts` (10); structure test updated (10 platform tables, credential allowlist, more duplicate names) |
| Integrations | `TransactionalMailProvider` and `FakeTransactionalMailProvider`; `ProviderSet.mail`; `LiveProvidersUnavailableError`; tests (13) |
| API | `src/auth/`: controller, service, guards (`OriginGuard`, `SessionGuard`, `CsrfGuard`), Argon2id hasher, token crypto, session cookie, errors and filter, background tasks, mail templates, policy. `database/` and `mail/` modules. Global `RequestErrorFilter`. `WEB_APP_URL` in `env.ts`. `main.ts` prints a clear message when no live mail provider exists. |
| Dependencies | `@node-rs/argon2` 2.2.2, `@nestjs/throttler` 6.7.1, `cookie` 2.0.1 (catalog); `@lead-fennec-ai/integrations` added to the API |
| Config | `.env.example`, `turbo.json` (`WEB_APP_URL`); log redaction for `x-csrf-token`, `newPassword`, `passwordHash`, `csrfToken`, `sessionToken` |
| Docs | `docs/decisions.md` D-04A-01 to 13, O-19 to O-22. `README.md`: status, layout, "Accounts and sessions", tests, migrations. `CLAUDE.md`: credentials rule and an Authentication section. `docs/local-development.md`: `WEB_APP_URL`, account email in development, the startup error. This entry. |

### Passed local checks

**Database used:** PGlite 0.5.13 (PostgreSQL 18.6) on 127.0.0.1:54329, run from the scratch
folder. It was restarted fresh before each run and stopped at the end (port released).

| Command / check | Actual result |
|---|---|
| Official guidance (WebFetch) | OWASP Password Storage, Authentication, Forgot Password, Session Management and CSRF Prevention cheat sheets; the `cookie` README |
| npm registry | Versions, publish dates, peer ranges and install scripts of the chosen and rejected libraries (D-04A-01, D-04A-03, D-04A-06). All chosen versions are older than the 1-day release-age rule; `pnpm add` passed the supply-chain check. |
| `prisma migrate diff … --script` | Generated migration: 4 tables, 3 types, 1 column, 5 indexes (one partial), 3 foreign keys (CASCADE) |
| `prisma migrate deploy` on an empty database; `migrate status`; deploy again | 8 migrations applied; "Database schema is up to date!"; "No pending migrations to apply." |
| Drift (`migrate diff --exit-code`) | Exit 0 |
| Fixture CLI: load, then `--reset` | Exit 0; the fixtures are unaffected by the new tables |
| Catalog after all migrations | 53 tables, 108 foreign keys, 147 CHECK constraints, 190 indexes, 49 triggers |
| Smoke test: built API (`dist/main.js`, development, PGlite) | `/health/live` 200; register 202, twice; sign-in of the unverified account **403** `email_not_verified` (after letting the background registration finish; a first try 0.1 s after registering got 401 because the account did not exist yet); sign-in with `Origin: https://evil.test` 403; `/auth/session` without a cookie 401; no auth-task failure; the password in no log line (30 lines) |
| Built API with `APP_ENV=staging` | Exit 1: `[api] No live provider adapters exist yet. Account email needs a live mail provider…` (after Nest's own stack trace). Without `WEB_APP_URL` in production: `[api] Invalid environment configuration: WEB_APP_URL: is required outside development and test`. |

**Final regression.** The generated client was deleted first; Turborepo ran without its cache.

| Command | Actual result |
|---|---|
| `pnpm install --frozen-lockfile` / `pnpm peers check` | Exit 0; no peer issues |
| `pnpm format:check` | **First run: exit 1** (15 new files). After `prettier --write` on them: exit 0. **Again exit 1** after a late change (`registry.ts`); formatted, exit 0. |
| `pnpm typecheck --force` | Exit 0; 14/14, 0 cached |
| `pnpm exec turbo run lint --force`, then root ESLint | Exit 0; 14/14, 0 cached; root ESLint exit 0. Earlier, 6 lint findings in new code were fixed. |
| `pnpm test --force`, no `TEST_*` variables | Exit 0; 9/9, 0 cached: shared **134**, integrations **13**, database **46 passed, 280 skipped**, worker **4**, api **18 passed, 25 skipped** (the auth suite skipped) |
| `pnpm test --force`, with `TEST_DATABASE_URL` (PGlite) | Exit 0; 9/9, 0 cached: shared **134**, integrations **13**, database **324 passed, 2 skipped** (Redis; concurrency on PGlite), worker **4**, api **43** (auth flows 25, auth units 12, health 6) |
| `pnpm build --force` | Exit 0; 11/11, 0 cached; `dist/testing` present in the database package |
| `pnpm test:e2e` | Exit 0; Playwright **1 passed** |
| After the late `main.ts` / `registry.ts` change | `turbo run typecheck lint` for integrations and api: 8/8, 0 cached. Their tests with `TEST_DATABASE_URL`: integrations 13, api 43. Build of both: 5/5. Format check exit 0. |
| `git status --porcelain` in the 9 `reference-repos/*` | 0 changed files in each |
| Credential scan (Stripe keys, webhook secrets, private keys, cloud and GitHub tokens, personal email) | No matches. The tests' passwords are fake test values. |

### What the 04A tests prove (on PGlite)

- **Registration:**
  - `202` with a one-time link (token in the URL fragment);
  - only an Argon2id hash (m=19456, t=2, p=1) and the token's SHA-256 are stored;
  - identical answers for a new, an unverified and a verified address;
  - "already registered" mail without a token;
  - the pre-hijacking defense: the first registrant's link stops working and the owner sets
    the password;
  - validation never echoes input, and a malformed body gets the contract's envelope.
- **Verification:** works once; unknown, used and expired (24 h) links are rejected; resend
  issues a new link.
- **Sign-in:**
  - wrong password, unknown address and disabled user give identical `401`s;
  - unverified address `403` only with the right password;
  - cookie `__Host-lf_session` is HttpOnly, Secure, SameSite=Lax, Path=/, with no Domain and no
    lifetime;
  - the token appears neither in the body nor in the database;
  - a new session id at every sign-in, and the old session is ended.
- **Sessions:**
  - expire after 30 idle minutes;
  - activity extends them up to exactly 8 hours;
  - expired, forged, ended and disabled-user sessions get `401`, with the cookie cleared.
- **CSRF and origin:**
  - logout needs the session's own CSRF token; another session's token is refused;
  - every `POST`, sign-in and registration included, is refused from another origin, a
    cross-site or same-site fetch, or `Origin: null`;
  - non-browser clients are accepted.
- **Password reset:**
  - same answer for unknown and known addresses, and mail only to owners;
  - a weak password doesn't use up the link;
  - the link works once and expires after 30 minutes;
  - success ends every session, invalidates the old password and sends a notice.
- **Repeated attempts:**
  - after 5 failures an address is locked for 15 minutes (`429`, `Retry-After`, even with the
    right password), for existing and unknown addresses alike;
  - the lock lifts afterwards;
  - at most 3 reset emails per hour;
  - per-IP limit (`429` on the 4th request at a limit of 3), with session reads not limited.
- **Logs:** no password, link token, session token or CSRF token from any test appeared in any
  log line.
- **Database:**
  - CHECKs reject plain, bcrypt and Argon2i hashes, non-SHA-256 token values, inconsistent
    session times, tokens used after expiry and unhashed throttle keys;
  - one unused token per purpose;
  - deleting a user cascades;
  - attempt windows and locks behave as specified;
  - 8 concurrent attempts are each counted once;
  - a token for a changed address fails;
  - a reset is atomic.
- **Contract:** every API response is parsed with the shared schemas.

### Defects found and fixed during 04A

1. **Bodies that aren't JSON** bypassed the auth error filter. Nest answered with the parser's
   message, which can quote the body. Fixed with a global `RequestErrorFilter` (fixed message,
   contract envelope).
2. **`ECONNRESET` on PGlite** with two connections per Prisma pool in the API suite. Each test
   client now uses one connection.
3. **Raw SQL in the throttle store** would have depended on `search_path` in schema-scoped
   tests. Replaced with optimistic updates through Prisma before the first run.
4. **Six lint findings:** optional chains; Argon2id selection via an ambient const enum
   (`isolatedModules`), now the library default plus a PHC-prefix check; string spread, now
   `Array.from`.
5. **The structure test's credential scan** matched `user_credentials.password_changed_at`
   (a timestamp). Added to the explicit allowlist.
6. **Staging startup** failed with only a Nest stack trace. Now a named
   `LiveProvidersUnavailableError` and a one-line message, with `abortOnError: false` so
   `main.ts` handles startup errors.

### Incomplete live checks (not passed)

- **Real PostgreSQL 18.6 never ran 03A–04A:** no Docker (O-06), and CI hasn't run (not
  pushed).
- **Real browsers:** cookie prefixes, `SameSite` and Fetch Metadata are only simulated with
  headers.
- **Same-origin serving:** serving the API on the web origin (a proxy route) is not built yet;
  it comes with the screens.
- **Redis integration test** and the **real-PostgreSQL concurrency test** (03C): skipped.

### Live checks (external services)

None. Nothing was sent, charged or published. Network use: OWASP and GitHub pages (6), npm
registry metadata, and installing three packages through `pnpm add` (lockfile updated).

### Blockers

1. **The reference plan is missing** (O-01). The auth decision should be checked against it
   (O-22).
2. **No Docker** (O-06), and native PostgreSQL holds 5432 (O-05).
3. **Uncommitted:** 04A is on `feat/04a-auth`, uncommitted, on top of the unpushed
   `feat/03a-data-model`. CI hasn't run.
4. **Open for later tasks:**
   - mail provider and a development inbox (O-19); until then staging and production refuse
     to start;
   - background work, per-IP limits across instances, proxy trust (O-20);
   - MFA, breached passwords, CAPTCHA, session list, email change, deletion, retention (O-21).

### Manual check

- **Once a browser flow exists (next prompt):** sign up, confirm, sign in, reload, sign out
  and reset in a real browser. Check in the developer tools that `__Host-lf_session` is
  HttpOnly, Secure and SameSite=Lax, and that no token appears in the console or the address
  bar.
- **With Docker, or once pushed:** `pnpm test` with `TEST_DATABASE_URL` on real PostgreSQL;
  expect api **43 passed** and database **326 passed, 0 skipped** (with `TEST_REDIS_URL`).

### Next prompt

**04B** (as it turned out: workspaces, invitations and authorization; the screens are 04C).

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
