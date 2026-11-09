-- Contact enrichment (task 08C, docs/decisions.md D-08C-*). Hand-written: Prisma does not model
-- CHECK constraints or triggers. The enum value comes from the previous migration (a new enum
-- value can't be used in the transaction that adds it).

ALTER TABLE "imports"
  -- An enrichment run is made from an ICP like a search: its targets, provider, company limit,
  -- input hash and inputs are present exactly for these two kinds of run.
  DROP CONSTRAINT "imports_search_check",
  ADD CONSTRAINT "imports_search_check" CHECK (
    ("source" IN ('ORGANIZATION_SEARCH', 'CONTACT_ENRICHMENT')) = ("icp_id" IS NOT NULL)
    AND ("source" IN ('ORGANIZATION_SEARCH', 'CONTACT_ENRICHMENT')) = ("search_provider" IS NOT NULL)
    AND ("source" IN ('ORGANIZATION_SEARCH', 'CONTACT_ENRICHMENT')) = ("search_filters" IS NOT NULL)
    AND ("source" IN ('ORGANIZATION_SEARCH', 'CONTACT_ENRICHMENT')) = ("result_limit" IS NOT NULL)
    AND ("source" IN ('ORGANIZATION_SEARCH', 'CONTACT_ENRICHMENT')) = ("query_sha256" IS NOT NULL)
    AND ("source" IN ('ORGANIZATION_SEARCH', 'CONTACT_ENRICHMENT')) = ("source_metadata" IS NOT NULL)
  ),
  -- Bounded: at most 25 companies a run, and the companies done never exceed them.
  ADD CONSTRAINT "imports_enrichment_check" CHECK (
    "source" <> 'CONTACT_ENRICHMENT'
    OR ("result_limit" BETWEEN 1 AND 25 AND "pages_fetched" <= "result_limit" AND "file_name" IS NULL)
  );

-- Where a run sends its contacts never changes after it was requested.
CREATE TRIGGER "imports_destination_immutable" BEFORE UPDATE ON "imports" FOR EACH ROW
  EXECUTE FUNCTION "forbid_column_changes"('lead_list_id');

ALTER TABLE "source_records"
  -- A saved company or person points at what it saved; a person's record may also say why they
  -- can't be emailed. An excluded or failed record points at no contact and says why (a
  -- person's still names the company it was found at).
  DROP CONSTRAINT "source_records_outcome_check",
  ADD CONSTRAINT "source_records_outcome_check" CHECK (
    "outcome" IS NULL
    OR ("import_id" IS NOT NULL AND (
      ("outcome" IN ('CREATED', 'MATCHED') AND "organization_id" IS NOT NULL
          AND ("issues" IS NULL OR "contact_id" IS NOT NULL))
      OR ("outcome" IN ('EXCLUDED', 'FAILED') AND "contact_id" IS NULL AND "issues" IS NOT NULL)
    ))
  ),
  -- Role-match confidence of a person found by enrichment, 0–100.
  ADD CONSTRAINT "source_records_confidence_check" CHECK (
    "confidence" IS NULL OR ("confidence" BETWEEN 0 AND 100 AND "outcome" IS NOT NULL)
  );

ALTER TABLE "contacts"
  ADD CONSTRAINT "contacts_name_key_check" CHECK (
    "name_key" IS NULL OR char_length("name_key") BETWEEN 1 AND 300
  );

ALTER TABLE "verifications"
  ADD CONSTRAINT "verifications_reason_check" CHECK ("reason" ~ '^[a-z][a-z0-9_]{0,63}$');
