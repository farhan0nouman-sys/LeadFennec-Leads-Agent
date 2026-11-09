# Data retention: suppressions, deletion requests, exports and imports

Task 11C (`docs/decisions.md` D-11C-01 to D-11C-04). This policy was written without the
missing build plan (O-01): its periods are open choices (O-45) to confirm with the plan, or with
legal advice, before production.

## Principles

- **Keep only what honors the request.** A person who asked not to be contacted, or to be erased,
  is kept as their normalized address on the do-not-contact list, and nothing more.
- **Files that leave the app expire.** A lead export can be downloaded for 24 hours, by the
  member who made it; then its content is deleted.
- **Audit records never hold personal data:** no addresses, names, notes or search text. They
  hold counts, kinds, reasons and record ids.

## What is kept, and for how long

| Data | Kept | Deleted |
|---|---|---|
| Do-not-contact entry: the normalized address or domain, the reason, the source, when | For as long as the workspace exists. It is what stops the person from being contacted or imported again. | With the workspace. A member can remove only an entry a member added by hand (reason and source MANUAL). |
| A member's note on an entry | With the entry | When the entry is removed, or when the person asks to be erased (the note is cleared). An entry made by a deletion request never has one (a database CHECK). |
| A lead and everything about them: sources, evidence, research about the person, address checks, scores, decisions, campaign leads, drafts, approvals, sends, threads, replies, list memberships, notes, tags | Until the person asks to be erased, or the workspace is deleted | By a deletion request, in one transaction (the foreign keys cascade) |
| Import and search records that name an address without being the person's own (excluded or failed rows) | With their import | By a deletion request for that address |
| A people file's rows | Only the mapped columns, one source record per row. Unmapped columns are never stored. | Rows not yet imported are deleted when the import is cancelled. |
| A lead export's content | 24 hours after it was made | At expiry: by the download that finds it expired, before every new export, and by the worker's sweep every 15 minutes. The export's record (search, counts, hash) stays, without content. |
| Audit records | Append-only, with the workspace | With the workspace |

## Deletion requests

A member with `suppressions.manage` and `contacts.write` erases a person:
- from their lead profile ("Erase this lead's data"), at the version the member saw; or
- by address on the do-not-contact page ("Erase a person on request"), also when the workspace
  never saved them.

The address stays on the list with reason DELETION_REQUEST, and the audit record holds the
counts only.

## Known gaps (O-45)

- **A person without an address** can be erased, but nothing can be kept to recognize them, so a
  later import or people search could find them again. The list holds addresses and domains only.
- **Raw provider notifications** (`inbound_events`) and outbox events aren't searched by a
  deletion request. No inbound processing exists yet.
- **Backups and logs** follow the hosting provider's retention (not chosen yet, O-06). Request
  logs leave out query strings (D-11C-07), and nothing logs an address deliberately; redaction is
  a safety net.
