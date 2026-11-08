# Authorization review (task 04C, 2026-11-01)

Every API route and every data-access function that existed after 04B was checked for missing
authorization. Decisions: `docs/decisions.md` D-04C-04. The route list is enforced by
`apps/api/src/http/route-guards.test.ts`: a new route fails that test until it is added to its
reviewed list, so add it here too. Since 05B the API contract test
(`apps/api/src/http/api-contract.test.ts`) also requires every route to be in the endpoint list
(`packages/shared/src/contracts/endpoints.ts`) with the same access, permission, status and
validation schemas; the list generates `docs/api/openapi.json`.

## How access is decided

Since 05A the web server checks every page before rendering it, and the API's route test ties
each page's navigation permission to its API routes (`docs/decisions.md` D-05A-03):

| Layer | Check |
|---|---|
| Navigation | Shows the sections the member's permissions open (`packages/shared/src/navigation.ts`). Convenience only. |
| Web server | `apps/web/lib/server/access.ts` on every page: sign-in, membership (`404`), the section's permission ("You don't have access"), platform admin for `/admin`. |
| API | The layers below, unchanged. |


| Layer | Check |
|---|---|
| Session (`SessionGuard`) | The acting user always comes from the session cookie. No route takes a user id. |
| Cross-site requests (`OriginGuard`, `CsrfGuard`) | State-changing routes need a same-origin request and, with a session, the session's CSRF token. |
| Workspace (`WorkspaceGuard`) | `:workspaceId` must be an active workspace where the user has an active membership, else `404`. |
| Permission (`PermissionGuard`, `@RequirePermissions`) | The member's role must grant the route's permissions, else `403`. |
| Repositories | Check the permission again, and look up every record id inside the scope's workspace. |
| Platform admins | Only `/platform/*`, through `platformConsole` / `platformAdminScope`: re-checked on each request, a stated reason, audited, read-only (except status changes and limit overrides). |
| Workers | `claimJob` takes the workspace from the task row, never from the message. |

## Routes (36)

| Route | Guards | Repository check | Result |
|---|---|---|---|
| `GET /health/live`, `GET /health/ready` | none (public probes) | — | OK: no data, no details on failure |
| `POST /auth/register`, `/auth/verify-email`, `/auth/verify-email/resend`, `/auth/login`, `/auth/password-reset/request`, `/auth/password-reset/confirm` | Throttler, Origin | Auth store, keyed by email hash or token hash | OK: public by design; enumeration-safe answers (D-04A-02) |
| `POST /auth/logout` | Throttler, Origin, Session, CSRF | Ends only the request's own session | OK |
| `GET /auth/session` | Throttler, Session | — | OK: the user's own data |
| `POST /workspaces` | Throttler, Origin, Session, CSRF | `createWorkspace` requires an active, verified user | OK |
| `GET /workspaces` | Throttler, Session | `listUserWorkspaces(userId)` from the session | OK |
| `GET /workspaces/:workspaceId` | Throttler, Session, Workspace | Membership from the guard | OK: membership only, by design |
| `GET /workspaces/:workspaceId/members`, `/roles`, `/invitations` | Throttler, Session, Workspace, Permission `members.read` | `members.list`, `members.roles`, `invitations.listOpen`: `members.read` | OK |
| `PATCH /workspaces/:workspaceId/members/:membershipId` | Throttler, Origin, Session, CSRF, Workspace, Permission `members.manage` | `members.changeRole`: `members.manage`; ids in the workspace; last-admin rule | OK |
| `POST /workspaces/:workspaceId/invitations` | Throttler, Origin, Session, CSRF, Workspace, Permission `members.manage` | `invitations.create`: `members.manage`; role id in the workspace | OK |
| `DELETE /workspaces/:workspaceId/invitations/:invitationId` | same | `invitations.revoke`: `members.manage`; id in the workspace | OK |
| `GET /workspaces/:workspaceId/leads/summary` | Throttler, Session, Workspace, Permission `contacts.read` | `dashboard.leadSummary`: `contacts.read`; counts filtered by the workspace | OK (05C) |
| `GET /workspaces/:workspaceId/campaigns/summary` | Throttler, Session, Workspace, Permission `campaigns.read` | `dashboard.campaignSummary`: `campaigns.read` | OK (05C) |
| `GET /workspaces/:workspaceId/activity` | Throttler, Session, Workspace, Permission `audit.read` | `dashboard.activity` via `audit.list`: `audit.read`; names only from this workspace's memberships; no record ids or metadata | OK (05C) |
| `GET /workspaces/:workspaceId/integrations/health` | Throttler, Session, Workspace, Permission `settings.manage` | `dashboard.integrationHealth`: `settings.manage` | OK (05C) |
| `GET /workspaces/:workspaceId/campaigns`, `/campaigns/:campaignId` | Throttler, Session, Workspace, Permission `campaigns.read` | `campaigns.list`, `campaigns.get`: `campaigns.read`; id in the workspace | OK (06A) |
| `GET /workspaces/:workspaceId/campaigns/:campaignId/readiness` | Throttler, Session, Workspace, Permission `campaigns.read` | `campaigns.readiness`: `campaigns.read`; every fact read inside the workspace | OK (06C) |
| `POST /workspaces/:workspaceId/campaigns/:campaignId/activate` | Throttler, Origin, Session, CSRF, Workspace, Permission `campaigns.write` | `campaigns.activate`: `campaigns.write` (and `drafts.approve` for automatic approval); version check; every check passes; audited | OK (06C) |
| `GET /workspaces/:workspaceId/campaigns/options` | Throttler, Session, Workspace, Permission `campaigns.read` | `campaigns.options`: `campaigns.read`; only this workspace's usable ICPs, lead lists, mailboxes and templates (names, mailbox addresses and statuses) | OK (06B) |
| `POST /workspaces/:workspaceId/campaigns`, `PATCH …/campaigns/:campaignId`, `POST …/campaigns/:campaignId/duplicate` | Throttler, Origin, Session, CSRF, Workspace, Permission `campaigns.write` | `campaigns.create`, `update`, `duplicate`: `campaigns.write` (and `drafts.approve` for automatic approval); campaign and every referenced id in the workspace; version check | OK (06A) |
| `POST /workspaces/:workspaceId/imports/discovery` | Throttler, Origin, Session, CSRF, Workspace, Permission `imports.create` | `discovery.request`: `imports.create` (members only); the ICP read by `(tenant_id, id)`, another workspace's is not found; the plan checked before anything is written; import, task and audit record in one transaction | OK (07A) |
| `GET /workspaces/:workspaceId/imports/:importId` | Throttler, Session, Workspace, Permission `imports.create` | `discovery.get`: `imports.create`; id in the workspace (a malformed id is not found) | OK (07A) |
| `POST /workspaces/:workspaceId/imports/csv` | Throttler, Origin, Session, CSRF, Workspace, Permission `imports.create` | `imports.csv` → `discovery.importCsv`: `imports.create` (members only); file parsed and mapped again on the server; companies saved in the workspace only (suppression checked); import, records and audit in one transaction | OK (07C) |
| `GET /workspaces/:workspaceId/imports`, `/imports/options` | Throttler, Session, Workspace, Permission `imports.create` | `discovery.list`, `options`: `imports.create`; the workspace's runs and usable ICPs (names) only | OK (07C) |
| `GET /workspaces/:workspaceId/imports/:importId/results` | Throttler, Session, Workspace, Permission `imports.create` | `discovery.results`: `imports.create`; the run read by `(tenant_id, id)`, its records filtered by the tenant | OK (07C) |
| `POST /workspaces/:workspaceId/imports/:importId/cancel` | Throttler, Origin, Session, CSRF, Workspace, Permission `imports.create` | `discovery.cancel`: `imports.create` (members only); the run locked and read in the workspace; audited | OK (07C) |
| `POST /workspaces/:workspaceId/imports/:importId/enrichment` | Throttler, Origin, Session, CSRF, Workspace, Permission `imports.create` | `enrichment.request`: `imports.create` and `contacts.write` (members only); the source run, the campaign and its ICP read by `(tenant_id, id)` (another workspace's campaign is "Not found in this workspace."); the companies are the run's own records; run, job task and audit record in one transaction. The API records the provider's declaration only and calls no provider | OK (08C) |
| `GET /workspaces/:workspaceId/imports/:importId/contacts` | Throttler, Session, Workspace, Permission `imports.create` | `enrichment.results`: `imports.create`, or a platform admin's audited scope; the run read by `(tenant_id, id)` and refused unless it is an enrichment run; its records filtered by the tenant | OK (08C) |
| `POST /workspaces/:workspaceId/contacts/:contactId/recheck` | Throttler, Origin, Session, CSRF, Workspace, Permission `verifications.run` | `enrichment.requestRecheck`: `verifications.run` (members only); the contact read by `(tenant_id, id)`; limits counted from the workspace's own tasks under a per-workspace lock (429); job task and audit record in one transaction; refused (409) without an address or without a verification service. The API checks no address | OK (08C) |
| `GET /workspaces/:workspaceId/leads` | Throttler, Session, Workspace, Permission `contacts.read` | `leads.search`: `contacts.read`, or a platform admin's audited scope; `scores.read` and `campaigns.read` for those filters (403) and fields; one statement of fixed fragments and bind parameters, every join on the contact's tenant, every row read back checked against the tenant (`assertTenant`); a campaign id of another workspace is not found; read-only, at most 100 rows, a 5-second statement timeout | OK (11A) |
| `GET /workspaces/:workspaceId/leads/:contactId`, `/leads/:contactId/evidence` | Throttler, Session, Workspace, Permission `contacts.read` | `leads.detail`, `evidence`: `contacts.read`, or a platform admin's audited scope; the person read by `(tenant_id, id)` (another workspace's or a malformed id is not found); every list filtered by the tenant, capped, and checked (`assertTenant`); evidence of another person at the same company left out | OK (11A) |
| `PATCH /workspaces/:workspaceId/leads/:contactId`, `/leads/:contactId/tags`, `POST …/leads/:contactId/notes` | Throttler, Origin, Session, CSRF, Workspace, Permission `contacts.write` | `leads.correct`, `setTags`, `addNote`: `contacts.write` (members only); the person read by `(tenant_id, id)` and locked; the version checked (409); a correction's address checked unique in the workspace; a material correction makes the person's drafts, scheduled sends and decisions stale in the same transaction; audit records without values or text | OK (11B) |
| `POST /workspaces/:workspaceId/leads/:contactId/campaigns` | Throttler, Origin, Session, CSRF, Workspace, Permission `campaigns.write` | `leads.assign`: `campaigns.write` (members only); the person locked and version-checked; the campaign read by `(tenant_id, id)` (another workspace's is "Not found in this workspace."); refused for an ended campaign, one without a lead list, and a person with a block before sending (archived, do-not-contact, campaign exclusions); audited | OK (11B) |
| `GET /workspaces/:workspaceId/organizations/:organizationId/research`, `/research/:researchId` | Throttler, Session, Workspace, Permission `contacts.read` | `research.organizationResearch`, `version`: `contacts.read`, or a platform admin's audited scope; the company and the version read by `(tenant_id, id)` (a malformed id, another workspace's company or another company's version is not found); evidence read by id in the workspace only | OK (09C) |
| `POST /workspaces/:workspaceId/organizations/:organizationId/research` | Throttler, Origin, Session, CSRF, Workspace, Permission `research.run` | `research.request`: `research.run` (members only); the company and any campaign checked in the workspace before anything is written; one active run per company (partial unique index); version row, job task and audit record in one transaction. The API fetches no page and calls no model | OK (09C) |
| `POST /workspaces/:workspaceId/organizations/:organizationId/research/corrections` | Throttler, Origin, Session, CSRF, Workspace, Permission `research.run` | `research.correct`: `research.run` (members only); compare-and-set on the current version under a per-company lock (409 otherwise); a new version, its note as evidence and an audit record (field and action only, no text) in one transaction | OK (09C) |
| `GET /workspaces/:workspaceId/settings/send-policy` | Throttler, Session, Workspace, Permission `settings.manage` | `eligibility.policy`: `settings.manage`, or a platform admin's audited scope; the workspace's own settings row only | OK (10B) |
| `PATCH /workspaces/:workspaceId/settings/send-policy` | Throttler, Origin, Session, CSRF, Workspace, Permission `settings.manage` | `eligibility.updatePolicy`: `settings.manage` (members only); compare-and-set (409 `version_conflict`); a policy that could allow unnamed countries is refused (400); audit record in the same transaction | OK (10B) |
| `GET /workspaces/:workspaceId/campaigns/:campaignId/leads`, `/leads/:contactId` | Throttler, Session, Workspace, Permission `campaigns.read` | `qualification.list`, `view`: `campaigns.read`, `contacts.read` and `scores.read` (or the system actor, or a platform admin's audited scope); the campaign and the person read by `(tenant_id, id)` (a malformed id or another workspace's record is not found); read-only | OK (10C) |
| `POST /workspaces/:workspaceId/campaigns/:campaignId/leads/:contactId/qualify` | Throttler, Origin, Session, CSRF, Workspace, Permission `research.run` | `qualification.request`: `research.run` (members only); the campaign and the person checked in the workspace first; one queued or running run per lead (under a lock); job task and audit record in one transaction. The API calls no model | OK (10C) |
| `POST /workspaces/:workspaceId/campaigns/:campaignId/leads/:contactId/decisions` | Throttler, Origin, Session, CSRF, Workspace, Permission `campaigns.write` | `qualification.decide`: `campaigns.write` (members only), `drafts.approve` to accept eligibility review reasons; version check (409); a blocked person is never qualified (409, and a database check); decision and audit record (no note text) in one transaction | OK (10C) |
| `POST /invitations/preview`, `POST /invitations/accept` | Throttler, Origin, Session, CSRF | Bound to the signed-in user's normalized email; accept also to the confirmed workspace id | OK: the workspace comes from the invitation, never from the request alone |
| `GET /platform/workspaces` | Throttler, Session (Origin, CSRF pass on GET) | `platformConsole`: platform admin, reason, audited | OK |
| `POST /platform/workspaces/:workspaceId/access`, `/status` | Throttler, Origin, Session, CSRF | `platformAdminScope` / `platformConsole.setTenantStatus`: platform admin, reason, audited | OK |

Every `/workspaces/:workspaceId/<resource>` route must belong to a section in
`packages/shared/src/navigation.ts` (`apiResources`), and every GET route there must require
that section's permission (route test, task 05A). Today: `members`, `roles` and `invitations`
belong to Team (`members.read`). Since 05C: `leads` to Leads (`contacts.read`), `campaigns` to
Campaigns (`campaigns.read`), `activity` to Audit log (`audit.read`) and `integrations` to
Integrations (`settings.manage`). Since 07A: `imports` to Imports (`imports.create`). The dashboard shows a panel only when its section opens.

Reads (`GET`) skip the per-IP request limit (`@SkipThrottle`); the guard is still attached.

**Client cache (05B, D-05B-03).** The web app caches API reads in browser memory only. Every key
holds the user's id and, for workspace data, the workspace id from the request path;
invalidation matches those stored fields; signing out clears the cache. The session (with its
CSRF token) and platform-admin reads are never cached. The server caches nothing across
requests.

## Data-access functions

| Function | Who may call it | Result |
|---|---|---|
| `memberScope`, `platformAdminScope`, `systemScope`, `platformConsole` | Entry points; each checks its actor | OK (03C) |
| `scope.db` (tenant-scoped client) | Any scope | **Limit, not a defect:** it injects the tenant id but checks no permission. Routes must use repositories, or call `requirePermission` themselves. |
| `members.list`, `members.roles`, `invitations.listOpen` | `members.read`, or a platform admin's audited scope | OK |
| `members.changeRole`, `invitations.create`, `invitations.revoke` | `members.manage` | OK |
| `previewInvitation`, `acceptInvitation` | The invited user (identity binding) | OK |
| `createWorkspace`, `listUserWorkspaces` | The session's user | OK |
| `audit.record` | Any scope (append-only, application code) | OK |
| `audit.list` | **Was any scope.** Now `audit.read` or a platform admin | **Fixed** |
| `campaigns.list`, `get`, `options`, `readiness` | `campaigns.read`, or a platform admin's audited scope | OK (06A–06C) |
| `campaigns.activate` | `campaigns.write` (members only); automatic approval also `drafts.approve` | OK (06C) |
| `discovery.request` | `imports.create` (members only; workers and platform admins refused) | OK (07A) |
| `discovery.get` | `imports.create`, or a platform admin's audited scope | OK (07A) |
| `discovery.list`, `results`, `options` | `imports.create`, or a platform admin's audited scope | OK (07C) |
| `discovery.importCsv`, `cancel` | `imports.create` (members only; workers and platform admins refused) | OK (07C) |
| `research.organizationResearch`, `version` | `contacts.read`, or a platform admin's audited scope | OK (09C) |
| `research.request`, `correct` | `research.run` (members only; workers and platform admins refused) | OK (09C) |
| `scoring.scoreLead` | The system actor only (application code scores; no route yet); members and platform admins refused. The campaign, the person and every cited evidence row are checked in the workspace before anything is written | OK (10A) |
| `eligibility.evaluate` | `campaigns.read` and `contacts.read` (and `scores.read` for the fit), the system actor, or a platform admin's audited scope; the campaign and the person read by `(tenant_id, id)` (another workspace's or a malformed id is not found); every fact read in this workspace only; read-only | OK (10B) |
| `eligibility.policy` | `settings.manage`, the system actor, or a platform admin's audited scope | OK (10B) |
| `eligibility.updatePolicy` | `settings.manage` (members only; workers and platform admins refused); compare-and-set on the version; validated (no setting can allow unnamed countries); audit record (counts and source names only) in the same transaction | OK (10B) |
| `qualification.context`, `recordAutomatic` | The system actor only (the lead_qualification worker, through `claimJob`); members and platform admins refused | OK (10C) |
| `scoring.scoreLead` with proposals | The system actor only; every cited research fact checked again against the current research version before anything is written | OK (10C) |
| `scoring.current`, `get`, `reproduce` | `scores.read`, the system actor, or a platform admin's audited scope; read by `(tenant_id, id)` (another workspace's or a malformed id, or a score without inputs, is not found) | OK (10A) |
| `research.beginRun`, `freshPage`, `savePage`, `reusable`, `completeRun`, `retryRun`, `failRun` | The system actor only (the website_research worker, through `claimJob`); members and platform admins refused | OK (09C) |
| `discovery.beginSearch`, `saveSearchPage`, `finishSearch`, `failSearch` | The system actor only (the search worker, through `claimJob`); members and platform admins refused | OK (07C) |
| `enrichment.request`, `requestRecheck` | `imports.create` and `contacts.write`; `verifications.run` (members only; workers and platform admins refused) | OK (08C) |
| `enrichment.results`, `quality` | `imports.create`; `contacts.read` (or the system actor), or a platform admin's audited scope; ids of another workspace are not found (results) or left out (quality) | OK (08C) |
| `enrichment.begin`, `nextCompany`, `knownPeople`, `freshChecks`, `saveCompany`, `finish`, `fail`, `beginRecheck`, `saveRecheck` | The system actor only (the contact_enrichment worker, through `claimJob`); members and platform admins refused. People are saved through `saveContacts` under a per-workspace lock; every lookup filtered by the tenant | OK (08C) |
| `leads.search`, `detail`, `evidence` | `contacts.read`, or a platform admin's audited scope (workers refused); `scores.read`, `campaigns.read` and `lead_lists.read` for those parts; every row read through a join checked against the tenant (`TenantLeakError` otherwise); read-only | OK (11A) |
| `leads.correct`, `setTags`, `addNote`, `assign` | `contacts.write` (`campaigns.write` to assign), members only (workers and platform admins refused); version-checked under a row lock; every referenced record checked in the workspace; audited | OK (11B) |
| `markLeadsStale` | Called only inside a lead correction or a research correction transaction; filters by the tenant; never deletes a draft or an approval, only moves statuses forward | OK (11B) |
| `dueJobTasks` (relay) | Lists active workspaces, then each one's due tasks through its own scoped client; returns task ids only | OK (07C) |
| `campaigns.create`, `update`, `duplicate` | `campaigns.write` (members only); `update` to automatic approval also `drafts.approve` and a workspace that allows it | OK (06A) |
| `dashboard.leadSummary`, `campaignSummary`, `activity`, `integrationHealth` | The section's permission (`contacts.read`, `campaigns.read`, `audit.read`, `settings.manage`), or a platform admin's audited scope; workers refused | OK (05C) |
| `billing.currentSubscription`, `billing.effectiveLimits` | **Were any scope.** Now `billing.read`, the system actor or a platform admin | **Fixed** |
| `usage.summary` | **Was any scope.** Now as billing reads | **Fixed** |
| `billing.setLimitOverride` | Platform admins only, audited | OK |
| `usage.reserve`, `usage.commit`, `usage.release` | Members and the system actor, not platform admins | Accepted: bookkeeping by application code around metered work, whose own route checks the permission (e.g. `research.run`) |
| `usage.expireHolds` | System actor only | OK |
| `notifications.notify` | **Were members and the system actor.** Now the system actor only | **Fixed:** a member could have written any message to another member |
| `notifications.listMine`, `unreadCount`, `markRead` | The acting member, own notifications only | OK |
| `enqueueJob`, `claimJob` | Not from a platform admin's scope; the tenant comes from the task row | OK (04B) |
| `findCurrentSubscription`, `findEffectiveLimit`, `writeAuditRecord`, `syncPermissionCatalog` | Low-level helpers with an explicit tenant id, used inside repositories | Accepted: never call them with a tenant id taken from a request |
| Auth store (`createAuthStore`) | `AuthService` only: platform-level account data keyed by token or email hash | OK |

No route used the four fixed functions yet, so nothing was exposed. The tenant-access suite
now checks them with a Client Team Member's scope, a platform admin's scope and the system
actor.

## Not covered here

- Rate limits per IP depend on `TRUST_PROXY_HOPS` and the deployment's proxies (D-04C-06,
  O-20).
- Suspending or removing members, and custom roles, don't exist yet (O-23).
