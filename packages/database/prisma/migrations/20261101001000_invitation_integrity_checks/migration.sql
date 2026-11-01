-- Integrity rules for invitations (task 04B, docs/decisions.md D-04B-*). Hand-written; Prisma
-- does not model CHECK constraints or triggers, so it neither generates nor drops them.

ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_email_check" CHECK (char_length("email") BETWEEN 3 AND 254),
  ADD CONSTRAINT "invitations_normalized_email_check" CHECK ("is_normalized_email"("normalized_email")),
  ADD CONSTRAINT "invitations_token_hash_check" CHECK ("is_sha256_hex"("token_hash")),
  -- Open, accepted or revoked, never both; an accepted invitation names its membership.
  ADD CONSTRAINT "invitations_state_check" CHECK (
    num_nonnulls("accepted_at", "revoked_at") <= 1
    AND ("accepted_at" IS NULL) = ("accepted_membership_id" IS NULL)
  ),
  -- Accepted only before it expires.
  ADD CONSTRAINT "invitations_timing_check" CHECK (
    "expires_at" > "created_at"
    AND "accepted_at" BETWEEN "created_at" AND "expires_at"
    AND "revoked_at" >= "created_at"
  );

-- The binding never changes: workspace (tenant_id, by its own trigger), address, role, inviter,
-- token and validity. Only acceptance and revocation are recorded later.
CREATE TRIGGER "invitations_binding_immutable" BEFORE UPDATE ON "invitations" FOR EACH ROW
  EXECUTE FUNCTION "forbid_column_changes"('id', 'email', 'normalized_email', 'role_id', 'invited_by_membership_id', 'token_hash', 'expires_at', 'created_at');

CREATE TRIGGER "invitations_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "invitations" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
