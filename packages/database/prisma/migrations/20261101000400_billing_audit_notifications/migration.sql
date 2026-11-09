-- CreateEnum
CREATE TYPE "billing_plan_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "billing_interval" AS ENUM ('MONTH', 'YEAR');

-- CreateEnum
CREATE TYPE "usage_metric" AS ENUM ('AI_TOKENS', 'LEAD_ENRICHMENTS', 'EMAIL_VERIFICATIONS', 'EMAILS_SENT');

-- CreateEnum
CREATE TYPE "billing_provider" AS ENUM ('STRIPE', 'MANUAL');

-- CreateEnum
CREATE TYPE "subscription_status" AS ENUM ('INCOMPLETE', 'INCOMPLETE_EXPIRED', 'TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'UNPAID', 'PAUSED');

-- CreateEnum
CREATE TYPE "payment_event_kind" AS ENUM ('PAYMENT_SUCCEEDED', 'PAYMENT_FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "usage_reservation_status" AS ENUM ('HELD', 'COMMITTED', 'RELEASED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "usage_ledger_entry_kind" AS ENUM ('USAGE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "audit_actor_type" AS ENUM ('MEMBER', 'PLATFORM_ADMIN', 'SYSTEM');

-- CreateTable
CREATE TABLE "billing_plans" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "billing_plan_status" NOT NULL DEFAULT 'ACTIVE',
    "currency" CHAR(3) NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "interval" "billing_interval" NOT NULL,
    "external_price_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "billing_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_limits" (
    "plan_id" UUID NOT NULL,
    "metric" "usage_metric" NOT NULL,
    "quantity_per_period" BIGINT NOT NULL,

    CONSTRAINT "plan_limits_pkey" PRIMARY KEY ("plan_id","metric")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "provider" "billing_provider" NOT NULL,
    "status" "subscription_status" NOT NULL,
    "external_customer_id" TEXT,
    "external_subscription_id" TEXT,
    "current_period_start" TIMESTAMPTZ(3) NOT NULL,
    "current_period_end" TIMESTAMPTZ(3) NOT NULL,
    "trial_ends_at" TIMESTAMPTZ(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "canceled_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "last_synced_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "provider" "billing_provider" NOT NULL,
    "external_event_id" TEXT,
    "kind" "payment_event_kind" NOT NULL,
    "subscription_id" UUID,
    "inbound_event_id" UUID,
    "external_object_id" TEXT,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "failure_code" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "tenant_limit_overrides" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "metric" "usage_metric" NOT NULL,
    "quantity_per_period" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_limit_overrides_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "usage_reservations" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "metric" "usage_metric" NOT NULL,
    "quantity" BIGINT NOT NULL,
    "period_start" TIMESTAMPTZ(3) NOT NULL,
    "status" "usage_reservation_status" NOT NULL DEFAULT 'HELD',
    "idempotency_key" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "committed_quantity" BIGINT,
    "settled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "usage_reservations_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "usage_ledger_entries" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "metric" "usage_metric" NOT NULL,
    "period_start" TIMESTAMPTZ(3) NOT NULL,
    "kind" "usage_ledger_entry_kind" NOT NULL,
    "quantity" BIGINT NOT NULL,
    "reservation_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "note" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usage_ledger_entries_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "tenant_branding" (
    "tenant_id" UUID NOT NULL,
    "display_name" TEXT,
    "logo_url" TEXT,
    "primary_color" TEXT,
    "accent_color" TEXT,
    "email_footer" TEXT,
    "support_email" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_branding_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "audit_records" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "actor_type" "audit_actor_type" NOT NULL,
    "actor_user_id" UUID,
    "actor_membership_id" UUID,
    "actor_name" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" UUID,
    "reason" TEXT,
    "request_id" TEXT,
    "metadata" JSONB,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_records_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "platform_audit_records" (
    "id" UUID NOT NULL,
    "actor_type" "audit_actor_type" NOT NULL,
    "actor_user_id" UUID,
    "actor_name" TEXT,
    "action" TEXT NOT NULL,
    "subject_tenant_id" UUID,
    "target_type" TEXT,
    "target_id" UUID,
    "reason" TEXT,
    "request_id" TEXT,
    "metadata" JSONB,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_audit_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "recipient_membership_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link_path" TEXT,
    "dedupe_key" TEXT,
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateIndex
CREATE UNIQUE INDEX "billing_plans_key_key" ON "billing_plans"("key");

-- CreateIndex
CREATE UNIQUE INDEX "billing_plans_external_price_id_key" ON "billing_plans"("external_price_id");

-- CreateIndex
CREATE INDEX "subscriptions_tenant_id_status_idx" ON "subscriptions"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "subscriptions_plan_id_idx" ON "subscriptions"("plan_id");

-- CreateIndex
CREATE INDEX "subscriptions_provider_external_customer_id_idx" ON "subscriptions"("provider", "external_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_external_subscription_key" ON "subscriptions"("provider", "external_subscription_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_one_current_key" ON "subscriptions"("tenant_id") WHERE (status <> ALL (ARRAY['INCOMPLETE_EXPIRED'::subscription_status, 'CANCELED'::subscription_status]));

-- CreateIndex
CREATE INDEX "payment_events_tenant_id_subscription_id_occurred_at_idx" ON "payment_events"("tenant_id", "subscription_id", "occurred_at");

-- CreateIndex
CREATE INDEX "payment_events_tenant_id_occurred_at_idx" ON "payment_events"("tenant_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_provider_event_key" ON "payment_events"("tenant_id", "provider", "external_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_tenant_id_inbound_event_id_key" ON "payment_events"("tenant_id", "inbound_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_limit_overrides_tenant_id_metric_key" ON "tenant_limit_overrides"("tenant_id", "metric");

-- CreateIndex
CREATE INDEX "usage_reservations_tenant_id_metric_period_start_status_idx" ON "usage_reservations"("tenant_id", "metric", "period_start", "status");

-- CreateIndex
CREATE UNIQUE INDEX "usage_reservations_tenant_id_idempotency_key_key" ON "usage_reservations"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "usage_reservations_tenant_id_id_metric_period_start_key" ON "usage_reservations"("tenant_id", "id", "metric", "period_start");

-- CreateIndex
CREATE INDEX "usage_ledger_entries_tenant_id_metric_period_start_idx" ON "usage_ledger_entries"("tenant_id", "metric", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "usage_ledger_entries_tenant_id_idempotency_key_key" ON "usage_ledger_entries"("tenant_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "usage_ledger_entries_tenant_id_reservation_id_key" ON "usage_ledger_entries"("tenant_id", "reservation_id");

-- CreateIndex
CREATE INDEX "audit_records_tenant_id_target_type_target_id_id_idx" ON "audit_records"("tenant_id", "target_type", "target_id", "id");

-- CreateIndex
CREATE INDEX "audit_records_tenant_id_actor_user_id_id_idx" ON "audit_records"("tenant_id", "actor_user_id", "id");

-- CreateIndex
CREATE INDEX "platform_audit_records_subject_tenant_id_id_idx" ON "platform_audit_records"("subject_tenant_id", "id");

-- CreateIndex
CREATE INDEX "platform_audit_records_actor_user_id_id_idx" ON "platform_audit_records"("actor_user_id", "id");

-- CreateIndex
CREATE INDEX "notifications_tenant_id_recipient_membership_id_id_idx" ON "notifications"("tenant_id", "recipient_membership_id", "id");

-- CreateIndex
CREATE INDEX "notifications_unread_idx" ON "notifications"("tenant_id", "recipient_membership_id") WHERE (read_at IS NULL);

-- CreateIndex
CREATE UNIQUE INDEX "notifications_tenant_id_recipient_membership_id_dedupe_key_key" ON "notifications"("tenant_id", "recipient_membership_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "plan_limits" ADD CONSTRAINT "plan_limits_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "billing_plans"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "billing_plans"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_tenant_id_subscription_id_fkey" FOREIGN KEY ("tenant_id", "subscription_id") REFERENCES "subscriptions"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_tenant_id_inbound_event_id_fkey" FOREIGN KEY ("tenant_id", "inbound_event_id") REFERENCES "inbound_events"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "tenant_limit_overrides" ADD CONSTRAINT "tenant_limit_overrides_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "usage_reservations" ADD CONSTRAINT "usage_reservations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "usage_ledger_entries" ADD CONSTRAINT "usage_ledger_entries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "usage_ledger_entries" ADD CONSTRAINT "usage_ledger_entries_reservation_fkey" FOREIGN KEY ("tenant_id", "reservation_id", "metric", "period_start") REFERENCES "usage_reservations"("tenant_id", "id", "metric", "period_start") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "tenant_branding" ADD CONSTRAINT "tenant_branding_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "audit_records" ADD CONSTRAINT "audit_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_recipient_membership_id_fkey" FOREIGN KEY ("tenant_id", "recipient_membership_id") REFERENCES "memberships"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
