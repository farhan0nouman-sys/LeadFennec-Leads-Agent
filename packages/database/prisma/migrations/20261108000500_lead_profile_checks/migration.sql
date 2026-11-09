-- Lead profile (task 11B, docs/decisions.md D-11B-*). Hand-written: Prisma does not model CHECK
-- constraints or triggers. The new enum values come from the previous migration (a new enum value
-- can't be used in the transaction that adds it).

ALTER TABLE "contacts"
  ADD CONSTRAINT "contacts_version_check" CHECK ("version" >= 1);

ALTER TABLE "contact_notes"
  ADD CONSTRAINT "contact_notes_body_check" CHECK (char_length(btrim("body")) BETWEEN 1 AND 2000);

ALTER TABLE "contact_tags"
  ADD CONSTRAINT "contact_tags_tag_check" CHECK ("tag" ~ '^[a-z0-9][a-z0-9 _-]{0,39}$');

CREATE TRIGGER "contact_notes_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "contact_notes"
  FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "contact_tags_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "contact_tags"
  FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();

-- A note never changes: what someone wrote stays as written (a correction is a new note).
CREATE TRIGGER "contact_notes_immutable" BEFORE UPDATE ON "contact_notes" FOR EACH ROW
  EXECUTE FUNCTION "forbid_column_changes"('id', 'contact_id', 'body', 'created_by_membership_id', 'created_at');
-- A tag is added or removed, never edited.
CREATE TRIGGER "contact_tags_immutable" BEFORE UPDATE ON "contact_tags" FOR EACH ROW
  EXECUTE FUNCTION "forbid_column_changes"('id', 'contact_id', 'tag', 'created_at');
