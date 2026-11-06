# Lead discovery and imports API

Tasks 07A–07C. Company searches from an ideal customer profile (ICP) and CSV imports of
companies, followed by run id. The contracts are `packages/shared/src/contracts/lead-discovery.ts`
and `organization-import.ts` (`@lead-fennec-ai/shared`). Every route is in the endpoint list
(`packages/shared/src/contracts/endpoints.ts`) and in the generated [openapi.json](openapi.json).
Conventions (JSON, `Cache-Control: no-store`, the error envelope, the session cookie, CSRF on
changes) are as in [auth.md](auth.md); workspace rules (`404` outside the user's workspaces,
`403` without the permission) as in [workspaces.md](workspaces.md). Decisions:
`docs/decisions.md` D-07A-*, D-07B-*, D-07C-*.

| Route | Permission | Answer |
|---|---|---|
| `POST /workspaces/:workspaceId/imports/discovery` | `imports.create` | `202 { runId, status, statusUrl }`: the search is queued |
| `POST /workspaces/:workspaceId/imports/csv` | `imports.create` | `201` and the run: every row saved, matched, excluded or failed |
| `GET /workspaces/:workspaceId/imports` | `imports.create` | The runs, newest first (`limit`, `cursor`) |
| `GET /workspaces/:workspaceId/imports/options` | `imports.create` | The ICPs a search can use, the search provider and its limits, the CSV limits |
| `GET /workspaces/:workspaceId/imports/:importId` | `imports.create` | The run: source, status, search inputs, attribution, counts, error code, timestamps |
| `GET /workspaces/:workspaceId/imports/:importId/results` | `imports.create` | What happened to each record, in order (`outcome`, `limit`, `cursor`) |
| `POST /workspaces/:workspaceId/imports/:importId/cancel` | `imports.create` | `{}`: stops a queued or running search; `200` and the run |

Searches and imports bring in **companies only**. People and contact details are separate
steps (contact discovery, 08A).

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
attribution, and a queued job task. The worker runs it page by page (D-07C-02).

### Which criteria are searched

| ICP criterion | Searched? |
|---|---|
| `industries`, `countries`, `employees`, `keywords` | Yes, by the development provider and by Apollo |
| `technologies`, `annualRevenue` | By Apollo; with the development provider the request is refused |
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

## How a search runs

- **Page by page.** Each page is saved in one transaction: its companies, a result per
  record, the counts and where the next page starts. An interrupted search resumes at the
  last saved page; nothing is saved twice.
- **Each company is:**
  - **excluded** when its domain, or a parent domain, is on the workspace's suppression list;
  - **matched** when the workspace already has it (same domain; without a domain, the same
    normalized name among companies without one): missing details are filled in, nothing is
    overwritten, and it is never added twice;
  - **created** otherwise.
- **Statuses:** `PENDING` (queued), `PROCESSING` (running; with an `errorCode` while it waits
  to retry), `COMPLETED`, `CANCELLED`, `FAILED` (with an `errorCode` such as `timeout`,
  `quota_exceeded` or `usage_limit_reached`, never a provider's message).
- **Paid providers** (Apollo) take one search credit of the workspace's plan per page, reserved
  before the request. The development provider is free.

## Importing a CSV file

```json
{
  "fileName": "prospects.csv",
  "content": "Company,Website,Employees\nAcme Analytics,https://acme.example,120\n",
  "mapping": { "name": "Company", "website": "Website", "employees": "Employees" }
}
```

- **The file:** UTF-8 text with a header row, at most 256 KB, 1000 data rows, 30 columns
  and 1000 characters a cell. Quoted cells (`"Acme, Inc."`, `""` for a quote), LF or CRLF, a
  byte-order mark and blank lines are fine.
- **The mapping:** field → column header (case-insensitive), each column at most once.
  Fields: `name` (required), `domain`, `website`, `industry`, `employees`, `country` (a
  two-letter code). Columns not mapped are not stored.
- **Each row** is saved, matched, excluded or failed, as for a search. A failed row says why,
  by field ("Use a whole number of employees, such as 120."). Values are cleaned (control
  characters, extra spaces) and never evaluated: `=1+2` is stored as text.
- **Refusals** (`400 validation_failed`, "The file can't be imported as it is."): `content`
  (for example "A quoted cell is not closed. (line 2)", "The file has no rows below the
  header.") or `mapping.<field>` ("The file has no column "Domain"."). Nothing is stored.
- JSON bodies are limited to 1 MB (`413` beyond).

## Following a run

```json
{
  "id": "0190f5c4-0b6e-7d55-8a43-2f1d9c7e6a01",
  "source": "ORGANIZATION_SEARCH",
  "status": "COMPLETED",
  "search": {
    "icpId": "0190f5c2-7d1e-7c3a-9c1e-4f6a8b2d3e10",
    "provider": "FAKE",
    "filters": { "industries": ["software"], "employees": { "min": 50, "max": 500 } },
    "maxResults": 200,
    "ignoredCriteria": ["titles"],
    "attribution": "Synthetic companies from the Lead Fennec test directory, not real businesses."
  },
  "fileName": null,
  "counts": { "found": 40, "saved": 39, "created": 12, "excluded": 1, "failed": 0, "repeated": 0 },
  "pagesFetched": 2,
  "errorCode": null,
  "createdAt": "2026-11-06T09:00:00.000Z",
  "startedAt": "2026-11-06T09:00:05.000Z",
  "completedAt": "2026-11-06T09:00:07.000Z"
}
```

- **Counts:**
  - `found`: records received (rows, or companies the provider returned);
  - `saved`: kept in the workspace, of which `created` are new (the rest were matched);
  - `excluded`;
  - `failed`;
  - `repeated`: the same company again within the run.
- `search` is `null` for CSV imports; `fileName` is `null` for searches.
- Another workspace's run, or an id that isn't a UUID, answers `404`.

## Results

`GET …/imports/:importId/results?outcome=FAILED&limit=50` returns records in order:

```json
{
  "items": [
    {
      "id": "0190f5c4-…",
      "position": 7,
      "outcome": "FAILED",
      "name": "Bad Size",
      "domain": "bad.example",
      "externalId": null,
      "organizationId": null,
      "issues": [{ "field": "employees", "message": "Use a whole number of employees, such as 120." }]
    }
  ],
  "nextCursor": null
}
```

- `position` is the CSV line (the header is line 1) or the place in the search results.
- `outcome`: `CREATED`, `MATCHED`, `EXCLUDED` or `FAILED`.
- `name` and `domain` are as received: untrusted text, escaped wherever shown.
- The web app's error report (excluded and failed records) is a CSV whose cells can't run as
  spreadsheet formulas (D-07C-05).

## Cancelling

`POST …/imports/:importId/cancel` with `{}` stops a queued or running search before its next
page; companies saved before stay. Repeating it answers the same. A completed or failed import
answers `409 import_not_cancellable`; CSV imports finish in their request, so they are never
cancellable.

## Providers

| Environment | Provider |
|---|---|
| Development, test | `FAKE`: 240 synthetic companies on `.example` domains, the same results every time |
| Staging, production | `APOLLO`: Apollo organization search (task 07B). Requests are checked against its declared filters (all six company filters) and limits; the worker that runs them needs `APOLLO_API_KEY`. |

With Apollo, a request may ask for up to 1000 companies (Lead Fennec's cap; Apollo's own is
50,000), and each page of up to 100 companies costs 1 Apollo credit. Industry names must be
Apollo's exact ones (for example "information technology & services"). Found companies carry
an id, name, domain and website only: Apollo's search documents no industry, size or country.
Details: `docs/decisions.md` D-07B-*.
