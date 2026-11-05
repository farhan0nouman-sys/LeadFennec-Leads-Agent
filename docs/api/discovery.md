# Lead discovery API

Task 07A. Organization searches from an ideal customer profile (ICP), requested and followed
by run id. The contract is `packages/shared/src/contracts/lead-discovery.ts`
(`@lead-fennec-ai/shared`). Every route is in the endpoint list
(`packages/shared/src/contracts/endpoints.ts`) and in the generated [openapi.json](openapi.json).
Conventions (JSON, `Cache-Control: no-store`, the error envelope, the session cookie, CSRF on
changes) are as in [auth.md](auth.md); workspace rules (`404` outside the user's workspaces,
`403` without the permission) as in [workspaces.md](workspaces.md). Decisions:
`docs/decisions.md` D-07A-*.

| Route | Permission | Answer |
|---|---|---|
| `POST /workspaces/:workspaceId/imports/discovery` | `imports.create` | `202 { runId, status, statusUrl }`: the search is queued |
| `GET /workspaces/:workspaceId/imports/:importId` | `imports.create` | The run: source, status, search inputs, attribution, counts, error code, timestamps |

A search finds **companies only**. People and contact details are separate steps (contact
discovery, 08A); nothing here creates contacts, and in 07A nothing creates companies either:
the queued search runs in a worker (07C).

## Requesting a search

```json
{ "icpId": "0190f5c2-7d1e-7c3a-9c1e-4f6a8b2d3e10", "maxResults": 200 }
```

- `icpId`: an ICP of this workspace that isn't archived.
- `maxResults` (optional, default 100): how many companies the search may return, from 1 to
  the lower of 1000 and the provider's own limit (the development provider allows 500).
- Unknown fields are refused.

The answer is `202`:

```json
{
  "runId": "0190f5c4-0b6e-7d55-8a43-2f1d9c7e6a01",
  "status": "PENDING",
  "statusUrl": "/workspaces/0190f5c1-…/imports/0190f5c4-0b6e-7d55-8a43-2f1d9c7e6a01"
}
```

`statusUrl` is an API path; the web app calls it through `/api`. The request is stored with
the filters it will search (a snapshot of the ICP), the limit, the provider and its
attribution, and a queued job task. Requesting the same search again creates a new run with
the same query hash.

### Which criteria are searched

| ICP criterion | Searched? |
|---|---|
| `industries`, `countries`, `employees`, `keywords` | Yes, by the development provider |
| `technologies`, `annualRevenue` | Only by a provider that declares them; otherwise the request is refused |
| `titles`, `seniorities` | Not by a company search: kept as `ignoredCriteria` for contact discovery |

### Refusals

`400 validation_failed` with one issue per reason:

| Path | Message (examples) |
|---|---|
| `icpId` | "Not found in this workspace." (also for another workspace's ICP) · "This ideal customer profile is archived." |
| `maxResults` | "Ask for at most 500 companies in one search." · "Ask for at least 1 company." |
| `criteria` | "The ideal customer profile has no company filters (industry, country, company size or keywords). Add one before searching." · "Lead Fennec doesn't recognize the filter "sector"." |
| `criteria.<filter>` | "Company search can't filter by technologies yet. Remove it from the profile to search." |

A body that doesn't match the schema answers "The request is invalid."; a search the provider
can't run answers "The search can't run as asked." Nothing is stored for a refused request.

## Following a run

```json
{
  "id": "0190f5c4-0b6e-7d55-8a43-2f1d9c7e6a01",
  "source": "ORGANIZATION_SEARCH",
  "status": "PENDING",
  "search": {
    "icpId": "0190f5c2-7d1e-7c3a-9c1e-4f6a8b2d3e10",
    "provider": "FAKE",
    "filters": { "industries": ["software"], "employees": { "min": 50, "max": 500 } },
    "maxResults": 200,
    "ignoredCriteria": ["titles"],
    "attribution": "Synthetic companies from the Lead Fennec test directory, not real businesses."
  },
  "counts": { "found": 0, "saved": 0, "skipped": 0, "failed": 0 },
  "errorCode": null,
  "createdAt": "2026-11-05T09:00:00.000Z",
  "startedAt": null,
  "completedAt": null
}
```

- `status`: `PENDING`, `PROCESSING`, `COMPLETED`, `FAILED` or `CANCELLED`. In 07A runs stay
  `PENDING`: the worker that runs them is 07C.
- `search` is `null` for CSV and Apollo imports (same table, same route).
- `errorCode` is a machine-readable code (for example `rate_limited`), never a provider's
  message.
- Another workspace's run, or an id that isn't a UUID, answers `404`.

## Providers

| Environment | Provider |
|---|---|
| Development, test | `FAKE`: 240 synthetic companies on `.example` domains, the same results every time |
| Staging, production | A live adapter (Apollo, task 07B), which doesn't exist yet: the API refuses to start |
