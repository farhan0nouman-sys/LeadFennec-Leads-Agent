# Lead search API

Task 11A (`docs/decisions.md` D-11A-01 to D-11A-07). The workspace's people, searched with
allowlisted filters and sorts one page at a time; one person in detail; and the evidence about
them.

| Route | Permission | What it does |
|---|---|---|
| `GET /workspaces/:workspaceId/leads` | `contacts.read` | One page of people matching the filters, in the chosen order. |
| `GET /workspaces/:workspaceId/leads/:contactId` | `contacts.read` | One person in detail. |
| `GET /workspaces/:workspaceId/leads/:contactId/evidence` | `contacts.read` | The evidence about the person and their company, newest first (`limit`, `cursor`, `kind`). |

Score filters, fields and sorting also need `scores.read`. Campaign filters and fields need
`campaigns.read`, and lead lists `lead_lists.read`. Without them, those filters are refused
(`403`) and those fields are left out.

## Searching

Every parameter is optional. A list is one parameter with comma-separated values
(`country=US,DE`). Anything not listed here, and any value outside the lists, is refused:
`400 validation_failed`, with one issue per parameter.

| Parameter | Matches |
|---|---|
| `q` | Name, address, title, company name or domain contains the text (2–100 characters) |
| `company` | The company's name or domain contains the text |
| `contact` | The person's name or address contains the text |
| `title` | The title contains the text |
| `country` | The person's country, else the company's (ISO codes, up to 20) |
| `industry` | The company's industry, any of these (case-insensitive) |
| `source` | Where the person's data came from: `APOLLO`, `CSV_IMPORT`, `MANUAL`, `WEBSITE`, `FAKE` |
| `campaignId` | Only this campaign's leads (on its lead list, or enrolled). Scores and qualifications are then this campaign's. |
| `campaignStatus` | Leads of a campaign in one of these states (`DRAFT`, `ACTIVE`, `PAUSED`, `COMPLETED`, `CANCELLED`) |
| `scoreMin`, `scoreMax`, `band` | The current score (the highest version): the campaign's, else any campaign's |
| `verification` | The newest check of the current address: `verified`, `risky`, `unknown`, `invalid`, `unchecked` (never checked), `no_address` |
| `eligibility` | The eligibility recorded with the newest qualification decision: `eligible`, `review`, `blocked`, `not_qualified` |
| `activeAfter`, `activeBefore` | Last activity at or after / before (ISO date and time) |
| `status` | `ACTIVE` (the default), `ARCHIVED` |
| `sort` | `created` (the default), `activity`, `name` (last name, then first name), `company`, `score` (needs `campaignId`) |
| `order` | `desc` (the default) or `asc` |
| `limit` | 1–100 (25 by default) |
| `cursor` | The previous page's `nextCursor` |

- **Text** is matched literally: `%` and `_` are ordinary characters.
- **Eligibility** here is what was recorded with a decision. It is not permission to send. The
  lead view decides eligibility again from the facts when it is read (`docs/api/qualification.md`).
- **Bounded:** a search that runs longer than 5 seconds is stopped by the database.

### Pages

```json
{
  "items": [
    {
      "id": "…",
      "name": "Ada Lovelace",
      "title": "VP Sales",
      "email": "ada@acme.example",
      "status": "ACTIVE",
      "countryCode": "US",
      "company": { "id": "…", "name": "Acme", "domain": "acme.example", "industry": "Software", "countryCode": "US" },
      "sources": ["APOLLO"],
      "verification": { "status": "verified", "checkedAt": "…" },
      "score": { "campaignId": "…", "value": 90, "band": "HIGH_PRIORITY", "version": 1, "scoredAt": "…" },
      "qualification": { "campaignId": "…", "state": "QUALIFIED", "eligibilityStatus": "eligible", "decidedAt": "…" },
      "createdAt": "…",
      "lastActivityAt": "…"
    }
  ],
  "nextCursor": "…",
  "sort": { "field": "created", "order": "desc" }
}
```

- **Keyset pages:** ordered by the sort key, then the id. People added while you page don't
  repeat or shift earlier people.
- **Cursors:** a cursor works only with the filters, sort and order it came from. With anything
  else, the answer is `400`, `cursor`: "Start again from the first page."
- **No results:** `{ "items": [], "nextCursor": null, … }`.
- **Score without a campaign:** `score` is the highest current score in any campaign.
- **Last activity:** the newest of the person's creation, data retrieved about them, a check of
  their address, a score, a qualification decision, and an enrollment or its change.

## One lead

The detail has:
- the person and their company;
- `quality`: the contact's data quality (`docs/api/enrichment.md`);
- `sources`: the newest 20 records the person came from;
- `verifications`: the newest 20 checks of their addresses;
- `campaigns`: the campaigns they are a lead of, at most 50. Each says whether the person is on
  the campaign's lead list, their enrollment, and their current score and newest qualification
  there;
- `leadLists`: the lead lists they are on, at most 50;
- `truncated`: which lists were cut.

`404` for a person of another workspace, or a malformed id.

## Evidence

The person's own evidence (`about: "person"`), and their company's evidence that isn't about
another person (`about: "company"`), newest first.
- **Kinds:** `WEBSITE_EXCERPT`, `PROVIDER_FIELD`, `AI_EXTRACTION`, `MANUAL_NOTE`.
- **Untrusted text:** excerpts are page text, provider fields or notes. Escape them when showing
  them.

## Changes (task 11B)

| Route | Permission | What it does |
|---|---|---|
| `PATCH /workspaces/:workspaceId/leads/:contactId` | `contacts.write` | Corrects the data: `{ version, changes, reason }`. Audited without the values. |
| `PATCH …/leads/:contactId/tags` | `contacts.write` | Replaces the tags: `{ version, tags }` (at most 20). Audited. |
| `POST …/leads/:contactId/notes` | `contacts.write` | Adds a note: `{ body }` (`201`). Notes never change. Audited without the text. |
| `POST …/leads/:contactId/campaigns` | `campaigns.write` | Adds the lead to a campaign's lead list: `{ version, campaignId }`. Audited. |

Each answers with the lead's detail as it now stands.

- **Versions:** every change but a note names the lead's `version`. A stale one is
  `409 version_conflict`, and nothing changes.
- **Corrections:**
  - `changes` may hold `firstName`, `lastName`, `title`, `email`, `countryCode` and
    `linkedinUrl`; null clears a field;
  - another lead's address is `409 email_taken`;
  - a lead left without an address, a profile or a company domain is `400`;
  - the reason is kept as a note.
- **Material corrections** (name, title, address, country):
  - the lead's live drafts become `INVALIDATED`, and their scheduled sends are cancelled;
  - every campaign's decision goes back to Review, with eligibility decided again.

  A correction of the company's research (09C) does the same for its people.
- **Assignment** is refused with `409 assignment_not_possible`, one issue per reason:
  - another workspace's campaign ("Not found in this workspace.");
  - a campaign that has ended or has no lead list;
  - a lead who is archived, on the do-not-contact list or excluded by the campaign.

Approving or rejecting a lead in a campaign is the qualification decision
(`docs/api/qualification.md`).
