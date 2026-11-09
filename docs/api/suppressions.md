# Do-not-contact list and deletion requests API

Task 11C (`docs/decisions.md` D-11C-03 and D-11C-04, `docs/security/data-retention.md`).

| Route | Permission | What it does |
|---|---|---|
| `GET /workspaces/:workspaceId/suppressions` | `suppressions.manage` | The list, newest first (`limit`, `cursor`, `q`: part of an address or domain, `kind`: `email` or `domain`). |
| `POST /workspaces/:workspaceId/suppressions` | `suppressions.manage` | Adds `{ kind, value, reason?, note? }`. Answers `{ suppression, created, reopenedLeads }`. |
| `DELETE /workspaces/:workspaceId/suppressions/:suppressionId` | `suppressions.manage` | Removes an entry a member added by hand (`204`). |
| `POST /workspaces/:workspaceId/suppressions/deletion-requests` | `suppressions.manage` and `contacts.write` | Erases a person by address: `{ email }`. |
| `POST /workspaces/:workspaceId/leads/:contactId/suppress` | `suppressions.manage` | Puts the lead's own address on the list: `{ reason, note? }`. Answers the lead's detail. |
| `POST /workspaces/:workspaceId/leads/:contactId/deletion-request` | `suppressions.manage` and `contacts.write` | Erases the lead at `{ version }` (`409 version_conflict` when stale). |

## Entries

- **What is kept:** an address or a domain, normalized. A domain covers its subdomains. Each
  entry keeps its reason, its source, when it was added, and an optional member's note (at most
  500 characters).
- **Reasons a member gives:** `MANUAL` (default), `OPT_OUT`, `COMPLAINT`. `HARD_BOUNCE` comes
  from providers, and `DELETION_REQUEST` from deletion requests.
- **Repeating** an address or a domain changes nothing (`created: false`).
- **Removal:** only entries with reason `MANUAL` and source `MANUAL` can be removed; the rest
  stay (`409 suppression_not_removable`). Removing one doesn't reopen anything by itself.
- **A lead without an address** can't be put on the list (`409 no_address`).
- **Reopened leads:** a new entry reopens the leads it covers, in the same transaction (at most
  1,000):
  - their drafts are invalidated;
  - their scheduled sends are cancelled;
  - their decisions go back to Review, with eligibility decided again (blocked).

  Sending checks the list again before every attempt anyway. A lead's detail says
  `doNotContact`.

## Deletion requests

- **Deleted:** the person and everything about them, by the foreign keys' cascades: sources,
  evidence, research about them, address checks, scores, decisions, campaign leads with their
  drafts, approvals, sends, threads and replies, list memberships, notes and tags. Also deleted:
  the import and search records that name the address without being the person's own.
- **Kept:** the address only, on the list with reason `DELETION_REQUEST` and no note. An earlier
  entry for the address keeps its reason and loses its note. So the person is never imported or
  contacted again.
- **By address**, it works for someone the workspace never saved too: only the address is kept.
- **Answer:** `{ suppressionId, deleted: { contacts, sourceRecords } }`. `suppressionId` is null
  for a lead without an address.

Changes are audited with kinds, reasons and counts, never an address, a domain or a note.
