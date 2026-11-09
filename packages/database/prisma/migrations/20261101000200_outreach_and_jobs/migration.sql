-- CreateEnum
CREATE TYPE "mailbox_provider" AS ENUM ('GMAIL', 'MICROSOFT_GRAPH');

-- CreateEnum
CREATE TYPE "email_account_status" AS ENUM ('PENDING', 'ACTIVE', 'PAUSED', 'DISCONNECTED', 'ERROR');

-- CreateEnum
CREATE TYPE "template_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "campaign_status" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "sequence_status" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "campaign_lead_status" AS ENUM ('PENDING', 'ACTIVE', 'COMPLETED', 'STOPPED');

-- CreateEnum
CREATE TYPE "campaign_lead_stop_reason" AS ENUM ('REPLIED', 'OPTED_OUT', 'HARD_BOUNCED', 'SUPPRESSED', 'INELIGIBLE', 'CAMPAIGN_CANCELLED', 'MANUAL');

-- CreateEnum
CREATE TYPE "draft_status" AS ENUM ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "draft_source" AS ENUM ('TEMPLATE', 'AI', 'MANUAL');

-- CreateEnum
CREATE TYPE "approval_decision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "outbound_intent_status" AS ENUM ('SCHEDULED', 'SENDING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "outbound_intent_cancel_reason" AS ENUM ('LEAD_STOPPED', 'CAMPAIGN_STOPPED', 'SUPPRESSED', 'INELIGIBLE', 'MANUAL');

-- CreateEnum
CREATE TYPE "outbound_attempt_status" AS ENUM ('SENDING', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "inbound_message_classification" AS ENUM ('UNCLASSIFIED', 'REPLY', 'AUTO_REPLY', 'OPT_OUT', 'HARD_BOUNCE', 'SOFT_BOUNCE', 'OTHER');

-- CreateEnum
CREATE TYPE "suppression_reason" AS ENUM ('OPT_OUT', 'HARD_BOUNCE', 'COMPLAINT', 'MANUAL');

-- CreateEnum
CREATE TYPE "suppression_source" AS ENUM ('MANUAL', 'INBOUND_MESSAGE', 'PROVIDER_EVENT', 'IMPORT');

-- CreateEnum
CREATE TYPE "job_run_trigger" AS ENUM ('SCHEDULE', 'MANUAL', 'EVENT');

-- CreateEnum
CREATE TYPE "job_run_status" AS ENUM ('QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "job_task_status" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "integration_provider" AS ENUM ('GMAIL', 'MICROSOFT_GRAPH', 'GOHIGHLEVEL', 'APOLLO', 'STRIPE');

-- CreateEnum
CREATE TYPE "inbound_event_status" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED');

-- CreateTable
CREATE TABLE "email_accounts" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "provider" "mailbox_provider" NOT NULL,
    "email" TEXT NOT NULL,
    "normalized_email" TEXT NOT NULL,
    "display_name" TEXT,
    "status" "email_account_status" NOT NULL DEFAULT 'PENDING',
    "external_account_id" TEXT,
    "secret_ref" TEXT,
    "daily_send_limit" INTEGER NOT NULL DEFAULT 50,
    "connected_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "email_accounts_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "templates" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "template_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "templates_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "campaign_status" NOT NULL DEFAULT 'DRAFT',
    "icp_id" UUID,
    "lead_list_id" UUID,
    "email_account_id" UUID,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "send_weekdays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "send_window_start_minute" INTEGER NOT NULL DEFAULT 540,
    "send_window_end_minute" INTEGER NOT NULL DEFAULT 1020,
    "activated_at" TIMESTAMPTZ(3),
    "paused_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "sequences" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "sequence_status" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sequences_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "sequence_steps" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "sequence_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "delay_minutes" INTEGER NOT NULL DEFAULT 0,
    "template_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sequence_steps_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "campaign_leads" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "sequence_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "status" "campaign_lead_status" NOT NULL DEFAULT 'PENDING',
    "stop_reason" "campaign_lead_stop_reason",
    "timezone" TEXT NOT NULL,
    "current_step_position" INTEGER NOT NULL DEFAULT 0,
    "next_action_at" TIMESTAMPTZ(3),
    "enrolled_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),
    "stopped_at" TIMESTAMPTZ(3),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "campaign_leads_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "drafts" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "campaign_lead_id" UUID NOT NULL,
    "sequence_id" UUID NOT NULL,
    "sequence_step_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "draft_status" NOT NULL,
    "source" "draft_source" NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "template_id" UUID,
    "template_version" INTEGER,
    "model" TEXT,
    "prompt_version" TEXT,
    "created_by_membership_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "drafts_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "approvals" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "draft_id" UUID NOT NULL,
    "decision" "approval_decision" NOT NULL,
    "decided_by_membership_id" UUID NOT NULL,
    "note" TEXT,
    "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "approvals_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "outbound_intents" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "campaign_lead_id" UUID NOT NULL,
    "sequence_step_id" UUID NOT NULL,
    "draft_id" UUID NOT NULL,
    "approval_id" UUID,
    "approval_decision" "approval_decision",
    "email_account_id" UUID NOT NULL,
    "recipient_email" TEXT NOT NULL,
    "status" "outbound_intent_status" NOT NULL DEFAULT 'SCHEDULED',
    "scheduled_at" TIMESTAMPTZ(3) NOT NULL,
    "scheduled_timezone" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ(3),
    "failed_at" TIMESTAMPTZ(3),
    "error_code" TEXT,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" "outbound_intent_cancel_reason",
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "outbound_intents_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "outbound_attempts" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "outbound_intent_id" UUID NOT NULL,
    "attempt_number" INTEGER NOT NULL,
    "email_account_id" UUID NOT NULL,
    "status" "outbound_attempt_status" NOT NULL DEFAULT 'SENDING',
    "internet_message_id" TEXT NOT NULL,
    "provider_message_id" TEXT,
    "email_thread_id" UUID,
    "error_code" TEXT,
    "retryable" BOOLEAN,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "outbound_attempts_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "email_threads" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "email_account_id" UUID NOT NULL,
    "provider_thread_id" TEXT NOT NULL,
    "campaign_lead_id" UUID,
    "subject" TEXT,
    "last_message_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "email_threads_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "inbound_messages" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "email_account_id" UUID NOT NULL,
    "email_thread_id" UUID NOT NULL,
    "provider_message_id" TEXT NOT NULL,
    "internet_message_id" TEXT,
    "in_reply_to" TEXT,
    "from_email" TEXT NOT NULL,
    "from_normalized_email" TEXT,
    "subject" TEXT,
    "snippet" TEXT,
    "received_at" TIMESTAMPTZ(3) NOT NULL,
    "classification" "inbound_message_classification" NOT NULL DEFAULT 'UNCLASSIFIED',
    "classified_at" TIMESTAMPTZ(3),
    "outbound_attempt_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inbound_messages_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "suppressions" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "normalized_email" TEXT,
    "normalized_domain" TEXT,
    "reason" "suppression_reason" NOT NULL,
    "source" "suppression_source" NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "suppressions_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "job_schedules" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "job_type" TEXT NOT NULL,
    "cron_expression" TEXT,
    "interval_seconds" INTEGER,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "campaign_id" UUID,
    "email_account_id" UUID,
    "next_run_at" TIMESTAMPTZ(3),
    "last_run_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_schedules_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "job_runs" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "schedule_id" UUID,
    "job_type" TEXT NOT NULL,
    "trigger" "job_run_trigger" NOT NULL,
    "status" "job_run_status" NOT NULL DEFAULT 'QUEUED',
    "scheduled_for" TIMESTAMPTZ(3) NOT NULL,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "error_code" TEXT,
    "stats" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_runs_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "job_tasks" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "run_id" UUID,
    "task_type" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" "job_task_status" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "last_error_code" TEXT,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "job_tasks_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "worker_leases" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" UUID NOT NULL,
    "holder_id" TEXT NOT NULL,
    "fencing_token" BIGINT NOT NULL DEFAULT 1,
    "acquired_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "worker_leases_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(3),
    "publish_attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error_code" TEXT,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "inbound_events" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "provider" "integration_provider" NOT NULL,
    "event_key" TEXT NOT NULL,
    "event_type" TEXT,
    "email_account_id" UUID,
    "payload" JSONB NOT NULL,
    "payload_sha256" CHAR(64) NOT NULL,
    "status" "inbound_event_status" NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error_code" TEXT,
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "inbound_events_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "integration_sync_cursors" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "provider" "integration_provider" NOT NULL,
    "resource" TEXT NOT NULL,
    "scope_key" TEXT NOT NULL,
    "email_account_id" UUID,
    "cursor" TEXT,
    "last_synced_at" TIMESTAMPTZ(3),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "last_error_code" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "integration_sync_cursors_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_accounts_tenant_id_normalized_email_key" ON "email_accounts"("tenant_id", "normalized_email");

-- CreateIndex
CREATE UNIQUE INDEX "email_accounts_tenant_id_provider_external_account_id_key" ON "email_accounts"("tenant_id", "provider", "external_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "templates_tenant_id_name_key" ON "templates"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "campaigns_tenant_id_status_idx" ON "campaigns"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "campaigns_tenant_id_icp_id_idx" ON "campaigns"("tenant_id", "icp_id");

-- CreateIndex
CREATE INDEX "campaigns_tenant_id_lead_list_id_idx" ON "campaigns"("tenant_id", "lead_list_id");

-- CreateIndex
CREATE INDEX "campaigns_tenant_id_email_account_id_idx" ON "campaigns"("tenant_id", "email_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_tenant_id_name_key" ON "campaigns"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "sequences_tenant_id_campaign_id_name_key" ON "sequences"("tenant_id", "campaign_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "sequences_tenant_id_campaign_id_id_key" ON "sequences"("tenant_id", "campaign_id", "id");

-- CreateIndex
CREATE INDEX "sequence_steps_tenant_id_template_id_idx" ON "sequence_steps"("tenant_id", "template_id");

-- CreateIndex
CREATE UNIQUE INDEX "sequence_steps_tenant_id_sequence_id_position_key" ON "sequence_steps"("tenant_id", "sequence_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "sequence_steps_tenant_id_sequence_id_id_key" ON "sequence_steps"("tenant_id", "sequence_id", "id");

-- CreateIndex
CREATE INDEX "campaign_leads_tenant_id_campaign_id_status_idx" ON "campaign_leads"("tenant_id", "campaign_id", "status");

-- CreateIndex
CREATE INDEX "campaign_leads_tenant_id_campaign_id_sequence_id_idx" ON "campaign_leads"("tenant_id", "campaign_id", "sequence_id");

-- CreateIndex
CREATE INDEX "campaign_leads_tenant_id_contact_id_idx" ON "campaign_leads"("tenant_id", "contact_id");

-- CreateIndex
CREATE INDEX "campaign_leads_tenant_id_status_next_action_at_idx" ON "campaign_leads"("tenant_id", "status", "next_action_at");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_leads_tenant_id_campaign_id_contact_id_key" ON "campaign_leads"("tenant_id", "campaign_id", "contact_id");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_leads_tenant_id_id_sequence_id_key" ON "campaign_leads"("tenant_id", "id", "sequence_id");

-- CreateIndex
CREATE INDEX "drafts_tenant_id_status_created_at_idx" ON "drafts"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "drafts_tenant_id_sequence_step_id_idx" ON "drafts"("tenant_id", "sequence_step_id");

-- CreateIndex
CREATE INDEX "drafts_tenant_id_template_id_idx" ON "drafts"("tenant_id", "template_id");

-- CreateIndex
CREATE INDEX "drafts_tenant_id_created_by_membership_id_idx" ON "drafts"("tenant_id", "created_by_membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "drafts_tenant_id_campaign_lead_id_sequence_step_id_version_key" ON "drafts"("tenant_id", "campaign_lead_id", "sequence_step_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "drafts_one_live_version_key" ON "drafts"("tenant_id", "campaign_lead_id", "sequence_step_id") WHERE (status = ANY (ARRAY['PENDING_APPROVAL'::draft_status, 'APPROVED'::draft_status]));

-- CreateIndex
CREATE UNIQUE INDEX "drafts_tenant_id_id_campaign_lead_id_sequence_step_id_key" ON "drafts"("tenant_id", "id", "campaign_lead_id", "sequence_step_id");

-- CreateIndex
CREATE INDEX "approvals_tenant_id_decided_by_membership_id_idx" ON "approvals"("tenant_id", "decided_by_membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "approvals_tenant_id_draft_id_key" ON "approvals"("tenant_id", "draft_id");

-- CreateIndex
CREATE UNIQUE INDEX "approvals_tenant_id_id_draft_id_decision_key" ON "approvals"("tenant_id", "id", "draft_id", "decision");

-- CreateIndex
CREATE INDEX "outbound_intents_tenant_id_status_scheduled_at_idx" ON "outbound_intents"("tenant_id", "status", "scheduled_at");

-- CreateIndex
CREATE INDEX "outbound_intents_tenant_id_email_account_id_scheduled_at_idx" ON "outbound_intents"("tenant_id", "email_account_id", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_intents_lead_step_key" ON "outbound_intents"("tenant_id", "campaign_lead_id", "sequence_step_id");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_intents_tenant_id_draft_id_key" ON "outbound_intents"("tenant_id", "draft_id");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_intents_tenant_id_approval_id_key" ON "outbound_intents"("tenant_id", "approval_id");

-- CreateIndex
CREATE INDEX "outbound_attempts_tenant_id_email_account_id_started_at_idx" ON "outbound_attempts"("tenant_id", "email_account_id", "started_at");

-- CreateIndex
CREATE INDEX "outbound_attempts_tenant_id_email_thread_id_idx" ON "outbound_attempts"("tenant_id", "email_thread_id");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_attempts_intent_attempt_number_key" ON "outbound_attempts"("tenant_id", "outbound_intent_id", "attempt_number");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_attempts_one_open_or_sent_key" ON "outbound_attempts"("tenant_id", "outbound_intent_id") WHERE (status <> 'FAILED'::outbound_attempt_status);

-- CreateIndex
CREATE UNIQUE INDEX "outbound_attempts_provider_message_key" ON "outbound_attempts"("tenant_id", "email_account_id", "provider_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "outbound_attempts_tenant_id_internet_message_id_key" ON "outbound_attempts"("tenant_id", "internet_message_id");

-- CreateIndex
CREATE INDEX "email_threads_tenant_id_campaign_lead_id_idx" ON "email_threads"("tenant_id", "campaign_lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_threads_tenant_id_email_account_id_provider_thread_id_key" ON "email_threads"("tenant_id", "email_account_id", "provider_thread_id");

-- CreateIndex
CREATE UNIQUE INDEX "email_threads_tenant_id_id_email_account_id_key" ON "email_threads"("tenant_id", "id", "email_account_id");

-- CreateIndex
CREATE INDEX "inbound_messages_tenant_id_email_thread_id_received_at_idx" ON "inbound_messages"("tenant_id", "email_thread_id", "received_at");

-- CreateIndex
CREATE INDEX "inbound_messages_tenant_id_classification_received_at_idx" ON "inbound_messages"("tenant_id", "classification", "received_at");

-- CreateIndex
CREATE INDEX "inbound_messages_tenant_id_from_normalized_email_idx" ON "inbound_messages"("tenant_id", "from_normalized_email");

-- CreateIndex
CREATE INDEX "inbound_messages_tenant_id_outbound_attempt_id_idx" ON "inbound_messages"("tenant_id", "outbound_attempt_id");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_messages_provider_message_key" ON "inbound_messages"("tenant_id", "email_account_id", "provider_message_id");

-- CreateIndex
CREATE UNIQUE INDEX "suppressions_tenant_id_normalized_email_key" ON "suppressions"("tenant_id", "normalized_email");

-- CreateIndex
CREATE UNIQUE INDEX "suppressions_tenant_id_normalized_domain_key" ON "suppressions"("tenant_id", "normalized_domain");

-- CreateIndex
CREATE INDEX "job_schedules_tenant_id_enabled_next_run_at_idx" ON "job_schedules"("tenant_id", "enabled", "next_run_at");

-- CreateIndex
CREATE INDEX "job_schedules_tenant_id_campaign_id_idx" ON "job_schedules"("tenant_id", "campaign_id");

-- CreateIndex
CREATE INDEX "job_schedules_tenant_id_email_account_id_idx" ON "job_schedules"("tenant_id", "email_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_schedules_tenant_id_name_key" ON "job_schedules"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "job_runs_tenant_id_status_scheduled_for_idx" ON "job_runs"("tenant_id", "status", "scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "job_runs_tenant_id_schedule_id_scheduled_for_key" ON "job_runs"("tenant_id", "schedule_id", "scheduled_for");

-- CreateIndex
CREATE INDEX "job_tasks_tenant_id_status_available_at_idx" ON "job_tasks"("tenant_id", "status", "available_at");

-- CreateIndex
CREATE INDEX "job_tasks_tenant_id_run_id_idx" ON "job_tasks"("tenant_id", "run_id");

-- CreateIndex
CREATE UNIQUE INDEX "job_tasks_tenant_id_task_type_idempotency_key_key" ON "job_tasks"("tenant_id", "task_type", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "worker_leases_tenant_id_resource_type_resource_id_key" ON "worker_leases"("tenant_id", "resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "outbox_events_unpublished_idx" ON "outbox_events"("tenant_id", "occurred_at") WHERE (published_at IS NULL);

-- CreateIndex
CREATE INDEX "outbox_events_aggregate_idx" ON "outbox_events"("tenant_id", "aggregate_type", "aggregate_id", "occurred_at");

-- CreateIndex
CREATE INDEX "inbound_events_tenant_id_status_received_at_idx" ON "inbound_events"("tenant_id", "status", "received_at");

-- CreateIndex
CREATE INDEX "inbound_events_tenant_id_email_account_id_idx" ON "inbound_events"("tenant_id", "email_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "inbound_events_tenant_id_provider_event_key_key" ON "inbound_events"("tenant_id", "provider", "event_key");

-- CreateIndex
CREATE INDEX "integration_sync_cursors_tenant_id_email_account_id_idx" ON "integration_sync_cursors"("tenant_id", "email_account_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_sync_cursors_scope_key" ON "integration_sync_cursors"("tenant_id", "provider", "resource", "scope_key");

-- AddForeignKey
ALTER TABLE "email_accounts" ADD CONSTRAINT "email_accounts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "templates" ADD CONSTRAINT "templates_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenant_id_icp_id_fkey" FOREIGN KEY ("tenant_id", "icp_id") REFERENCES "icps"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenant_id_lead_list_id_fkey" FOREIGN KEY ("tenant_id", "lead_list_id") REFERENCES "lead_lists"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_tenant_id_email_account_id_fkey" FOREIGN KEY ("tenant_id", "email_account_id") REFERENCES "email_accounts"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sequences" ADD CONSTRAINT "sequences_tenant_id_campaign_id_fkey" FOREIGN KEY ("tenant_id", "campaign_id") REFERENCES "campaigns"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sequence_steps" ADD CONSTRAINT "sequence_steps_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sequence_steps" ADD CONSTRAINT "sequence_steps_tenant_id_sequence_id_fkey" FOREIGN KEY ("tenant_id", "sequence_id") REFERENCES "sequences"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sequence_steps" ADD CONSTRAINT "sequence_steps_tenant_id_template_id_fkey" FOREIGN KEY ("tenant_id", "template_id") REFERENCES "templates"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_tenant_id_campaign_id_fkey" FOREIGN KEY ("tenant_id", "campaign_id") REFERENCES "campaigns"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_tenant_id_campaign_id_sequence_id_fkey" FOREIGN KEY ("tenant_id", "campaign_id", "sequence_id") REFERENCES "sequences"("tenant_id", "campaign_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_tenant_id_contact_id_fkey" FOREIGN KEY ("tenant_id", "contact_id") REFERENCES "contacts"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_tenant_id_campaign_lead_id_sequence_id_fkey" FOREIGN KEY ("tenant_id", "campaign_lead_id", "sequence_id") REFERENCES "campaign_leads"("tenant_id", "id", "sequence_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_tenant_id_sequence_id_sequence_step_id_fkey" FOREIGN KEY ("tenant_id", "sequence_id", "sequence_step_id") REFERENCES "sequence_steps"("tenant_id", "sequence_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_tenant_id_template_id_fkey" FOREIGN KEY ("tenant_id", "template_id") REFERENCES "templates"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_tenant_id_created_by_membership_id_fkey" FOREIGN KEY ("tenant_id", "created_by_membership_id") REFERENCES "memberships"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_tenant_id_draft_id_fkey" FOREIGN KEY ("tenant_id", "draft_id") REFERENCES "drafts"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_tenant_id_decided_by_membership_id_fkey" FOREIGN KEY ("tenant_id", "decided_by_membership_id") REFERENCES "memberships"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "outbound_intents" ADD CONSTRAINT "outbound_intents_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "outbound_intents" ADD CONSTRAINT "outbound_intents_tenant_id_campaign_lead_id_fkey" FOREIGN KEY ("tenant_id", "campaign_lead_id") REFERENCES "campaign_leads"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "outbound_intents" ADD CONSTRAINT "outbound_intents_tenant_id_draft_id_campaign_lead_id_seque_fkey" FOREIGN KEY ("tenant_id", "draft_id", "campaign_lead_id", "sequence_step_id") REFERENCES "drafts"("tenant_id", "id", "campaign_lead_id", "sequence_step_id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "outbound_intents" ADD CONSTRAINT "outbound_intents_tenant_id_approval_id_draft_id_approval_d_fkey" FOREIGN KEY ("tenant_id", "approval_id", "draft_id", "approval_decision") REFERENCES "approvals"("tenant_id", "id", "draft_id", "decision") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "outbound_intents" ADD CONSTRAINT "outbound_intents_tenant_id_email_account_id_fkey" FOREIGN KEY ("tenant_id", "email_account_id") REFERENCES "email_accounts"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "outbound_attempts" ADD CONSTRAINT "outbound_attempts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "outbound_attempts" ADD CONSTRAINT "outbound_attempts_tenant_id_outbound_intent_id_fkey" FOREIGN KEY ("tenant_id", "outbound_intent_id") REFERENCES "outbound_intents"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "outbound_attempts" ADD CONSTRAINT "outbound_attempts_tenant_id_email_account_id_fkey" FOREIGN KEY ("tenant_id", "email_account_id") REFERENCES "email_accounts"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "outbound_attempts" ADD CONSTRAINT "outbound_attempts_tenant_id_email_thread_id_fkey" FOREIGN KEY ("tenant_id", "email_thread_id") REFERENCES "email_threads"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_tenant_id_email_account_id_fkey" FOREIGN KEY ("tenant_id", "email_account_id") REFERENCES "email_accounts"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "email_threads" ADD CONSTRAINT "email_threads_tenant_id_campaign_lead_id_fkey" FOREIGN KEY ("tenant_id", "campaign_lead_id") REFERENCES "campaign_leads"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_tenant_id_email_thread_id_email_account_i_fkey" FOREIGN KEY ("tenant_id", "email_thread_id", "email_account_id") REFERENCES "email_threads"("tenant_id", "id", "email_account_id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inbound_messages" ADD CONSTRAINT "inbound_messages_tenant_id_outbound_attempt_id_fkey" FOREIGN KEY ("tenant_id", "outbound_attempt_id") REFERENCES "outbound_attempts"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "suppressions" ADD CONSTRAINT "suppressions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "job_schedules" ADD CONSTRAINT "job_schedules_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "job_schedules" ADD CONSTRAINT "job_schedules_tenant_id_campaign_id_fkey" FOREIGN KEY ("tenant_id", "campaign_id") REFERENCES "campaigns"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "job_schedules" ADD CONSTRAINT "job_schedules_tenant_id_email_account_id_fkey" FOREIGN KEY ("tenant_id", "email_account_id") REFERENCES "email_accounts"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_tenant_id_schedule_id_fkey" FOREIGN KEY ("tenant_id", "schedule_id") REFERENCES "job_schedules"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "job_tasks" ADD CONSTRAINT "job_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "job_tasks" ADD CONSTRAINT "job_tasks_tenant_id_run_id_fkey" FOREIGN KEY ("tenant_id", "run_id") REFERENCES "job_runs"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "worker_leases" ADD CONSTRAINT "worker_leases_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inbound_events" ADD CONSTRAINT "inbound_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "inbound_events" ADD CONSTRAINT "inbound_events_tenant_id_email_account_id_fkey" FOREIGN KEY ("tenant_id", "email_account_id") REFERENCES "email_accounts"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "integration_sync_cursors" ADD CONSTRAINT "integration_sync_cursors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "integration_sync_cursors" ADD CONSTRAINT "integration_sync_cursors_tenant_id_email_account_id_fkey" FOREIGN KEY ("tenant_id", "email_account_id") REFERENCES "email_accounts"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
