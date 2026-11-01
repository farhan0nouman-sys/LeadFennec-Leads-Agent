-- Integrity rules for billing, usage, branding, audit and notifications (task 03C,
-- docs/decisions.md D-03C-*). Hand-written; Prisma does not model CHECK constraints, functions
-- or triggers, so it neither generates nor drops them.

-- ─── Value predicates ────────────────────────────────────────────────────────
-- STRICT: NULL input returns NULL, which a CHECK constraint accepts (nullable columns).

-- An identifier issued by a provider (e.g. a Stripe id, or a fake id in development): 1-255
-- characters, no whitespace, quotes or markup.
CREATE FUNCTION "is_provider_id"(value text) RETURNS boolean
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  RETURN value ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$';

-- ISO 4217 alphabetic currency code, upper case.
CREATE FUNCTION "is_currency_code"(value text) RETURNS boolean
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  RETURN value ~ '^[A-Z]{3}$';

-- Snake-case key, e.g. a row type such as "subscription".
CREATE FUNCTION "is_snake_key"(value text) RETURNS boolean
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  RETURN value ~ '^[a-z][a-z0-9_]{0,62}$';

-- Same shape as resolveRequestId in @lead-fennec-ai/shared.
CREATE FUNCTION "is_request_id"(value text) RETURNS boolean
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  RETURN value ~ '^[A-Za-z0-9._:-]{1,128}$';

-- ─── Plan catalog ────────────────────────────────────────────────────────────

ALTER TABLE "billing_plans"
  ADD CONSTRAINT "billing_plans_key_check" CHECK ("key" ~ '^[a-z][a-z0-9_]{0,49}$'),
  ADD CONSTRAINT "billing_plans_name_check" CHECK (char_length("name") BETWEEN 1 AND 100),
  ADD CONSTRAINT "billing_plans_currency_check" CHECK ("is_currency_code"("currency")),
  ADD CONSTRAINT "billing_plans_amount_check" CHECK ("amount_minor" >= 0),
  ADD CONSTRAINT "billing_plans_external_price_id_check" CHECK ("is_provider_id"("external_price_id"));

ALTER TABLE "plan_limits"
  ADD CONSTRAINT "plan_limits_quantity_check" CHECK ("quantity_per_period" >= 0);

-- ─── Subscriptions and payments ──────────────────────────────────────────────

ALTER TABLE "subscriptions"
  -- STRIPE rows name the provider's customer and subscription; MANUAL rows have neither.
  ADD CONSTRAINT "subscriptions_external_ids_check" CHECK (
    CASE "provider"
      WHEN 'STRIPE' THEN "external_customer_id" IS NOT NULL AND "external_subscription_id" IS NOT NULL
        AND "is_provider_id"("external_customer_id") AND "is_provider_id"("external_subscription_id")
      ELSE "external_customer_id" IS NULL AND "external_subscription_id" IS NULL
    END
  ),
  ADD CONSTRAINT "subscriptions_period_check" CHECK ("current_period_end" > "current_period_start"),
  ADD CONSTRAINT "subscriptions_trial_check" CHECK ("status" <> 'TRIALING' OR "trial_ends_at" IS NOT NULL),
  -- ended_at is set exactly when the subscription is no longer current.
  ADD CONSTRAINT "subscriptions_ended_check" CHECK (
    ("ended_at" IS NOT NULL) = ("status" IN ('CANCELED', 'INCOMPLETE_EXPIRED'))
  );

ALTER TABLE "payment_events"
  -- STRIPE facts carry the provider's event id; MANUAL facts have no provider event.
  ADD CONSTRAINT "payment_events_source_check" CHECK (
    CASE "provider"
      WHEN 'STRIPE' THEN "external_event_id" IS NOT NULL AND "is_provider_id"("external_event_id")
      ELSE "external_event_id" IS NULL AND "inbound_event_id" IS NULL
    END
  ),
  ADD CONSTRAINT "payment_events_object_id_check" CHECK ("is_provider_id"("external_object_id")),
  ADD CONSTRAINT "payment_events_amount_check" CHECK ("amount_minor" >= 0),
  ADD CONSTRAINT "payment_events_currency_check" CHECK ("is_currency_code"("currency")),
  -- A failed payment has a machine-readable code; other facts have none.
  ADD CONSTRAINT "payment_events_failure_check" CHECK (
    ("kind" = 'PAYMENT_FAILED') = ("failure_code" IS NOT NULL)
    AND "failure_code" ~ '^[a-z][a-z0-9_]{0,63}$'
  );

-- ─── Limits and usage ────────────────────────────────────────────────────────

ALTER TABLE "tenant_limit_overrides"
  ADD CONSTRAINT "tenant_limit_overrides_quantity_check" CHECK ("quantity_per_period" >= 0),
  ADD CONSTRAINT "tenant_limit_overrides_reason_check" CHECK (char_length("reason") BETWEEN 1 AND 500);

ALTER TABLE "usage_reservations"
  ADD CONSTRAINT "usage_reservations_quantity_check" CHECK ("quantity" > 0),
  ADD CONSTRAINT "usage_reservations_purpose_check" CHECK ("is_dotted_key"("purpose")),
  ADD CONSTRAINT "usage_reservations_idempotency_key_check" CHECK (char_length("idempotency_key") BETWEEN 1 AND 200),
  ADD CONSTRAINT "usage_reservations_expiry_check" CHECK ("expires_at" > "created_at"),
  -- HELD: not settled. COMMITTED: settled with the quantity used (at most the quantity held).
  -- RELEASED, EXPIRED: settled without usage.
  ADD CONSTRAINT "usage_reservations_settlement_check" CHECK (
    CASE "status"
      WHEN 'HELD' THEN "settled_at" IS NULL AND "committed_quantity" IS NULL
      WHEN 'COMMITTED' THEN "settled_at" IS NOT NULL AND "committed_quantity" IS NOT NULL
        AND "committed_quantity" BETWEEN 0 AND "quantity"
      ELSE "settled_at" IS NOT NULL AND "committed_quantity" IS NULL
    END
  ),
  ADD CONSTRAINT "usage_reservations_timing_check" CHECK ("settled_at" >= "created_at");

ALTER TABLE "usage_ledger_entries"
  -- USAGE is consumption (positive). ADJUSTMENT is a signed correction with a note and no
  -- reservation.
  ADD CONSTRAINT "usage_ledger_entries_kind_check" CHECK (
    CASE "kind"
      WHEN 'USAGE' THEN "quantity" > 0
      ELSE "quantity" <> 0 AND "note" IS NOT NULL AND "reservation_id" IS NULL
    END
  ),
  ADD CONSTRAINT "usage_ledger_entries_idempotency_key_check" CHECK (char_length("idempotency_key") BETWEEN 1 AND 200),
  ADD CONSTRAINT "usage_ledger_entries_note_check" CHECK (char_length("note") BETWEEN 1 AND 500);

-- ─── Branding ────────────────────────────────────────────────────────────────

ALTER TABLE "tenant_branding"
  ADD CONSTRAINT "tenant_branding_display_name_check" CHECK (char_length("display_name") BETWEEN 1 AND 100),
  ADD CONSTRAINT "tenant_branding_logo_url_check" CHECK (
    "logo_url" ~ '^https://[^[:space:]<>"''\\]+$' AND char_length("logo_url") <= 2048
  ),
  ADD CONSTRAINT "tenant_branding_colors_check" CHECK (
    "primary_color" ~ '^#[0-9A-F]{6}$' AND "accent_color" ~ '^#[0-9A-F]{6}$'
  ),
  ADD CONSTRAINT "tenant_branding_email_footer_check" CHECK (char_length("email_footer") <= 2000),
  ADD CONSTRAINT "tenant_branding_support_email_check" CHECK ("is_normalized_email"("support_email"));

-- ─── Audit ───────────────────────────────────────────────────────────────────

ALTER TABLE "audit_records"
  -- Members are named by user and membership; platform admins by user, always with a reason;
  -- system actors by name.
  ADD CONSTRAINT "audit_records_actor_check" CHECK (
    CASE "actor_type"
      WHEN 'MEMBER' THEN "actor_user_id" IS NOT NULL AND "actor_membership_id" IS NOT NULL
        AND "actor_name" IS NULL
      WHEN 'PLATFORM_ADMIN' THEN "actor_user_id" IS NOT NULL AND "actor_membership_id" IS NULL
        AND "actor_name" IS NULL AND "reason" IS NOT NULL
      ELSE "actor_user_id" IS NULL AND "actor_membership_id" IS NULL AND "actor_name" IS NOT NULL
    END
  ),
  ADD CONSTRAINT "audit_records_actor_name_check" CHECK ("is_snake_key"("actor_name")),
  ADD CONSTRAINT "audit_records_action_check" CHECK ("is_dotted_key"("action")),
  ADD CONSTRAINT "audit_records_target_check" CHECK (
    "is_snake_key"("target_type") AND ("target_id" IS NULL OR "target_type" IS NOT NULL)
  ),
  ADD CONSTRAINT "audit_records_reason_check" CHECK (char_length("reason") BETWEEN 1 AND 1000),
  ADD CONSTRAINT "audit_records_request_id_check" CHECK ("is_request_id"("request_id")),
  ADD CONSTRAINT "audit_records_metadata_check" CHECK (
    jsonb_typeof("metadata") = 'object' AND octet_length("metadata"::text) <= 8192
  );

ALTER TABLE "platform_audit_records"
  -- Platform records have no tenant member: platform admins (with a reason) or system actors.
  ADD CONSTRAINT "platform_audit_records_actor_check" CHECK (
    CASE "actor_type"
      WHEN 'PLATFORM_ADMIN' THEN "actor_user_id" IS NOT NULL AND "actor_name" IS NULL
        AND "reason" IS NOT NULL
      WHEN 'SYSTEM' THEN "actor_user_id" IS NULL AND "actor_name" IS NOT NULL
      ELSE false
    END
  ),
  ADD CONSTRAINT "platform_audit_records_actor_name_check" CHECK ("is_snake_key"("actor_name")),
  ADD CONSTRAINT "platform_audit_records_action_check" CHECK ("is_dotted_key"("action")),
  ADD CONSTRAINT "platform_audit_records_target_check" CHECK (
    "is_snake_key"("target_type") AND ("target_id" IS NULL OR "target_type" IS NOT NULL)
  ),
  ADD CONSTRAINT "platform_audit_records_reason_check" CHECK (char_length("reason") BETWEEN 1 AND 1000),
  ADD CONSTRAINT "platform_audit_records_request_id_check" CHECK ("is_request_id"("request_id")),
  ADD CONSTRAINT "platform_audit_records_metadata_check" CHECK (
    jsonb_typeof("metadata") = 'object' AND octet_length("metadata"::text) <= 8192
  );

-- ─── Notifications ───────────────────────────────────────────────────────────

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_type_check" CHECK ("is_dotted_key"("type")),
  ADD CONSTRAINT "notifications_title_check" CHECK (char_length("title") BETWEEN 1 AND 200),
  ADD CONSTRAINT "notifications_body_check" CHECK (char_length("body") <= 2000),
  -- A path inside the app: "/" not followed by "/" or "\" (which browsers treat as another
  -- host), no whitespace.
  ADD CONSTRAINT "notifications_link_path_check" CHECK (
    "link_path" ~ '^/([^/\\[:space:]][^[:space:]]*)?$' AND char_length("link_path") <= 500
  ),
  ADD CONSTRAINT "notifications_dedupe_key_check" CHECK (char_length("dedupe_key") BETWEEN 1 AND 200),
  ADD CONSTRAINT "notifications_read_check" CHECK ("read_at" >= "created_at");

-- ─── Append-only rows ────────────────────────────────────────────────────────
-- Financial facts, usage and audit records never change after insert. Same trigger function as
-- 03B (20261101000300_outreach_integrity_checks), listing every column.

CREATE TRIGGER "payment_events_immutable" BEFORE UPDATE ON "payment_events" FOR EACH ROW
  EXECUTE FUNCTION "forbid_column_changes"('id', 'provider', 'external_event_id', 'kind', 'subscription_id', 'inbound_event_id', 'external_object_id', 'amount_minor', 'currency', 'failure_code', 'occurred_at', 'recorded_at');
CREATE TRIGGER "usage_ledger_entries_immutable" BEFORE UPDATE ON "usage_ledger_entries" FOR EACH ROW
  EXECUTE FUNCTION "forbid_column_changes"('id', 'metric', 'period_start', 'kind', 'quantity', 'reservation_id', 'idempotency_key', 'note', 'occurred_at');
CREATE TRIGGER "audit_records_immutable" BEFORE UPDATE ON "audit_records" FOR EACH ROW
  EXECUTE FUNCTION "forbid_column_changes"('id', 'actor_type', 'actor_user_id', 'actor_membership_id', 'actor_name', 'action', 'target_type', 'target_id', 'reason', 'request_id', 'metadata', 'occurred_at');
CREATE TRIGGER "platform_audit_records_immutable" BEFORE UPDATE ON "platform_audit_records" FOR EACH ROW
  EXECUTE FUNCTION "forbid_column_changes"('id', 'actor_type', 'actor_user_id', 'actor_name', 'action', 'subject_tenant_id', 'target_type', 'target_id', 'reason', 'request_id', 'metadata', 'occurred_at');

-- ─── tenant_id is immutable ──────────────────────────────────────────────────
-- Same trigger function as the 03A tables (20261101000100_tenant_integrity_checks).

CREATE TRIGGER "subscriptions_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "subscriptions" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "payment_events_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "payment_events" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "tenant_limit_overrides_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "tenant_limit_overrides" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "usage_reservations_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "usage_reservations" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "usage_ledger_entries_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "usage_ledger_entries" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "tenant_branding_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "tenant_branding" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "audit_records_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "audit_records" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "notifications_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "notifications" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
