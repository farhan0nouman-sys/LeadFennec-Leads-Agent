-- Integrity rules the Prisma schema cannot express (task 03A, docs/decisions.md D-03A-*).
-- Hand-written; Prisma does not model CHECK constraints, functions or triggers, so it
-- neither generates nor drops them.

-- ─── Identity normalization ──────────────────────────────────────────────────
-- Mirrors normalizeDomain / normalizeEmail in @lead-fennec-ai/shared (identity.ts).
-- STRICT: NULL input returns NULL, which a CHECK constraint accepts (nullable columns).

CREATE FUNCTION "is_normalized_domain"(value text) RETURNS boolean
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  RETURN value ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})$'
    AND length(value) <= 253
    AND value NOT LIKE 'www.%';

CREATE FUNCTION "is_normalized_email"(value text) RETURNS boolean
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  RETURN value ~ '^[a-z0-9!#$%&''*+/=?^_`{|}~-]+(\.[a-z0-9!#$%&''*+/=?^_`{|}~-]+)*@([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,63}|xn--[a-z0-9-]{1,59})$'
    AND length(split_part(value, '@', 1)) <= 64
    AND length(split_part(value, '@', 2)) <= 253;

ALTER TABLE "users"
  ADD CONSTRAINT "users_normalized_email_check" CHECK ("is_normalized_email"("normalized_email"));

ALTER TABLE "organizations"
  ADD CONSTRAINT "organizations_normalized_domain_check" CHECK ("is_normalized_domain"("normalized_domain")),
  ADD CONSTRAINT "organizations_country_code_check" CHECK ("country_code" ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT "organizations_employee_count_check" CHECK ("employee_count" >= 0);

ALTER TABLE "contacts"
  ADD CONSTRAINT "contacts_normalized_email_check" CHECK ("is_normalized_email"("normalized_email")),
  -- email (display), normalized_email (identity) and email_domain are all set or all NULL,
  -- and email_domain is exactly the domain part of normalized_email.
  ADD CONSTRAINT "contacts_email_identity_check" CHECK (
    ("email" IS NULL AND "normalized_email" IS NULL AND "email_domain" IS NULL)
    OR ("email" IS NOT NULL AND "normalized_email" IS NOT NULL
        AND "email_domain" = split_part("normalized_email", '@', 2))
  ),
  ADD CONSTRAINT "contacts_country_code_check" CHECK ("country_code" ~ '^[A-Z]{2}$');

ALTER TABLE "verifications"
  ADD CONSTRAINT "verifications_normalized_email_check" CHECK ("is_normalized_email"("normalized_email")),
  ADD CONSTRAINT "verifications_provider_check" CHECK ("provider" ~ '^[a-z][a-z0-9_-]{0,62}$'),
  ADD CONSTRAINT "verifications_expiry_check" CHECK ("expires_at" IS NULL OR "expires_at" > "checked_at");

-- ─── Keys and value ranges ───────────────────────────────────────────────────

ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_slug_check" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length("slug") <= 63);

ALTER TABLE "permissions"
  ADD CONSTRAINT "permissions_key_check" CHECK ("key" ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$');

ALTER TABLE "roles"
  ADD CONSTRAINT "roles_key_check" CHECK ("key" ~ '^[a-z][a-z0-9_]{1,62}$');

ALTER TABLE "imports"
  ADD CONSTRAINT "imports_row_counts_check" CHECK (
    "total_rows" >= 0 AND "imported_rows" >= 0 AND "skipped_rows" >= 0 AND "failed_rows" >= 0
    AND "imported_rows" + "skipped_rows" + "failed_rows" <= "total_rows"
  ),
  ADD CONSTRAINT "imports_timing_check" CHECK ("completed_at" IS NULL OR "started_at" IS NULL OR "completed_at" >= "started_at");

ALTER TABLE "source_records"
  -- An import row number exists exactly when the record came from an import.
  ADD CONSTRAINT "source_records_import_row_check" CHECK (
    ("import_id" IS NULL) = ("import_row_number" IS NULL)
    AND ("import_row_number" IS NULL OR "import_row_number" > 0)
  ),
  ADD CONSTRAINT "source_records_payload_sha256_check" CHECK ("payload_sha256" ~ '^[0-9a-f]{64}$');

ALTER TABLE "research"
  ADD CONSTRAINT "research_subject_check" CHECK (num_nonnulls("contact_id", "organization_id") >= 1),
  ADD CONSTRAINT "research_tokens_check" CHECK (
    ("input_tokens" IS NULL OR "input_tokens" >= 0) AND ("output_tokens" IS NULL OR "output_tokens" >= 0)
  ),
  ADD CONSTRAINT "research_timing_check" CHECK ("completed_at" IS NULL OR "started_at" IS NULL OR "completed_at" >= "started_at");

ALTER TABLE "evidence"
  ADD CONSTRAINT "evidence_subject_check" CHECK (num_nonnulls("contact_id", "organization_id") >= 1);

ALTER TABLE "scores"
  ADD CONSTRAINT "scores_value_check" CHECK ("value" BETWEEN 0 AND 100),
  -- A score is about exactly one contact or one organization.
  ADD CONSTRAINT "scores_subject_check" CHECK (num_nonnulls("contact_id", "organization_id") = 1);

-- ─── tenant_id is immutable ──────────────────────────────────────────────────
-- Composite foreign keys stop cross-tenant links; this stops a row from being moved to
-- another tenant (which would also carry references along with it).

CREATE FUNCTION "forbid_tenant_id_change"() RETURNS trigger
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."tenant_id" IS DISTINCT FROM OLD."tenant_id" THEN
    RAISE EXCEPTION 'tenant_id is immutable on table %', TG_TABLE_NAME
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "tenant_settings_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "tenant_settings" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "roles_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "roles" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "role_permissions_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "role_permissions" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "memberships_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "memberships" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "icps_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "icps" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "organizations_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "organizations" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "contacts_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "contacts" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "lead_lists_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "lead_lists" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "lead_list_members_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "lead_list_members" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "imports_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "imports" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "source_records_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "source_records" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "research_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "research" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "evidence_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "evidence" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "scores_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "scores" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "verifications_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "verifications" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
