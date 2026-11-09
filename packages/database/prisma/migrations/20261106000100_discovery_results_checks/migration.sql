-- Discovery results (task 07C, docs/decisions.md D-07C-*). Hand-written: Prisma does not model
-- CHECK constraints.

ALTER TABLE "source_records"
  -- Outcomes belong to records of an import or a search. A saved record points at its
  -- organization; an excluded or failed one points at nothing and says why.
  ADD CONSTRAINT "source_records_outcome_check" CHECK (
    "outcome" IS NULL
    OR ("import_id" IS NOT NULL AND (
      ("outcome" IN ('CREATED', 'MATCHED') AND "organization_id" IS NOT NULL AND "issues" IS NULL)
      OR ("outcome" IN ('EXCLUDED', 'FAILED') AND "organization_id" IS NULL AND "contact_id" IS NULL
          AND "issues" IS NOT NULL)
    ))
  ),
  -- Issues: a short JSON array of { field, message }.
  ADD CONSTRAINT "source_records_issues_check" CHECK (
    "issues" IS NULL
    OR ("outcome" IS NOT NULL AND jsonb_typeof("issues") = 'array'
        AND jsonb_array_length("issues") BETWEEN 1 AND 20
        AND octet_length("issues"::text) <= 8192)
  );

ALTER TABLE "imports"
  -- Only searches resume from a provider token.
  ADD CONSTRAINT "imports_cursor_check" CHECK (
    "cursor" IS NULL OR ("source" = 'ORGANIZATION_SEARCH' AND char_length("cursor") BETWEEN 1 AND 500)
  ),
  ADD CONSTRAINT "imports_pages_fetched_check" CHECK ("pages_fetched" BETWEEN 0 AND 1000);

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_name_key_check" CHECK (
    "name_key" IS NULL OR char_length("name_key") BETWEEN 1 AND 300
  );
