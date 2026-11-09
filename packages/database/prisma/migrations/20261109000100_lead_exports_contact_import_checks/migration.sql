-- Imports, exports and the do-not-contact list (task 11C, docs/decisions.md D-11C-*,
-- docs/security/data-retention.md). Hand-written: Prisma does not model CHECK constraints,
-- triggers or data. The new enum values come from the previous migration (a new enum value can't
-- be used in the transaction that adds it).

-- ─── Lead exports ───────────────────────────────────────────────────────────────

ALTER TABLE "exports"
  -- A file is READY with its content, or EXPIRED with its content deleted (and when).
  ADD CONSTRAINT "exports_content_check" CHECK (
    ("status" = 'READY' AND "content" IS NOT NULL AND "purged_at" IS NULL)
    OR ("status" = 'EXPIRED' AND "content" IS NULL AND "purged_at" IS NOT NULL)
  ),
  -- Bounded: at most 2,000 leads and 4 MB, and the size is the content's.
  ADD CONSTRAINT "exports_size_check" CHECK (
    "row_count" BETWEEN 0 AND 2000
    AND "byte_size" BETWEEN 0 AND 4194304
    AND ("content" IS NULL OR octet_length("content") = "byte_size")
  ),
  ADD CONSTRAINT "exports_content_sha256_check" CHECK ("is_sha256_hex"("content_sha256")),
  -- The download window is short: at most 7 days from when the file was made.
  ADD CONSTRAINT "exports_expiry_check" CHECK (
    "expires_at" > "created_at" AND "expires_at" <= "created_at" + interval '7 days'
    AND ("purged_at" IS NULL OR "purged_at" >= "created_at")
  ),
  ADD CONSTRAINT "exports_downloads_check" CHECK (
    "download_count" >= 0 AND ("downloaded_at" IS NULL) = ("download_count" = 0)
    AND ("downloaded_at" IS NULL OR "downloaded_at" >= "created_at")
  ),
  ADD CONSTRAINT "exports_file_name_check" CHECK ("file_name" ~ '^[a-z0-9][a-z0-9-]{0,99}\.csv$'),
  ADD CONSTRAINT "exports_filters_check" CHECK (
    jsonb_typeof("filters") = 'object' AND octet_length("filters"::text) <= 16384
  );

CREATE TRIGGER "exports_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "exports"
  FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();

-- What was exported, by whom and until when never changes; only downloads are counted and the
-- content deleted.
CREATE TRIGGER "exports_immutable" BEFORE UPDATE ON "exports" FOR EACH ROW
  EXECUTE FUNCTION "forbid_column_changes"('id', 'kind', 'requested_by_membership_id', 'file_name', 'filters', 'row_count', 'truncated', 'byte_size', 'content_sha256', 'created_at', 'expires_at');

-- An expired file stays expired, and its content can only be deleted, never written again.
CREATE FUNCTION "exports_forward_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status" = 'EXPIRED' AND NEW."status" <> 'EXPIRED' THEN
    RAISE EXCEPTION 'An expired export stays expired' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."content" IS NOT NULL AND NEW."content" IS DISTINCT FROM OLD."content" THEN
    RAISE EXCEPTION 'An export''s content can only be deleted' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "exports_forward_only" BEFORE UPDATE ON "exports" FOR EACH ROW
  EXECUTE FUNCTION "exports_forward_only"();

-- ─── People imports from a CSV file ─────────────────────────────────────────────

ALTER TABLE "imports"
  -- A people import has its file, and its batches never exceed the 1,000 rows' 10.
  ADD CONSTRAINT "imports_contact_csv_check" CHECK (
    "source" <> 'CONTACT_CSV' OR ("file_name" IS NOT NULL AND "pages_fetched" <= 10)
  );

-- A row of a people import is received when the file is accepted and linked to its person when
-- the worker saves it: the person's last activity moves then (task 11A's trigger handles only
-- new records).
CREATE TRIGGER "source_records_touch_contact_on_link" AFTER UPDATE OF "contact_id" ON "source_records"
  FOR EACH ROW WHEN (NEW."contact_id" IS NOT NULL AND OLD."contact_id" IS DISTINCT FROM NEW."contact_id")
  EXECUTE FUNCTION "touch_contact_activity"('fetched_at');

-- ─── The do-not-contact list ────────────────────────────────────────────────────

ALTER TABLE "suppressions"
  -- A deletion request keeps only the address: no note, no domain (data-retention.md).
  ADD CONSTRAINT "suppressions_deletion_request_check" CHECK (
    "reason" <> 'DELETION_REQUEST' OR ("normalized_email" IS NOT NULL AND "note" IS NULL)
  ),
  ADD CONSTRAINT "suppressions_note_check" CHECK ("note" IS NULL OR char_length("note") BETWEEN 1 AND 500);

-- ─── The new permission ─────────────────────────────────────────────────────────

-- contacts.export (PERMISSION_CATALOG) for every workspace's Client Admin role, which holds every
-- permission. New workspaces get it from the catalog when they are created.
INSERT INTO "permissions" ("key", "description")
VALUES ('contacts.export', 'Export leads to a file')
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "role_permissions" ("tenant_id", "role_id", "permission_key")
SELECT r."tenant_id", r."id", 'contacts.export'
FROM "roles" r
WHERE r."key" = 'client_admin' AND r."is_system"
ON CONFLICT DO NOTHING;
