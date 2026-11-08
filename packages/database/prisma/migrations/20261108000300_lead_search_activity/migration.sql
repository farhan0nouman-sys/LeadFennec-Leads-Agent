-- Lead search (task 11A, docs/decisions.md D-11A-*): a person's last activity, kept by the
-- database. Hand-written: Prisma does not model triggers or CHECK constraints.
--
-- Activity is the newest of: the contact's creation, data retrieved about them (source records),
-- a check of their address (verifications), a score, a qualification decision, and an enrollment
-- or its change (campaign leads). Each event moves it forward from the event's own time, never
-- back. Application code never writes the column.

-- Existing contacts: the newest of what already happened to them.
UPDATE "contacts" c
SET "last_activity_at" = GREATEST(
  c."created_at",
  COALESCE((SELECT max(s."fetched_at") FROM "source_records" s
            WHERE s."tenant_id" = c."tenant_id" AND s."contact_id" = c."id"), c."created_at"),
  COALESCE((SELECT max(v."checked_at") FROM "verifications" v
            WHERE v."tenant_id" = c."tenant_id" AND v."contact_id" = c."id"), c."created_at"),
  COALESCE((SELECT max(sc."scored_at") FROM "scores" sc
            WHERE sc."tenant_id" = c."tenant_id" AND sc."contact_id" = c."id"), c."created_at"),
  COALESCE((SELECT max(q."decided_at") FROM "lead_qualifications" q
            WHERE q."tenant_id" = c."tenant_id" AND q."contact_id" = c."id"), c."created_at"),
  COALESCE((SELECT max(l."updated_at") FROM "campaign_leads" l
            WHERE l."tenant_id" = c."tenant_id" AND l."contact_id" = c."id"), c."created_at")
);

ALTER TABLE "contacts"
  ADD CONSTRAINT "contacts_last_activity_check" CHECK ("last_activity_at" >= "created_at");

-- A new contact's last activity is its creation, whatever was sent.
CREATE FUNCTION "contacts_activity_on_insert"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."last_activity_at" := NEW."created_at";
  RETURN NEW;
END;
$$;

CREATE TRIGGER "contacts_activity_on_insert" BEFORE INSERT ON "contacts" FOR EACH ROW
  EXECUTE FUNCTION "contacts_activity_on_insert"();

-- Something happened to a person: their last activity moves to the event's time if later. The
-- argument names the event's time column. Same tenant only (the row's own tenant_id).
CREATE FUNCTION "touch_contact_activity"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  happened timestamptz;
BEGIN
  IF NEW."contact_id" IS NULL THEN
    RETURN NULL;
  END IF;
  happened := (to_jsonb(NEW) ->> TG_ARGV[0])::timestamptz;
  IF happened IS NULL THEN
    RETURN NULL;
  END IF;
  UPDATE "contacts"
  SET "last_activity_at" = happened
  WHERE "tenant_id" = NEW."tenant_id" AND "id" = NEW."contact_id"
    AND "last_activity_at" < happened;
  RETURN NULL;
END;
$$;

CREATE TRIGGER "source_records_touch_contact" AFTER INSERT ON "source_records" FOR EACH ROW
  EXECUTE FUNCTION "touch_contact_activity"('fetched_at');
CREATE TRIGGER "verifications_touch_contact" AFTER INSERT ON "verifications" FOR EACH ROW
  EXECUTE FUNCTION "touch_contact_activity"('checked_at');
CREATE TRIGGER "scores_touch_contact" AFTER INSERT ON "scores" FOR EACH ROW
  EXECUTE FUNCTION "touch_contact_activity"('scored_at');
CREATE TRIGGER "lead_qualifications_touch_contact" AFTER INSERT ON "lead_qualifications" FOR EACH ROW
  EXECUTE FUNCTION "touch_contact_activity"('decided_at');
CREATE TRIGGER "campaign_leads_touch_contact" AFTER INSERT OR UPDATE ON "campaign_leads" FOR EACH ROW
  EXECUTE FUNCTION "touch_contact_activity"('updated_at');
