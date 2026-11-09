# Lead exports API

Task 11C (`docs/decisions.md` D-11C-02, `docs/security/data-retention.md`). A CSV file of the
leads a search finds, made on request for one member, downloadable only by that member until it
expires.

| Route | Permission | What it does |
|---|---|---|
| `POST /workspaces/:workspaceId/exports` | `contacts.export` | Makes the file (`201`). Body: `{ filters }`, the lead search's parameters (`docs/api/leads.md`) without `cursor` and `limit`. |
| `GET /workspaces/:workspaceId/exports` | `contacts.read` and `contacts.export` | The member's own files, newest first (`limit`, `cursor`). |
| `GET /workspaces/:workspaceId/exports/:exportId/download` | `contacts.read` and `contacts.export` | The file itself. |

`contacts.export` is a Client Admin permission. The reads sit in the Leads section, so their
route guard asks for `contacts.read`; the API checks `contacts.export`, and the requester's own
membership, on every route.

## The file

- **Rows:** the leads the search finds, from the first one, read page by page through the lead
  search, so its own checks apply (score filters need `scores.read`, campaign filters
  `campaigns.read`).
- **Limits:** at most 2,000 leads and 4 MB. More matches are cut, and `truncated` is true.
- **Format:** UTF-8 with a byte-order mark, CRLF line ends, then a header row:

  `Lead ID, Name, Title, Email, Address check, Address checked at, Company, Company domain,
  Industry, Country, Score, Score band, Qualification, Eligibility, Sources, Created, Last activity`

- **Formulas:** every cell goes through `toCsv`. A cell a spreadsheet would run as a formula
  (`=`, `+`, `-`, `@`, a tab or a carriage return, also after spaces) gets a leading apostrophe.
  Names and titles from imports and providers stay text.

## Downloading

- **Answer:** `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="leads-….csv"`
  (a name the server makes), `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`.
- **Who:** only the member who made it, while they keep `contacts.export`. Another member's file
  is `404`.
- **How:** the web app links to `/api/workspaces/…/exports/…/download`. The browser sends the
  session cookie through the web origin's proxy; the address holds ids only, never a token.

## Expiry

- A file can be downloaded for 24 hours (`expiresAt`). After that it is `410 export_expired`, and
  its content is deleted: by that download, before every new export, and by the worker's sweep
  every 15 minutes.
- What was exported stays: the search, the counts and the content's hash.
- A member may have at most 10 files waiting (`409 export_limit_reached`).

Exports and downloads are audited with counts only, never the search text or a lead's data.
