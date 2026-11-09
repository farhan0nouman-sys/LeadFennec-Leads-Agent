# Lead qualification API

Task 10C (`docs/decisions.md` D-10C-01 to D-10C-06). A campaign's leads are the people on its lead
list. For each one, the API shows three things apart: fit (the score and why), eligibility
(whether the campaign may email them now) and qualification (the decision).

| Route | Permission | What it does |
|---|---|---|
| `GET /workspaces/:workspaceId/campaigns/:campaignId/leads` | `campaigns.read` (and `contacts.read`, `scores.read`) | The lead list, a page at a time (`limit`, `cursor`): each person with their current score and qualification. `leadListId: null` when the campaign has no list. |
| `GET /workspaces/:workspaceId/campaigns/:campaignId/leads/:contactId` | `campaigns.read` (and `contacts.read`, `scores.read`) | One lead: `fit`, `eligibility`, `qualification`, `history`, `sendPermitted`, `readyToContact`, `pending`. |
| `POST …/leads/:contactId/qualify` | `research.run` | `{}`: queues a qualification run (`202 { "state": "queued" }`), or answers with the one already queued (`"running"`). Audited. |
| `POST …/leads/:contactId/decisions` | `campaigns.write` | A person's decision (`201`, the lead as it now stands). Audited. |

## Fit

`fit` is the current lead score:
- its value, band (High Priority 80–100, Review 60–79, Low Priority 0–59) and the band of the score
  alone;
- the calculation and rule versions, and the agent's run (prompt, model, outcome, review items);
- every factor with its weight, rating (0–4, or missing and why), points, who rated it (rules, the
  qualification agent or a person), its explanation and its evidence.

Evidence is shown as it was read: a company or person field and its value, a research fact with
its page excerpt, URL and date, or an email check. Explanations from the model and every
excerpt are untrusted text.

## Eligibility

`eligibility` is decided when the lead is read, without the score (task 10B,
`docs/api/send-policy.md`). Its checks say pass, review (a person may decide) or blocked (nobody
may send).

## Qualification

States: `QUALIFIED`, `REVIEW`, `REJECTED`. Each decision has at least one reason (`code`,
`message`, `details`). The rules decide after every run; a person may decide too:

```json
{ "version": 3, "state": "QUALIFIED", "note": "Asked for a demo.", "acceptReview": true }
```

- `version` is the current decision's version (0 when there is none); otherwise `409
  version_conflict`.
- `note` is required. It is kept with the decision and is not copied into the audit record.
- A person whose own eligibility is blocked can't be qualified: `409 qualification_blocked`, one
  issue per blocking reason (`path: "eligibility"`, `message`: the reason code).
- `acceptReview` (only with `QUALIFIED`, and only with `drafts.approve`) accepts the eligibility
  reasons that need a person, as they are now. A block can never be accepted.

## What may be sent

- `sendPermitted`: eligibility is `eligible`, or it is `review` and a person's current
  `QUALIFIED` decision accepted every current review reason. A new review reason needs a person
  again; a block is never permitted.
- `readyToContact`: sending is permitted and the lead is qualified.
