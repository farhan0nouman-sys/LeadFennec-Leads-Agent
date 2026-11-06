# Apollo contract fixtures (synthetic)

Task 07B, `docs/decisions.md` D-07B-06. These files imitate the shapes in Apollo's official
documentation, checked 2026-11-06:

- [Organization search](https://docs.apollo.io/reference/organization-search): the 200
  response (its documented top-level keys and organization fields), the 401 text, the 403
  message and the 429 rate-limit error.
- [Rate limits](https://docs.apollo.io/reference/rate-limits) and
  [status codes](https://docs.apollo.io/reference/status-codes): `error_details` with `code`,
  `suggestions` and `context.window`.

Every company, id, domain, phone number and link is invented (`.example` domains, `555`
numbers). Nothing was captured from a real account, and no file holds a key, a token or
anyone's personal data. Messages marked "Synthetic" are ours, not Apollo's.

| File                              | Stands for                                                                                                                 |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `organization-search-page-1.json` | Page 1 of 2 (`per_page` 2, 3 matches): one complete record with the documented extras (phone, links), one without a domain |
| `organization-search-page-2.json` | The last page: one record with an upper-case domain                                                                        |
| `organization-search-empty.json`  | No matches                                                                                                                 |
| `error-401.txt`                   | Invalid API key (documented plain-text body)                                                                               |
| `error-403.json`                  | Plan without API access (documented message, legacy fields)                                                                |
| `error-429-minute.json`           | The team's per-minute limit (`API_RATE_LIMIT_EXCEEDED`, window `minute`)                                                   |
| `error-429-day.json`              | The team's daily limit (window `day`)                                                                                      |
| `error-429-platform.json`         | Platform load (`PLATFORM_RATE_LIMIT`, `retry_after_seconds` 60)                                                            |
