-- Task 10C (docs/decisions.md D-10C-*): lead qualification decisions. Hand-written: rules Prisma
-- can't express. The application validates the same rules first (shared lead-qualification
-- contract); these keep any other writer within them.

ALTER TABLE "lead_qualifications"
  ADD CONSTRAINT "lead_qualifications_version_check" CHECK ("version" >= 1),
  ADD CONSTRAINT "lead_qualifications_eligibility_status_check" CHECK (
    "eligibility_status" IN ('eligible', 'review', 'blocked')
  ),
  -- Every decision is explained: a non-empty array of reasons.
  ADD CONSTRAINT "lead_qualifications_reasons_check" CHECK (
    jsonb_typeof("reasons") = 'array'
    AND jsonb_array_length("reasons") BETWEEN 1 AND 10
    AND octet_length("reasons"::text) <= 16384
  ),
  ADD CONSTRAINT "lead_qualifications_accepted_review_reasons_check" CHECK (
    "accepted_review_reasons" IS NOT NULL AND cardinality("accepted_review_reasons") <= 30
  ),
  -- A person's decision names the member and says why; an automatic one has neither, and
  -- accepts nothing.
  ADD CONSTRAINT "lead_qualifications_origin_check" CHECK (
    ("origin" = 'PERSON' AND "decided_by_membership_id" IS NOT NULL
      AND "note" IS NOT NULL AND char_length(btrim("note")) BETWEEN 1 AND 1000)
    OR ("origin" = 'AUTOMATIC' AND "decided_by_membership_id" IS NULL AND "note" IS NULL
      AND cardinality("accepted_review_reasons") = 0)
  ),
  -- Eligibility review reasons are accepted only by qualifying the lead.
  ADD CONSTRAINT "lead_qualifications_accepted_state_check" CHECK (
    cardinality("accepted_review_reasons") = 0 OR "state" = 'QUALIFIED'
  ),
  -- A lead whose own eligibility is blocked is never qualified, by the rules or by a person.
  ADD CONSTRAINT "lead_qualifications_blocked_check" CHECK (
    "eligibility_status" <> 'blocked' OR "state" <> 'QUALIFIED'
  );

CREATE TRIGGER "lead_qualifications_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "lead_qualifications"
  FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();

-- A decision never changes: a new decision is a new version, so the history is complete.
CREATE TRIGGER "lead_qualifications_immutable" BEFORE UPDATE ON "lead_qualifications" FOR EACH ROW
  EXECUTE FUNCTION "forbid_column_changes"('id', 'campaign_id', 'contact_id', 'version', 'state', 'origin', 'score_id', 'eligibility_status', 'reasons', 'accepted_review_reasons', 'note', 'decided_by_membership_id', 'decided_at');
