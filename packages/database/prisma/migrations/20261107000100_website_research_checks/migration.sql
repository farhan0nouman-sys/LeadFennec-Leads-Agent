-- Task 09C (docs/decisions.md D-09C-02): research versions and their evidence. Hand-written:
-- rules Prisma can't express.

ALTER TABLE "research"
  ADD CONSTRAINT "research_version_hashes_check" CHECK (
    ("input_sha256" IS NULL OR "is_sha256_hex"("input_sha256"))
    AND ("context_sha256" IS NULL OR "is_sha256_hex"("context_sha256"))
    AND ("prompt_sha256" IS NULL OR "is_sha256_hex"("prompt_sha256"))
  ),
  -- A reused or corrected version names the version it continues; nothing continues itself.
  ADD CONSTRAINT "research_based_on_check" CHECK (
    ("origin" IS NULL OR "origin" = 'MODEL' OR "based_on_id" IS NOT NULL)
    AND "based_on_id" IS DISTINCT FROM "id"
  ),
  -- Version numbers count completed versions of 09C, from 1.
  ADD CONSTRAINT "research_version_check" CHECK (
    "version" IS NULL OR ("version" >= 1 AND "status" = 'COMPLETED' AND "origin" IS NOT NULL)
  ),
  -- Only a completed version of 09C has the agent's outcome.
  ADD CONSTRAINT "research_result_status_check" CHECK (
    "result_status" IS NULL OR ("status" = 'COMPLETED' AND "origin" IS NOT NULL)
  ),
  ADD CONSTRAINT "research_model_provider_check" CHECK (
    "model_provider" IS NULL OR "model_provider" IN ('OPENAI', 'FAKE')
  ),
  ADD CONSTRAINT "research_schema_version_check" CHECK (
    "schema_version" IS NULL OR "schema_version" ~ '^[a-z0-9./-]{1,100}$'
  ),
  ADD CONSTRAINT "research_cost_check" CHECK ("cost_micro_usd" IS NULL OR "cost_micro_usd" >= 0),
  ADD CONSTRAINT "research_findings_check" CHECK (
    "findings" IS NULL
    OR (jsonb_typeof("findings") = 'object' AND octet_length("findings"::text) <= 262144)
  ),
  ADD CONSTRAINT "research_error_code_check" CHECK (
    "error_code" IS NULL OR "error_code" ~ '^[a-z][a-z0-9_]{0,63}$'
  );

ALTER TABLE "evidence"
  ADD CONSTRAINT "evidence_extract_label_check" CHECK (
    "extract_label" IS NULL OR "extract_label" ~ '^E[1-9][0-9]?$'
  ),
  ADD CONSTRAINT "evidence_content_sha256_check" CHECK (
    "content_sha256" IS NULL OR "is_sha256_hex"("content_sha256")
  ),
  ADD CONSTRAINT "evidence_excerpt_length_check" CHECK (char_length("excerpt") <= 20000);

-- A completed or failed version never changes: a refresh, a reuse or a correction is a new
-- version that points to it (based_on_id). Pending and running versions still change status.
CREATE FUNCTION "forbid_finished_research_change"() RETURNS trigger
  LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" IN ('COMPLETED', 'FAILED') THEN
    RAISE EXCEPTION 'research % is finished and can''t change; add a new version', OLD."id"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "research_finished_immutable" BEFORE UPDATE ON "research" FOR EACH ROW
  EXECUTE FUNCTION "forbid_finished_research_change"();

-- Evidence is append-only: a capture stays what it was when it was taken.
CREATE TRIGGER "evidence_immutable" BEFORE UPDATE ON "evidence" FOR EACH ROW
  EXECUTE FUNCTION "forbid_column_changes"('id', 'kind', 'contact_id', 'organization_id', 'research_id', 'source_record_id', 'source_url', 'excerpt', 'captured_at', 'created_at', 'extract_label', 'content_sha256');
