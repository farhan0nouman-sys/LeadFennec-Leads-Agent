-- Integrity rules for the outreach and background-job tables (task 03B, docs/decisions.md
-- D-03B-*). Hand-written; Prisma does not model CHECK constraints, functions or triggers, so it
-- neither generates nor drops them.

-- ─── Value predicates ────────────────────────────────────────────────────────
-- Mirror normalizeTimeZone and parseSecretRef in @lead-fennec-ai/shared. STRICT: NULL input
-- returns NULL, which a CHECK constraint accepts (nullable columns).

-- An IANA time zone name ("Area/Location", or "UTC") that this server can convert. Legacy
-- single-word names (EST, EST5EDT, GMT, Japan), abbreviations and fixed offsets are rejected:
-- they do not follow a place's daylight-saving rules. Declared IMMUTABLE for use in CHECK
-- constraints; strictly it depends on the server's time zone database, which only changes with
-- server updates (IANA keeps renamed zones as links). Not PARALLEL SAFE: the probe needs a
-- subtransaction.
CREATE FUNCTION "is_iana_time_zone"(value text) RETURNS boolean
  LANGUAGE plpgsql IMMUTABLE STRICT
AS $$
BEGIN
  IF value = 'UTC' THEN
    RETURN true;
  END IF;
  IF length(value) > 64 OR value !~ '^[A-Z][A-Za-z]*(/[A-Z][A-Za-z0-9_+-]*)+$' THEN
    RETURN false;
  END IF;
  BEGIN
    PERFORM '2000-01-01 00:00:00+00'::timestamptz AT TIME ZONE value;
  EXCEPTION WHEN invalid_parameter_value THEN
    RETURN false;
  END;
  RETURN true;
END;
$$;

-- "<store>://<path>": a reference into a secret store, never a credential. Path segments are
-- 1-64 characters from a small alphabet, which rejects token-shaped values (JWTs, OAuth
-- tokens, long API keys).
CREATE FUNCTION "is_secret_ref"(value text) RETURNS boolean
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  RETURN value ~ '^[a-z][a-z0-9-]{1,31}://[A-Za-z0-9][A-Za-z0-9._-]{0,63}(/[A-Za-z0-9][A-Za-z0-9._-]{0,63})*$'
    AND length(value) <= 255;

-- ISO weekdays, 1 (Monday) to 7 (Sunday): one-dimensional, at least one, no duplicates or NULLs.
CREATE FUNCTION "is_iso_weekday_set"(days integer[]) RETURNS boolean
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  RETURN CASE
    WHEN array_ndims(days) IS DISTINCT FROM 1 THEN false
    ELSE cardinality(days) <= 7
      AND array_position(days, NULL) IS NULL
      AND days <@ ARRAY[1, 2, 3, 4, 5, 6, 7]
      AND cardinality(days) = (SELECT count(DISTINCT d) FROM unnest(days) AS d)
  END;

-- Dotted lower-case keys, e.g. "campaign.dispatch" or "campaign_lead.stopped".
CREATE FUNCTION "is_dotted_key"(value text) RETURNS boolean
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  RETURN value ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$' AND length(value) <= 100;

-- ─── Tenant settings (03A table) ─────────────────────────────────────────────

ALTER TABLE "tenant_settings"
  ADD CONSTRAINT "tenant_settings_timezone_check" CHECK ("is_iana_time_zone"("timezone"));

-- ─── Mailboxes ───────────────────────────────────────────────────────────────

ALTER TABLE "email_accounts"
  ADD CONSTRAINT "email_accounts_normalized_email_check" CHECK ("is_normalized_email"("normalized_email")),
  ADD CONSTRAINT "email_accounts_secret_ref_check" CHECK ("is_secret_ref"("secret_ref")),
  -- Active and paused mailboxes have credentials; pending and disconnected ones have none.
  ADD CONSTRAINT "email_accounts_credentials_check" CHECK (
    CASE "status"
      WHEN 'ACTIVE' THEN "secret_ref" IS NOT NULL
      WHEN 'PAUSED' THEN "secret_ref" IS NOT NULL
      WHEN 'PENDING' THEN "secret_ref" IS NULL
      WHEN 'DISCONNECTED' THEN "secret_ref" IS NULL
      ELSE true
    END
  ),
  ADD CONSTRAINT "email_accounts_daily_send_limit_check" CHECK ("daily_send_limit" BETWEEN 1 AND 10000);

-- ─── Content ─────────────────────────────────────────────────────────────────

ALTER TABLE "templates"
  ADD CONSTRAINT "templates_content_check" CHECK (
    char_length("subject") BETWEEN 1 AND 300 AND char_length("body") BETWEEN 1 AND 20000
  ),
  ADD CONSTRAINT "templates_version_check" CHECK ("version" >= 1);

-- ─── Campaigns and sequences ─────────────────────────────────────────────────

ALTER TABLE "campaigns"
  ADD CONSTRAINT "campaigns_timezone_check" CHECK ("is_iana_time_zone"("timezone")),
  ADD CONSTRAINT "campaigns_send_weekdays_check" CHECK (
    "send_weekdays" IS NOT NULL AND "is_iso_weekday_set"("send_weekdays")
  ),
  ADD CONSTRAINT "campaigns_send_window_check" CHECK (
    "send_window_start_minute" >= 0 AND "send_window_end_minute" <= 1440
    AND "send_window_start_minute" < "send_window_end_minute"
  ),
  -- The status and its timestamps agree: pausing sets paused_at and resuming clears it.
  ADD CONSTRAINT "campaigns_status_check" CHECK (
    ("status" = 'PAUSED') = ("paused_at" IS NOT NULL)
    AND ("status" = 'COMPLETED') = ("completed_at" IS NOT NULL)
    AND ("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL)
    AND ("status" NOT IN ('ACTIVE', 'PAUSED', 'COMPLETED') OR "activated_at" IS NOT NULL)
  );

ALTER TABLE "sequence_steps"
  ADD CONSTRAINT "sequence_steps_position_check" CHECK ("position" >= 1),
  ADD CONSTRAINT "sequence_steps_delay_check" CHECK ("delay_minutes" BETWEEN 0 AND 525600);

ALTER TABLE "campaign_leads"
  ADD CONSTRAINT "campaign_leads_timezone_check" CHECK ("is_iana_time_zone"("timezone")),
  ADD CONSTRAINT "campaign_leads_progress_check" CHECK ("current_step_position" >= 0),
  -- A stopped lead has a reason and a time; completed and stopped leads have nothing due.
  ADD CONSTRAINT "campaign_leads_status_check" CHECK (
    ("status" = 'STOPPED') = ("stop_reason" IS NOT NULL)
    AND ("status" = 'STOPPED') = ("stopped_at" IS NOT NULL)
    AND ("status" = 'COMPLETED') = ("completed_at" IS NOT NULL)
    AND ("status" NOT IN ('COMPLETED', 'STOPPED') OR "next_action_at" IS NULL)
  );

-- ─── Drafts and approvals ────────────────────────────────────────────────────

ALTER TABLE "drafts"
  ADD CONSTRAINT "drafts_version_check" CHECK ("version" >= 1),
  ADD CONSTRAINT "drafts_content_check" CHECK (
    char_length("subject") BETWEEN 1 AND 300 AND char_length("body") BETWEEN 1 AND 20000
  ),
  -- Provenance matches the source of the version.
  ADD CONSTRAINT "drafts_source_check" CHECK (
    ("template_id" IS NULL) = ("template_version" IS NULL)
    AND ("template_version" IS NULL OR "template_version" >= 1)
    AND ("source" <> 'TEMPLATE' OR "template_id" IS NOT NULL)
    AND ("source" <> 'AI' OR ("model" IS NOT NULL AND "prompt_version" IS NOT NULL))
    AND ("source" <> 'MANUAL' OR "created_by_membership_id" IS NOT NULL)
  );

ALTER TABLE "approvals"
  ADD CONSTRAINT "approvals_note_check" CHECK (char_length("note") <= 2000);

-- ─── Sending ─────────────────────────────────────────────────────────────────

ALTER TABLE "outbound_intents"
  ADD CONSTRAINT "outbound_intents_recipient_email_check" CHECK ("is_normalized_email"("recipient_email")),
  ADD CONSTRAINT "outbound_intents_scheduled_timezone_check" CHECK ("is_iana_time_zone"("scheduled_timezone")),
  -- approval_id and approval_decision are set together, and only for an APPROVED decision. The
  -- composite foreign key then proves it is the decision on this exact draft version.
  ADD CONSTRAINT "outbound_intents_approval_check" CHECK (
    ("approval_id" IS NULL) = ("approval_decision" IS NULL)
    AND ("approval_decision" IS NULL OR "approval_decision" = 'APPROVED')
  ),
  ADD CONSTRAINT "outbound_intents_status_check" CHECK (
    ("status" = 'SENT') = ("sent_at" IS NOT NULL)
    AND ("status" = 'FAILED') = ("failed_at" IS NOT NULL)
    AND ("status" <> 'FAILED' OR "error_code" IS NOT NULL)
    AND ("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL)
    AND ("status" = 'CANCELLED') = ("cancel_reason" IS NOT NULL)
  );

ALTER TABLE "outbound_attempts"
  ADD CONSTRAINT "outbound_attempts_number_check" CHECK ("attempt_number" >= 1),
  -- RFC 5322 Message-ID: <local@domain>.
  ADD CONSTRAINT "outbound_attempts_message_id_check" CHECK (
    "internet_message_id" ~ '^<[^<>@[:space:]]+@[^<>@[:space:]]+>$'
    AND length("internet_message_id") <= 998
  ),
  ADD CONSTRAINT "outbound_attempts_status_check" CHECK (
    CASE "status"
      WHEN 'SENDING' THEN "finished_at" IS NULL AND "error_code" IS NULL AND "retryable" IS NULL
      WHEN 'SENT' THEN "finished_at" IS NOT NULL AND "provider_message_id" IS NOT NULL
        AND "error_code" IS NULL AND "retryable" IS NULL
      WHEN 'FAILED' THEN "finished_at" IS NOT NULL AND "error_code" IS NOT NULL AND "retryable" IS NOT NULL
    END
  ),
  ADD CONSTRAINT "outbound_attempts_timing_check" CHECK ("finished_at" IS NULL OR "finished_at" >= "started_at");

-- ─── Conversations ───────────────────────────────────────────────────────────

ALTER TABLE "inbound_messages"
  ADD CONSTRAINT "inbound_messages_from_email_check" CHECK ("is_normalized_email"("from_normalized_email")),
  ADD CONSTRAINT "inbound_messages_snippet_check" CHECK (char_length("snippet") <= 2000),
  ADD CONSTRAINT "inbound_messages_classified_check" CHECK (
    ("classification" = 'UNCLASSIFIED') = ("classified_at" IS NULL)
  );

ALTER TABLE "suppressions"
  -- Exactly one target: an address or a whole domain.
  ADD CONSTRAINT "suppressions_target_check" CHECK (num_nonnulls("normalized_email", "normalized_domain") = 1),
  ADD CONSTRAINT "suppressions_normalized_email_check" CHECK ("is_normalized_email"("normalized_email")),
  ADD CONSTRAINT "suppressions_normalized_domain_check" CHECK ("is_normalized_domain"("normalized_domain"));

-- ─── Background jobs and integrations ────────────────────────────────────────

ALTER TABLE "job_schedules"
  ADD CONSTRAINT "job_schedules_job_type_check" CHECK ("is_dotted_key"("job_type")),
  ADD CONSTRAINT "job_schedules_timezone_check" CHECK ("is_iana_time_zone"("timezone")),
  -- Exactly one of a cron expression (five numeric fields) and an interval of 1 minute to 30 days.
  ADD CONSTRAINT "job_schedules_recurrence_check" CHECK (
    num_nonnulls("cron_expression", "interval_seconds") = 1
    AND ("cron_expression" IS NULL OR "cron_expression" ~ '^[0-9*,/-]+( [0-9*,/-]+){4}$')
    AND ("interval_seconds" IS NULL OR "interval_seconds" BETWEEN 60 AND 2592000)
  ),
  ADD CONSTRAINT "job_schedules_target_check" CHECK (num_nonnulls("campaign_id", "email_account_id") <= 1);

ALTER TABLE "job_runs"
  ADD CONSTRAINT "job_runs_job_type_check" CHECK ("is_dotted_key"("job_type")),
  ADD CONSTRAINT "job_runs_schedule_check" CHECK ("trigger" <> 'SCHEDULE' OR "schedule_id" IS NOT NULL),
  ADD CONSTRAINT "job_runs_status_check" CHECK (
    ("status" NOT IN ('RUNNING', 'SUCCEEDED', 'FAILED') OR "started_at" IS NOT NULL)
    AND ("status" IN ('SUCCEEDED', 'FAILED', 'CANCELLED')) = ("finished_at" IS NOT NULL)
    AND ("status" <> 'FAILED' OR "error_code" IS NOT NULL)
  ),
  ADD CONSTRAINT "job_runs_timing_check" CHECK (
    "finished_at" IS NULL OR "started_at" IS NULL OR "finished_at" >= "started_at"
  );

ALTER TABLE "job_tasks"
  ADD CONSTRAINT "job_tasks_task_type_check" CHECK ("is_dotted_key"("task_type")),
  ADD CONSTRAINT "job_tasks_idempotency_key_check" CHECK (char_length("idempotency_key") BETWEEN 1 AND 200),
  ADD CONSTRAINT "job_tasks_attempts_check" CHECK (
    "max_attempts" BETWEEN 1 AND 100 AND "attempt_count" BETWEEN 0 AND "max_attempts"
  ),
  ADD CONSTRAINT "job_tasks_priority_check" CHECK ("priority" BETWEEN -1000 AND 1000),
  ADD CONSTRAINT "job_tasks_status_check" CHECK (
    ("status" NOT IN ('RUNNING', 'SUCCEEDED', 'FAILED') OR "started_at" IS NOT NULL)
    AND ("status" IN ('SUCCEEDED', 'FAILED', 'CANCELLED')) = ("finished_at" IS NOT NULL)
    AND ("status" <> 'FAILED' OR "last_error_code" IS NOT NULL)
  ),
  ADD CONSTRAINT "job_tasks_timing_check" CHECK (
    "finished_at" IS NULL OR "started_at" IS NULL OR "finished_at" >= "started_at"
  );

ALTER TABLE "worker_leases"
  ADD CONSTRAINT "worker_leases_resource_type_check" CHECK ("is_dotted_key"("resource_type")),
  ADD CONSTRAINT "worker_leases_holder_check" CHECK ("holder_id" ~ '^[A-Za-z0-9._:-]{1,128}$'),
  ADD CONSTRAINT "worker_leases_fencing_token_check" CHECK ("fencing_token" >= 1),
  ADD CONSTRAINT "worker_leases_expiry_check" CHECK ("expires_at" > "acquired_at");

ALTER TABLE "outbox_events"
  ADD CONSTRAINT "outbox_events_aggregate_type_check" CHECK ("aggregate_type" ~ '^[a-z][a-z0-9_]{0,62}$'),
  ADD CONSTRAINT "outbox_events_event_type_check" CHECK ("is_dotted_key"("event_type")),
  ADD CONSTRAINT "outbox_events_publish_attempts_check" CHECK ("publish_attempts" >= 0);

ALTER TABLE "inbound_events"
  ADD CONSTRAINT "inbound_events_event_key_check" CHECK (char_length("event_key") BETWEEN 1 AND 512),
  ADD CONSTRAINT "inbound_events_payload_sha256_check" CHECK ("payload_sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "inbound_events_attempts_check" CHECK ("attempts" >= 0),
  ADD CONSTRAINT "inbound_events_status_check" CHECK (
    ("status" IN ('PROCESSED', 'IGNORED')) = ("processed_at" IS NOT NULL)
  );

ALTER TABLE "integration_sync_cursors"
  ADD CONSTRAINT "integration_sync_cursors_resource_check" CHECK ("is_dotted_key"("resource")),
  -- A mailbox cursor is scoped by its email account id.
  ADD CONSTRAINT "integration_sync_cursors_scope_check" CHECK (
    "scope_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:@-]{0,199}$'
    AND ("email_account_id" IS NULL OR "scope_key" = "email_account_id"::text)
  ),
  ADD CONSTRAINT "integration_sync_cursors_cursor_check" CHECK (char_length("cursor") <= 8192),
  ADD CONSTRAINT "integration_sync_cursors_failures_check" CHECK ("consecutive_failures" >= 0);

-- ─── Append-only rows ────────────────────────────────────────────────────────
-- A draft version's content and provenance never change after insert (only its status does),
-- and an approval never changes at all: what was approved is exactly what gets sent.

CREATE FUNCTION "forbid_column_changes"() RETURNS trigger
  LANGUAGE plpgsql
AS $$
DECLARE
  col text;
BEGIN
  FOREACH col IN ARRAY TG_ARGV LOOP
    IF (to_jsonb(OLD) -> col) IS DISTINCT FROM (to_jsonb(NEW) -> col) THEN
      RAISE EXCEPTION '%.% is immutable', TG_TABLE_NAME, col
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "drafts_content_immutable" BEFORE UPDATE ON "drafts" FOR EACH ROW
  EXECUTE FUNCTION "forbid_column_changes"('id', 'campaign_lead_id', 'sequence_id', 'sequence_step_id', 'version', 'source', 'subject', 'body', 'template_id', 'template_version', 'model', 'prompt_version', 'created_by_membership_id', 'created_at');
CREATE TRIGGER "approvals_immutable" BEFORE UPDATE ON "approvals" FOR EACH ROW
  EXECUTE FUNCTION "forbid_column_changes"('id', 'draft_id', 'decision', 'decided_by_membership_id', 'note', 'decided_at');

-- ─── tenant_id is immutable ──────────────────────────────────────────────────
-- Same trigger function as the 03A tables (20261101000100_tenant_integrity_checks).

CREATE TRIGGER "email_accounts_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "email_accounts" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "templates_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "templates" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "campaigns_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "campaigns" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "sequences_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "sequences" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "sequence_steps_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "sequence_steps" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "campaign_leads_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "campaign_leads" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "drafts_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "drafts" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "approvals_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "approvals" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "outbound_intents_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "outbound_intents" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "outbound_attempts_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "outbound_attempts" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "email_threads_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "email_threads" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "inbound_messages_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "inbound_messages" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "suppressions_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "suppressions" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "job_schedules_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "job_schedules" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "job_runs_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "job_runs" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "job_tasks_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "job_tasks" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "worker_leases_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "worker_leases" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "outbox_events_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "outbox_events" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "inbound_events_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "inbound_events" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
CREATE TRIGGER "integration_sync_cursors_tenant_id_immutable" BEFORE UPDATE OF "tenant_id" ON "integration_sync_cursors" FOR EACH ROW EXECUTE FUNCTION "forbid_tenant_id_change"();
