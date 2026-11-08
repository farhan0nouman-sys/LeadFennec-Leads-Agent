# Contact enrichment API

Task 08C (`docs/decisions.md` D-08C-01 to D-08C-07). People are found for the companies a
finished company run saved (a search or a CSV import), for the roles of an ideal customer
profile. Nobody is emailed by any of this.

| Route | Permission | What it does |
|---|---|---|
| `POST /workspaces/:workspaceId/imports/:importId/enrichment` | `imports.create` (and `contacts.write`) | Queues a people search for the run's companies (`202`, `{ runId, status, statusUrl }`). Audited. |
| `GET /workspaces/:workspaceId/imports/:importId` | `imports.create` | The run with its progress (`enrichment`), as for every run (`docs/api/discovery.md`). |
| `GET /workspaces/:workspaceId/imports/:importId/contacts` | `imports.create` | What each person (or skipped company) of an enrichment run became, in order (`limit`, `cursor`, `outcome`). |
| `POST /workspaces/:workspaceId/contacts/:contactId/recheck` | `verifications.run` | Queues a new check of the contact's address (`202`, `{ contactId, status }`). Audited. |

## Asking for people

```json
{ "campaignId": "0190f5c2-7d1e-7c3a-9c1e-4f6a8b2d3e10", "maxContactsPerCompany": 3 }
```

- Both fields are optional. `maxContactsPerCompany` is 1 to 5 (3 by default).
- **The campaign:**
  - its exclusions apply (addresses, domains, lead lists);
  - people who may be emailed one day are added to its lead list;
  - its ideal customer profile is used when the run has none (a CSV import).
- **The run covers** the first 25 companies the source run saved. The targets are the ICP's
  titles, seniorities and countries, copied when the run is asked for.
- **`400 validation_failed`, one issue per reason:**
  - the run is still going, saved no companies, or is itself a people search;
  - the campaign isn't in this workspace or has ended;
  - there is no ICP;
  - the ICP is archived.
- **`404`:** a run of another workspace.

## Progress

`GET …/imports/:importId` answers with `source: "CONTACT_ENRICHMENT"` and `enrichment`:

```json
{
  "sourceImportId": "…",
  "icpId": "…",
  "campaignId": "…",
  "leadListId": "…",
  "provider": "FAKE",
  "attribution": "Synthetic people from the Lead Fennec test directory, not real people.",
  "targeting": { "titles": ["VP Sales"], "seniorities": ["VP"], "countries": ["US"] },
  "maxContactsPerCompany": 3,
  "companies": { "total": 25, "done": 12, "skipped": 2, "beyondLimit": 40 }
}
```

The run's `counts` are people: found, saved (`created` of them new), excluded, failed. A run can be
cancelled like a search (`POST …/cancel`): it stops before its next company.

## People

Each item is a person, or a company skipped before the provider was asked:

| `outcome` | Person | Company |
|---|---|---|
| `CREATED` | Saved as a new contact | — |
| `MATCHED` | Already in the workspace: linked, not duplicated (`reused: true` when it wasn't looked up again) | — |
| `EXCLUDED` | On the do-not-contact list or excluded by the campaign: not saved | Outside the targeted countries, or its domain is on the do-not-contact list or excluded |
| `FAILED` | Not usable (a partial record) | No domain, or no longer exists |

- **`person`:**
  - `name`, `title`, `email`;
  - `contactId`;
  - `confidence`: the role match, 0–100;
  - `reused`;
  - `check`: the check made during the run (`verified`, `risky`, `unknown`, `invalid`), or null.
- **`issues`:** say why something was excluded or failed, or why a saved person can't be emailed
  (no address, an address that doesn't accept email, or one a person must decide on).
- **Not on the lead list:** people without an address, or with an address that doesn't accept
  email. Send eligibility blocks them too.
- **Untrusted text:** names, titles and companies come from providers.

## Contact quality

The lead view (`GET …/campaigns/:campaignId/leads/:contactId`, `docs/api/qualification.md`) has
`quality`; each item of the leads list has its short form (`{ level, emailState }`):

- **`level`:**
  - `good`: a fresh verified check, from a fresh source;
  - `review`;
  - `unusable`: no address, or one that doesn't accept email.
- **`reasons`.**
- **`source`:** the provider, its attribution, when it was retrieved, and whether that is within
  30 days.
- **`confidence`:** the role match.
- **`email`:**
  - the address;
  - the provider's own claim (never a check);
  - the newest check of this address;
  - its state (`eligible`, `needs_review`, `stale`, `unverified`, `blocked`).
- **`recheck`:** whether one is queued, when the next may be asked for, and why the last one
  failed.

Quality is decided when it is read. It never permits sending: eligibility does.

## Rechecks

- **`{}` answers `202`:** `{ "status": "queued" }`, or `"already_queued"` while one waits.
- **Limits:** once a contact in 24 hours, and 50 a workspace in 24 hours. Over a limit:
  `429 too_many_requests` with `Retry-After`.
- **`409 no_email_address`:** the contact has no address.
- **`409 verification_unavailable`:** no verification service is set up (staging and production
  today, `docs/decisions.md` O-35).
- **The result** is a new check of the address. A failed check leaves it as it was and shows as
  `recheck.lastErrorCode`.
