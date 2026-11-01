# Workspaces, team and platform-admin API contract

Task 04B. The machine-readable contract is `packages/shared/src/contracts/workspaces.ts`
(`@lead-fennec-ai/shared`). The permission catalog and the system roles are in
`packages/shared/src/authorization.ts`. Conventions (JSON, `Cache-Control: no-store`, the
error envelope, the session cookie, CSRF and origin checks) are as in
[auth.md](auth.md). Decisions: `docs/decisions.md` D-04B-*.

## Who is acting

- **The user always comes from the session cookie.** No route takes a user id.
- **A `:workspaceId` in the path** is accepted only when that user has an `ACTIVE` membership in
  an `ACTIVE` workspace. Otherwise the answer is `404 not_found`, whether the workspace
  doesn't exist, the user isn't a member, or it's suspended.
- **A record id** (membership, role, invitation) in the path or body is looked up inside that
  workspace only. An id from another workspace is `404 not_found`.
- **Permissions** come from the member's role and are checked by the route and again by the
  repository. Missing permission: `403 forbidden`.
- **Being a platform admin grants nothing on these routes;** see "Platform admin" below.

| Role | Team routes |
|---|---|
| Client Admin (`client_admin`) | Everything: `members.read`, `members.manage` and every other permission |
| Client Team Member (`client_member`) | Reads the team, roles and invitations (`members.read`); no changes |

## Routes

All `POST`, `PATCH` and `DELETE` routes need the session's `x-csrf-token` and the web app's
origin.

| Method and path | Permission | Body / query | Success | Errors |
|---|---|---|---|---|
| `POST /workspaces` | Verified, signed-in user | `{ name, slug? }` | `201` workspace with your membership (Client Admin) | `400`, `409 slug_taken` |
| `GET /workspaces` | Signed in | — | `200 { items: [{ workspace, membership }] }`: your active workspaces | `401` |
| `GET /workspaces/:workspaceId` | Member | — | `200 { workspace, membership }` | `404` |
| `GET /workspaces/:workspaceId/members` | `members.read` | `?limit&cursor` | `200 { items, nextCursor }` | `403`, `404` |
| `PATCH /workspaces/:workspaceId/members/:membershipId` | `members.manage` | `{ roleId }` | `200` member | `403`, `404`, `409 last_admin` |
| `GET /workspaces/:workspaceId/roles` | `members.read` | — | `200 { items: [{ id, key, name, isSystem, permissions }] }` | `403`, `404` |
| `GET /workspaces/:workspaceId/invitations` | `members.read` | `?limit&cursor` | `200 { items, nextCursor }`: open invitations, newest first | `403`, `404` |
| `POST /workspaces/:workspaceId/invitations` | `members.manage` | `{ email, roleId }` | `201` invitation (no token) and the email is sent | `403`, `404`, `409 already_member`, `429` |
| `DELETE /workspaces/:workspaceId/invitations/:invitationId` | `members.manage` | — | `204` | `403`, `404` |
| `POST /invitations/preview` | Signed in as the invited address | `{ token }` | `200 { workspace: { id, name }, role, invitedBy, expiresAt }` | `400 invalid_or_expired_invitation`, `403 invitation_for_another_account` |
| `POST /invitations/accept` | Signed in as the invited address | `{ token, workspaceId }` | `200 { workspace, membership }` | `400 invalid_or_expired_invitation`, `400 invitation_for_another_workspace`, `403 invitation_for_another_account`, `409 already_member` |

## Invitations

| Item | Rule |
|---|---|
| Link | `<WEB_APP_URL>/invitations/accept#token=…` (token in the fragment), sent by email only |
| Bound to | One workspace and one email address (normalized). The binding can't be changed afterwards (database trigger). |
| Validity | 7 days, single use. Inviting the same address again revokes the earlier link. |
| Accepting | Needs a signed-in, verified account with the invited address, and the workspace id the user confirmed (from the preview). It creates the membership with the invited role, or reactivates a suspended one. |
| Unusable | Unknown, used, revoked and expired invitations, and invitations of inactive workspaces, all give `invalid_or_expired_invitation` |
| Limit | At most 100 invitation emails per workspace and day (`429`) |
| Privacy | A user with another address learns nothing about the workspace (`invitation_for_another_account`) |

## Platform admin

Explicit routes, each needing a signed-in platform admin (re-checked on every request) and a
stated reason (10–500 characters). Anyone else gets `403 forbidden`, and the refusal is
recorded in `platform_audit_records`.

| Method and path | Reason in | Effect and audit |
|---|---|---|
| `GET /platform/workspaces?limit&cursor` | `x-access-reason` header | Every workspace, newest first. Records `platform_admin.console_opened`. |
| `POST /platform/workspaces/:workspaceId/access` | Body `{ reason }` | `{ workspace, memberCount }` through read-only access. Records `platform_admin.access_opened` in the workspace's audit records. |
| `POST /platform/workspaces/:workspaceId/status` | Body `{ status: "ACTIVE" \| "SUSPENDED", reason }` | Suspends or reactivates the workspace; members of a suspended workspace get `404`. Records `tenant.status_changed` (with before and after) in `platform_audit_records`. |

## Audit records (tenant)

| Action | When |
|---|---|
| `workspace.created` | A workspace is created (actor: its creator) |
| `invitation.created`, `invitation.revoked` | By an admin |
| `invitation.accepted` | By the new member |
| `membership.role_changed` | Metadata `{ from, to }` (role keys) |
| `platform_admin.access_opened` | A platform admin opened read-only access, with the reason |

None of them contains a token, a password or an email body.
