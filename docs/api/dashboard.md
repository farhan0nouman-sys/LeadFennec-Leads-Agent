# Dashboard API

Task 05C. Read-only aggregates for the workspace overview. The contract is
`packages/shared/src/contracts/dashboard.ts` (`@lead-fennec-ai/shared`). Every route is in the
endpoint list (`packages/shared/src/contracts/endpoints.ts`) and in the generated
[openapi.json](openapi.json). Conventions (JSON, `Cache-Control: no-store`, the error envelope,
the session cookie) are as in [auth.md](auth.md); workspace rules (`404` outside the user's
workspaces, `403` without the permission) as in [workspaces.md](workspaces.md). Decisions:
`docs/decisions.md` D-05C-*.

| Route | Permission | Answer |
|---|---|---|
| `GET /workspaces/:workspaceId/leads/summary` | `contacts.read` | `generatedAt`, `contacts` (active), `companies`, `contactsWithEmail`, `contactsAddedLast30Days` |
| `GET /workspaces/:workspaceId/campaigns/summary` | `campaigns.read` | `generatedAt`, `campaigns`, `activeCampaigns`, `leadsInProgress`, `campaignsByStatus`, `leadsByStatus` |
| `GET /workspaces/:workspaceId/activity?limit=1..25` | `audit.read` | `generatedAt`, `counts` (`last24Hours`, `last7Days`, `last30Days`), `items` (newest first; default 10) |
| `GET /workspaces/:workspaceId/integrations/health` | `settings.manage` | `generatedAt`, `items`: one per Gmail, Microsoft 365, GoHighLevel and Apollo, with `state` |

## Activity items

`{ id, action, actor: { kind, name }, targetType, reason, occurredAt }`

- `action` is a dotted key, e.g. `invitation.created`; `activityLabel(action)` gives the words.
- `actor.kind` is `member` (named: display name, else email address), `former_member`,
  `platform_admin` or `system`. Only members of this workspace are ever named.
- `reason` is plain text from the actor (always set for platform admins): untrusted, render
  it as text.
- The id of the changed record and the audit metadata are never returned.

## Integration health

`state` is `not_connected`, `connecting`, `healthy` or `attention`
(`integrationHealthState`). Inputs per integration: `mailboxes` by status (mailbox providers
only, else `null`), `syncs`, `failingSyncs`, `lastSyncedAt`, `failedEventsLast24Hours`
and `lastEventAt`. Nothing is asked of the providers: these are the workspace's own records.

## Refreshing

The web app polls `activity` every minute and `integrations/health` every 2 minutes, only
while the page is visible. It backs off after failures and stops after 30 minutes or 3
failures in a row (D-05C-04). The summaries load when the page opens and on request.
