# Send policy API

Task 10B (`docs/decisions.md` D-10B-01 to D-10B-05). The send policy says which recipients'
countries and which data sources a workspace's campaigns may email. It is one input of send
eligibility, which is decided by rules, separately from a lead's score.

| Route | Permission | What it does |
|---|---|---|
| `GET /workspaces/:workspaceId/settings/send-policy` | `settings.manage` | `{ "version": n, "policy": { … } \| null }`. `null` (version 0) until the policy is first set. |
| `PATCH /workspaces/:workspaceId/settings/send-policy` | `settings.manage` | `{ "version": n, "policy": { … } \| null }`: replaces the whole policy, or clears it with `null`. `200` and the new state; audited. |

## The policy

```json
{
  "version": 3,
  "policy": {
    "regions": {
      "countries": { "US": "ALLOW", "GB": "REVIEW", "RU": "BLOCK" },
      "otherCountries": "REVIEW"
    },
    "sources": { "APOLLO": "ALLOW", "CSV_IMPORT": "ALLOW", "MANUAL": "REVIEW" }
  }
}
```

- **Countries:** ISO 3166-1 alpha-2 codes in capitals (at most 250), each `ALLOW`, `REVIEW` (a
  person must decide) or `BLOCK`. The recipient's own country decides; a company country that is
  blocked also blocks.
- **`otherCountries`:** what happens to recipients in a country not named, or whose country isn't
  known: `REVIEW` or `BLOCK`. It can't be `ALLOW`, so a country is allowed only by naming it.
- **Sources:** `APOLLO`, `CSV_IMPORT`, `MANUAL`, `WEBSITE`, `FAKE`, each `ALLOW`, `REVIEW` or
  `BLOCK`. A source that isn't named needs a person. A person with several sources gets the
  strictest answer.
- **No policy:** every lead needs a person (`source_policy_unknown`, `region_policy_unknown`).
- Unknown settings are refused by name (`400 validation_failed`).

## Saving

`version` is the version you loaded. If the policy changed since, nothing is saved and the answer
is `409 version_conflict`: load it again and reapply your change. Each save writes the audit
record `send_policy.updated` with the new version, whether a policy is set, the number of
countries and the source names.

## Send eligibility (no route yet)

`scope.eligibility.evaluate(campaignId, contactId)` answers `{ fit, eligibility, sendPermitted,
needsPerson }`:
- `fit` is the lead's current score, reported only;
- `eligibility` is `eligible`, `review` or `blocked`, with every check (workspace sending,
  campaign, mailbox, person, do-not-contact list, campaign exclusions, email check, data source,
  region) and its reason codes;
- `sendPermitted` is true only when eligibility is `eligible`, whatever the score.

Task 10C shows it in the app.
