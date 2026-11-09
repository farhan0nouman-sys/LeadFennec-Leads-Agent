# Build progress — Lead Fennec AI

Newest entry first. A check is listed as passed only if it ran and succeeded.

---

## GIT-21: Commit and push the progress log (2026-11-09)

**Status: Done.** The user asked for an audit that everything is pushed, then to commit and push
the progress log.

| Step | Actual result |
|---|---|
| Audit before | Only `docs/build-progress.md` was uncommitted (the GIT-20, M3 and 11C entries). `HEAD` and `origin/feat/05a-app-shell` were both `e9fa20a`. No local branch had a commit missing from GitHub (`feat/03a-data-model` exists only locally under that name, and its commits are on GitHub in the other branches). No stashes, tags or other worktrees. Ignored files are build output, caches and `reference-repos/` (the third-party clones, never pushed); no environment or credential files exist. |
| Committed and pushed | This entry and the three above, in one commit on `feat/05a-app-shell`, so the log is not left behind again. The commit's id and the remote head are reported in the chat (an entry can't name the commit it is in). |

- **CI has not run:** the workflow runs on pushes to `main`, on pull requests and on manual
  dispatch, not on pushes to other branches.

---

## GIT-20: Commit and push 11C (2026-11-09)

**Status: Done.** The requests were `git commit`, then `git push`, both while the 11C browser
rerun was still running.

| Step | Actual result |
|---|---|
| Committed | `e9fa20a` on `feat/05a-app-shell`: 11C and the GIT-19 entry; 80 files, 13,404 insertions, 1,993 deletions; working tree clean afterwards. The message says the browser rerun was in progress and that this entry and M3 were not included. |
| Pushed | `feat/05a-app-shell` → `origin/feat/05a-app-shell`, `0a32e26..e9fa20a`; the remote head is `e9fa20a` (checked with `git ls-remote`) |
| Remote | `github.com/farhan0nouman-sys/LeadFennec-Leads-Agent` (**public**); `main` unchanged at `7fc44f2`; `feat/04a-auth` unchanged at `3e0b418` |
| After the push | The browser rerun passed: 64 tests. The checks after the commit (web lint, typecheck and unit tests; the browser run without a database) passed too; see 11C. |

- **CI has not run:** the workflow runs on pushes to `main`, on pull requests and on manual
  dispatch, not on pushes to other branches.
- This entry, M3 and the 11C entry were not in `e9fa20a`; they are pushed by GIT-21.

---

## M3: Leads milestone (2026-11-09)

**Status: Reached on local checks, with source and eligibility evidence.** The 11C prompt says to
mark M3 only with source and eligibility evidence. Both are below, from the 11C regression. The
plan that defines M3 is missing (O-01), so this records what the 07A–11C prompts asked for, not
the plan's wording.

**Still open (not passed):**
- Real PostgreSQL and CI: everything ran on PGlite.
- A screen-reader pass of the new screens (axe only).
- Live providers: Apollo, a verification service (O-35) and OpenAI were never called.
- Commit: 11C is `e9fa20a` on `feat/05a-app-shell`, pushed (GIT-20); this entry is pushed by GIT-21.

| Evidence | What it shows | Where (11C regression) |
|---|---|---|
| **Source** | Every lead says why it exists: the people search's source record (provider, run, role match) and the company search that found its company, in both fixture tenants. An imported lead's source is the CSV import, linked on its profile. Each tenant sees only its own. | `apps/worker/src/jobs/pipeline.integration.test.ts` (3); `e2e/lead-workflow.spec.ts` ("Why this lead exists": CSV import); 11B `lead-profile.integration.test.ts` |
| **Eligibility** | The decision records the lead's own eligibility apart from fit (review: no send policy yet, so a person looks). The full check, decided now, blocks: sending is off, the campaign is a draft, there is no mailbox. A suppressed or erased person is blocked and never imported or listed again. | `pipeline.integration.test.ts`; `suppressions.integration.test.ts`, `contact-import.integration.test.ts`; 10B and 10C suites; `e2e/lead-workflow.spec.ts` |
| Search, import, export, correction | End to end, in the database and in the browser | `pipeline.integration.test.ts`, `privacy.integration.test.ts`, `e2e/lead-workflow.spec.ts` |

**What M3 means in practice:** a workspace can find companies and people, import people from a
file, research companies, score and qualify leads, see why each lead exists and whether it may be
emailed, correct it, export it, and honor a person's request not to be contacted or to be erased.
Nothing is sent: sending isn't built, and every check blocks it.

---

## 11C: People imports, lead exports, the do-not-contact list, deletion requests (2026-11-09)

**Status: Passed (local checks). Incomplete live checks:**
- **Real PostgreSQL / CI:** PGlite only.
- **Retention periods** (24 hours for exports, the life of the workspace for suppressions) and the
  limits were chosen without the missing plan (O-01, O-45).
- **Committed and pushed** as `e9fa20a` on `feat/05a-app-shell` (GIT-20), before the browser rerun
  finished. This entry and M3 are pushed by GIT-21.

### Changed components

| Area | Files |
|---|---|
| Shared | New: `contracts/contact-import.ts` (the people file's mapping, request, row normalization and payload), `contracts/exports.ts` (routes, limits, the request, the export, `leadExportCsv`), `contracts/suppressions.ts` (routes, reasons, requests, the entry, the deletion result). Changed: `organization-import.ts` (people fields, issue fields, results with `kind`, `email`, `company`, `contactId`; the options' `contacts`), `lead-discovery.ts` (`CONTACT_CSV`, `contactImport`), `leads.ts` (`doNotContact`), `endpoints.ts` (10 endpoints, 73 in all; `responseType` for the download), `openapi.ts` (a text/csv answer), `workspaces.ts` (4 error codes), `authorization.ts` (`contacts.export`), `navigation.ts` (the do-not-contact page available; `exports` under Leads), `logger.ts` (request logs without the query string), `index.ts`. Tests: `contact-import.test.ts` (4), `exports.test.ts` (3), `logger.test.ts` (+1), `endpoints.test.ts`, `navigation.test.ts`. |
| Database | `schema.prisma`: `exports` (new), `CONTACT_CSV`, `DELETION_REQUEST`. Migrations: `20261109000000_lead_exports_contact_import` (generated) and `…000100_…_checks` (export checks and triggers, the people import's check, the source record link trigger, the deletion request check, the `contacts.export` grant). New: `tenancy/contact-import.ts`, `tenancy/exports.ts`, `tenancy/suppressions.ts`. Changed: `contact-store.ts` (the known address checked too; country; `suppressedAddresses`), `discovery.ts` (people results, progress, options, cancel), `lead-search.ts` (`doNotContact`), `access.ts`, `index.ts`. Fixtures: an expired export in each tenant. Tests: `contact-import.integration.test.ts` (4), `exports.integration.test.ts` (3), `suppressions.integration.test.ts` (4); tenant tables and models 48 → 49, relations 74 → 75. |
| Worker | `jobs/contact-import.ts` (the job), `jobs/export-retention.ts` (the sweep), `main.ts` (its queue, the sweep every 15 minutes), `queue.ts`, `run-task.ts`. Test: `jobs/pipeline.integration.test.ts` (3). |
| API | `workspaces/exports.controller.ts`, `workspaces/suppressions.controller.ts` (new); `discovery.controller.ts` (people import), `leads.controller.ts` (suppress, deletion request), `workspaces.module.ts`, `http/api-errors.ts` (4 errors). Tests: `privacy.integration.test.ts` (3), `route-guards.test.ts` (10 routes). |
| Web | `lib/api-proxy.ts` (import bodies up to 1 MB; `Content-Disposition` and `nosniff` forwarded). New: `app/workspaces/[workspaceId]/suppressions/page.tsx`, `components/suppressions/suppression-list.tsx`, `components/leads/lead-exports.tsx`, `components/leads/lead-privacy.tsx`, `lib/exports.ts`. Changed: `components/imports/import-forms.tsx` (the people form), `imports-home.tsx`, `run-view.tsx` (rows done, people, their report), `components/leads/lead-list.tsx` (exports, the erased notice), `lead-profile.tsx` (the do-not-contact note, Privacy), `components/data/status-label.tsx`, `lib/imports.ts`. Tests: `lib/imports.test.ts` (+2), `lib/exports.test.ts` (3); browser `e2e/lead-workflow.spec.ts` (4), `e2e/support/db.ts`. |
| Docs | `docs/decisions.md` D-11C-01 to 07 and O-45; `docs/security/data-retention.md` (new, the retention policy); `docs/api/exports.md`, `docs/api/suppressions.md` (new); `docs/api/discovery.md` (people imports); `docs/api/openapi.json` (regenerated); `docs/security/authorization-review.md` (6 route rows, 3 service rows); README; `CLAUDE.md` (3 rules). This entry and M3. |

### Passed local checks

**Database used:** PGlite 0.5.13 (PostgreSQL 18.6) on 127.0.0.1:54329. It was restarted fresh
before each database run and stopped at the end.

**Final regression.** The generated Prisma client was deleted first, and Turborepo ran without
its cache.

| Command | Actual result |
|---|---|
| `pnpm install --frozen-lockfile` / `pnpm peers check` | Exit 0 / no peer issues |
| `pnpm format:check` | Exit 0 |
| `pnpm typecheck --force` | Exit 0; 15/15 tasks, 0 cached |
| `turbo run lint --force` + root ESLint | Exit 0; 15/15 tasks, 0 cached; root ESLint OK |
| `pnpm openapi --check` | Up to date (regenerated) |
| `pnpm test --force`, no `TEST_*` variables | Exit 0; 12/12 tasks, 0 cached: shared **286**, integrations **381**, ai-agents **63**, web **50**, database **46 passed, 418 skipped**, worker **9 passed, 25 skipped**, api **31 passed, 84 skipped** |
| `turbo run test --force --concurrency=1` with `TEST_DATABASE_URL` (PGlite) | Exit 0; 12/12 tasks, 0 cached: shared **286**, integrations **381**, ai-agents **63**, database **462 passed, 2 skipped** (the PGlite concurrency skips), api **115**, web **50**, worker **34** |
| `prisma migrate deploy` (fresh database), `migrate status`, drift `--exit-code` | 35 migrations (2 new); up to date; no difference, exit 0 |
| `pnpm build --force` | Exit 0; 11/11 tasks, 0 cached |
| `pnpm test:e2e` with `E2E_DATABASE_URL` (PGlite) | **64 passed** (3.5 min), after a fix (see below). The first run failed 2 tests (61 passed, 1 not run). The web build came from the cache-free build plus the fix |
| After the fix: `pnpm format:check`, web lint, typecheck and unit tests | Exit 0; 6/6 tasks, 0 cached; **50** passed |
| `pnpm test:e2e` without it | **9 passed, 55 skipped** |
| Reference repos / credential and personal-data scan of the 80 committed files | 0 changes in each of the 9 / no matches (apart from this log's own descriptions of earlier scans) |

**Earlier failures in this task (logged honestly):**
1. **Tests I wrote wrong:**
   - audit records are ordered by `occurredAt`, not `createdAt`;
   - `fetch().text()` drops a byte-order mark, so the API test reads the bytes;
   - the API test harness runs on its own clock, so the expired export is made relative to it;
   - the pipeline test first expected the live eligibility to be `review`. The decision records
     the lead's own eligibility; the live check adds the campaign's blocks. The test now asserts
     both, and the code is `source_policy_unknown`.
2. **Lint:** 4 errors (an always-false condition, two unnecessary optional chains, an unused
   initial value).
3. **OpenAPI** was stale once: the lead detail gained `doNotContact` after the first generation.
4. **Format:** one test file.
5. **Tooling:** two long shell heredocs failed before writing anything (scripts written with the
   Write tool instead); a marker matched twice (nothing written to that file); a `node -e` with
   backticks failed (nothing written).
6. **Browser tests, first run (2 failures):**
   - **The 10C qualification decision's "Saved" message was never seen.** The decision was
     saved, but the form is keyed by the current decision, so the refreshed decision remounted
     it and wiped the message. For a person it could vanish at once. A 10C defect, made likelier
     by the wider refresh since 11B. The message now lives in the section, outside the keyed
     form (`components/qualification/lead-qualification.tsx`).
   - **axe found no page title** on the company research page while it showed an earlier
     version. Nothing in 11C touches that page, and it passed in the rerun without a change,
     so it is logged as an unexplained flake. If it recurs, look at the title during client
     navigation.

**Defects found and fixed in passing (not caused by 11C):**
- **Suppressed people could come back through a profile match (08C).** `saveContacts` checked only
  the incoming address. A person on the do-not-contact list found again without their address
  (by LinkedIn profile or name) was matched, and a people search could list them for a campaign
  again. A known person is now checked with the address the workspace has for them.
- **The web proxy cut every request at 64 KB (07C).** A company CSV over 64 KB couldn't be imported
  from the browser, although the API allows 256 KB of text. Import routes now get the API's 1 MB.
- **Search text reached the logs (11A).** Request logs included the query string (`q`, `contact`).
  They leave it out now (D-11C-07).
- **The 10C decision's "Saved" message vanished** when the refreshed decision remounted the form
  (failure 6 above).

### What 11C proves (local)

- **Imports:** a people file is checked row by row in the request. Failed rows are reported at
  once, with their reasons, and unmapped columns are never kept. The worker saves the rest in
  batches of 100 with visible progress. A cancelled import keeps only what was done.
- **Re-enrollment:** suppressed people can't come back through an import:
  - an address or a domain on the list is excluded before anything is saved;
  - a known suppressed person without their address is excluded too, from imports and people
    searches;
  - an erased person is excluded the next time the same file is imported (database and browser).
- **Exports:** a lead search becomes a CSV file of at most 2,000 leads, every cell safe in a
  spreadsheet, with a byte-order mark. Only its maker can download it, for 24 hours; then it is
  410 and its content is deleted (download, new export, worker sweep). At most 10 files wait per
  member, and audits hold counts only.
- **The do-not-contact list:**
  - add, repeat, a domain with its subdomains;
  - reopened leads (Review, blocked);
  - only a member's own entries removable;
  - audits without addresses;
  - another tenant's lead with the same address untouched.
- **Deletion requests:**
  - erase a lead and everything about them, and the records naming the address, keeping only the
    address (no note);
  - a stale page erases nothing;
  - by address, also for someone unknown.
- **Two fixture tenants:** discovery, people, research, qualification and profile review in both
  tenants with the real jobs (D-11C-05). Then a correction, a people import and exports, neither
  tenant seeing the other's copy of the same synthetic person.

### Incomplete live checks (not passed)

- Real PostgreSQL and CI; a screen-reader check of the new screens (axe only).
- The retention sweep on a real schedule (it ran in tests, not in a deployed worker; no Redis here,
  O-06).

### Blockers

1. The reference plan is missing (O-01).
2. No email verification service is selected (O-35).
3. No Docker or Redis (O-06).
4. Open: O-19 to O-34, O-36 to O-45.

### Manual check

1. In development, open Imports and import a small CSV of people (first, last, email, company)
   that includes an address you added to the do-not-contact list. Run the worker (or
   `apps/worker/dist/run-task.js` with the task id), and watch the rows done; download the error
   report.
2. In Leads, export the leads, download the file and open it in a spreadsheet: formulas show as
   text.
3. Open a lead, erase them under Privacy, then import the same file again: they are excluded.
4. Open the do-not-contact list: the erased person's address is there, without a note.

### Next prompt

Not given yet: 11C was the last prompt sent. The next one waits for the user.

---

## GIT-19: Commit and push 11A and 11B (2026-11-08)

**Status: Done.** The requests were `git commit`, then `git push`.

| Step | Actual result |
|---|---|
| Committed | `0a32e26` on `feat/05a-app-shell`: 11A, 11B and the GIT-18 entry; 54 files, 13,584 insertions, 206 deletions; working tree clean afterwards |
| Pushed | `feat/05a-app-shell` → `origin/feat/05a-app-shell`, `c53fe39..0a32e26`; the remote head is `0a32e26` (checked with `git ls-remote`) |
| Remote | `github.com/farhan0nouman-sys/LeadFennec-Leads-Agent` (**public**); `main` unchanged at `7fc44f2`; `feat/04a-auth` unchanged at `3e0b418` |

- **CI has not run:** the workflow runs on pushes to `main`, on pull requests and on manual
  dispatch, not on pushes to other branches.
- This entry is not in the pushed commit; it is a local change to the log.
- **Next prompt:** 11C, waiting for the go-ahead.

---

## 11B: Lead list and profile, corrections, tags, notes, assignment, stale data (2026-11-08)

**Status: Passed (local checks). Incomplete live checks:**
- **Real PostgreSQL / CI:** PGlite only.
- **No real drafts or sends:** draft generation and sending aren't built. Invalidation and
  cancellation were tested on seeded drafts, approvals and scheduled sends.
- **Plan:** the material fields, the staleness rules and the assignment refusals were chosen
  without the missing plan (O-01, O-44).
- **Not committed:** on branch `feat/05a-app-shell`, on top of `c53fe39`, with 11A and the GIT-18
  log entry.

### Changed components

| Area | Files |
|---|---|
| Shared | `contracts/lead-profile.ts` (new): routes, limits, material fields, and the correction, tag, note and assignment requests, plus 2 error codes. Also changed: `contracts/leads.ts` (the detail's version, research, tags, notes, score history, activity, source URLs, decision versions), `lead-qualification.ts` (`lead_data_changed`), `endpoints.ts` (4 endpoints; the decision now also refreshes the lead), `workspaces.ts`, `navigation.ts` (Leads available), `index.ts`. Tests: `endpoints.test.ts` (59 → 63), `navigation.test.ts`. |
| Database | `schema.prisma`: `contacts.version`, the tables `contact_notes` and `contact_tags`, `INVALIDATED` drafts and `LEAD_DATA_CHANGED` cancellations. Migrations: `20261108000400_lead_profile` (generated) and `…000500_lead_profile_checks` (checks, the immutability and append-only triggers). New: `tenancy/lead-changes.ts` (`correct`, `setTags`, `addNote`, `assign` and their errors) and `tenancy/lead-staleness.ts` (`markLeadsStale`). Changed: `send-eligibility.ts` (`evaluateEligibilityFacts`, run in the caller's transaction), `lead-search.ts` (the profile parts and the changes in `scope.leads`), `research.ts` (a correction makes its company's leads stale), `index.ts`. Fixtures: a note and a tag in each tenant. Tests: `lead-profile.integration.test.ts` (new, 7); tenant tables 46 → 48, relations 71 → 74, model registry 46 → 48. |
| API | `workspaces/leads.controller.ts` (4 routes), `http/api-errors.ts` (4 errors, mapped and caught). Tests: `leads.integration.test.ts` (+1), `route-guards.test.ts` (4 routes). |
| Web | `app/workspaces/[workspaceId]/leads/page.tsx` (the list, replacing the shell) and `leads/[contactId]/page.tsx` (new). `components/leads/lead-list.tsx`, `lead-profile.tsx` and `lead-forms.tsx` (new). `lib/leads.ts` (new) and its test (2). Browser tests: `e2e/lead-profile.spec.ts` (new, 3); `e2e/app-shell.spec.ts` (Leads is now a built page). |
| Docs | `docs/decisions.md` D-11B-01 to 05 and O-44; `docs/api/leads.md` (Changes); `docs/api/openapi.json` (regenerated); `docs/security/authorization-review.md` (2 route rows, 2 service rows); README (Lead profile); `CLAUDE.md` (the lead changes rule). This entry. |

### Passed local checks

**Database used:** PGlite 0.5.13 (PostgreSQL 18.6) on 127.0.0.1:54329. It was restarted fresh
before each database run and stopped at the end.

**Final regression.** The generated Prisma client was deleted first, and Turborepo ran without
its cache.

| Command | Actual result |
|---|---|
| `pnpm install --frozen-lockfile` / `pnpm peers check` | Exit 0 / no peer issues |
| `pnpm format:check` | Exit 0 |
| `pnpm typecheck --force` | Exit 0; 15/15 tasks, 0 cached |
| `turbo run lint --force` + root ESLint | Exit 0; 15/15 tasks, 0 cached; root ESLint OK |
| `pnpm openapi --check` | Up to date (regenerated for the 4 routes) |
| `pnpm test --force`, no `TEST_*` variables | Exit 0; 12/12 tasks, 0 cached: shared **278**, integrations **381**, ai-agents **63**, web **45**, database **46 passed, 405 skipped**, worker **9 passed, 22 skipped**, api **31 passed, 81 skipped** |
| `turbo run test --force --concurrency=1` with `TEST_DATABASE_URL` (PGlite) | Exit 0; 12/12 tasks, 0 cached: shared **278**, integrations **381**, ai-agents **63**, database **449 passed, 2 skipped** (the PGlite concurrency skips), api **112**, web **45**, worker **31** |
| `prisma migrate deploy` (fresh database), `migrate status`, drift `--exit-code` | 33 migrations (2 new); up to date; no difference, exit 0 |
| `pnpm build --force` | Exit 0; 11/11 tasks, 0 cached |
| `pnpm test:e2e` with `E2E_DATABASE_URL` (PGlite) | **60 passed** (5.7 min), after a fix (see below). The first run failed 1 test (57 passed, 2 not run) |
| `pnpm test:e2e` without it | **9 passed, 51 skipped** |
| After the fix: `pnpm format:check`, web lint and typecheck | Exit 0; 5/5 tasks, 0 cached |
| Reference repos / credential and personal-data scan of the 54 uncommitted files (11A and 11B) | 0 changes in each of the 9 / no matches (the only hits were this log's own descriptions of earlier scans) |

**Earlier failures in this task (logged honestly):**
1. **Tests that changed with the task:**
   - the navigation test listed the built sections, and the OpenAPI test failed until
     `pnpm openapi` ran (the decision endpoint now also refreshes the lead);
   - the app shell browser test used Leads as its example of an unbuilt page. It now checks
     the built Leads page; the unbuilt pages keep their own loop.
2. **Lint:** one optional chain.
3. **Tooling:**
   - long shell heredocs failed twice before writing anything; the edits were made with script
     files instead;
   - one inline quoting slip (nothing written).
4. **Browser test:** the 10C qualification test clicked the link named "Leads" on a campaign
   page. Since Leads is a built page, the navigation has a link with the same name, so the click
   was ambiguous and the test failed. It now clicks the campaign page's own link (inside the
   main region). Rerun: 60 passed.

### What 11B proves (local)

- **Why a lead exists** is on its profile:
  - its sources, linked to their import or page;
  - the evidence about the person and their company, and the company's research;
  - its data quality and every address check, its score history, campaigns and decisions;
  - its notes and tags.
- **Corrections without stale approvals:** a material correction, in one transaction:
  - invalidates the approved draft (its approval kept, append-only, but unusable);
  - cancels its scheduled send (`LEAD_DATA_CHANGED`);
  - sends every campaign's decision back to Review with the reason, eligibility decided again
    (a new, unchecked address: blocked).

  In the browser, an approval made on the profile goes back to Review after a correction, and
  the reason is kept as a note. A company research correction does the same for its leads. A
  LinkedIn profile change reopens nothing.
- **Stale edits fail safely:** a correction, a tag change or an assignment from an old version
  is 409 and changes nothing. In the browser, a second, stale page's edit is refused without
  overwriting.
- **Unauthorized assignments fail safely:**
  - refused for another workspace's campaign ("Not found in this workspace.", in the database
    and over HTTP), an ended campaign, one without a lead list, and a lead on the do-not-contact
    list;
  - refused for a member without `campaigns.write`;
  - another workspace's lead is 404; a change without a CSRF token is 403.
- **Validation:** another lead's address, a malformed address, a lead left unidentifiable, more
  than 20 tags, bad tag characters, and a missing reason are all refused. Notes never change.

### Incomplete live checks (not passed)

- Real PostgreSQL and CI; a screen-reader check of the new screens (axe only).
- Real drafts and sends (not built).

### Blockers

1. The reference plan is missing (O-01).
2. No email verification service is selected (O-35).
3. No Docker or Redis (O-06).
4. Open: O-19 to O-34, O-36 to O-44.

### Manual check

1. In development, open Leads and pick a person.
2. Check the profile: their source (with a link to the import), data quality, campaigns and
   activity.
3. Approve them in a campaign with a note.
4. Correct their title with a reason. The activity now shows the campaign back in Review ("The
   lead's data was corrected after this decision. Decide again."), and the reason is a note.
5. Open the same profile in a second tab, change the tags in the first, then save tags in the
   second: it says the lead changed since you opened it.

### Next prompt

11C, as sent: "Implement task 11C only." It waits for the go-ahead (one prompt at a time).

---

## 11A: Lead search, lead detail and evidence (2026-11-08)

**Status: Passed (local checks). Incomplete live checks:**
- **Real PostgreSQL / CI:** PGlite only. The 5-second statement timeout is set, but no search was
  slow enough to hit it locally. The planner checks ran on small tables.
- **No screen:** the Leads section is still "not available"; the search is an API only (as the
  prompt asks). No export exists.
- **Plan:** the filters, sorts, limits and the meaning of "activity" and "eligibility" were
  chosen without the missing plan (O-01, O-43).
- **Not committed:** on branch `feat/05a-app-shell`, on top of `c53fe39`, with the uncommitted
  GIT-18 log entry.

### Changed components

| Area | Files |
|---|---|
| Shared | `contracts/leads.ts` (new): routes, limits, the allowlisted sorts and filters, `leadSearchQuerySchema`, `leadSearchFilters`, `likeContains`, and the page, detail and evidence schemas. Also changed: `endpoints.ts` (3 endpoints, the `leads` tag, 3 cache resources) and `index.ts`. Tests: `leads.test.ts` (new, 4); `endpoints.test.ts` (56 → 59). |
| Database | `schema.prisma`: `contacts.last_activity_at` and 2 indexes. Migrations: `20261108000200_lead_search` (generated) and `…000300_lead_search_activity` (backfill, the triggers, a check). `tenancy/lead-search.ts` (new): `scope.leads` with `search`, `detail` and `evidence`, plus `assertTenant` and `TenantLeakError`. Also changed: `access.ts`, `index.ts`. Tests: `lead-search.integration.test.ts` (new, 12); `schema.integration.test.ts` (+2 index checks). No new table or relation. |
| API | `workspaces/leads.controller.ts` (new, 3 routes), `workspaces.module.ts`. Tests: `leads.integration.test.ts` (new, 4), `route-guards.test.ts` (3 routes). |
| Web | `components/imports/run-view.tsx` and `enrichment-view.tsx`: a run's results load once more when the run finishes (a fix, see below). |
| Docs | `docs/decisions.md` D-11A-01 to 07 and O-43; `docs/api/leads.md` (new); `docs/api/openapi.json` (regenerated); `docs/security/authorization-review.md` (2 route rows, 1 service row); README (Lead search); `CLAUDE.md` (the lead search rule). This entry. |

### Passed local checks

**Database used:** PGlite 0.5.13 (PostgreSQL 18.6) on 127.0.0.1:54329. It was restarted fresh
before each database run and stopped at the end.

**Final regression.** The generated Prisma client was deleted first, and Turborepo ran without
its cache.

| Command | Actual result |
|---|---|
| `pnpm install --frozen-lockfile` / `pnpm peers check` | Exit 0 / no peer issues |
| `pnpm format:check` | Exit 0 (after a fix, see below) |
| `pnpm typecheck --force` | Exit 0; 15/15 tasks, 0 cached |
| `turbo run lint --force` + root ESLint | Exit 0; 15/15 tasks, 0 cached; root ESLint OK |
| `pnpm openapi --check` | Up to date (regenerated for the 3 routes) |
| `pnpm test --force`, no `TEST_*` variables | Exit 0; 12/12 tasks, 0 cached: shared **274**, integrations **381**, ai-agents **63**, web **43**, database **46 passed, 394 skipped**, worker **9 passed, 22 skipped**, api **31 passed, 80 skipped**. This run was before the 4 shared `leads.test.ts` tests were added; the next row includes them |
| `turbo run test --force --concurrency=1` with `TEST_DATABASE_URL` (PGlite) | Exit 0; 12/12 tasks, 0 cached: shared **278**, integrations **381**, ai-agents **63**, database **438 passed, 2 skipped** (the PGlite concurrency skips), api **111**, web **43**, worker **31** |
| `prisma migrate deploy` (fresh database), `migrate status`, drift `--exit-code` | 31 migrations (2 new); up to date; no difference, exit 0 |
| `pnpm build --force` | Exit 0; 11/11 tasks, 0 cached |
| `pnpm test:e2e` with `E2E_DATABASE_URL` (PGlite) | **57 passed**, after a fix (see below). The first two runs failed 1 test (52 passed, 4 not run). The web build came from the cache-free build plus the fix |
| `pnpm test:e2e` without it | **9 passed, 48 skipped** |
| After the fix: `pnpm format:check`, web lint, web unit tests | Exit 0; 4/4 lint tasks; **43** passed |
| Reference repos / credential and personal-data scan of the 26 changed files | 0 changes in each of the 9 / no matches |

**Earlier failures in this task (logged honestly):**
1. **Lint** (fixed):
   - a type parameter used once;
   - an unnecessary assertion, `void` on a value, a ternary instead of `??`, and an unnecessary
     `String()`;
   - removing two unused fields: the first attempt hit read-only fields (a type error). The
     cursor's filter hash now leaves the page out through a JSON replacer.
2. **Format:** ESLint's automatic fixes left the new database test unformatted, and the first
   `pnpm format:check` of the regression failed on it. It was reformatted; format and lint pass.
3. **A results list that went stale (a defect, fixed):** the first two browser runs failed the
   07C test "a search finds companies…": the run said "Finished" with 30 saved, but its results
   table had no rows. The trace showed why. The results were loaded while the run was still
   queued; when the run finished, the results stopped refreshing with it, so they were never
   loaded again. The race existed since 07C and was won by earlier runs; the slightly slower job
   (the new triggers) lost it both times. The run page, and the 08C people results, now load
   their results once more when the run finishes. The third run passed (57).
4. **Tooling:** generating the migration once failed because the database URL wasn't set in that
   shell (nothing written); the files were then written with the Write tool.

### What 11A proves (local)

- **Stable, combined, without duplicates:**
  - every sort (created, activity, name, company) in both orders, paged two at a time, returns
    exactly the one-page result: each lead once, ties broken by id;
  - the score sort pages one at a time;
  - people added between pages don't repeat or shift anyone;
  - combined filters (a campaign, an industry, a score floor, a verified address) narrow
    correctly, and a combined search paged one at a time holds only matches, in order;
  - the same over HTTP.
- **No tenant leakage:**
  - the other workspace holds the same company and person, and is never returned;
  - its person's detail and evidence are 404, and so is its campaign as a filter;
  - every row read through a join passes `assertTenant`, which throws on another tenant's row.
- **No results:** an empty page with no cursor, in the database and over HTTP.
- **Invalid input is refused (400):**
  - invalid sort fields, including an injection attempt;
  - an invalid order, unknown parameters and values, a too-large page;
  - a score sort without a campaign;
  - cursors of another sort, order or filter set, and malformed ones.

  Text matches literally (`%`, `_`).
- **Bounded:** at most 100 rows a page, capped detail lists, list and text limits, and a 5-second
  statement timeout; there is no export.
- **Indexes:** the planner uses the new activity and country indexes.

### Incomplete live checks (not passed)

- Real PostgreSQL and CI, with realistic workspace sizes (and the statement timeout).
- A screen for the search (a later task).

### Blockers

1. The reference plan is missing (O-01).
2. No email verification service is selected (O-35).
3. No Docker or Redis (O-06).
4. Open: O-19 to O-34, O-36 to O-43.

### Manual check

In development, with a signed-in session, open:
- `/api/workspaces/<workspace id>/leads?q=<text>&sort=name&order=asc&limit=2`: two people and a
  `nextCursor`. Pass it back as `cursor` with the same parameters for the next page.
- the same URL with `sort=email`: a 400 naming `sort`.
- `/api/workspaces/<workspace id>/leads/<contact id>` and `…/evidence`.

### Next prompt

11A is the last prompt received. The plan is missing (O-01), so the user sends the next prompt.

---

## GIT-18: Push `feat/05a-app-shell` (2026-11-08)

**Status: Done.** The request was `git push`.

| Step | Actual result |
|---|---|
| Pushed | `feat/05a-app-shell` → `origin/feat/05a-app-shell`, `d0cecc4..c53fe39` (08B finished, 08C); the remote head is `c53fe39` (checked with `git ls-remote`) |
| Remote | `github.com/farhan0nouman-sys/LeadFennec-Leads-Agent` (**public**); `main` unchanged at `7fc44f2`; `feat/04a-auth` unchanged at `3e0b418` |

- **CI has not run:** the workflow runs on pushes to `main`, on pull requests and on manual
  dispatch, not on pushes to other branches.
- This entry is not in the pushed commit; it is a local change to the log.

---

## GIT-17: Commit 08B and 08C (2026-11-08)

**Status: Done (local commit only).** The request was `git commit`.

| Step | Actual result |
|---|---|
| Branch and author | `feat/05a-app-shell` (on top of `d0cecc4`); author `LeadFennec-Leads-Agent` with the GitHub `noreply` address |
| Content | 08B's finish (its decisions D-08B-01 to 06, O-35, the README and `CLAUDE.md` notes and its final entry; its code was already in `1fe897d` and `d0cecc4`), 08C (contact enrichment runs, deduplication, contact quality and rechecks: code, 2 migrations, tests, docs) and this log entry |
| Checks before committing | 08C's cache-free regression on the whole tree (see its entry): format, typecheck, lint, all unit and PGlite suites, migrations and drift, build, OpenAPI, and the browser tests with and without a database, all passing. Then `pnpm format:check` and a scan of the staged changes (results below). |
| Commit | The commit that contains this entry (`git log`) |

- **Results:**
  - `pnpm format:check` exit 0;
  - 58 files staged (this entry is in `docs/build-progress.md`, one of them), none of them env
    files, build output, generated code or reference repos;
  - the scan of the staged diff found no credentials, no personal emails and no Apollo-style
    24-hex ids.
- **Not pushed.**
- **Still open:** no live Apollo, model, verification service, Redis or CI run; the decisions
  O-01 and O-19 to O-42.

---

## 08C: Contact enrichment jobs, deduplication, contact quality and rechecks (2026-11-08)

**Status: Passed (local checks). Incomplete live checks:**
- **No live provider:** people were found with the deterministic fakes only. A live Apollo run
  spends credits and needs an authorized key and run (O-42).
- **No verification service** (O-35): only the fake checks addresses. Outside development and
  test, enrichment leaves addresses unverified, and a recheck is refused (409) or fails closed.
- **No Redis:** the enrichment queue (BullMQ) and the worker process weren't started. The jobs
  ran through `run-task` and the job tests (O-33).
- **Nothing is sent:** no lead is enrolled or emailed; `BUILT_SERVICES` is unchanged.
- **Plan:** the limits, the location rule and the destination were chosen without the missing
  plan (O-01, O-42).
- **Real PostgreSQL / CI:** PGlite only.
- **Not committed:** on branch `feat/05a-app-shell`, on top of `d0cecc4`, with the uncommitted
  08B documents.

### Changed components

| Area | Files |
|---|---|
| Shared | `contracts/enrichment-runs.ts` (new): routes, limits, the request, run info and targets, results, `contactQuality` and its schemas, recheck schemas, 2 error codes. Also changed: `lead-discovery.ts` (the run's `enrichment` and its source), `lead-qualification.ts` (`quality` in the lead view and list), `endpoints.ts` (3 endpoints, the `contacts` tag, 1 cache resource, 2 error statuses), `workspaces.ts`, `index.ts`. Tests: `enrichment-runs.test.ts` (new, 7); `endpoints.test.ts` (53 → 56). |
| Integrations | `contact-enrichment.ts`: the agent's `known` callback (reused people are never looked up), `reused`, `records`, `usage.reused`. `registry.ts`: `contactDataDeclaration`, `emailVerificationAvailable`. The attributions are exported from `apollo-people.ts` and `fake-contacts.ts`. Tests: `contact-enrichment.test.ts` (+1, and one assertion widened), `apollo-people.test.ts` (the `reused` count), `registry.test.ts` (+1). |
| Database | `schema.prisma`: `CONTACT_ENRICHMENT`, `contacts.name_key` and 2 indexes (one replaces the `(tenant, organization)` index it prefixes), `source_records.confidence`, `verifications.reason`. Migrations `20261108000000_contact_enrichment` (generated, plus the dropped index) and `…000100_contact_enrichment_checks` (the import and outcome checks rewritten, the destination trigger, new checks). New files: `tenancy/enrichment.ts` (`scope.enrichment`), `contact-store.ts` (`saveContacts`), `contact-quality.ts` (`contactQualities`, `RECHECK_TASK_TYPE`), `enrichment-metadata.ts`. Changed: `usage.ts` (`settleReservation`, run in the caller's transaction), `discovery.ts` (`runView`, `runViews`; the enrichment info and skipped companies; lenient issue fields), `qualification.ts` (quality in the view and list), `access.ts`, `index.ts`. Tests: `enrichment.integration.test.ts` (new, 8); `schema.integration.test.ts` (the index now used for "contacts of an organization"). No new table or relation, so the tenancy counts are unchanged. |
| Worker | `jobs/contact-enrichment.ts` (new): the `contact_enrichment` worker, for `contact_enrichment.run` and `contact_verification.recheck`. Also changed: `main.ts` (its queue, providers and verifier, failing closed), `queue.ts` (`ENRICHMENT_QUEUE_NAME`), `run-task.ts` (a list of runners tried in turn). Test: `jobs/contact-enrichment.integration.test.ts` (new, 6). |
| API | `workspaces/enrichment.controller.ts` (new, 3 routes), `enrichment-provider.ts` (new: the provider and verification declarations), `workspaces.module.ts`, `http/api-errors.ts` (4 errors, mapped and caught). Tests: `enrichment.integration.test.ts` (new, 4), `route-guards.test.ts` (3 routes), `qualification.integration.test.ts` (quality in the list). |
| Web | `components/imports/enrichment-view.tsx` (new): the "Find people" form, the progress and the people table. `components/qualification/contact-quality.tsx` (new): contact data and the recheck. Also changed: `components/imports/run-view.tsx`, `components/qualification/lead-qualification.tsx` and `campaign-leads.tsx` (the Contact data column), `components/data/status-label.tsx` (3 kinds), `lib/imports.ts` (`canFindPeople`, titles, an error text) and its test (+1). Browser tests: `e2e/contact-enrichment.spec.ts` (new, 3); `e2e/support/db.ts` (4 helpers). |
| Docs | `docs/decisions.md` D-08C-01 to 08 and O-42; `docs/api/enrichment.md` (new); `docs/api/openapi.json` (regenerated); `docs/security/authorization-review.md` (3 route rows, 3 service rows); README (Contact enrichment); `CLAUDE.md` (the contact enrichment rule). This entry. |

### Passed local checks

**Database used:** PGlite 0.5.13 (PostgreSQL 18.6) on 127.0.0.1:54329. It was restarted fresh
before each database run and stopped at the end.

**Final regression.** The generated Prisma client was deleted first, and Turborepo ran without
its cache.

| Command | Actual result |
|---|---|
| `pnpm install --frozen-lockfile` / `pnpm peers check` | Exit 0 / no peer issues |
| `pnpm format:check` | Exit 0 |
| `pnpm typecheck --force` | Exit 0; 15/15 tasks, 0 cached |
| `turbo run lint --force` + root ESLint | Exit 0; 15/15 tasks, 0 cached; root ESLint OK |
| `pnpm test --force`, no `TEST_*` variables | Exit 0; 12/12 tasks, 0 cached: shared **274**, integrations **381**, ai-agents **63**, web **43**, database **46 passed, 380 skipped**, worker **9 passed, 22 skipped**, api **31 passed, 76 skipped** |
| `turbo run test --force --concurrency=1` with `TEST_DATABASE_URL` (PGlite) | Exit 0; 12/12 tasks, 0 cached: shared **274**, integrations **381**, ai-agents **63**, database **424 passed, 2 skipped** (the PGlite concurrency skips), api **107**, web **43**, worker **31** |
| `prisma migrate deploy` (fresh database), `migrate status`, drift `--exit-code` | 29 migrations (2 new); up to date; no difference, exit 0 |
| `pnpm build --force` | Exit 0; 11/11 tasks, 0 cached |
| `pnpm openapi --check` | Up to date (regenerated for the 3 routes) |
| `pnpm test:e2e` with `E2E_DATABASE_URL` (PGlite) | **57 passed** (3 new: find people from a finished search with progress and outcomes; asking again matches people; contact data on the lead page and in the leads list, a recheck, then the daily limit). The e2e task ran; its 11 build dependencies came from the cache-free build just before |
| `pnpm test:e2e` without it | **9 passed, 48 skipped** |
| Reference repos / credential and personal-data scan of the 58 changed files | 0 changes in each of the 9 / no new matches (only the public repository name and synthetic ids, already committed) |

**Earlier failures in this task (logged honestly):**
1. **A planner change caught by the schema test:** the new `(tenant, organization, name key)`
   index made the `(tenant, organization)` index redundant: the planner chose the new one. The
   old index was dropped in the new migration, and the test expects the new name.
2. **Tests built on the old shapes:** three tests compared whole objects that now carry more,
   and were updated:
   - the 08B agent run (`reused`, `records`) and its usage (`reused: 0`);
   - the 10C leads list (`quality`).
3. **Test setup:** a finished job task needs its start and finish times (the database's check);
   the test data was fixed.
4. **Lint and types:**
   - non-null assertions in a test;
   - two optional chains, and an always-true branch;
   - `expect.any` / `expect.arrayContaining` inside matchers (unsafe `any`);
   - a discriminated union TypeScript didn't narrow (a type guard now);
   - **dead code:** the paid-verifier reservations could never run, since only the free fake
     verifier exists. They were removed; the worker and D-08C-04 say a live verifier must
     reserve first.
5. **Tooling:** a long shell heredoc failed before writing anything (the files were written with
   the Write tool), and a stray `cat` waited on input until it was stopped. Neither wrote
   anything.

### What 08C proves (local)

- **Repeated enrichment doesn't duplicate contacts:**
  - a second run over the same companies leaves the number of contacts unchanged, and every
    person comes back MATCHED (the database, job and browser tests);
  - a person found with another provider id but the same address is matched to them;
  - a repeated save of a company (a retry) saves nothing.
- **Repeated enrichment doesn't charge twice:**
  - on a paid provider, the second run sent nobody to enrichment and checked no address again;
    the `LEAD_ENRICHMENTS` ledger didn't move, and its three holds were released;
  - a company's usage is committed in the transaction that saves it. A repeated save releases
    its hold. A rate-limited company's hold is released, and on the retry the ledger equals the
    sum of the committed holds.
- **Ineligible results are kept with reasons but can't enter sending:**
  - people on the do-not-contact list are recorded as EXCLUDED with the reason and not saved;
  - people whose address doesn't accept email are saved with the reason, never added to the
    campaign's lead list, and blocked by send eligibility (`email_invalid`, not overridable);
  - companies outside the targeted countries, or on the do-not-contact list, are skipped with the
    reason before anything is paid.
- **Bounded and isolated:**
  - 25 companies and 5 people a company at most, inputs immutable (triggers);
  - only the worker saves;
  - another workspace's run, campaign or contact is not found;
  - rechecks: once a contact a day, 50 a workspace a day, 429 with Retry-After, 409 without an
    address or a verifier.
- **Quality:** decided from stored facts (source, role match, newest check); a provider's claim is
  never a check. Shown on the lead page and in the leads list; the lead page passes axe.

### Incomplete live checks (not passed)

- A live Apollo people search and enrichment with an authorized key (it spends credits).
- A live email verification service (none chosen, O-35).
- The BullMQ enrichment queue with Redis.
- Real PostgreSQL and CI; a screen-reader check of the new screens (axe only).

### Blockers

1. The reference plan is missing (O-01).
2. No email verification service is selected (O-35).
3. No Docker or Redis (O-06).
4. Open: O-19 to O-34, O-36 to O-42.

### Manual check

1. In development, open a finished company search (Imports).
2. In "Find people at these companies", choose a campaign and press "Find people".
3. Run the queued task: `node apps/worker/dist/run-task.js <task id>`, using the newest
   `contact_enrichment.run` in `job_tasks`.
4. The run page then shows:
   - the companies done and skipped, and the targets;
   - each person's outcome, role match, check and reasons.
5. Press "Find people" again and run its task: everyone is "Already saved", and the contact
   count doesn't change.
6. Open a person: "Contact data" shows the source, the role match and the address's check.
   "Check the address again" works once a day.

### Next prompt

08C is the last prompt received. The plan is missing (O-01), so the user sends the next prompt.

---

## 08B: Apollo people lookup and contact enrichment (2026-11-06, finished 2026-11-08)

**Status: Passed (local checks). Incomplete live checks:**
- **No live Apollo call:** the adapters were tested against recorded-shape fixtures only. A live
  run spends enrichment credits and needs an authorized key and run. Apollo's documentation was
  checked on 2026-11-06 (D-08B-01).
- **No verification service** (the user's answer): the fake stays, and live verification fails
  closed (O-35).
- **Not wired into the app:** nothing stores contacts, queues enrichment or shows them yet (08C).
- **Plan:** chosen without the missing plan (O-01).
- **Commits:** the code is in `1fe897d`, which was pushed as "08B in progress". This finish adds
  the decisions, the README and `CLAUDE.md` notes and this entry; they aren't committed yet.
- This entry replaces the "in progress" entry of 2026-11-06, which is kept in git history.

### Changed components

| Area | Files |
|---|---|
| Integrations | `apollo-client.ts` (new: the Apollo HTTP client, moved out of 07B's adapter and shared), `apollo-people.ts` (new: `ApolloPeopleSearchProvider`, `ApolloContactEnrichmentProvider`), `providers.ts` (a batched `ContactEnrichmentProvider`, partial `ProviderPerson` records), `fake-contacts.ts` (partial records, repeated ids, guessed addresses, enrichment and verification failures), `contact-enrichment.ts` (the agent's usage report, failed checks as retryable or permanent), `registry.ts` (`createContactDataProviders`, `createEmailVerificationProvider`), `fixtures/apollo/` (people search pages, a bulk match, 401, 403 and three kinds of 429). Tests: `apollo-people.test.ts` (new, 7), `contact-enrichment.test.ts` (8), `fakes.test.ts`, `registry.test.ts`. |
| Docs | `docs/decisions.md` D-08B-01 to 06 and O-35; README (Contact enrichment: Apollo, failing closed); `CLAUDE.md` (the Contacts rule). This entry. |

### Passed local checks

Only documentation changed since `d0cecc4`, and the 08B code is used by the integrations package
alone (checked by search). So the checks below were run now, and the database, API, worker and
browser suites were not run again.

| Command | Actual result |
|---|---|
| `pnpm format:check` | Exit 0 |
| `pnpm typecheck --force` | Exit 0; 15/15 tasks, 0 cached |
| `turbo run lint --force` + root ESLint | Exit 0; 15/15 tasks, 0 cached; root ESLint OK |
| `pnpm test --force`, no `TEST_*` variables | Exit 0; 12/12 tasks, 0 cached: shared **267**, integrations **379**, ai-agents **63**, web **42**, database **46 passed, 372 skipped**, worker **9 passed, 16 skipped**, api **31 passed, 72 skipped** |
| The 08B test files (`apollo-people`, `contact-enrichment`, `registry`, `fakes`) | 4 files, **25 passed** |
| Not run again for 08B: the PGlite suites, migrations, build and browser tests | The same code (`d0cecc4`, plus docs) passed them cache-free at the end of 10C (see the 10C entry): database 416 passed and 2 skipped, api 103, worker 25; 27 migrations with no drift; build 11/11; browser tests 54 passed with a database, and 9 passed with 45 skipped without one |
| Scan of the 08B files and fixtures | No credentials and no personal data. The 24-hex ids are synthetic (`6a1f…b001`), and the addresses are `.example`. Reference repos: 0 changes in each of the 9 |

**The completion check, test by test:**

| Required | Where it is shown |
|---|---|
| Missing emails | Enrichment keeps missing addresses apart from claims; the agent skips (and doesn't pay for) people the search says have no address; missing addresses are reported |
| Partial records | Search returns partial records (no address, shortened last name); enrichment completes them; a record left partial is refused |
| Quota exhaustion | A 429 for the day's allowance is `quota_exceeded` (permanent); platform load is `rate_limited` with the suggested 60 s; another 429 follows Retry-After |
| Repeated provider IDs | Kept once, sent to enrichment once, counted in the usage |
| Verification failures | Each failed check is recorded with its code and as retryable or permanent; the address stays unverified |
| Unconfigured live adapters fail closed | Without `APOLLO_API_KEY`, `LiveProvidersUnavailableError`; live verification always fails closed |
| Never guess and label verified | Extrapolated (guessed) and malformed addresses are dropped; Apollo's email status is only a claim |

**Earlier failures in this task (logged honestly):**
1. **The first session stopped at the usage limit** after the integrations package passed (48
   tests then). Its regression and records were missing; this finish ran the checks and wrote
   them.
2. **A test count:** the decisions first said `apollo-people.test.ts` has 6 tests; it has 7
   (corrected).
3. **The first scan's file list** missed the fixtures subfolder (a shell glob); the fixtures
   were then scanned recursively.

### Incomplete live checks (not passed)

- A live Apollo run with an authorized key (people search and paid enrichment).
- A live email verification service (none chosen, O-35).
- CI.

### Blockers

1. The reference plan is missing (O-01).
2. No email verification service is selected (O-35): no address can be verified live.
3. No Docker or Redis (O-06).
4. Open: O-19 to O-34, O-36 to O-41.

### Manual check

None in the app: 08B adds no screen or job. The adapters' behavior is shown by the fixture tests
above.

### Next prompt

08C (queue bounded enrichment for discovered organizations), as sent earlier.

---

## GIT-16: Push `feat/05a-app-shell` (2026-11-08)

**Status: Done.** The request was `git push`.

| Step | Actual result |
|---|---|
| Pushed | `feat/05a-app-shell` → `origin/feat/05a-app-shell`, `1fe897d..d0cecc4` (09A to 10C); the remote head is `d0cecc4` (checked with `git ls-remote`) |
| Remote | `github.com/farhan0nouman-sys/LeadFennec-Leads-Agent` (**public**); `main` unchanged at `7fc44f2`; `feat/04a-auth` unchanged at `3e0b418` |

- **08B is still in progress** in the pushed branch; 08C waits.
- **CI has not run:** the workflow runs on pushes to `main`, on pull requests and on manual
  dispatch, not on pushes to other branches.
- This entry is not in the pushed commit; it is a local change to the log.

---

## GIT-15: Commit 09A to 10C (2026-11-08)

**Status: Done (local commit only).** The request was `git commit`.

| Step | Actual result |
|---|---|
| Branch and author | `feat/05a-app-shell` (on top of `1fe897d`); author `LeadFennec-Leads-Agent` with the GitHub `noreply` address |
| Content | 09A (safe website fetching), 09B (model provider, OpenAI adapter, WebsiteResearchAgent), 09C (research jobs, evidence, corrections, company profile, evaluation), 10A (lead scoring model), 10B (send eligibility and the send policy), 10C (lead qualification), and this log entry |
| Checks before committing | Each task's own regression (see its entry); the last, 10C's, ran cache-free on the whole tree with every task in it: format, typecheck, lint, all unit and PGlite suites, migrations and drift, build, OpenAPI, and the browser tests with and without a database, all passing. After this entry: `pnpm format:check` and a scan of the staged changes for credentials, the personal emails and the Apollo account id (results below). |
| Commit | The commit that contains this entry (`git log`) |

- **Results:**
  - `pnpm format:check` exit 0;
  - 152 files staged, none of them env files, build output, generated code or reference repos;
  - the scan of the staged diff found no credentials and no personal emails (only the public
    repository name), and no Apollo-style 24-hex ids.
- **Not pushed.**
- **Still open:** 08B (its decisions and final entry) and 08C; no live model, Redis or CI run.

---

## 10C: Lead qualification (2026-11-08)

**Status: Passed (local checks). Incomplete live checks:**
- **No live model:** the agent ran with the fake model only. No OpenAI model is chosen (O-37),
  and the agent has no evaluation set or live baseline yet (O-41).
- **No Redis:** the qualification queue (BullMQ) and the worker process weren't started. The job
  ran through `run-task` and the job tests (O-33).
- **Nothing is sent:** leads aren't enrolled or emailed; `BUILT_SERVICES` is unchanged, so
  activation still fails closed.
- **Plan:** the state rules, permissions and agent scope were chosen without the missing plan
  (O-01, O-41).
- **Real PostgreSQL / CI:** PGlite only.
- **Not committed:** on branch `feat/05a-app-shell`, on top of `1fe897d`, together with 09A to
  10B.
- **Order:** 08B is still in progress and 08C waits.

### Changed components

| Area | Files |
|---|---|
| Shared | `contracts/lead-qualification.ts` (new: the agent's input and output schemas, factor guide and limits, review reasons, states and reasons, `classifyLead`, `leadEligibilityStatus`, `leadEligibilityCodes`, the decision request, `contactDecision`, the view and list schemas, routes, `qualification_blocked`). `contracts/lead-scoring-rules.ts` (the agent run in the stored inputs, `LEAD_SCORE_AGENT_STATUSES`). `contracts/endpoints.ts` (4 endpoints, 2 cache resources), `workspaces.ts` (error code), `index.ts`. Tests: `lead-qualification.test.ts` (new, 10); `endpoints.test.ts` (49 → 53). |
| AI agents | `lead-qualification/prompt.ts` (new: `lead-qualification/1`, its schema and pinned hash), `agent.ts` (new: `LeadQualificationAgent`), `index.ts`; package `index.ts`. Test: `agent.test.ts` (new, 9). |
| Integrations | `model/fake.ts`: the built-in qualification responder. |
| Database | `schema.prisma`: table `lead_qualifications` and enums `qualification_state`, `qualification_origin`. Migrations `20261107000600_lead_qualification` (generated) and `…000700_lead_qualification_checks` (checks, triggers). `tenancy/qualification.ts` (new: `scope.qualification` with `request`, `context`, `recordAutomatic`, `decide`, `view`, `list`), `lead-scoring.ts` (checked proposals, the agent run, method AI), `access.ts`, `index.ts`. Fixtures: a person's decision per tenant. Tests: `qualification.integration.test.ts` (new, 9); tenant tables 45 → 46; relations 67 → 71; model registry 45 → 46. |
| Worker | `jobs/lead-qualification.ts` (new: the job), `main.ts` (its queue, relay and consumer), `queue.ts` (`QUALIFICATION_QUEUE_NAME`), `run-task.ts` (dispatch), `jobs/website-research.ts` (the token helper exported). Test: `jobs/lead-qualification.integration.test.ts` (new, 3). |
| API | `workspaces/qualification.controller.ts` (new, 4 routes), `workspaces.module.ts`, `http/api-errors.ts` (2 errors, mapped and caught). Tests: `qualification.integration.test.ts` (new, 4), `route-guards.test.ts`. |
| Web | `app/workspaces/[workspaceId]/campaigns/[campaignId]/leads/page.tsx` and `leads/[contactId]/page.tsx` (new), `components/qualification/campaign-leads.tsx` and `lead-qualification.tsx` (new), `lib/qualification.ts` (new) and its test (4), `lib/polling.ts` (`QUALIFICATION_RUN_POLL`), `components/data/status-label.tsx` (4 kinds), `components/campaigns/campaign-wizard.tsx` (the Leads link). Browser tests: `e2e/lead-qualification.spec.ts` (new, 3), `e2e/support/db.ts` (3 helpers). |
| Docs | `docs/decisions.md` D-10C-01 to 06 and O-41; `docs/api/qualification.md` (new); `docs/api/openapi.json` (regenerated); `docs/security/authorization-review.md` (3 route rows, 2 service rows); README (Lead qualification); `CLAUDE.md` (the lead qualification rule). This entry. |

### Passed local checks

**Database used:** PGlite 0.5.13 (PostgreSQL 18.6) on 127.0.0.1:54329. It was restarted fresh
before each database run and stopped at the end.

**Final regression.** The generated Prisma client was deleted first, and Turborepo ran without
its cache.

| Command | Actual result |
|---|---|
| `pnpm install --frozen-lockfile` / `pnpm peers check` | Exit 0 / no peer issues |
| `pnpm format:check` | Exit 0 |
| `pnpm typecheck --force` | Exit 0; 15/15 tasks, 0 cached |
| `turbo run lint --force` + root ESLint | Exit 0; 15/15 tasks, 0 cached; root ESLint OK |
| `pnpm test --force`, no `TEST_*` variables | Exit 0; 12/12 tasks, 0 cached: shared **267**, integrations **379**, ai-agents **63**, web **42**, database **46 passed, 372 skipped**, worker **9 passed, 16 skipped**, api **31 passed, 72 skipped** |
| `turbo run test --force --concurrency=1` with `TEST_DATABASE_URL` (PGlite) | Exit 0; 12/12 tasks, 0 cached: shared **267**, integrations **379**, ai-agents **63**, database **416 passed, 2 skipped** (the PGlite concurrency skips), api **103**, web **42**, worker **25** |
| `prisma migrate deploy` (fresh database), `migrate status`, drift `--exit-code` | 27 migrations (2 new); up to date; no difference, exit 0 |
| `pnpm build --force` | Exit 0; 11/11 tasks, 0 cached |
| `pnpm openapi --check` | Up to date (regenerated for the 4 routes) |
| `pnpm test:e2e` with `E2E_DATABASE_URL` (PGlite) | **54 passed** (3 new: the leads list and the lead page, qualification by the worker, a person's decision and a suppression). The e2e task ran; its 11 build dependencies came from the cache-free build just before |
| `pnpm test:e2e` without it | **9 passed, 45 skipped** |
| Reference repos / credential and personal-data scan of the 152 uncommitted files (09A to 10C) | 0 changes in each of the 9 / no matches (only the public repository name) |

**Earlier failures in this task (logged honestly):**
1. **The lead page hid "accept these checks" (a defect found and fixed):** the first browser run
   failed. The page offered to accept review reasons only when the overall eligibility was
   `review`. A draft campaign makes it `blocked` for everyone, although the person's own checks
   only needed a person, and the API accepts those. The page now offers them unless the person
   is blocked. A unit test covers both cases, and the rerun passed.
2. **Test expectations and setup:**
   - three answers broke the output schema's limit (invalid output, not a missing factor);
   - a test organization had no normalized domain;
   - a test lead had no email check, so it was rightly blocked;
   - the API's test clock (2026-11-02) made a check dated today a check from the future, so it
     was rightly ignored.
   - The ai-agents tests read the integrations build, which predated the new fake responder
     (rebuilt). The prompt hash was pinned after a placeholder.
3. **Lint and types:** an unused body parameter (now passed to the repository, which validates
   it), optional chains, an unnecessary assertion, nullish coalescing, an `as never` replaced by
   the right type.
4. **Tooling:**
   - edit scripts whose markers no longer matched after `prisma format`, or matched twice
     (nothing written each time; corrected);
   - a quoting slip in an inline script (nothing written; done with the Edit tool).
5. The OpenAPI test failed until `pnpm openapi` regenerated the document, as expected.

### What 10C proves (local)

- **Every classification is explainable:**
  - every state from `classifyLead`, in all 80 combinations of fit, eligibility and agent outcome,
    has at least one reason with a message;
  - the database refuses a decision without reasons;
  - the lead page shows the reasons, and every factor's rating, who rated it, why, and its
    evidence (a company or person field, a research excerpt with its URL and date, an email
    check).
- **Invalid model output goes to review:**
  - an answer that isn't JSON, breaks the schema, carries a score or a state, refuses, or is cut
    off drops every proposal;
  - a proposal citing an unknown fact, a level without evidence, timing not from hiring or news,
    or instruction-like text is dropped;
  - in the job, invalid output and a missing model left supported need and timing missing (score
    70) and the decision Review, with the reason.
- **Application code scores:**
  - the repository checks every cited research fact again;
  - a proposal with a value the research doesn't state, another fact's evidence rows, or a factor
    the rules assess is refused, and nothing is saved;
  - stored scores keep the calculation, rule and agent versions, and still reproduce.
- **Manual changes are tracked:**
  - a person's decision is a new version with their name and note, behind a version check (409);
  - the audit record leaves out the note;
  - accepting review reasons needs `drafts.approve`, and a new review reason (an aged email check)
    needs a person again;
  - the history keeps every decision, and the database refuses changes.
- **Score changes never erase a suppression:**
  - with the score raised to 100 by the agent, the suppression row is still there and still
    blocks;
  - the automatic decision is Rejected (`suppressed_email`), and nobody can qualify the person
    (409, and a database check);
  - `sendPermitted` and `readyToContact` stay false;
  - the browser shows "Nobody can override this." and no Qualified option.
- **Isolation:** another workspace's campaign or person is not found; only the worker records
  automatic decisions or reads the agent's context.

### Incomplete live checks (not passed)

- A live model and an evaluation set for the agent.
- The BullMQ qualification queue with Redis.
- Real PostgreSQL and CI; a screen-reader check of the lead page (axe only).

### Blockers

1. The reference plan is missing (O-01).
2. No Docker or Redis (O-06).
3. No OpenAI key or model chosen (O-37).
4. 08B is unfinished (its decisions and final entry); 08C waits.
5. Open: O-19 to O-34, O-36 to O-41.

### Manual check

Open a campaign's setup, choose "Leads", and open a person. Press "Qualify this lead", then run
the queued task in development (`node apps/worker/dist/run-task.js <task id>`, the newest
`lead_qualification.run` in `job_tasks`). The page then shows:
- Fit, with each factor's rating, explanation and evidence;
- Eligibility, with every check;
- Qualification, with the state and its reasons.

Decide yourself with a note: a new decision appears in the history. Add the person's address to
the do-not-contact list and reload: eligibility says "Nobody can override this.", and Qualified
is no longer offered.

### Next prompt

The 10A to 10C prompts are done. Finish 08B (its decisions and final entry), then 08C; the plan
is missing (O-01), so the user sends the next prompt.

---

## 10B: Send eligibility decisions (2026-11-07)

**Status: Passed (local checks). Incomplete live checks:**
- **Nothing calls eligibility in the running app yet:** there is no enrollment or sending step,
  and no screen shows it (10C). It was exercised in the database and API tests only.
  `BUILT_SERVICES.eligibility` stays `false` for that reason, so activation still fails closed.
- **No workspace has a send policy:** until one is set (only through the API for now), every
  lead needs a person (`region_policy_unknown`, `source_policy_unknown`).
- **Plan:** the block and review split, the 30-day window and the policy shape were chosen
  without the missing plan (O-01, O-40). They haven't had legal review.
- **Real PostgreSQL / CI:** PGlite only.
- **Not committed:** on branch `feat/05a-app-shell`, on top of `1fe897d`, together with 09A to
  10A.
- **Order:** 08B is still in progress and 08C waits.

### Changed components

| Area | Files |
|---|---|
| Shared | `contracts/send-eligibility.ts` (new: the send policy schema and its routes, the checks and reason codes, the facts schema, `evaluateSendEligibility`, the result schema, `leadFitSchema`, `leadSendDecision`). `contracts/endpoints.ts` (2 endpoints, the `settings` tag, the `sendPolicy` cache resource), `index.ts`. Tests: `send-eligibility.test.ts` (new, 13); `endpoints.test.ts` (47 → 49). |
| Database | `schema.prisma`: `tenant_settings.send_policy` and `send_policy_version`. Migrations `20261107000400_send_policy` (generated) and `…000500_send_policy_checks` (checks). `tenancy/send-eligibility.ts` (new: `scope.eligibility` with `evaluate`, `policy`, `updatePolicy`, and `SendPolicyVersionConflictError`), `access.ts`, `index.ts`. Test: `send-eligibility.integration.test.ts` (new, 7). |
| API | `workspaces/send-policy.controller.ts` (new: `GET` and `PATCH /workspaces/:workspaceId/settings/send-policy`), `workspaces.module.ts`, `http/api-errors.ts` (the conflict error, mapped and caught). Tests: `send-policy.integration.test.ts` (new, 3), `route-guards.test.ts`. |
| Docs | `docs/decisions.md` D-10B-01 to 05 and O-40; `docs/api/send-policy.md` (new); `docs/api/openapi.json` (regenerated); `docs/security/authorization-review.md` (2 routes, 3 service methods); README (Send eligibility); `CLAUDE.md` (the send eligibility rule). This entry. |

### Passed local checks

**Database used:** PGlite 0.5.13 (PostgreSQL 18.6) on 127.0.0.1:54329. It was restarted fresh
before each database run and stopped at the end.

**Final regression.** The generated Prisma client was deleted first, and Turborepo ran without
its cache.

| Command | Actual result |
|---|---|
| `pnpm install --frozen-lockfile` / `pnpm peers check` | Exit 0 / no peer issues |
| `pnpm format:check` | Exit 0 (after `prettier --write` on the 2 new shared files) |
| `pnpm typecheck --force` | Exit 0; 15/15 tasks, 0 cached |
| `turbo run lint --force` + root ESLint | Exit 0; 15/15 tasks, 0 cached; root ESLint OK |
| `pnpm test --force`, no `TEST_*` variables | Exit 0; 12/12 tasks, 0 cached: shared **257**, integrations **379**, ai-agents **54**, web **38**, database **46 passed, 361 skipped**, worker **9 passed, 13 skipped**, api **31 passed, 68 skipped** |
| `turbo run test --force --concurrency=1` with `TEST_DATABASE_URL` (PGlite) | Exit 0; 12/12 tasks, 0 cached: shared **257**, integrations **379**, ai-agents **54**, database **405 passed, 2 skipped** (the PGlite concurrency skips), api **99**, web **38**, worker **22** |
| `prisma migrate deploy` (fresh database), `migrate status`, drift `--exit-code` | 25 migrations (2 new); up to date; no difference, exit 0 |
| `pnpm build --force` | Exit 0; 11/11 tasks, 0 cached |
| `pnpm openapi --check` | Up to date (regenerated for the 2 routes) |
| `pnpm test:e2e` with `E2E_DATABASE_URL` (PGlite) | **51 passed** (no new browser scenario: 10B adds no screen). The e2e task ran; its 11 build dependencies came from the cache-free build just before |
| `pnpm test:e2e` without it | **9 passed, 42 skipped** |
| Reference repos / credential and personal-data scan of the 129 uncommitted files (09A to 10B) | 0 changes in each of the 9 / no matches (only the public repository name) |

**Earlier failures in this task (logged honestly):**
1. **A conflict answered 500 (a defect found and fixed):** the API test's stale save got
   `500 Internal server error` instead of `409 version_conflict`. The new error was mapped, but
   the exception filter's `@Catch(...)` list names every error class, and the new one wasn't in
   it. Added; the test now passes.
2. **Validation messages:** zod reports a bad record key as "Invalid key in record", and an
   unknown source didn't name the known ones. Both records now have their own messages, which
   the tests pin. Zod's declared issue type lacks the `unrecognized_keys` code it produces at
   run time (a type error), so the check is written the other way round.
3. **Test setup slips:** pausing a campaign and completing an enrollment in the test broke
   database rules (`paused_at` and `completed_at` must be set too); resetting exclusions to `{}`
   instead of NULL would have failed the strict parse. All three were in the test only.
4. **Tooling:** a duplicate type re-export (removed before it compiled); an edit script whose
   marker matched twice (nothing written; done with the Edit tool); one lint finding
   (nullish coalescing).
5. A filtered test run (`-t`) skipped the setup of the earlier tests and failed for that reason
   alone; only full-file runs are counted.

### What 10B proves (local)

- **A score of 100 still fails** when the person is suppressed (`suppressed_email`), the address
  is invalid (`email_invalid`), the region or source is restricted (`region_blocked`,
  `source_blocked`) or the policy is unknown (`region_policy_unknown`, `source_policy_unknown`).
  The same holds in the rules, on PostgreSQL, and next to a stored lead score of 100. The rules
  refuse facts that carry a score at all.
- **Current status and changes after qualification:** after the 10A rules scored the lead, each
  of these took effect at once and was undone, with the fit unchanged every time:
  - a paused campaign, a paused mailbox, sending switched off;
  - a domain on the do-not-contact list, an excluded lead list, an active enrollment elsewhere;
  - an email check that aged past 30 days, a newer invalid check, a changed or cleared policy.
- **Nothing unknown is permission:**
  - an address nobody checked, a check of another address, a malformed one or one from the
    future is blocked;
  - a stale, risky or unknown check, an unnamed source or country, an unknown country, a
    person without a recorded source, and a policy that is unset (or stored out of shape) need
    a person;
  - the company's country never permits.
- **Hard blocks:** every block is `overridable: false`, and a block wins over any review.
- **The policy:** saved with a version check (409), audited without personal data, and refused
  when it could allow unnamed countries or names unknown settings. It needs `settings.manage`
  (403 for a member, CSRF required, 404 for another workspace), and Beta's policy is its own.
- **Isolation:** another workspace's campaign or person, and malformed ids, are not found.

### Incomplete live checks (not passed)

- Eligibility in the running app (no enrollment, sending or screen until 10C and later).
- Real PostgreSQL and CI.

### Blockers

1. The reference plan is missing (O-01).
2. No Docker or Redis (O-06).
3. No OpenAI key or model chosen (O-37).
4. 08B is unfinished (its decisions and final entry); 08C waits.
5. Open: O-19 to O-34, O-36 to O-40.

### Manual check

There is no screen yet. Through the API, with an admin session:
- `GET /workspaces/:workspaceId/settings/send-policy` answers `{ "version": 0, "policy": null }`;
- a `PATCH` with `otherCountries: "ALLOW"` answers `400` ("Choose REVIEW or BLOCK.");
- a valid policy answers version 1;
- repeating the same `PATCH` with version 0 answers `409 version_conflict`.

### Next prompt

10C (LeadQualificationAgent, qualification states and the UI), as sent. 08B (its decisions and
final entry) and 08C are still open.

---

## 10A: Lead scoring model (2026-11-07)

**Status: Passed (local checks). Incomplete live checks:**
- **Nothing calculates scores in the running app yet:** `scope.scoring.scoreLead` is a worker
  method with no job or route. 10C adds the qualification step and the screens. Scores were
  calculated in the database and API tests only.
- **Supported need and timing aren't assessed** until 10C. With the default weights the rules
  reach at most 70, so no lead is High Priority yet.
- **Weights are set through the campaign API only:** the setup wizard has no scoring stage
  (O-39).
- **Plan:** the levels, rules and default policy were chosen without the missing plan (O-01,
  O-39).
- **Real PostgreSQL / CI:** PGlite only.
- **Not committed:** on branch `feat/05a-app-shell`, on top of `1fe897d`, together with 09A to
  09C.
- **Order:** 08B is still in progress and 08C waits.

### Changed components

| Area | Files |
|---|---|
| Shared | `contracts/lead-scoring.ts` (new: factors, default weights, the weight, policy and configuration schemas, bands, assessment and evidence schemas, `calculateLeadScore`, `describeLeadScore`, `leadScoreEvidenceIds`). `contracts/lead-scoring-rules.ts` (new: targets, the facts schema, the rules `assessLeadFactors`, the stored-inputs schema, `reproduceLeadScore`). `contracts/research-fields.ts` (new: the research field list, moved out of `website-research.ts` to avoid an import cycle; still exported there). `contracts/campaigns.ts` (the `scoring` section: request, response `{ custom, config }`, `CAMPAIGN_SECTIONS`). `index.ts`. Tests: `lead-scoring.test.ts` (new, 24), `lead-scoring-rules.test.ts` (new, 14). |
| Database | `schema.prisma`: `campaigns.scoring`; `scores` gains the campaign and its version, the email check, a version number, the band, the inputs and their hash, and `icp_id` becomes optional; enum `score_band`; new table `score_evidence`. Migrations `20261107000200_lead_scoring` (generated) and `…000300_lead_scoring_checks` (checks, and triggers that refuse any change to a score or a citation). `tenancy/lead-scoring.ts` (new: `scope.scoring`), `access.ts`, `index.ts`, `campaigns.ts` (the scoring section: read, save, copy). Fixtures: one lead score per tenant, built by the real rules and calculation, citing the careers-page evidence (`fixture-data.ts`, `load.ts`). Tests: `lead-scoring.integration.test.ts` (new, 11); tenant tables 44 → 45 (structure, tenant access, model registry); relations 63 → 67; fixture scores 2 → 3. |
| API | No new route. `campaigns.integration.test.ts`: the scoring section over HTTP (1 new). |
| Web | `lib/campaign-wizard.test.ts`: the test campaign has the new field. |
| Docs | `docs/decisions.md` D-10A-01 to 06 and O-39; `docs/api/campaigns.md` (Lead scoring); `docs/api/openapi.json` (regenerated); `docs/security/authorization-review.md` (the `scope.scoring` rows); README (Lead scoring); `CLAUDE.md` (the lead scoring rule; scores in the append-only list). This entry. |

### Passed local checks

**Database used:** PGlite 0.5.13 (PostgreSQL 18.6) on 127.0.0.1:54329. It was restarted fresh
before each database run and stopped at the end.

**Final regression.** The generated Prisma client was deleted first, and Turborepo ran without
its cache.

| Command | Actual result |
|---|---|
| `pnpm install --frozen-lockfile` / `pnpm peers check` | Exit 0 / no peer issues |
| `pnpm format:check` | Exit 0 (after `prettier --write` on the 8 new or changed code files) |
| `pnpm typecheck --force` | Exit 0; 15/15 tasks, 0 cached |
| `turbo run lint --force` + root ESLint | Exit 0; 15/15 tasks, 0 cached; root ESLint OK |
| `pnpm test --force`, no `TEST_*` variables | Exit 0; 12/12 tasks, 0 cached: shared **244**, integrations **379**, ai-agents **54**, web **38**, database **46 passed, 354 skipped**, worker **9 passed, 13 skipped**, api **31 passed, 65 skipped** |
| `turbo run test --force --concurrency=1` with `TEST_DATABASE_URL` (PGlite) | Exit 0; 12/12 tasks, 0 cached: shared **244**, integrations **379**, ai-agents **54**, database **398 passed, 2 skipped** (the PGlite concurrency skips), api **96**, web **38**, worker **22** |
| `prisma migrate deploy` (fresh database), `migrate status`, drift `--exit-code` | 23 migrations (2 new); up to date; no difference, exit 0 |
| `pnpm build --force` | Exit 0; 11/11 tasks, 0 cached |
| `pnpm openapi --check` | Up to date (regenerated for the campaign `scoring` section) |
| `pnpm test:e2e` with `E2E_DATABASE_URL` (PGlite) | **51 passed** (no new browser scenario: 10A adds no screen). The e2e task ran; its 11 build dependencies came from the cache-free build just before |
| `pnpm test:e2e` without it | **9 passed, 42 skipped** |
| Reference repos / credential and personal-data scan of the 120 uncommitted files (09A to 10A) | 0 changes in each of the 9 / no matches (only the public repository name) |

**Earlier failures in this task (logged honestly):**
1. **Erasing a person failed (a defect found and fixed):** two existing erasure tests (schema and
   outreach) failed. Deleting a contact whose fixture lead score cited that contact's evidence
   row hit the `score_evidence` NO ACTION reference: PostgreSQL checked it during the contact's
   cascade, before the cascade through `scores` had removed the citation. The email-check
   reference escaped only by the order the constraints were created in. Both references now
   cascade (D-10A-05); the score still names a removed row and recalculation reports it. A new
   test erases a person with scores and citations. The generated migration was corrected in
   place: at that point it had been applied only to this machine's throwaway in-memory PGlite,
   never committed or applied anywhere else.
2. **Test expectations:** the model registry count (44 → 45) was missed at first; my erasure
   test expected one Beta score where the fixtures hold two (the older ICP score and the lead
   score); audit records are ordered by `occurredAt` (a type error).
3. **Type and lint:** a read-only policy literal and a union spread in test helpers; unnecessary
   optional chains and type assertions; an unused destructured variable.
4. **The OpenAPI test** failed until `pnpm openapi` regenerated the document, as expected after a
   contract change.

### What 10A proves (local)

- **Boundaries:** every whole score is in exactly one band. 79.75 is 79 (Review), 80 is High
  Priority, 59.75 is 59 (Low Priority), 60 is Review.
- **Invalid weights are refused:**
  - totals other than 100 (99, 101, 0), naming the total;
  - fractions, negatives, values above 100, strings, NaN, infinity, null, a missing or unknown
    factor;
  - a required factor with weight 0, repeated or unknown required factors, an out-of-range limit,
    an unknown action, and any setting that would give missing data points.

  Over HTTP: `400` with the issue paths `scoring.weights`,
  `scoring.missingData.requiredFactors.0` and `scoring.missingData`.
- **Missing evidence gets nothing:**
  - all 64 combinations of missing factors give exactly 100 minus their weight;
  - a missing factor can't carry a level or evidence, and an assessed one needs evidence;
  - on PostgreSQL, a person with no company, no address and a title that doesn't match scores 0,
    every missing factor at 0 points and nothing cited.
- **Saved scores can be reproduced from their inputs:**
  - each stored score keeps its inputs, their hash, the campaign version, the research version,
    the email check and its citations;
  - recalculation still passes after the campaign's weights and the company's industry changed;
  - a stored value the inputs don't give, and inputs edited after hashing, are both reported;
  - triggers refuse changes, and versions are numbered per lead.
- **Policy:** a missing required factor keeps a High Priority score at Review; too little data
  goes to Review only when the policy says `REVIEW`; nothing is ever lifted above Review.
- **Isolation:** only the worker calculates; another workspace's campaign, person or score is not
  found; cited evidence must be the company's evidence in this workspace.
- **Untrusted text:** instructions in a title or an industry are only compared and quoted (level
  0).

### Incomplete live checks (not passed)

- Scoring in the running app (no job or route until 10C).
- The industry matching against real provider industries.
- Real PostgreSQL and CI.

### Blockers

1. The reference plan is missing (O-01).
2. No Docker or Redis (O-06).
3. No OpenAI key or model chosen (O-37).
4. 08B is unfinished (its decisions and final entry); 08C waits.
5. Open: O-19 to O-34, O-36 to O-39.

### Manual check

No screen shows scores yet. A campaign's scoring section can be checked through the API on a
draft campaign: weights adding up to 105 answer `400` ("The weights add up to 105. Make them add
up to 100."); valid weights answer with `scoring.custom: true`; `"scoring": null` returns the
defaults.

### Next prompt

10B (separate eligibility decisions), as sent. 08B (its decisions and final entry) and 08C are
still open.

---

## 09C: Research jobs, evidence, freshness, corrections, evaluation (2026-11-07)

**Status: Passed (local checks). Incomplete live checks:**
- **No live site or model:** the job ran with the fake fetcher (synthetic pages) and the fake
  model. No OpenAI key or model is chosen (O-37), and a live evaluation baseline needs an
  authorized paid run (O-38).
- **No Redis:** the research queue (BullMQ) and the worker process weren't started. The job
  itself ran through `run-task` and the job tests (O-33, O-38).
- **Evaluation set reviewed by the author only:** a human review of the cases is open (O-38).
- **Plan:** pages, freshness windows, permissions and the evaluation criteria were chosen
  without the missing plan (O-01, O-38).
- **Real PostgreSQL / CI:** PGlite only.
- **Not committed:** on branch `feat/05a-app-shell`, on top of `1fe897d`, together with 09A and
  09B.
- **Order:** 08B is still in progress and 08C waits.

### Changed components

| Area | Files |
|---|---|
| Database | `schema.prisma`: `research` gains origin, result status, based-on, refresh, version, input, context and prompt hashes, schema version, model provider and cost; `evidence` gains its extract label and page hash; enums `research_origin`, `research_result_status`; partial unique indexes (one active run per company, one version number per company); a self-reference. Migrations `20261107000000_website_research` (generated) and `…000100_website_research_checks` (checks, `research_finished_immutable` and `evidence_immutable` triggers). `tenancy/research.ts` (new: request, read, versions, corrections, and the worker's page store, reuse, completion, retry and failure), `access.ts` (`scope.research`), `index.ts`. Fixtures: a correction version in both tenants. Tests: `research.integration.test.ts` (new, 9); relation count 62 → 63; fixture research count 1 → 2. |
| Shared | `contracts/research.ts` (new: routes, requests, corrections, the stored findings schema, versions, history, the company research view, freshness, `research_not_possible`), `website-research.ts` (review reasons moved here), `endpoints.ts` (4 endpoints, the `research` tag, cache resources), `workspaces.ts` (error codes), `navigation.ts` (the Leads "Company profile" detail), `index.ts`. `endpoints.test.ts` (43 → 47). |
| Integrations | `registry.ts`: the development and test fake fetcher uses the real clock. |
| AI agents | `website-research/pages.ts` (new: `pickResearchLinks`, `researchInputSha256`), `types.ts` (review reasons from shared). Evaluation (new): `evaluation/cases.ts` (8 reviewed cases), `evaluate.ts` (criteria, three models, baseline), `cli.ts`, `evaluation.test.ts` (4); `package.json` (`evaluate`). |
| Worker | `jobs/website-research.ts` (new: the job), `main.ts` (a queue, relay and consumer per worker definition), `queue.ts` (named queues), `run-task.ts` (dispatch by type), `package.json` (ai-agents). Test: `jobs/website-research.integration.test.ts` (new, 6). |
| API | `workspaces/research.controller.ts` (new, 4 routes), `workspaces.module.ts`, `http/api-errors.ts` (three errors). Tests: `research.integration.test.ts` (new, 3), `route-guards.test.ts`. |
| Web | `app/workspaces/[workspaceId]/leads/page.tsx` (the Leads shell) and `leads/organizations/[organizationId]/page.tsx` (new: the company profile), `components/research/company-research.tsx` (new), `lib/research.ts` (new) and its test (4), `lib/polling.ts` (`RESEARCH_RUN_POLL`), `components/data/status-label.tsx`, `components/imports/run-view.tsx` (links to profiles). Browser tests: `e2e/company-research.spec.ts` (new, 4), `e2e/imports.spec.ts` (the profile link), `e2e/support/db.ts`, `worker.ts`. |
| Docs | `docs/decisions.md` D-09C-01 to 06 and O-38; `docs/evaluations/website-research.md` and `website-research-baseline.json` (new); `docs/api/openapi.json`; `docs/security/authorization-review.md`; README (Website research jobs and evidence); `CLAUDE.md` (website research rule). This entry. |

### Passed local checks

**Database used:** PGlite 0.5.13 (PostgreSQL 18.6) on 127.0.0.1:54329. It was restarted fresh
before each database run and stopped at the end.

**Final regression.** The generated Prisma client was deleted first, and Turborepo ran without
its cache.

| Command | Actual result |
|---|---|
| `pnpm install --frozen-lockfile` / `pnpm peers check` | Exit 0 / no peer issues |
| `pnpm format:check` | Exit 0 |
| `pnpm typecheck --force` | Exit 0; 15/15 tasks, 0 cached |
| `turbo run lint --force` + root ESLint | Exit 0; 15/15 tasks, 0 cached; root ESLint OK |
| `pnpm test --force`, no `TEST_*` variables | Exit 0; 12/12 tasks, 0 cached: shared **206**, integrations **379**, ai-agents **54**, web **38**, database **46 passed, 341 skipped**, worker **9 passed, 13 skipped**, api **31 passed, 64 skipped** |
| `turbo run test --force --concurrency=1` with `TEST_DATABASE_URL` (PGlite) | Exit 0; 12/12 tasks, 0 cached: shared **206**, integrations **379**, ai-agents **54**, database **385 passed, 2 skipped** (the PGlite concurrency skips), api **95**, web **38**, worker **22** |
| `prisma migrate deploy` (fresh database), `migrate status`, drift `--exit-code` | 21 migrations (2 new); up to date; no difference, exit 0 |
| `pnpm build --force` | Exit 0; 11/11 tasks, 0 cached |
| `pnpm openapi --check` | Up to date (regenerated for the 4 routes) |
| `pnpm test:e2e` with `E2E_DATABASE_URL` (PGlite) | **51 passed** (4 new: the company profile; the imports scenario also checks the profile link). The e2e task ran; its 11 build dependencies came from the cache-free build just before |
| `pnpm test:e2e` without it | **9 passed, 42 skipped** |
| Reference repos / credential and personal-data scan of the 103 uncommitted files (09A to 09C) | 0 changes in each of the 9 / no matches (only the synthetic test keys) |

**Earlier failures in this task (logged honestly):**
1. **Clock skew (a defect found and fixed):** the API test completed a run with the worker's
   clock and corrected it with the API's (5 days behind). Ordering by completion time took the
   run for the current version, so a correction on a stale version was accepted. Versions now
   carry a number per company, assigned under a per-company lock, with a unique index. A test
   reproduces the skew.
2. **Ids checked too late (fixed):** a request naming another workspace's campaign answered
   "running" when a run was active, because the active check came first. The campaign is now
   checked before anything else.
3. **A misspelled field compiled:** selecting `domain` (the column is `normalizedDomain`) passed
   the type check, because Prisma's generic select types accept unknown nested keys. Fixed; the
   integration tests run every query.
4. **Test expectations:** the fixture campaign has no business profile; a malformed id is a
   404, not a 400; a stub that declares OpenAI is recorded as OpenAI; ambiguous browser
   locators (two `status` regions, a URL shown twice). The endpoint count rose to 47.
5. **The evaluation's own test** first required "unknowns honest" of every model. The fake fails
   it on the conflict cases, which is a real limitation, so the test now requires only the
   guarantees and pins the rest through the saved baseline.
6. **Lint:** an `any` from `expect.stringContaining` in a test (found by the full-package lint,
   not the per-file one), form values read without a string check, an optional chain.
7. **Tooling slips:** a script with `]);` for `);` (nothing written); a marker that no longer
   matched after `prisma format` (nothing written); a stray `cat >` waiting on input hung one
   command, which was stopped, and its probe file was removed. A note on run-task: it now tries
   the search worker first and falls back to research on `wrong_worker`, refused before anything
   is claimed.
8. **Writing this log** failed once with the same Windows `UNKNOWN` open error as in 09B. The
   file was unchanged, and the retry succeeded.

### What 09C proves (local)

- **Research is traceable to dated extracts:** each fact cites evidence rows. Each row is the
  extract's text, its page URL, when the page was read, the page's content hash and the stored
  page (a source record). This holds through refreshes, reuses and corrections, in the database,
  the API, the worker job and the browser.
- **Refreshes preserve history:**
  - a completed version and its evidence can't be updated (triggers; tested by trying);
  - refresh, reuse and correction add numbered versions that name what they continue;
  - earlier versions stay readable through the API and on the profile.
- **Cache hits avoid model calls:**
  - fresh research (30 days) answers a request without a run;
  - stored pages (7 days) are used without fetching;
  - a refresh whose pages are unchanged reuses the findings, with 0 model calls (the fake model's
    request count doesn't move);
  - a changed page calls the model again.
- **Corrections:** set, reject and restore work; each is audited (field and action only), is a
  compare-and-set (409 on a stale version), and is carried into later model runs.
- **Permitted fetches only:** pages refused by robots.txt or failing are recorded with their
  reason, and the run finishes with nothing to read. A temporary start-page failure retries.
- **Budgets:** a paid model reserves and commits its AI tokens; without budget the run fails
  before any model call; without a configured model it fails as `model_unavailable`.
- **Injected instructions:** a hostile page's instructions never become facts; the version is
  flagged for review.
- **Evaluation saved:** criteria, 8 reviewed cases, and baselines for three models, with the
  limitations, in `docs/evaluations/website-research.md`. A test fails if the saved baseline
  stops matching.

### Incomplete live checks (not passed)

- A live model and real sites: an authorized staging run, and a live evaluation baseline.
- The BullMQ research queue with Redis.
- A human review of the evaluation cases; a screen-reader check of the profile.
- Real PostgreSQL and CI.

### Blockers

1. The reference plan is missing (O-01).
2. No Docker or Redis (O-06).
3. No OpenAI key or model chosen (O-37).
4. 08B is unfinished (its decisions and final entry); 08C waits.
5. Open: O-19 to O-34, O-36 to O-38.

### Manual check

Open a company from an import run's results (Imports → a run → a company name). Press "Research
the website", then run the queued task in development (`node apps/worker/dist/run-task.js
<task id>`, the id from `job_tasks`). The profile then shows facts with their evidence. Press
"Read the pages again": a new version says the pages were unchanged. Correct a field: a third
version shows the correction, and version 1 is unchanged in the history.

### Next prompt

Finish 08B (its decisions and final entry), then 08C. The plan is missing (O-01), so the user
sends the next prompt.

---

## 09B: Model provider, OpenAI adapter, WebsiteResearchAgent (2026-11-07)

**Status: Passed (local checks). Incomplete live checks:**
- **No live model call:** the OpenAI adapter is tested only against scripted HTTP answers
  shaped like OpenAI's documentation (checked 2026-11-07). No key exists here, no paid call
  was made, and no model was chosen (O-37).
- **No job runs the agent yet:** nothing is stored, and no usage is recorded in the ledger
  (that is 09C's work).
- **Plan:** the research fields, limits, confidence rules and instruction patterns were chosen
  without the missing plan (O-01, O-37).
- **Real PostgreSQL / CI:** the regression ran on PGlite only (09B changes no table).
- **Not committed:** on branch `feat/05a-app-shell`, on top of `1fe897d`, together with 09A.
- **Order:** 08B is still in progress and 08C waits; 09C was sent with this prompt and waits.

### Changed components

| Area | Files |
|---|---|
| Shared | `contracts/website-research.ts` (new): the 12 research fields and their descriptions, limits, `researchExtractSchema`, `websiteResearchInputSchema` (company, campaign context from the campaign and ICP schemas, fields, 1 to 8 extracts), the strict `websiteResearchModelOutputSchema`. `index.ts`. `logger.ts` (redacts `OPENAI_API_KEY`). Tests: `contracts/website-research.test.ts` (new, 4), `logger.test.ts`. |
| Integrations | New `src/model/`: `types.ts` (`ModelProvider`, requests without tools, results, `ModelCostEvent`, prices, bounds), `openai.ts` (`OpenAiResponsesProvider`: the Responses API, strict structured output, `store: false`, no tools, retries, deadline, errors, cost events), `fake.ts` (`FakeModelProvider` and the deterministic research reader), `index.ts`. `providers.ts` (`AiProvider` replaced by `ModelProvider`; the `canceled` error code), `fakes.ts` (`FakeAiProvider` replaced), `registry.ts` (`createModelProvider`), `index.ts`. Tests: `model/openai.test.ts` (new, 24), `model/fake.test.ts` (new, 8), `fakes.test.ts` (the old fake's test removed). |
| AI agents | First code in `packages/ai-agents`: `website-research/prompt.ts` (versioned instructions, the hand-written strict JSON Schema, the pinned hash, the JSON input), `evidence.ts` (quote, value and instruction checks), `extracts.ts` (`pageExtracts`), `types.ts`, `agent.ts` (`WebsiteResearchAgent`), `index.ts`. `package.json` (build, test, dependencies), `tsconfig.build.json`, `vitest.config.mjs`. Tests (new): `agent.test.ts` (28), `evidence.test.ts` (22). |
| Worker | `env.ts`: `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_REASONING_EFFORT`, `OPENAI_INPUT_USD_PER_MTOK`, `OPENAI_OUTPUT_USD_PER_MTOK` (both prices or neither), `modelConfig`. `env.test.ts` (+2). |
| Config | `turbo.json` (the five variables), `.env.example` (commented placeholders), `pnpm-lock.yaml` (ai-agents' workspace links only; no new external package). |
| Docs | `docs/decisions.md` D-09B-01 to 06 and O-37; `docs/local-development.md` (the five variables); README (Website research); `CLAUDE.md` (AI models rule). This entry. |

No route, table, migration or screen changed.

### Passed local checks

**Database used:** PGlite 0.5.13 (PostgreSQL 18.6) on 127.0.0.1:54329. It was restarted fresh
before each database run and stopped at the end.

**Final regression.** The generated Prisma client was deleted first, and Turborepo ran without
its cache.

| Command | Actual result |
|---|---|
| `pnpm install --frozen-lockfile` / `pnpm peers check` | Exit 0 / no peer issues |
| `pnpm format:check` | Exit 0 |
| `pnpm typecheck --force` | Exit 0; 14/14 tasks, 0 cached |
| `turbo run lint --force` + root ESLint | Exit 0; 14/14 tasks, 0 cached; root ESLint OK |
| `pnpm test --force`, no `TEST_*` variables | Exit 0; 11/11 tasks, 0 cached (ai-agents now has tests): shared **206**, integrations **379**, ai-agents **50**, database **46 passed, 332 skipped**, web **33**, worker **9 passed, 7 skipped**, api **31 passed, 61 skipped** |
| `turbo run test --force --concurrency=1` with `TEST_DATABASE_URL` (PGlite) | Exit 0; 11/11 tasks, 0 cached: shared **206**, integrations **379**, ai-agents **50**, database **376 passed, 2 skipped** (the PGlite concurrency skips), web **33**, worker **16**, api **92** |
| `prisma migrate deploy` (fresh database), `migrate status`, drift `--exit-code` | 19 migrations (none new); up to date; no difference, exit 0 |
| `pnpm build --force` | Exit 0; 11/11 tasks, 0 cached |
| `pnpm openapi --check` | Up to date (no route changed) |
| `pnpm test:e2e` with `E2E_DATABASE_URL` (PGlite) | **47 passed** (no new scenario: 09B has no screen). The e2e task ran; its 11 build dependencies came from the cache-free build just before |
| `pnpm test:e2e` without it | **9 passed, 38 skipped** |
| Reference repos / credential and personal-data scan of the 57 uncommitted files (09A and 09B) | 0 changes in each of the 9 / no matches (only the synthetic `sk-synthetic-...` test keys) |

**Earlier failures in this task (logged honestly):**
1. **Docs:** platform.openai.com answered 403 to the fetcher; the same documentation was read
   on developers.openai.com. The reference page is 558,000 characters long, so it was read in
   parts.
2. **Types and lint:** a too-narrow type for OpenAI's error body (`exactOptionalPropertyTypes`);
   flags set inside closures that TypeScript treated as always false (now held in an object);
   a useless initial assignment.
3. **Test expectations:** one extract count in a `pageExtracts` test (a third short page fits
   the budget) was wrong; the prompt hash started as a placeholder and was then pinned.
4. **Escape trap again:** a `\u0027` written in a test string became a bare apostrophe, which
   broke the string. It was caught before running and the string rewritten with double quotes.
   Every new file was then scanned for stray characters (none).
5. **Writing this log** failed once with a Windows `UNKNOWN` error when opening the file
   (likely a short-lived lock). The file was unchanged, and the retry succeeded.

### What 09B proves (local)

- **Injected webpage instructions can't invoke tools or change policy:**
  - a model request has no tools field. The OpenAI body has no tools, `tool_choice`,
    metadata or background, and an answer containing a tool call is refused;
  - the instructions are the same fixed text for a benign and a hostile page; page text
    travels only as JSON data;
  - answers that add an eligibility, a "verified" flag, a send flag or tool calls are refused
    as a whole (strict schema), with every field unknown;
  - facts or hypotheses quoting instruction-like page text go to review; the page is flagged
    and what the model ignored is recorded.
- **Missing evidence gives unknown or review, never a fabricated claim:**
  - no facts means every field unknown;
  - all of these go to review and their field stays unknown: a quote not in its extract, an
    extract that wasn't provided, a number or value the quotes don't contain, a fact with one
    bad quote among good ones, conflicting values, an unrequested field;
  - a refusal, a truncated or filtered answer, or bad JSON gives review with every field
    unknown;
  - a high-confidence hypothesis is refused.
- **Provenance and versions:** every verified fact carries its quotes with the extract's URL,
  retrieval time and page hash; every result names the prompt, its pinned hash, the schema,
  the provider and the model.
- **The real adapter's contract**, against scripted HTTP:
  - the documented body and headers, `store: false`, strict structured output, the token
    ceiling;
  - refusals, incomplete answers, usage and request ids;
  - every error mapped, billing and quota 429s not retried, a rate limit retried after
    `Retry-After`;
  - timeouts not retried, cancellation, a cost event per attempt with a computed cost, the key
    never echoed.

  The agent also ran end to end through it.
- **Fake model:** offline, deterministic, quoting only real sentences, with scripted refusals,
  truncation and errors.

### Incomplete live checks (not passed)

- A live OpenAI call (no key; staging, authorized, with a chosen model and prices).
- Real PostgreSQL and CI.

### Blockers

1. The reference plan is missing (O-01).
2. No Docker or Redis (O-06).
3. No OpenAI key or model chosen (O-37).
4. 08B is unfinished (its decisions and final entry); 08C and 09C wait.
5. Open: O-19 to O-34, O-36, O-37.

### Manual check

None: 09B has no screen or route. Once authorized, run one research request in staging with a
real key and model on a synthetic page, and compare the answer with the checks above.

### Next prompt

09C (sent and waiting). Then finish 08B and do 08C.

---

## 09A: Safe server-side website fetching (2026-11-06)

**Status: Passed (local checks). Incomplete live checks:**
- **No live fetch:** every test uses a local fixture server and a fake resolver. Nothing was
  fetched from the internet, and TLS ran only against a server that doesn't speak it (O-36).
- **No job uses the fetcher yet:** nothing is stored. Research jobs come in a later task.
- **Plan:** limits, the reading of "configured access restrictions" and the robots.txt
  handling were chosen without the missing plan (O-01, O-36).
- **Real PostgreSQL / CI:** the regression ran on PGlite only (09A changes no table).
- **Not committed:** on branch `feat/05a-app-shell`, on top of `1fe897d`.
- **Order:** 08B is still in progress (its decisions and final entry are not written) and 08C
  waits. This regression covered the whole tree, 08B's code included, but 08B's status is
  unchanged.

### Changed components

| Area | Files |
|---|---|
| Integrations | New `src/website/`: `address.ts` (IPv4 and IPv6 checks, cloud metadata, internal names, URL parsing, DNS answer checks), `errors.ts` (`WebsiteFetchError`, retryable or permanent), `policy.ts` (limits with ceilings, blocked and allowed hosts), `robots.ts` (RFC 9309), `text.ts` (parse5 text extraction with nesting and element caps, decoding, clean-up), `limiter.ts` (per-host concurrency), `transport.ts` (HTTP over a connection to the checked address), `fetcher.ts` (`SafeWebsiteFetcher`: hops, redirects, robots.txt, limits, hashes), `fake.ts` (`FakeWebsiteFetcher`), `types.ts`, `index.ts`. `providers.ts` (`ProviderSet.websiteFetcher`), `fakes.ts`, `registry.ts` (`createWebsiteFetcher`), `index.ts`, `package.json` (parse5). Tests (new): `website/address.test.ts` (166), `website/fetcher.test.ts` (87), `website/robots.test.ts` (23), `website/text.test.ts` (15), `website/fake.test.ts` (9); `fakes.test.ts` (new key). |
| Worker | `env.ts`: `WEBSITE_FETCH_BLOCKED_HOSTS`, `WEBSITE_FETCH_ALLOWED_HOSTS` (domain lists). `main.ts`: builds the fetcher at startup, so an invalid restriction stops the worker. `env.test.ts` (+1). |
| Config | `pnpm-workspace.yaml` (catalog: `parse5` 8.1.0), `pnpm-lock.yaml` (parse5 8.1.0, entities 9.0.0), `turbo.json` (the two variables), `.env.example` (commented placeholders). |
| Docs | `docs/decisions.md` D-09A-01 to 07 and O-36; `docs/local-development.md` (the two variables); README (Website fetching); `CLAUDE.md` (website fetching rule). This entry. |

No route, table, migration or screen changed.

### Passed local checks

**Database used:** PGlite 0.5.13 (PostgreSQL 18.6) on 127.0.0.1:54329. It was restarted fresh
before each database run and stopped at the end.

**Final regression.** The generated Prisma client was deleted first, and Turborepo ran without
its cache.

| Command | Actual result |
|---|---|
| `pnpm install --frozen-lockfile` / `pnpm peers check` | Exit 0 / no peer issues |
| `pnpm format:check` | Exit 0 |
| `pnpm typecheck --force` | Exit 0; 14/14 tasks, 0 cached |
| `turbo run lint --force` + root ESLint | Exit 0; 14/14 tasks, 0 cached; root ESLint OK |
| `pnpm test --force`, no `TEST_*` variables | Exit 0; 10/10 tasks, 0 cached: shared **202**, integrations **348**, database **46 passed, 332 skipped**, web **33**, worker **7 passed, 7 skipped**, api **31 passed, 61 skipped** |
| `turbo run test --force --concurrency=1` with `TEST_DATABASE_URL` (PGlite) | Exit 0; 10/10 tasks, 0 cached: shared **202**, integrations **348**, database **376 passed, 2 skipped** (the PGlite concurrency skips), web **33**, worker **14**, api **92** |
| `prisma migrate deploy` (fresh database), `migrate status`, drift `--exit-code` | 19 migrations (none new); up to date; no difference, exit 0 |
| `pnpm build --force` | Exit 0; 11/11 tasks, 0 cached |
| `pnpm openapi --check` | Up to date (no route changed) |
| `pnpm test:e2e` with `E2E_DATABASE_URL` (PGlite) | **47 passed** (no new scenario: 09A has no screen). The e2e task ran; its 11 build dependencies came from the cache-free build just before |
| `pnpm test:e2e` without it | **9 passed, 38 skipped** |
| Reference repos / credential and personal-data scan of the 34 changed files | 0 changes in each of the 9 / no matches |

**Dependency:** parse5 **8.1.0** (MIT, published 2026-11-01, older than pnpm's
`minimumReleaseAge`) and its one dependency entities 9.0.0 (BSD-2-Clause). The lockfile gained
only these two packages.

**Earlier failures in this task (logged honestly):**
1. **Quadratic parsing (a defect found and fixed):** a test with 20,000 nested `<div>` took
   7 s and returned no text. Measured on its own, parse5 took 6.4 s, growing with the square
   of the depth, so a hostile 2 MiB page could hold a worker for minutes. A tree adapter now
   caps open elements at 512 and elements at 100,000 (`too_complex`, refused in
   milliseconds). Line breaks from empty blocks also no longer use up the text budget.
2. **Test expectations:** `::2` reports `unspecified` (it carries 0.0.0.2), not
   `ipv4_embedded`. One expected text line had a stray space. Fragment-only links (`#main`)
   now count as no link, and `<form>` as a block. All fixed.
3. **Escapes:** some regex escapes written by the editor landed as literal invisible
   characters (ESLint `no-irregular-whitespace`), and a heredoc collapsed `\\`, so one fix
   script matched nothing and wrote nothing. Both were redone with character codes, and the
   files were scanned for stray characters (none left).
4. **Lint:** two unnecessary type assertions, two promise rejections that weren't `Error`,
   and an `eslint-disable` comment that Prettier moved away from its line. A `node:util`
   import was needed for the `TextDecoder` type, and `tls.connect` takes no `family`.
5. **Test harness:** a malformed-HTTP test hung while closing its raw server, because the
   server-side socket stayed open. The client socket was already destroyed (checked
   separately). The test now destroys its sockets. A concurrency test left a rejection
   unhandled for a moment; both outcomes are now awaited together.
6. **TLS error mapping:** TLS to a server that doesn't speak it gives `EPROTO`, which first
   mapped to a retryable `connection_failed`. It is now `tls_failed` (permanent), with a test.

### What 09A proves (local)

- **Unsafe destinations are refused before any connection:**
  - addresses: loopback, private, shared, link-local, unspecified, multicast, broadcast,
    documentation, benchmarking and reserved IPv4; IPv6 outside 2000::/3, unique local,
    link-local, site-local, documentation, Teredo, 6to4, NAT64 and IPv4-mapped forms;
  - cloud metadata, by address (169.254.169.254, Azure's public 168.63.129.16, Alibaba's
    100.100.100.200, AWS and Google over IPv6) and by name (`metadata.google.internal`,
    `metadata.goog`);
  - internal names (`localhost`, single labels, `.local`, `.internal`, `.home.arpa` ...);
  - alternate encodings: integer, hex, octal, short, percent-encoded and full-width IPv4;
    IPv6 written out or IPv4-mapped;
  - other schemes, credentials in the URL, other ports;
  - none of these makes a DNS lookup, a connection or a request.
- **Every DNS answer is checked:** a name answering with any internal address (one in a mixed
  answer, an IPv4-mapped one, a metadata one) is refused; the connection goes to the checked
  address, never to a second lookup.
- **DNS changes:** a name that was public and then answers 127.0.0.1 is refused on the next
  fetch. A name that turns into the metadata address between two hops is refused at the
  redirect, after one connection only.
- **Redirects to internal addresses** (loopback, IPv6 loopback, metadata, hex and octal
  forms, mapped IPv6, `localhost`, metadata names, a name resolving to 10.0.0.5) and to other
  schemes, ports or credentials are refused without connecting. Checked redirects are
  followed and recorded; more than the limit, loops and missing locations are refused.
- **Oversized responses:** a declared length over the limit is refused before the body; a
  streamed body, a 20 MiB decompression bomb and 20 KB headers stop at their limits.
- **Unsupported types:** PDF, PNG, JSON, octet-stream, CSV, an invalid type, a missing type,
  and unknown or stacked encodings are refused; corrupt compression is a bad response.
- **Timeouts:** a server that never answers, a body that drips forever and a lookup that
  never returns all end at the budget (200–300 ms in the tests), as retryable timeouts;
  cancellation is `canceled`.
- **Per-host concurrency:** with 2 per host, 5 requests to one host run 2 at a time with 3
  queued, while another host is served; a queued request times out within its budget.
- **Access restrictions:** blocked hosts and their subdomains are refused, also through a
  redirect; an allow list refuses the rest; invalid lists or limits are refused at
  construction and at worker startup.
- **robots.txt:** our group wins over `*`; rules are cached per workspace; 404 allows, 503
  means "try later"; a robots.txt redirect to another host is followed and checked, and one
  to 127.0.0.1 is never connected to.
- **Text and provenance:** main content without scripts, styles, navigation, header,
  footer, cookie banner, hidden or decorative text, controls, embeds or dialogs. Title,
  description, language and absolute links. The requested and final URL, redirects,
  retrieval time and the SHA-256 of body and text.
- **The fake** gives the same synthetic page every time and refuses the same unsafe URLs.

### Incomplete live checks (not passed)

- A live fetch of a real site, and TLS against a real certificate (staging, authorized).
- Real PostgreSQL and CI.

### Blockers

1. The reference plan is missing (O-01).
2. No Docker or Redis (O-06).
3. 08B is unfinished: its decisions (D-08B-*, O-35) and final entry are not written. 08C
   waits.
4. Open: O-19 to O-34, O-36.

### Manual check

None: 09A has no screen or route. Optionally, in staging and once authorized, fetch one public
page through the worker's fetcher and compare the text and hashes.

### Next prompt

Finish 08B (its decisions and final entry), then 08C (sent and waiting). The plan is missing
(O-01), so the user sends the next prompt.

---

## GIT-14: Push `feat/05a-app-shell` (2026-11-06)

**Status: Done.** The request was `git push`.

| Step | Actual result |
|---|---|
| Pushed | `feat/05a-app-shell` → `origin/feat/05a-app-shell`, `20d0b38..1fe897d` (08A, 08B in progress); the remote head is `1fe897d` (checked with `git ls-remote`) |
| Remote | `github.com/farhan0nouman-sys/LeadFennec-Leads-Agent` (**public**); `main` unchanged at `7fc44f2`; `feat/04a-auth` unchanged at `3e0b418` |

- **08B is in progress** in the pushed commit: its regression and docs are not finished.
- **CI has not run:** the workflow runs on pushes to `main`, on pull requests and on manual
  dispatch, not on pushes to other branches.
- This entry is not in the pushed commit; it is a local change to the log.

---

## GIT-13: Commit 08A and 08B in progress (2026-11-06)

**Status: Done (local commit only).** The request was `git commit`.

| Step | Actual result |
|---|---|
| Branch and author | `feat/05a-app-shell` (on top of `20d0b38`); author `LeadFennec-Leads-Agent` with the GitHub `noreply` address |
| Content | 08A (contact enrichment contracts and fakes, complete), 08B **in progress** (Apollo people lookup and enrichment adapters, batched enrichment, usage, fail-closed factories; its regression and docs are not finished), and the GIT-12 and this log entry |
| Checks before committing | 08A: its full regression (see the 08A entry). For this commit, run on the whole tree with Turborepo's cache: `pnpm format:check` exit 0 (after formatting the fixtures README); `pnpm typecheck` exit 0, 14/14; `turbo run lint` exit 0, 14/14; `pnpm test` without `TEST_*` exit 0: shared 202, integrations 48, database 46 passed and 332 skipped, web 33, worker 6 passed and 7 skipped, api 31 passed and 61 skipped. **Not run for 08B:** the database, API and worker suites against PGlite, the build, migrations and the browser tests. A scan of the staged changes for credentials, the personal emails and the Apollo account id found nothing. |
| Commit | The commit that contains this entry (`git log`) |

- **Not pushed.** 08B stays "in progress" until its regression passes.

---

## 08A: Contact enrichment contracts and providers (2026-11-06)

**Status: Passed (local checks). Incomplete live checks:**
- **No live provider:** contracts and deterministic fakes only. No people-search,
  enrichment or verification provider is chosen or called (O-34).
- **Real PostgreSQL / CI:** the regression ran on PGlite only (08A changes no table).
- **Plan:** the ranking weights, freshness and identity rules could not be checked against the
  missing plan (O-01, O-34).
- **Not committed:** on branch `feat/05a-app-shell`, on top of `20d0b38`.

### Changed components

| Area | Files |
|---|---|
| Shared | `identity.ts`: `normalizeContactIdentity`, `normalizeLinkedinUrl`, `ContactIdentity`. `contracts/contact-enrichment.ts` (new): seniority levels, `normalizeTitle`, `inferSeniority`, `parseSeniority`, `rankRoleRelevance`; provenance; the agent's input and output schemas and `parseContactEnrichmentOutput`; `EMAIL_VERIFICATION_STATUSES`, `emailCheckSchema`, `emailSendEligibility`. `index.ts`. Test: `contracts/contact-enrichment.test.ts` (new, 11). |
| Integrations | `providers.ts`: `PeopleSearchProvider`, `ContactEnrichmentProvider`, `EmailVerificationProvider` (replacing `LeadDataProvider` and the old verification interface); provider set keys `peopleSearch`, `contactEnrichment`, `emailVerification`. `fake-contacts.ts` (new): the three deterministic fakes. `contact-enrichment.ts` (new): `ContactEnrichmentAgent`, `checkContactEmails`. `fakes.ts`, `index.ts`. Tests: `contact-enrichment.test.ts` (new, 6); `fakes.test.ts` (the old people and verification tests removed, keys updated). |
| Docs | `docs/decisions.md` D-08A-01 to 06 and O-34; README (contact enrichment); `CLAUDE.md` (contacts rule). This entry. |

No route, table, migration, environment variable or screen changed.

### Passed local checks

**Database used:** PGlite 0.5.13 (PostgreSQL 18.6) on 127.0.0.1:54329. It was restarted fresh
before each database run and stopped at the end; ports 54329, 3100 and 3101 are free.

**Final regression.** The generated Prisma client was deleted first, and Turborepo ran without
its cache.

| Command | Actual result |
|---|---|
| `pnpm install --frozen-lockfile` / `pnpm peers check` | Exit 0 / no peer issues |
| `pnpm format:check` | Exit 0 |
| `pnpm typecheck --force` | Exit 0; 14/14 tasks, 0 cached |
| `turbo run lint --force` + root ESLint | Exit 0; 14/14 tasks, 0 cached; root ESLint OK |
| `pnpm test --force`, no `TEST_*` variables | Exit 0; 10/10 tasks, 0 cached: shared **202**, integrations **39**, database **46 passed, 332 skipped**, web **33**, worker **6 passed, 7 skipped**, api **31 passed, 61 skipped** |
| `turbo run test --force --concurrency=1` with `TEST_DATABASE_URL` (PGlite) | Exit 0; 10/10 tasks, 0 cached: shared **202**, integrations **39**, database **376 passed, 2 skipped** (the PGlite concurrency skips), web **33**, worker **13**, api **92** |
| `prisma migrate deploy` (fresh database), `migrate status`, drift `--exit-code` | 19 migrations (none new); up to date; exit 0 |
| `pnpm build --force` | Exit 0; 11/11 tasks, 0 cached |
| `pnpm openapi --check` | Up to date (no route changed) |
| `pnpm test:e2e` with `E2E_DATABASE_URL` (PGlite) | **47 passed** (no new scenario: 08A has no screen) |
| `pnpm test:e2e` without it | **9 passed, 38 skipped** |
| Reference repos / credential and personal-data scan of the 15 changed files | 0 changes in each of the 9 / no matches |

**Earlier failures in this task (logged honestly):**
1. **Fake data:** every new integrations test failed at first ("empty list"). A hash product
   could be negative, so a list index went below zero. The index now wraps; all pass.
2. **The provider key test** listed the new keys out of order (the test sorts them); fixed.
3. **Lint:** an unused destructured variable, a regex instead of `endsWith`, an optional chain,
   and an `async` without `await` in a test double. One inline edit failed on escaping and
   wrote nothing; it was redone with the editor.

### What 08A proves (local)

- **Contracts reject malformed or unattributed contacts:**
  - a contact without provenance, or with empty attribution, is refused, as is an address
    without its own provenance;
  - each refusal has its path and reason, and so do:
    - a field out of shape (empty name, unknown seniority);
    - an address that isn't one;
    - a LinkedIn URL on another host or not a profile;
    - a person with nothing to identify them by;
    - a duplicate.
  - The whole answer is refused when it isn't the schema or has more contacts than asked for.
  - The agent's own provider records go through the same check (an empty attribution is
    refused).
- **Unknown and risky statuses cannot become automatically send-eligible:**
  - `risky` and `unknown` are `needs_review` at any age, never automatic;
  - only a fresh `verified` check of the same address is automatic;
  - with every check risky, nothing is automatic, though the enrichment provider claimed some
    addresses verified.
- **No schema equates an email-shaped string with verified status:**
  - an address, a bare "verified", a status without provider or time, another address's
    check, a future check and an unknown provider are all `unverified`;
  - the agent's output refuses a status, a "verified" flag, a verification or an eligibility
    field.
- **Deterministic fakes with provenance and timestamps:**
  - the same synthetic staff and addresses every time;
  - all four statuses across the fake companies, the same on every run;
  - every person, address and check carries its provider and the injected clock's time.
- **Role relevance and identity:**
  - the same title ranks above similar ones and the right seniority higher, deterministically;
  - identities are keyed by email, else LinkedIn, else company domain and name, with accents,
    case and punctuation normalized.

### Incomplete live checks (not passed)

- A live people-search, enrichment or verification provider (none chosen; official docs
  first, O-34).
- Real PostgreSQL and CI.

### Blockers

1. The reference plan is missing (O-01).
2. No Docker or Redis (O-06).
3. Open: O-19 to O-34.

### Manual check

None: 08A has no screen or route.

### Next prompt

Not known: the plan is missing (O-01). The user sends the next prompt.

---

## GIT-12: Push `feat/05a-app-shell` (2026-11-06)

**Status: Done.** The request was `git push`.

| Step | Actual result |
|---|---|
| Pushed | `feat/05a-app-shell` → `origin/feat/05a-app-shell`, `2655d7b..20d0b38` (07B–07C); the remote head is `20d0b38` (checked with `git ls-remote`) |
| Remote | `github.com/farhan0nouman-sys/LeadFennec-Leads-Agent` (**public**); `main` unchanged at `7fc44f2`; `feat/04a-auth` unchanged at `3e0b418` |

- **CI has not run:** the workflow runs on pushes to `main`, on pull requests and on manual
  dispatch, not on pushes to other branches. A pull request into `main` (or a manual run)
  would give the first real-PostgreSQL and Redis results for 03A–07C. That is the user's
  decision.
- This entry is not in the pushed commit; it is a local change to the log.

---

## GIT-11: Commit 07B–07C (2026-11-06)

**Status: Done (local commit only).** The request was `git commit`.

| Step | Actual result |
|---|---|
| Branch and author | `feat/05a-app-shell` (on top of `2655d7b`); author `LeadFennec-Leads-Agent` with the GitHub `noreply` address |
| Content | One commit for 07B (Apollo organization search adapter) and 07C (search jobs, organization upserts, CSV import, discovery screens), with the GIT-10 and this log entry |
| Checks before committing | The 07C regression (see the 07C entry), which ran on the whole working tree and so covers 07B; format check exit 0; a scan of the staged changes for credentials, the personal emails and the Apollo account id found nothing |
| Commit | The commit that contains this entry (`git log`) |

- **Not pushed:** CI hasn't run on 07B–07C. The workflow runs on pushes to `main`, pull
  requests and manual dispatch.

---

## 07C: Search jobs, organization upserts, CSV import, discovery screens (2026-11-06)

**Status: Passed (local checks). Incomplete live checks:**
- **The BullMQ queue never ran:** there is no Redis on this machine. The relay and consumer
  code typecheck and their logic is tested, but the worker process with Redis was not started.
  The job itself ran for real through `run-task`, in the worker tests and in the browser.
- **Real PostgreSQL / CI:** the regression ran on PGlite only.
- **Plan:** the matching rules, limits and screens could not be checked against the missing
  plan (O-01, O-33).
- **Not committed:** on branch `feat/05a-app-shell`, with 07B, on top of `2655d7b`.

### Changed components

| Area | Files |
|---|---|
| Shared | `csv.ts` (new): `parseCsv` (bounded RFC 4180, lines), `csvCell` / `toCsv` (formula-safe). `contracts/organization-import.ts` (new): `IMPORT_ROUTES`, CSV limits and fields, `importMappingSchema`, `csvImportRequestSchema`, `normalizeImportRow`, result, run page, options and cancel schemas, `import_not_cancellable`. `contracts/lead-discovery.ts`: run counts `{ found, saved, created, excluded, failed, repeated }`, `fileName`, `pagesFetched`. `contracts/endpoints.ts`: `imports.list`, `options`, `csv`, `results`, `cancel` (43 endpoints), cache resources. `contracts/workspaces.ts` (error codes), `navigation.ts` (Imports available, detail breadcrumb), `index.ts`. Tests: `csv.test.ts` (new, 6), `endpoints.test.ts`, `navigation.test.ts`. |
| Database | `prisma/schema.prisma`: `SourceRecordOutcome`, `source_records.outcome` / `issues`, the external-id unique replaced by an index, `organizations.name_key`, `imports.cursor` / `pages_fetched`, usage metric `ORGANIZATION_SEARCH_CREDITS`. Migrations `20261106000000_discovery_results` (generated) and `20261106000100_discovery_results_checks`. `tenancy/organization-store.ts` (new): `saveOrganizations`. `tenancy/discovery.ts`: list, results, options, cancel, `importCsv`, and the worker's `beginSearch`, `saveSearchPage`, `finishSearch`, `failSearch`; errors `CsvImportError`, `ImportNotCancellableError`. `tenancy/worker-context.ts`: `dueJobTasks`. `tenancy/access.ts`, `index.ts`, `fixtures/fixture-data.ts` (plan credits). Tests: `organization-import.integration.test.ts` (new, 4); `schema`, `billing-schema`, `discovery` suites updated. |
| Integrations | `lead-discovery.ts`: pages hand over rejected records; test. |
| Worker | `jobs/lead-discovery.ts` (new): `runDiscoveryTask`. `queue.ts` (new): relay, BullMQ queue and worker. `run-task.ts` (new, development and test only). `main.ts`: provider check, queue, relay, shutdown. `package.json` (bullmq, ioredis, integrations), `vitest.config.mjs`. Test: `jobs/lead-discovery.integration.test.ts` (new, 7). |
| API | `http/configure-app.ts` (new): 1 MB JSON bodies, used by `main.ts` and the test harness. `workspaces/discovery.controller.ts`: five routes. `http/api-errors.ts`: CSV, cancel and cursor errors. `testing/api-harness.ts`. Tests: `workspaces/imports.integration.test.ts` (new, 4), `route-guards.test.ts`, discovery test (counts). |
| Web | `app/workspaces/[workspaceId]/imports/` (new): page, `imports-home.tsx`, `[importId]/page.tsx`. `components/imports/` (new): `import-forms.tsx`, `run-list.tsx`, `run-view.tsx`. `lib/imports.ts` (new), `lib/polling.ts` (`IMPORT_RUN_POLL`), `components/data/status-label.tsx`. `e2e/imports.spec.ts` (new, 5), `e2e/support/db.ts`, `e2e/support/worker.ts` (new), `e2e/app-shell.spec.ts` (Leads is now the unbuilt example). Tests: `lib/imports.test.ts` (new, 2), `lib/polling.test.ts`. |
| Root | `pnpm-workspace.yaml` (bullmq 6.7.0; `msgpackr-extract` build disabled), `pnpm-lock.yaml`, `turbo.json` (`test:e2e` builds the worker), `docs/api/openapi.json`. |
| Docs | `docs/decisions.md` D-07C-01 to 07 and O-33 (O-31 updated); `docs/api/discovery.md`; `docs/security/authorization-review.md`; `docs/local-development.md`; README; `CLAUDE.md`. This entry. |

### Passed local checks

**Database used:** PGlite 0.5.13 (PostgreSQL 18.6) on 127.0.0.1:54329. It was restarted fresh
before each database run and stopped at the end; ports 54329, 3100 and 3101 are free.

**Final regression.** The generated Prisma client was deleted first, and Turborepo ran without
its cache.

| Command | Actual result |
|---|---|
| `pnpm install --frozen-lockfile` / `pnpm peers check` | Exit 0 / no peer issues |
| `pnpm format:check` | Exit 0 |
| `pnpm typecheck --force` | Exit 0; 14/14 tasks, 0 cached (run again after the last spec fix: same) |
| `turbo run lint --force` + root ESLint | Exit 0; 14/14 tasks, 0 cached; root ESLint OK |
| `pnpm test --force`, no `TEST_*` variables | Exit 0; 10/10 tasks, 0 cached: shared **191**, integrations **35**, database **46 passed, 332 skipped**, web **33**, worker **6 passed, 7 skipped**, api **31 passed, 61 skipped** |
| `turbo run test --force --concurrency=1` with `TEST_DATABASE_URL` (PGlite) | Exit 0; 10/10 tasks, 0 cached: shared **191**, integrations **35**, database **376 passed, 2 skipped** (the PGlite concurrency skips), web **33**, worker **13**, api **92** |
| `prisma migrate deploy` (fresh database), `migrate status`, drift `--exit-code` | 19 migrations (2 new); up to date; exit 0 |
| `pnpm build --force` | Exit 0; 11/11 tasks, 0 cached |
| `pnpm openapi --check` | Up to date |
| `pnpm test:e2e` with `E2E_DATABASE_URL` (PGlite) | First run: **40 passed, 1 failed, 6 did not run** (`app-shell.spec.ts`, see below). After the fix: **47 passed** (5 new imports scenarios, axe included) |
| `pnpm test:e2e` without it | **9 passed, 38 skipped** |
| Reference repos / credential and personal-data scan of the 85 files changed since `2655d7b` (07B and 07C) | 0 changes in each of the 9 / no key, email address or account id (one old placeholder, `'secret-value'` in `endpoints.test.ts`) |

**Earlier failures in this task (logged honestly):**
1. **Regressions caused by 07C, fixed:**
   - `billing-schema` expected 12 fixture plan limits; the new metric makes 15;
   - `schema.integration` checked the old `(provider, external_id)` uniqueness, which 07C
     removes on purpose; it now checks one record per import row;
   - the browser test `app-shell.spec.ts` used Imports as its example of an unbuilt page,
     which failed it and skipped the 6 scenarios after it. Leads is the example now.
2. **Mistakes in the new tests, fixed:** the generated CSV was under 100 KB (it now has 480
   rows); it had unquoted commas, which the parser rightly refused; a failed row's domain was
   expected where the file had none; the destructive confirmation is an `alertdialog`.
3. **Tooling:** pnpm refused to install BullMQ until `msgpackr-extract`'s build script was
   reviewed (disabled). Three inline edits lost text in backticks to the shell (a template
   string in the report download, SQL in `e2e/support/db.ts`), and were redone with the editor.
   Lint: unused or meaningless checks, and an unused route body (now validated by the
   repository).

### What 07C proves (local)

- **Repeating a search or import does not duplicate organizations:**
  - worker test: a second search matches all 30 companies (0 new);
  - database test: a second CSV import creates nothing;
  - API test: 480 rows imported twice, still 480 organizations;
  - browser: the second search and the second CSV both show 0 new, and the organization
    count is unchanged.
- **Interrupted pages resume safely:** the provider times out on page 2 and the run waits to
  retry (status, token `p:25`, error code, task due later). The resumed run asks only for
  `p:25` and ends with the same 40 companies, in the same order, as an uninterrupted run, with
  no duplicates. Each page is one transaction, so an interruption mid-page saves nothing of it.
- **The interface reports saved, excluded and failed accurately:**
  - the counts are the API's (from the stored rows), and the results list shows each record's
    outcome and reasons;
  - browser: 30 saved; then 29 saved, 0 new, 1 excluded (the suppressed domain, with its
    reason); a CSV with 2 saved and 2 failed, each failure listed by field;
  - the downloaded report lists the failures with the formula cell as text.
- **Search jobs:**
  - companies are saved per workspace, never in another;
  - each record keeps its provider, external id, time and payload;
  - progress counts and pages are updated per page;
  - a suppressed domain or a parent domain is excluded;
  - paid providers reserve a credit per page before asking (none: refused before any request;
    one: one page, then stopped with what it saved);
  - cancellation mid-run and before start;
  - provider refusals and exhausted retries fail with their code;
  - the relay publishes only due tasks of active workspaces;
  - forged messages are dropped.
- **CSV import:**
  - mapping guessed and changeable; missing columns refused by field;
  - limits (256 KB, 1000 rows, 1 MB bodies);
  - every row created, matched, excluded or failed with its line;
  - values cleaned; formulas kept as text;
  - unmapped columns (possibly personal data) not stored.
- **Formula injection:** cells starting with `=`, `+`, `-`, `@`, a tab or a carriage return
  get an apostrophe in every export (unit tests, and the downloaded file in the browser).
- **Screens:** discovery form; CSV form with mapping; runs list; run page with live status,
  counts, failure reason, cancellation with confirmation, outcome filter and report; axe on
  every new screen; 390 px without sideways scrolling.

### Incomplete live checks (not passed)

- The worker with Redis (BullMQ relay and consumer) end to end; CI has Redis but doesn't run
  on this branch.
- Real PostgreSQL and CI.
- A live Apollo search through the job (O-32).

### Blockers

1. The reference plan is missing (O-01).
2. No Docker or Redis (O-06).
3. Open: O-19 to O-33.

### Manual check

With Redis and PostgreSQL running (`pnpm dev`): on Imports, find companies for an ICP. The run
page should go from Queued to Finished by itself within a few seconds (the worker's relay runs
every 5 seconds). Then import a small CSV and download the error report.

### Next prompt

08A (sent earlier and waiting): contact enrichment contracts and providers.

---

## 07B: Apollo organization search adapter (2026-11-06)

**Status: Passed (local checks). Incomplete live checks:**
- **No live Apollo request:** the adapter is proven against Apollo's documentation and
  synthetic fixtures only. No API key exists for it yet, and a live page costs 1 credit.
- **Account capabilities:** only partly known (below).
- **Real PostgreSQL / CI:** the regression ran on PGlite only.
- **Not committed:** on branch `feat/05a-app-shell`, on top of `2655d7b`.

### Official documentation and account check

- **Docs checked 2026-11-06** (URLs and API version in `docs/decisions.md` D-07B-01):
  organization search (API v1, page updated 2026-09-29), authentication, API keys, rate
  limits, status codes, usage stats.
- **Account (read-only, through the Apollo connector, approved by the user):**
  - lead credits: 147 left of 200 for the cycle ending 2026-11-08;
  - no search run, no key created or seen;
  - not known: the plan, and whether a REST key with organization search access exists (the
    endpoint answers 403 without it).
  - No personal details from the profile are recorded.
- **Fixtures:** synthetic, as the user chose (no captured page).

### Changed components

| Area | Files |
|---|---|
| Integrations | `apollo-organization-search.ts` (new): `ApolloOrganizationSearchProvider` (documented endpoint only; explicit filter and field mapping; page tokens keeping the first page's size; 500-page and 50,000-record limits; cost 1 credit per page; quota from the rate-limit headers; bounded retries; per-attempt timeout; redirects refused; sanitized errors; key checked and sent only in `x-api-key`), `APOLLO_ORGANIZATION_SEARCH_CAPABILITIES`, `apolloSearchQuery`, `mapApolloOrganization`, `apolloCountryName`, `apolloTechnologyUid`. `providers.ts`: error code `bad_response`; page-size note. `registry.ts`: `createOrganizationSearchProvider` (fake in development and test; Apollo with a key elsewhere), `organizationSearchDeclaration`. `index.ts`. `fixtures/apollo/` (new): 8 synthetic fixtures and their README. `apollo-organization-search.test.ts` (new, 14). |
| API | `workspaces/discovery-provider.ts`: provides the declaration (source and capabilities), never credentials; `APOLLO` in staging and production. `workspaces/discovery.controller.ts`: uses it. |
| Worker | `env.ts`: `APOLLO_API_KEY` (optional, validated without echoing it, empty is unset). `env.test.ts` (new, 2). |
| Shared | `logger.ts`: `APOLLO_API_KEY` redacted; `logger.test.ts`. |
| Root | `.env.example` (commented placeholder), `turbo.json` (`dev` passes `APOLLO_API_KEY`). |
| Docs | `docs/decisions.md` D-07B-01 to 06 and O-32 (O-31 updated); `docs/api/discovery.md` (providers); `docs/local-development.md` (`APOLLO_API_KEY`); README; `CLAUDE.md` (Apollo rule). This entry. |

### Passed local checks

**Database used:** PGlite 0.5.13 (PostgreSQL 18.6) on 127.0.0.1:54329. It was restarted fresh
before each database run and stopped at the end; ports 54329, 3100 and 3101 are free.

**Final regression.** The generated Prisma client was deleted first, and Turborepo ran without
its cache.

| Command | Actual result |
|---|---|
| `pnpm install --frozen-lockfile` / `pnpm peers check` | Exit 0 / no peer issues (no dependency added: Apollo is called with the runtime's `fetch`) |
| `pnpm format:check` | Exit 0 |
| `pnpm typecheck --force` | Exit 0; 14/14 tasks, 0 cached |
| `turbo run lint --force` + root ESLint | Exit 0; 14/14 tasks, 0 cached; root ESLint OK |
| `pnpm test --force`, no `TEST_*` variables | Exit 0; 10/10 tasks, 0 cached: shared **185**, integrations **35**, database **46 passed, 328 skipped**, web **31**, worker **6**, api **31 passed, 57 skipped** |
| `turbo run test --force --concurrency=1` with `TEST_DATABASE_URL` (PGlite) | Exit 0; 10/10 tasks, 0 cached: shared **185**, integrations **35**, database **372 passed, 2 skipped** (the concurrency tests that skip on PGlite), web **31**, worker **6**, api **88** |
| `prisma migrate deploy` (fresh database), `migrate status`, drift `--exit-code` | 17 migrations (none new); up to date; exit 0 |
| `pnpm build --force` | Exit 0; 11/11 tasks, 0 cached |
| `pnpm openapi --check` | Up to date (no route changed) |
| `pnpm test:e2e` with `E2E_DATABASE_URL` (PGlite) | **42 passed** (no new browser scenarios: 07B has no screen) |
| `pnpm test:e2e` without it | **9 passed, 33 skipped** |
| Reference repos / credential and personal-data scan of the 28 files changed by 07B | 0 changes in each of the 9 / no key, email address, Apollo account id or name (the only matches were the public GitHub repository name) |

**Earlier failures in this task (logged honestly):**
1. **Country codes:** the first mapping used the runtime's region names alone, which name
   non-countries too (`ZZ` is "Unknown Region"). ISO user-assigned codes and EU/UN groupings
   are now refused explicitly, with a test.
2. **A fixture's legacy message** imitated Apollo's wording; it is now marked "Synthetic"
   like the others.

### What 07B proves (local, mocked)

- **Pagination:** two pages through opaque tokens. Later pages keep the first page's size, so
  pages stay aligned with offsets. The documented 500-page limit stops paging. Forged or
  out-of-range tokens and page sizes over 100 are refused before any request.
- **Empty results:** no companies, no next page, 1 credit, through LeadDiscoveryService.
- **Authentication failure:** 401 gives `unauthorized` after one request, with no retry and
  none of Apollo's words or the key in the error; 403 gives `forbidden`.
- **Quota limits:**
  - a daily limit gives `quota_exceeded` with the `retry-after` seconds, and isn't retried;
  - an hourly limit with a long wait is handed back, not slept on;
  - a short per-minute limit is waited out, then answered;
  - platform load uses the suggested 60 s;
  - retries stop after 3 attempts.
- **Provider timeouts:** retried with back-off (1 s, 2 s), then `timeout`. A fetch that
  ignores the abort still ends at the deadline, and one timeout followed by an answer
  recovers.
- **No undocumented endpoint:** every request goes to `POST
  https://api.apollo.io/api/v1/mixed_companies/search`, with only documented parameters.
- **No guessed data:**
  - only the documented `id`, `name`, `primary_domain` and `website_url` are read;
  - industry, size and country stay empty;
  - phones, links and the rest are dropped;
  - no person, title or email parameter or field is used.
- **Credentials:**
  - read from the worker's environment, refused if malformed without being echoed, and
    redacted in logs;
  - never in a URL or an error;
  - redirects are refused;
  - the API holds no key.

### Incomplete live checks (not passed)

- One authorized live page with a key scoped to `api/v1/mixed_companies/search` (1 credit),
  to confirm the mapping, the headers and the error shapes against real answers (O-32).
- Real PostgreSQL and CI.

### Blockers

1. The reference plan is missing (O-01).
2. No Docker (O-06).
3. Apollo access for the REST API is unconfirmed (O-32); open: O-19 to O-32.

### Manual check

None needed now. Before relying on Apollo in staging: create a scoped API key in Apollo
(Settings → Integrations → API Keys, endpoint `api/v1/mixed_companies/search`), set it as
`APOLLO_API_KEY` for the worker only, and authorize one live page.

### Next prompt

07C (sent and waiting): search jobs, organization upserts, CSV import, discovery screens.

---

## GIT-10: Push `feat/05a-app-shell` (2026-11-05)

**Status: Done.** The request was `git push`.

| Step | Actual result |
|---|---|
| Pushed | `feat/05a-app-shell` → `origin/feat/05a-app-shell`, `06b34b2..2655d7b` (06A–07A); the remote head is `2655d7b` (checked with `git ls-remote`) |
| Remote | `github.com/farhan0nouman-sys/LeadFennec-Leads-Agent` (**public**); `main` unchanged at `7fc44f2`; `feat/04a-auth` unchanged at `3e0b418` |

- **CI has not run:** the workflow runs on pushes to `main`, on pull requests and on manual
  dispatch, not on pushes to other branches. A pull request into `main` (or a manual run)
  would give the first real-PostgreSQL results for 03A–07A. That is the user's decision.
- This entry is not in the pushed commit; it is a local change to the log.

---

## GIT-09: Commit 06A–07A (2026-11-05)

**Status: Done (local commit only).** The request was `git commit`.

| Step | Actual result |
|---|---|
| Branch and author | `feat/05a-app-shell` (on top of `06b34b2`); author `LeadFennec-Leads-Agent` with the GitHub `noreply` address |
| Content | One commit for 06A (campaign configuration API), 06B (setup wizard), 06C (readiness and activation, M2) and 07A (lead discovery requests and organization search), with the GIT-08 and this log entry |
| Checks before committing | The 07A regression (see the 07A entry), which ran on the whole working tree and so covers 06A–06C; format check exit 0; a scan of the staged changes for credentials and the personal email found nothing |
| Commit | The commit that contains this entry (`git log`) |

- **Not pushed:** CI hasn't run on 06A–07A. The workflow runs on pushes to `main`, pull
  requests and manual dispatch.
- **Branch name:** the branch is still named after 05A; it now holds 05A–07A.

---

## 07A: Lead discovery requests and organization search (2026-11-05)

**Status: Passed (local checks). Incomplete live checks:**
- **Real PostgreSQL:** the database, API and browser suites ran on PGlite only; CI has not run.
- **Plan:** the criteria vocabulary, identity rules and limits could not be checked against the
  missing plan (O-01, O-31).
- **Not committed:** on branch `feat/05a-app-shell`, with 06A–06C.

The user sent 07A, 08A, 07B and 07C; asked which to do first, they chose "07A first". 07B,
07C and 08A wait until they are sent again.

### Changed components

| Area | Files |
|---|---|
| Shared | `identity.ts`: `normalizeCompanyIdentity`, `CompanyIdentity`, `IdentityNormalizationError`. `contracts/lead-discovery.ts` (new): `icpCriteriaSchema`, company and people filter keys, `organizationSearchFiltersSchema`, `OrganizationSearchCapabilities`, `planOrganizationSearch`, `discoveryRequestSchema`, `discoveryAcceptedSchema`, `importRunSchema`, `DISCOVERY_ROUTES`, limits (1000, default 100). `contracts/endpoints.ts`: tag `imports`, cache resource `importRun`, `discovery.request`, `discovery.get`; 38 endpoints. `index.ts`. Tests: `contracts/lead-discovery.test.ts` (new, 5); `endpoints.test.ts` (count 38). |
| Integrations | `providers.ts`: `OrganizationSearchProvider`, request, page, quota and organization types, `ProviderError` with `PROVIDER_ERROR_CODES`; `ProviderSet.organizationSearch`. `fake-organization-search.ts` (new): the deterministic fake (240 synthetic companies). `lead-discovery.ts` (new): `LeadDiscoveryService`, `DiscoveryPlanError`. `fakes.ts`, `index.ts`, `package.json` (zod, catalog), `pnpm-lock.yaml`. Tests: `lead-discovery.test.ts` (new, 8); `fakes.test.ts` (provider list). |
| Database | `prisma/schema.prisma`: `ImportSource.ORGANIZATION_SEARCH`, `SourceProvider.FAKE`, the search columns on `imports`, the `imports → icps` relation. Migrations `20261105000000_organization_search_imports` and `20261105000100_organization_search_import_checks` (checks and immutability trigger). `tenancy/discovery.ts` (new): `scope.discovery.request` / `get`, `DiscoveryRequestError`, `DISCOVERY_TASK_TYPE`. `tenancy/access.ts`, `tenancy/index.ts`. `fixtures/fixture-data.ts`: a queued search in each fixture tenant. Tests: `discovery.integration.test.ts` (new, 5); `tenant-access.integration.test.ts` (62 relations). |
| API | `workspaces/discovery.controller.ts` (new): `POST …/imports/discovery` (202), `GET …/imports/:importId`. `workspaces/discovery-provider.ts` (new): the `ORGANIZATION_SEARCH` token (fake in development and test). `workspaces/workspaces.module.ts`. `http/api-errors.ts`: `DiscoveryRequestError` → `400 validation_failed` with issues. Tests: `workspaces/discovery.integration.test.ts` (new, 3); `http/route-guards.test.ts` (both routes reviewed). |
| Root | `docs/api/openapi.json` regenerated. |
| Docs | `docs/decisions.md` D-07A-01 to 06 and O-31; `docs/api/discovery.md` (new); `docs/security/authorization-review.md` (38 routes); README (lead discovery, tests, fixtures); `CLAUDE.md` (lead discovery rule). This entry. |

### Passed local checks

**Database used:** PGlite 0.5.13 (PostgreSQL 18.6) on 127.0.0.1:54329. It was restarted fresh
before each database run and stopped at the end; ports 54329, 3100 and 3101 are free.

**Final regression.** The generated Prisma client was deleted first, and Turborepo ran without
its cache.

| Command | Actual result |
|---|---|
| `pnpm install --frozen-lockfile` / `pnpm peers check` | Exit 0 / no peer issues |
| `pnpm format:check` | Exit 0 (run before and after the fixture fix) |
| `pnpm typecheck --force` | Exit 0; 14/14 tasks, 0 cached (twice) |
| `turbo run lint --force` + root ESLint | Exit 0; 14/14 tasks, 0 cached; root ESLint OK (twice) |
| `pnpm test --force`, no `TEST_*` variables | Exit 0; 10/10 tasks, 0 cached: shared **185**, integrations **21**, database **46 passed, 328 skipped**, web **31**, worker **4**, api **31 passed, 57 skipped** (same before and after the fixture fix) |
| `turbo run test --force --concurrency=1` with `TEST_DATABASE_URL` (PGlite) | First run: **failed**, see below. After the fix: exit 0; 10/10 tasks, 0 cached: shared **185**, integrations **21**, database **372 passed, 2 skipped** (the concurrency tests that skip on PGlite), web **31**, worker **4**, api **88** |
| `prisma migrate deploy` (fresh database), `migrate status`, drift `--exit-code` | 17 migrations (2 new); up to date; exit 0 |
| `pnpm build --force` | Exit 0; 11/11 tasks, 0 cached |
| `pnpm openapi --check` | Up to date |
| `pnpm test:e2e` with `E2E_DATABASE_URL` (PGlite) | **42 passed** (no new browser scenarios: 07A has no screen) |
| `pnpm test:e2e` without it | **9 passed, 33 skipped** |
| Reference repos / credential and personal-email scan of the 37 files changed by 07A (including the lockfile, `openapi.json` and this log) | 0 changes in each of the 9 / no matches (one old placeholder, `'secret-value'` in `endpoints.test.ts`, is not a credential) |

**Earlier failures in this task (logged honestly):**
1. **Regression, database run 1:** `tenant-access.integration.test.ts` failed 2 tests, caused
   by 07A. The new `imports → icps` foreign key made 62 tenant relations (the test expected
   61), and no fixture row used it, so the cross-tenant check had no row to try ("no beta
   row"). Fixed by raising the count and adding a queued search from the ICP to both fixture
   tenants; the rerun passed.
2. **A run that never ran:** restarting PGlite and starting the tests in the same shell call
   ended the call with exit 4 and no output; no test ran. Restarting in its own call worked.
   Not counted as a pass.
3. **Development:** a regex with literal combining characters (rewritten with escapes); type
   errors in integrations until shared was rebuilt; zod missing from integrations (added);
   the fake-provider key list in `fakes.test.ts` (expected); an unnecessary type assertion
   and a non-null assertion (lint); one test expected "filter(s)" where the contract says
   "filter"; README backticks lost to shell substitution in a scripted edit (rewritten with
   the editor). All fixed.

### What 07A proves (local)

- **An ICP creates a tenant-owned discovery request.**
  - `POST /workspaces/:workspaceId/imports/discovery` answers `202` with `runId`, `status:
    PENDING` and `statusUrl`.
  - The status URL returns the run: the ICP, provider `FAKE`, the company filters planned
    from the ICP, the limit, the ignored people criteria and the attribution.
  - The import row belongs to the workspace, with a durable job task (`{ importId }` only)
    and an audit record, in one transaction.
  - No company or contact is written. The provider is never called while the API answers.
- **Unsupported filters fail clearly.**
  - A filter the provider doesn't support gives `criteria.<filter>`: "Company search can't
    filter by technologies yet. Remove it from the profile to search."
  - An unknown key is named, a profile with no company filter is refused, and an archived
    ICP is refused. Nothing is stored for a refused request.
- **Excessive limits fail clearly.**
  - Over the provider's cap: "Ask for at most 500 companies in one search."
  - Over the platform cap (1000), zero or not a whole number: rejected by the request schema.
- **Unauthorized access fails clearly.**
  - Another workspace's ICP is "Not found in this workspace."; its runs are `404`.
  - A non-member gets `404`; a member without `imports.create` gets `403`.
  - No session gives `401`; no CSRF token or another site's origin gives `403`.
  - Workers and platform admins can't request a search; a platform admin reads with a
    stated reason.
- **Fake results are repeatable.**
  - The same plan with a new fake provider returns the same companies in the same order,
    with the same identities.
  - The same search twice has the same query hash.
  - The directory is synthetic (`.example` domains, `raw.synthetic`) and identical on every
    call.
- **Provider interface:** paging by opaque token, resuming an interrupted run without
  repeats, quota and credits reported, typed and sanitized errors (rate limit with
  retry-after, quota exceeded, timeout), and errors raised after the pages already
  returned.
- **Company identity:** domains normalized (upper-case `www.`, taken from the website when
  missing); values that aren't domains are dropped rather than guessed; name keys are used
  without a domain; duplicates and invalid records are counted, not returned.
- **Database:** the search inputs are present exactly for searches and can't change
  afterwards; error codes have a fixed format; an ICP with searches can't be deleted.

### Incomplete live checks (not passed)

- Real PostgreSQL and CI.
- No live provider: 07A uses only the fake, and no Apollo documentation or account was used
  (that is 07B).
- The `pg` 8.23 deprecation warning from Prisma's `adapter-pg` still appears in runs (O-14).

### Blockers

1. The reference plan is missing (O-01).
2. No Docker (O-06).
3. Open: O-19 to O-31. Runs stay `PENDING` until the 07C worker publishes and runs them; the
   API refuses to start in staging and production until a live search adapter exists (07B).

### Manual check

None needed: 07A has no screen. Optional, with `pnpm dev` and a workspace that has an ICP,
`POST /api/workspaces/<id>/imports/discovery` with `{ "icpId": "<icp id>" }` from the
signed-in browser answers `202`, and the `statusUrl` (through `/api`) shows the run.

### Next prompt

07B, 07C or 08A, whichever the user sends next (each was sent once and is waiting). In
build order: 07B (Apollo organization search), then 07C (search jobs, CSV import, discovery
screens).

---

## M2: Campaign setup milestone (2026-11-04)

**Status: Reached on local checks.** The 06C prompt asks for M2 to be recorded once the wizard
and readiness behavior pass; both did, in the 06C regression below. The plan that defines M2 is
missing (O-01), so this records what the prompts asked for, not the plan's wording.

**Still open (not passed):**
- Real PostgreSQL and CI: everything ran on PGlite; nothing since `06b34b2` is pushed.
- A screen-reader pass (O-25, O-29).
- Commit: 06A–06C are uncommitted on `feat/05a-app-shell`.

| Part | Task | Evidence (06C regression) |
|---|---|---|
| Campaign drafts: sections, bounds, references within the workspace, version checks, safe duplication | 06A | Database `campaigns.integration.test.ts` (9), API `campaigns.integration.test.ts` (8): passed |
| Eight-stage wizard: save and reopen an incomplete campaign, the same validation as the API, back navigation, honest notices | 06B | Web units (7), browser `campaign-wizard.spec.ts` (7, axe on every stage): passed |
| Readiness and activation: every blocker named, unbuilt services fail closed, saving never starts, repeating changes nothing, stale versions conflict | 06C | Shared (5), database `campaign-activation.integration.test.ts` (5), API `campaign-activation.integration.test.ts` (3), the review screen in the browser test: passed |

**What M2 means in practice:** a workspace member can set up a campaign completely and see
exactly why it can't start. No campaign can start in production yet: checking leads, preparing
the emails and sending are later services, and their checks block (D-06C-02).

---

## 06C: Campaign readiness and activation (2026-11-04)

**Status: Passed (local checks). Incomplete live checks:**
- **Real PostgreSQL:** the database, API and browser suites ran on PGlite only; CI has not run.
- **Plan:** the checks and their wording could not be checked against the missing plan (O-01,
  O-30).
- **Not committed:** on branch `feat/05a-app-shell`, with 06A and 06B.

### Changed components

| Area | Files |
|---|---|
| Shared | `contracts/campaign-activation.ts` (new): `CAMPAIGN_SETUP_STAGES`, `ACTIVATION_CHECKS` (13), `CampaignServices` / `BUILT_SERVICES` (none built), `ActivationFacts`, `evaluateActivation`, the report and activation request schemas. `contracts/campaigns.ts`: routes `readiness`, `activate`; error `campaign_not_ready`. `contracts/endpoints.ts`: `campaigns.readiness` (cache `campaignReadiness`), `campaigns.activate`; the save also invalidates readiness; 36 endpoints. `contracts/dashboard.ts`: activity label. `contracts/campaign-activation.test.ts` (new, 5). |
| Database | `tenancy/campaigns.ts`: `readiness()` (facts gathered in one transaction), `activate()` (version first, idempotent repeat, compare-and-set, audit), `CampaignNotReadyError`; the repository takes the scope's clock. `tenancy/access.ts`. `campaign-activation.integration.test.ts` (new, 5). |
| API | `workspaces/campaign-services.ts` (new): the `CAMPAIGN_SERVICES` token (production: `BUILT_SERVICES`). `workspaces/campaigns.controller.ts`: `GET …/readiness`, `POST …/activate`. `http/api-errors.ts`: `409 campaign_not_ready` with one issue per reason. `testing/api-harness.ts`: `startApi(db, policy, services)`. `http/route-guards.test.ts`: both routes reviewed. `workspaces/campaign-activation.integration.test.ts` (new, 3). |
| Web | `components/campaigns/activation-panel.tsx` (new): every check with its reasons, "Fix in <stage>", Start campaign with confirmation. `delivery-stages.tsx`: the review stage uses it (the 06B "Still needed" notice and the "Starting the campaign: Not available yet" placeholder are gone). `campaign-wizard.tsx`: "Campaign started at …". `lib/campaign-wizard.test.ts`: stage keys match the shared list. `e2e/campaign-wizard.spec.ts`: the review checks. |
| Root | `docs/api/openapi.json` regenerated. |
| Docs | `docs/decisions.md` D-06C-01 to 05 and O-30; `docs/api/campaigns.md` (starting a campaign); `docs/security/authorization-review.md` (36 routes); README (status, screens, tests); `CLAUDE.md` (activation rule). This entry and M2. |

### Passed local checks

**Database used:** PGlite 0.5.13 (PostgreSQL 18.6) on 127.0.0.1:54329. It was restarted fresh
before each database run and stopped at the end; ports 54329, 3100 and 3101 are free.

**Final regression.** The generated Prisma client was deleted first, and Turborepo ran without
its cache.

| Command | Actual result |
|---|---|
| `pnpm install --frozen-lockfile` / `pnpm peers check` | Exit 0 / no peer issues |
| `pnpm format:check` | First run: **failed** on README.md (lines to reflow). Prettier then turned two `D-06…-*` references in one paragraph into italics markers (`D-06B-_`), so they were rewritten as explicit ranges; then exit 0. |
| `pnpm typecheck --force` | Exit 0; 14/14 tasks, 0 cached |
| `turbo run lint --force` + root ESLint | Exit 0; 14/14 tasks, 0 cached; root ESLint OK |
| `pnpm test --force`, no `TEST_*` variables | Exit 0; 10/10 tasks, 0 cached: shared **180**, integrations **13**, database **46 passed, 323 skipped**, web **31**, worker **4**, api **31 passed, 54 skipped** |
| `turbo run test --force --concurrency=1` with `TEST_DATABASE_URL` (PGlite) | Exit 0; 10/10 tasks, 0 cached: shared **180**, integrations **13**, database **367 passed, 2 skipped**, web **31**, worker **4**, api **85** |
| `prisma migrate deploy` (fresh database), `migrate status`, drift `--exit-code` | 15 migrations (none new); up to date; exit 0 |
| `pnpm build --force` | Exit 0; 11/11 tasks, 0 cached |
| `pnpm openapi --check` | Up to date |
| `pnpm test:e2e` with `E2E_DATABASE_URL` (PGlite) | **42 passed** (11 accounts and teams, 7 app shell, 7 campaign wizard with the review checks, 3 data client, 5 dashboard, 8 components, 1 smoke); axe included, no violations |
| `pnpm test:e2e` without it | **9 passed, 33 skipped** |
| Screens, by eye | The review checks at 1280 px and 390 px (throwaway screenshot spec, deleted) |
| Reference repos / credential and personal-email scan of the 51 changed files (06A–06C) | 0 changes in each of the 9 / no matches |

**Earlier failures in this task (logged honestly):**
1. **Lint:** an optional chain (shared), two non-null assertions in the new test, an unused
   import and a boolean comparison (web). All fixed.
2. **Scripted edits:**
   - a review-stage edit didn't match Prettier's multi-line import; nothing was written, and
     it was redone from a script file;
   - the docs script stopped at a README line with other wording, after writing three files.
     Only the README and `CLAUDE.md` parts were rerun, so nothing was applied twice.
3. **Formatting:** see the table (README).

### What 06C proves (local)

- **No campaign starts merely by saving it.**
  - A save can't name a status (the strict schema: `400`).
  - A complete campaign that passes every check stays `DRAFT` after saving, in the database
    test, over HTTP and in the browser.
  - Only `activate` sets `ACTIVE`.
- **Repeated activation is idempotent.**
  - With the services built (tests only), the first call starts the campaign: `activated_at`
    from the clock, one `campaign.activated` audit record.
  - The same request again returns the identical campaign (`200`), with no second record.
  - So does a repeat when the checks would now refuse.
- **Stale versions conflict:** a stale (or future) version gets `409 version_conflict`
  before anything else, also once the campaign is running.
- **Readiness with deterministic fixtures:**
  - shared tests with fixed facts: one ready campaign and 17 single problems, each blocking
    exactly its check with the expected words;
  - database tests with the fixture tenants: a new draft's exact blockers; a complete campaign
    blocked only by the workspace's sending switch and the services; the mailbox's daily limit.
- **Fail closed:** in production (no services built) activation is `409 campaign_not_ready`
  with one reason per unbuilt service, the same twice, and the campaign stays a draft.
- **Each blocker on the review screen:** every one of the 13 checks shows its state and the
  API's own reasons. Unbuilt services say "Not available yet", "Start campaign" is disabled,
  and "Fix in Mailbox" leads to the mailbox stage.
- **Permissions:**
  - automatic approval needs `drafts.approve` to start;
  - workers can't read readiness or start campaigns;
  - another workspace gets `404`;
  - CSRF is required.

### Incomplete live checks (not passed)

- Real PostgreSQL and CI.
- A screen-reader pass (O-25, O-29).
- The `pg` 8.23 deprecation warning from Prisma's `adapter-pg` still appears in runs (O-14).

### Blockers

1. The reference plan is missing (O-01).
2. No Docker (O-06).
3. Open: O-19 to O-30. Starting a campaign stays impossible until the eligibility, drafting
   and sending services are built (O-30, by design).

### Manual check

Optional, with `pnpm dev`: open a campaign's Review stage and read the list under "Before the
campaign can start". Every check that doesn't pass names what to do or says the service isn't
available yet, and "Start campaign" stays disabled.

### Next prompt

Not known: the plan is missing (O-01).

---

## 06B: Campaign setup wizard (2026-11-04)

**Status: Passed (local checks). Incomplete live checks:**
- **Real PostgreSQL:** the database, API and browser suites ran on PGlite only; CI has not run
  (CI runs only on `main` and pull requests).
- **Plan:** the eight stages are the ones the prompt names; their contents and wording could not
  be checked against the missing plan (O-01, O-29).
- **Accessibility:** axe on every stage and at 390 px; no screen reader (O-25, O-29).
- **Not committed:** on branch `feat/05a-app-shell`, together with the uncommitted 06A work.

### Changed components

| Area | Files |
|---|---|
| Web: pages | `app/workspaces/[workspaceId]/campaigns/page.tsx` and `campaign-list.tsx` (new): the Campaigns list, "New campaign" dialog, "Make a copy". `campaigns/[campaignId]/page.tsx` (new): the wizard; unknown or foreign campaigns are a real 404. |
| Web: wizard | `components/campaigns/` (new): `campaign-wizard.tsx` (loading, stage from `?stage=`, latest version, conflict notice, read-only mode, copy), `stage-frame.tsx` (`useStageForm`, step list, Back / Save draft / Save and continue, focus, unsaved-changes guard, "Not available yet" notice), `profile-stages.tsx` (business profile, target audience, offer, lead filters), `delivery-stages.tsx` (mailbox, sequence, schedule, review). `lib/campaign-wizard.ts` (new): stages, form ↔ save conversion, checking with the API's schema, issue → field mapping. |
| Web: shared parts | `components/form-field.tsx`: `CheckboxField`, `ChoiceGroup`. `components/data/status-label.tsx`: campaign and mailbox statuses. `components/shell/workspace-shell.tsx`: breadcrumbs of detail pages. |
| Web: tests | `lib/campaign-wizard.test.ts` (new, 7). `e2e/campaign-wizard.spec.ts` (new, 7 scenarios). `e2e/support/db.ts`: `seedCampaignChoices`, `markCampaignRunning`. `e2e/app-shell.spec.ts`: the unbuilt-page example is now Imports. |
| Shared | `contracts/campaigns.ts`: `CAMPAIGN_ROUTES.options`, `campaignOptionsSchema`; plain wording for numbers, days, times and the required name. `contracts/endpoints.ts`: `campaigns.options` (cache `campaignOptions`); 34 endpoints. `navigation.ts`: Campaigns `available`, `detailLabel`, `workspaceBreadcrumbs(…, detail)`. Tests updated. |
| Database / API | `tenancy/campaigns.ts`: `options()`. `workspaces/campaigns.controller.ts`: `GET …/campaigns/options` (before `:campaignId`). `http/route-guards.test.ts`: the route reviewed. One test each in the database and API campaign suites. |
| Root | `docs/api/openapi.json` regenerated. |
| Docs | `docs/decisions.md` D-06B-01 to 06 and O-29; `docs/api/campaigns.md`; `docs/security/authorization-review.md` (34 routes); `docs/local-development.md`; README (status, tests, screens); `CLAUDE.md` (wizard rule). This entry. |

### Passed local checks

**Database used:** PGlite 0.5.13 (PostgreSQL 18.6) on 127.0.0.1:54329. It was restarted fresh
before each database run and stopped at the end; ports 54329, 3100 and 3101 are free.

**Final regression.** The generated Prisma client was deleted first, and Turborepo ran without
its cache.

| Command | Actual result |
|---|---|
| `pnpm install --frozen-lockfile` / `pnpm peers check` / `pnpm format:check` | Exit 0 / no peer issues / exit 0 |
| `pnpm typecheck --force` | Exit 0; 14/14 tasks, 0 cached |
| `turbo run lint --force` + root ESLint | Exit 0; 14/14 tasks, 0 cached; root ESLint OK |
| `pnpm test --force`, no `TEST_*` variables | Exit 0; 10/10 tasks, 0 cached: shared **175**, integrations **13**, database **46 passed, 318 skipped**, web **31**, worker **4**, api **31 passed, 51 skipped** |
| `turbo run test --force --concurrency=1` with `TEST_DATABASE_URL` (PGlite) | Exit 0; 10/10 tasks, 0 cached: shared **175**, integrations **13**, database **362 passed, 2 skipped**, web **31**, worker **4**, api **82** |
| `prisma migrate deploy` (fresh database), `migrate status`, drift `--exit-code` | 15 migrations (none new); up to date; exit 0 |
| `pnpm build --force` | Exit 0; 11/11 tasks, 0 cached; web routes include `ƒ /workspaces/[workspaceId]/campaigns` and `…/campaigns/[campaignId]` |
| `pnpm openapi --check` | Up to date |
| `pnpm test:e2e` with `E2E_DATABASE_URL` (PGlite) | **42 passed**: 11 accounts and teams, 7 app shell, 7 campaign wizard, 3 data client, 5 dashboard, 8 components, 1 smoke; axe included, no violations |
| `pnpm test:e2e` without it | **9 passed, 33 skipped** |
| Screens, by eye | The list, a stage with an error, lead filters, mailbox, sequence and review at 1280 px; business profile and sequence at 390 px (throwaway screenshot spec, deleted) |
| Reference repos / credential and personal-email scan of the 44 changed files (06A and 06B) | 0 changes in each of the 9 / no matches |

**Earlier failures in this task (logged honestly):**
1. **Unit tests:** a type error in the new test (typed forms cast to one type); fixed with a
   small typed wrapper.
2. **Database test:** a check of mine was wrong (fixture ids share a prefix). The data was
   right; the check was removed.
3. **Scripted edits:** a test title lost its escaping, and a regular expression lost a
   backslash. Both were fixed with direct edits.
4. **Wizard browser test, first runs (each fixed, then rerun):**
   - The step links were named "Business profile , not done yet": Chrome adds a space before
     visually hidden text, and the test's locator didn't match.
   - Explicit `aria-label`s on the step links failed axe's label-in-name rule (the visible step
     number). They are named by their content again, and the locator allows the space.
   - The move buttons' names ("Move step 1 up") didn't contain their visible text ("Move up");
     now "Move up step 1".
   - The Review summary wrapped `dt`/`dd` in an extra element (invalid list structure).
     Restructured with a grid; the summary is now read before its Edit link.

### What 06B proves (local)

- **Completion check A: saving and reopening an incomplete campaign loses nothing valid.**
  - In the browser, a new campaign got a business profile without a description, a lead list,
    and only an offer name.
  - It was saved through Save and continue and Back, then left from the list ("1 of 6 parts
    filled in"). Reopened, and after a full reload, every saved value is there and the stage
    states are right.
  - Unit test: for a complete and an empty campaign, every stage's unchanged values give back
    exactly what is stored, and are a valid save.
- **Completion check A: the page and the API validate alike.**
  - The page checks each save with the API's own schema; no request is sent for an invalid
    value (the test saw no `PATCH`).
  - For five values (website scheme, leads per day, company size range, a country code, the
    sending window), the message next to the field is word for word the API's message for
    the same save.
  - Unit test: every message the schema gives lands on a field of its stage, list entries
    numbered; the API's reference issues map to fields.
- **Back navigation:** the stage is in the address; Back, the step list and reloading work, and
  moving saves first. An invalid stage stays put, with focus on the problem.
- **Not faked:**
  - The mailbox stage says connecting isn't available, and its connect buttons are disabled.
    A stored mailbox shows "Waiting for authorization"; "Connected" appears nowhere.
  - Sequence and Review say writing emails and starting aren't available; "Start campaign" is
    disabled.
- **Conflicts and read-only:**
  - Two pages edit the same draft: the outdated one is told and can load the latest version.
  - A running campaign is read-only and can be copied into a new draft.
- **Narrow screens and accessibility:** all 8 stages at 390 px without sideways scrolling; axe
  finds no WCAG 2.2 A/AA violations on the list or any stage.

### Incomplete live checks (not passed)

- Real PostgreSQL and CI.
- A screen-reader pass (O-25, O-29).
- The `pg` 8.23 deprecation warning from Prisma's `adapter-pg` still appears in runs (O-14).

### Blockers

1. The reference plan is missing (O-01).
2. No Docker (O-06).
3. Open: O-19 to O-29.

### Manual check

Optional, with `pnpm dev`:
- Open Campaigns, create a campaign, fill a few stages, close the tab, and reopen it from the
  list. Check that everything you saved is there.
- Leave a stage with an invalid value (a website without https://) and check the message next
  to the field.

### Next prompt

Not known: the plan is missing (O-01).

---

## 06A: Campaign configuration API (2026-11-02)

**Status: Passed (local checks). Incomplete live checks:**
- **Real PostgreSQL:** the database, API and browser suites ran on PGlite only. CI has not run
  (the branch was pushed in GIT-08; CI runs only on `main` and pull requests).
- **Plan:** the sections, fields, bounds and approval modes could not be checked against the
  missing plan (O-01, O-28).
- **Not committed:** on branch `feat/05a-app-shell`, after `06b34b2`.

### Changed components

| Area | Files |
|---|---|
| Database | `schema.prisma`: `CampaignApprovalMode` (`HUMAN`, `AUTOMATIC`); `campaigns` gains `version`, `approval_mode`, `business_profile`, `offer`, `audience_filters`, `exclusions` (JSONB), `daily_new_lead_limit`, `max_leads`. Migrations `20261102000000_campaign_configuration` (generated) and `20261102000100_campaign_configuration_checks` (hand-written CHECKs). `tenancy/campaigns.ts` (new): `scope.campaigns` with `list`, `get`, `create`, `update`, `duplicate` and four errors. `tenancy/access.ts`, `tenancy/index.ts`. `campaigns.integration.test.ts` (new, 8 tests). |
| Shared | `contracts/campaigns.ts` (new): routes, bounds, section schemas (requests normalize time zone, domains, addresses, country codes), create, save and duplicate requests, the campaign and list responses, `campaignReadiness`, error codes. `contracts/endpoints.ts`: 5 endpoints (tag `campaigns`), cache resources `campaigns` and `campaign`, statuses of the 3 new error codes. `contracts/workspaces.ts`: the codes in `API_ERROR_CODES`. `contracts/dashboard.ts`: activity labels for campaign actions. `contracts/campaigns.test.ts` (new, 7 tests); endpoint count 28 → 33. |
| API | `workspaces/campaigns.controller.ts` (new), registered after `DashboardController` in `workspaces.module.ts`. `http/api-errors.ts`: `version_conflict`, `campaign_not_editable`, `campaign_name_taken` (409), reference problems as `400 validation_failed` with issues. `http/route-guards.test.ts`: the 5 routes reviewed; `campaignId` only under a workspace. `workspaces/campaigns.integration.test.ts` (new, 7 tests). |
| Root | `docs/api/openapi.json` regenerated (33 operations). |
| Docs | `docs/decisions.md` D-06A-01 to 06 and O-28; `docs/api/campaigns.md` (new); `docs/security/authorization-review.md` (33 routes, the repository); README (status, migrations, tests); `CLAUDE.md` (campaign rule). This entry. |

### Passed local checks

**Database used:** PGlite 0.5.13 (PostgreSQL 18.6) on 127.0.0.1:54329. It was restarted fresh
before each database run and stopped at the end; ports 54329, 3100 and 3101 are free.

**Final regression.** The generated Prisma client was deleted first, and Turborepo ran without
its cache.

| Command | Actual result |
|---|---|
| `pnpm install --frozen-lockfile` / `pnpm peers check` | Exit 0 / no peer issues |
| `pnpm format:check` | First run: **failed**, 1 new test file unformatted. Formatted with Prettier; then exit 0. |
| `pnpm typecheck --force` | Exit 0; 14/14 tasks, 0 cached |
| `turbo run lint --force` + root ESLint | Exit 0; 14/14 tasks, 0 cached; root ESLint OK. Earlier in the task: 3 findings fixed (see below). |
| `pnpm test --force`, no `TEST_*` variables | Exit 0; 10/10 tasks, 0 cached: shared **175**, integrations **13**, database **46 passed, 317 skipped**, web **24**, worker **4**, api **31 passed, 50 skipped** |
| `turbo run test --force --concurrency=1` with `TEST_DATABASE_URL` (PGlite) | Exit 0; 10/10 tasks, 0 cached: shared **175**, integrations **13**, database **361 passed, 2 skipped**, web **24**, worker **4**, api **81** |
| `prisma migrate deploy` (fresh database), `migrate status`, drift `--exit-code` | **15 migrations** (2 new); up to date; exit 0 |
| `pnpm build --force` | Exit 0; 11/11 tasks, 0 cached |
| `pnpm openapi --check` | Up to date |
| `pnpm test:e2e` with `E2E_DATABASE_URL` (PGlite) | **35 passed** (no new browser scenarios: 06A has no screen) |
| `pnpm test:e2e` without it | **9 passed, 26 skipped** |
| Reference repos / credential and personal-email scan of the 26 changed files | 0 changes in each of the 9 / no matches |

**Earlier failures in this task (logged honestly):**
1. **First migration apply:** `DATABASE_URL` wasn't set in that shell, so `migrate deploy`
   failed and the drift check reported exit 1 without checking anything. Re-run with the
   variable: applied, drift exit 0.
2. **Database suite, first run:** 7 of 8 passed. The audit metadata listed the changed
   sections in request order; they are now in the contract's fixed order.
3. **Shared tests, first run:** one expectation was too narrow (a body with only an unknown
   field gets two root-level issues).
4. **Lint (3 findings, fixed):**
   - an unnecessary type assertion, then a ternary where `??` is preferred (both in the
     repository's JSON helper);
   - a test calling `toBeDefined` without `()`. That assertion never ran; the test now
     checks the parsed value.

### What 06A proves (local)

- **A draft survives reloads (completion check A):**
  - Sections saved one request at a time are all there afterwards: through another database
    connection and a new scope, and over HTTP after a new sign-in.
  - Every save raises the version.
- **Cross-tenant references are refused (completion check A):**
  - Another workspace's ICP, lead list, excluded lead list, mailbox or step template, in an
    incomplete draft, gives one issue per field and saves nothing.
  - An id that exists nowhere gets the same answer.
  - Another workspace's campaign is `404`, by id and by route.
- **Duplication (completion check B):**
  - A copy of the running fixture campaign (which has leads, drafts, an approval, an outbound
    intent and a job schedule) has 0 leads, 0 drafts, 0 approvals, 0 intents and 0
    schedules.
  - The copy is `DRAFT`, version 1, `HUMAN` approval (even from an `AUTOMATIC` source), with
    no activation times.
  - Its sequences and steps are new rows with the same settings, and the source is unchanged.
  - Over HTTP: a copy of a running campaign with an enrolled lead has no lead.
- **Version checks:** a save from a stale (or future) version is `409 version_conflict` and
  changes nothing.
- **Bounds:** lead limits, schedule, steps and delays, list sizes, text lengths, website
  scheme, country codes, domains, addresses, time zone and unknown fields are refused by the
  API and again by the repository.
- **Defaults:** a new campaign is `DRAFT` with `HUMAN` approval and the workspace's time zone.
  `AUTOMATIC` is refused without `drafts.approve` (`403`) and while the workspace requires
  approval (`400`).
- **Only drafts change:** saving a running campaign is `409 campaign_not_editable`.
- **Same rules as the rest of the API:** the route test, the contract test, the OpenAPI
  document and the authorization review cover the 5 routes.
  `GET …/campaigns/summary` (05C) still answers.

### Incomplete live checks (not passed)

- Real PostgreSQL and CI.
- The `pg` 8.23 deprecation warning from Prisma's `adapter-pg` still appears in runs (O-14).

### Blockers

1. The reference plan is missing (O-01).
2. No Docker (O-06).
3. Open: O-19 to O-28.

### Manual check

None needed: there is no screen yet. Optional, with `pnpm dev` and a signed-in browser
session: create a campaign and save a section with `PATCH /api/workspaces/<id>/campaigns/<id>`,
as described in `docs/api/campaigns.md`.

### Next prompt

Not known: the plan is missing (O-01).

---

## GIT-08: Push `feat/05a-app-shell` (2026-11-02)

**Status: Done.** The request was `git push`.

| Step | Actual result |
|---|---|
| Pushed | `feat/05a-app-shell` → `origin/feat/05a-app-shell` (new remote branch, tracking set), head `06b34b2` (05A–05C, on top of `3e0b418`) |
| Remote | `github.com/farhan0nouman-sys/LeadFennec-Leads-Agent` (**public**); `main` unchanged at `7fc44f2`; `feat/04a-auth` unchanged at `3e0b418` |

- **CI has not run:** the workflow runs on pushes to `main`, on pull requests and on manual
  dispatch, not on pushes to other branches. A pull request into `main` (or a manual run)
  would give the first real-PostgreSQL results for 03A–05C. That is the user's decision.
- This entry is not in the pushed commit; it is a local change to the log.

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
