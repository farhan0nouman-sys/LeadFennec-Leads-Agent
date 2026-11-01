# Authorization review (task 04C, 2026-11-01)

Every API route and every data-access function that existed after 04B was checked for missing
authorization. Decisions: `docs/decisions.md` D-04C-04. The route list is enforced by
`apps/api/src/http/route-guards.test.ts`: a new route fails that test until it is added to its
reviewed list, so add it here too.

## How access is decided

| Layer | Check |
|---|---|
| Session (`SessionGuard`) | The acting user always comes from the session cookie. No route takes a user id. |
| Cross-site requests (`OriginGuard`, `CsrfGuard`) | State-changing routes need a same-origin request and, with a session, the session's CSRF token. |
| Workspace (`WorkspaceGuard`) | `:workspaceId` must be an active workspace where the user has an active membership, else `404`. |
| Permission (`PermissionGuard`, `@RequirePermissions`) | The member's role must grant the route's permissions, else `403`. |
| Repositories | Check the permission again, and look up every record id inside the scope's workspace. |
| Platform admins | Only `/platform/*`, through `platformConsole` / `platformAdminScope`: re-checked on each request, a stated reason, audited, read-only (except status changes and limit overrides). |
| Workers | `claimJob` takes the workspace from the task row, never from the message. |

## Routes (24)

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
| `POST /invitations/preview`, `POST /invitations/accept` | Throttler, Origin, Session, CSRF | Bound to the signed-in user's normalized email; accept also to the confirmed workspace id | OK: the workspace comes from the invitation, never from the request alone |
| `GET /platform/workspaces` | Throttler, Session (Origin, CSRF pass on GET) | `platformConsole`: platform admin, reason, audited | OK |
| `POST /platform/workspaces/:workspaceId/access`, `/status` | Throttler, Origin, Session, CSRF | `platformAdminScope` / `platformConsole.setTenantStatus`: platform admin, reason, audited | OK |

Reads (`GET`) skip the per-IP request limit (`@SkipThrottle`); the guard is still attached.

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
