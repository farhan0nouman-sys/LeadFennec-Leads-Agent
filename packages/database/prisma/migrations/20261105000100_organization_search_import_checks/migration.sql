-- Organization searches as imports (task 07A, docs/decisions.md D-07A-*). Hand-written: Prisma
-- does not model CHECK constraints or triggers. The enum values come from the previous
-- migration (a new enum value can't be used in the transaction that adds it).

ALTER TABLE "imports"
  -- The search fields are present exactly for organization searches.
  ADD CONSTRAINT "imports_search_check" CHECK (
    ("source" = 'ORGANIZATION_SEARCH') = ("icp_id" IS NOT NULL)
    AND ("source" = 'ORGANIZATION_SEARCH') = ("search_provider" IS NOT NULL)
    AND ("source" = 'ORGANIZATION_SEARCH') = ("search_filters" IS NOT NULL)
    AND ("source" = 'ORGANIZATION_SEARCH') = ("result_limit" IS NOT NULL)
    AND ("source" = 'ORGANIZATION_SEARCH') = ("query_sha256" IS NOT NULL)
    AND ("source" = 'ORGANIZATION_SEARCH') = ("source_metadata" IS NOT NULL)
  ),
  ADD CONSTRAINT "imports_search_provider_check" CHECK ("search_provider" IN ('FAKE', 'APOLLO')),
  ADD CONSTRAINT "imports_result_limit_check" CHECK ("result_limit" BETWEEN 1 AND 1000),
  ADD CONSTRAINT "imports_query_sha256_check" CHECK ("is_sha256_hex"("query_sha256")),
  ADD CONSTRAINT "imports_search_json_check" CHECK (
    ("search_filters" IS NULL OR (jsonb_typeof("search_filters") = 'object'
      AND octet_length("search_filters"::text) <= 16384))
    AND ("source_metadata" IS NULL OR (jsonb_typeof("source_metadata") = 'object'
      AND octet_length("source_metadata"::text) <= 16384))
  ),
  ADD CONSTRAINT "imports_error_code_check" CHECK ("error_code" ~ '^[a-z][a-z0-9_]{0,63}$');

-- What a search asked for, and where from, never changes after it was requested: its results
-- are attributed to exactly these inputs.
CREATE TRIGGER "imports_search_immutable" BEFORE UPDATE ON "imports" FOR EACH ROW
  EXECUTE FUNCTION "forbid_column_changes"('source', 'icp_id', 'search_provider', 'search_filters', 'result_limit', 'query_sha256', 'source_metadata');
