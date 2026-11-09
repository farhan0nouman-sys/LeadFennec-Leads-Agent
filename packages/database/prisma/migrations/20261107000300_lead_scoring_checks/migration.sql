-- Task 10A (docs/decisions.md D-10A-*): lead scores. Hand-written: rules Prisma can't express.
-- The application validates the same rules first (shared lead-scoring contract); these keep any
-- other writer within them.

-- A campaign's scoring configuration is one small JSON object (NULL: the defaults).
ALTER TABLE "campaigns"
  ADD CONSTRAINT "campaigns_scoring_check" CHECK (
    "scoring" IS NULL
    OR (jsonb_typeof("scoring") = 'object' AND octet_length("scoring"::text) <= 4096)
  );

ALTER TABLE "scores"
  -- A score is against an ICP, a campaign, or both.
  ADD CONSTRAINT "scores_target_check" CHECK (num_nonnulls("icp_id", "campaign_id") >= 1),
  -- A lead score has every part or none: its inputs and their hash, its band, its number, the
  -- campaign and the campaign version it was calculated from, and the person scored.
  ADD CONSTRAINT "scores_lead_score_check" CHECK (
    ("inputs" IS NULL AND "input_sha256" IS NULL AND "band" IS NULL AND "version" IS NULL
      AND "campaign_version" IS NULL AND "campaign_id" IS NULL AND "verification_id" IS NULL)
    OR ("inputs" IS NOT NULL AND "input_sha256" IS NOT NULL AND "band" IS NOT NULL
      AND "version" >= 1 AND "campaign_id" IS NOT NULL AND "campaign_version" >= 1
      AND "contact_id" IS NOT NULL)
  ),
  ADD CONSTRAINT "scores_inputs_check" CHECK (
    "inputs" IS NULL
    OR (jsonb_typeof("inputs") = 'object' AND octet_length("inputs"::text) <= 65536)
  ),
  ADD CONSTRAINT "scores_input_sha256_check" CHECK (
    "input_sha256" IS NULL OR "is_sha256_hex"("input_sha256")
  ),
  -- The band follows the value (High Priority 80-100, Low Priority 0-59), except that the
  -- missing-data policy may send any lead to Review.
  ADD CONSTRAINT "scores_band_check" CHECK (
    "band" IS NULL
    OR "band" = 'REVIEW'
    OR ("band" = 'HIGH_PRIORITY' AND "value" >= 80)
    OR ("band" = 'LOW_PRIORITY' AND "value" <= 59)
  ),
  ADD CONSTRAINT "scores_method_version_check" CHECK (
    "method_version" IS NULL OR "method_version" ~ '^[a-z0-9./-]{1,100}$'
  ),
  ADD CONSTRAINT "scores_reason_length_check" CHECK (char_length("reason") <= 4000);

-- A score never changes: a new calculation is a new row (version + 1), so what a score says can
-- always be checked against what it was calculated from.
CREATE TRIGGER "scores_immutable" BEFORE UPDATE ON "scores" FOR EACH ROW
  EXECUTE FUNCTION "forbid_column_changes"('id', 'icp_id', 'contact_id', 'organization_id', 'research_id', 'value', 'reason', 'method', 'method_version', 'scored_at', 'created_at', 'campaign_id', 'campaign_version', 'verification_id', 'version', 'band', 'inputs', 'input_sha256');

-- ─── score_evidence ──────────────────────────────────────────────────────────

CREATE TRIGGER "score_evidence_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "score_evidence"
  FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();

CREATE TRIGGER "score_evidence_immutable" BEFORE UPDATE ON "score_evidence" FOR EACH ROW
  EXECUTE FUNCTION "forbid_column_changes"('score_id', 'evidence_id', 'created_at');
