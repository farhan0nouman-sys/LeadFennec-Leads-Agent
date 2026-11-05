# Campaigns API

Task 06A. Configuration of campaigns, saved incrementally while a campaign is a draft. The
contract is `packages/shared/src/contracts/campaigns.ts` (`@lead-fennec-ai/shared`). Every route
is in the endpoint list (`packages/shared/src/contracts/endpoints.ts`) and in the generated
[openapi.json](openapi.json). Conventions (JSON, `Cache-Control: no-store`, the error envelope,
the session cookie, CSRF on changes) are as in [auth.md](auth.md); workspace rules (`404`
outside the user's workspaces, `403` without the permission) as in
[workspaces.md](workspaces.md). Decisions: `docs/decisions.md` D-06A-*.

| Route | Permission | Answer |
|---|---|---|
| `GET /workspaces/:workspaceId/campaigns` | `campaigns.read` | A page of campaigns: id, name, status, version, approval mode, readiness |
| `POST /workspaces/:workspaceId/campaigns` | `campaigns.write` | `201` and the new campaign: `DRAFT`, version 1, `HUMAN` approval, the workspace's time zone |
| `GET /workspaces/:workspaceId/campaigns/options` | `campaigns.read` | What a campaign may reference: `icps`, `leadLists`, `mailboxes` (with `email`, `provider`, `status`) and `templates`, the usable ones of the workspace, up to 200 of each by name (task 06B) |
| `GET /workspaces/:workspaceId/campaigns/:campaignId` | `campaigns.read` | The configuration |
| `PATCH /workspaces/:workspaceId/campaigns/:campaignId` | `campaigns.write` | The saved configuration, version raised by one |
| `POST /workspaces/:workspaceId/campaigns/:campaignId/duplicate` | `campaigns.write` | `201` and the copy |
| `GET /workspaces/:workspaceId/campaigns/:campaignId/readiness` | `campaigns.read` | Every check that must pass before the campaign can start: `campaignId`, `version`, `status`, `ready`, `checks` (`key`, `label`, `kind`, `stage`, `passed`, `reasons`) (task 06C) |
| `POST /workspaces/:workspaceId/campaigns/:campaignId/activate` | `campaigns.write` | `{ "version": n }`: starts the campaign; `200` and the running campaign (task 06C) |

## Saving a draft

```json
{
  "version": 3,
  "offer": { "name": "Audit", "description": "A free audit." },
  "leadLimits": { "dailyNewLeads": 25, "maxLeads": 500 }
}
```

- `version` is the version you loaded. If the campaign changed since, nothing is saved and
  the answer is `409 version_conflict`: load it again and reapply your change.
- Send only the sections you change: `name`, `description`, `businessProfile`, `offer`,
  `audience`, `exclusions`, `leadLimits`, `timezone`, `schedule`, `sender`, `sequence`,
  `approvalMode`. Each one replaces its section entirely. `null` clears the description, the
  business profile or the offer.
- Inside a section every field is optional while the campaign is a draft, but every value
  must be within its bounds. Unknown fields are refused.
- Time zones, domains and addresses are normalized (`europe/berlin` → `Europe/Berlin`,
  `WWW.Example.COM` → `example.com`); lists are deduplicated.
- Only `DRAFT` campaigns can be saved (`409 campaign_not_editable`).

## References

Ids in `audience` (`icpId`, `leadListId`), `exclusions.leadListIds`,
`sender.emailAccountId` and `sequence.steps[].templateId` must be records of the same
workspace that can be used (not archived, not disconnected). Otherwise the answer is
`400 validation_failed` with one issue per field, for example:

```json
{ "error": { "code": "validation_failed", "message": "The request is invalid.",
  "issues": [{ "path": "sender.emailAccountId", "message": "Not found in this workspace." }] } }
```

Another workspace's record and an id that doesn't exist get the same answer.

## Approval mode

`HUMAN` (the default): every draft needs a member's approval. `AUTOMATIC` can be set only by
a member whose role grants `drafts.approve` (else `403`), and only in a workspace that doesn't
require approval (else `400`, issue `approvalMode`). Workspaces require approval by default.

## Readiness

Every campaign carries `readiness`: `complete` and the sections still `missing` among
`businessProfile` (company name and description), `offer` (name and description), `audience`
(an ICP or a lead list), `leadLimits` (both), `sender` and `sequence` (at least one step).

## Duplicating

`POST …/duplicate` with `{}` or `{ "name": "…" }`. The copy is a new `DRAFT` (version 1,
`HUMAN` approval) with the configuration, the references and the sequences and their steps.
It never gets the source's leads, drafts, approvals, sends or schedules. Default name:
"<name> (copy)", then "(copy 2)" and so on.

## Starting a campaign

Saving never starts a campaign. `POST …/activate` with the version you reviewed does:

- A stale version: `409 version_conflict`, before anything else.
- Already started from that version: `200` and the campaign, unchanged. Repeating the request
  is safe.
- Not a draft (paused, completed, cancelled): `409 campaign_not_editable`.
- Automatic approval: the member also needs `drafts.approve` (else `403`).
- Any check blocked: `409 campaign_not_ready`, one issue per reason, with the check's key as
  `path`.

Checking each lead, preparing the emails and sending aren't built yet: their checks always
block, so no campaign can start today (docs/decisions.md D-06C-02). The version doesn't change
when a campaign starts.

## Errors

| Code | Status | When |
|---|---|---|
| `validation_failed` | 400 | A value out of bounds, an unknown field, a reference outside the workspace, or `AUTOMATIC` where the workspace requires approval |
| `forbidden` | 403 | Missing `campaigns.write` (or `drafts.approve` for `AUTOMATIC`) |
| `not_found` | 404 | Unknown campaign, or one of another workspace |
| `version_conflict` | 409 | The campaign changed since the version sent |
| `campaign_not_editable` | 409 | The campaign isn't a draft |
| `campaign_name_taken` | 409 | Another campaign of the workspace has the name |
| `campaign_not_ready` | 409 | Starting: a check blocks it (issues name each reason) |
