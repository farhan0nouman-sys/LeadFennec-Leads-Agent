-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "tenant_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "deployment_mode" AS ENUM ('HOSTED', 'DEDICATED');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "icp_status" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "contact_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "lead_list_status" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "import_source" AS ENUM ('CSV', 'APOLLO');

-- CreateEnum
CREATE TYPE "import_status" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "source_provider" AS ENUM ('APOLLO', 'CSV_IMPORT', 'MANUAL', 'WEBSITE');

-- CreateEnum
CREATE TYPE "research_status" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "evidence_kind" AS ENUM ('WEBSITE_EXCERPT', 'PROVIDER_FIELD', 'AI_EXTRACTION', 'MANUAL_NOTE');

-- CreateEnum
CREATE TYPE "score_method" AS ENUM ('RULES', 'AI', 'MANUAL');

-- CreateEnum
CREATE TYPE "verification_status" AS ENUM ('VALID', 'INVALID', 'RISKY', 'UNKNOWN');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "tenant_status" NOT NULL DEFAULT 'ACTIVE',
    "deployment_mode" "deployment_mode" NOT NULL DEFAULT 'HOSTED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "normalized_email" TEXT NOT NULL,
    "display_name" TEXT,
    "is_platform_admin" BOOLEAN NOT NULL DEFAULT false,
    "status" "user_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "tenant_settings" (
    "tenant_id" UUID NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "require_send_approval" BOOLEAN NOT NULL DEFAULT true,
    "outbound_sending_enabled" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "roles" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "tenant_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "permission_key" TEXT NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("tenant_id","role_id","permission_key")
);

-- CreateTable
CREATE TABLE "memberships" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "status" "membership_status" NOT NULL DEFAULT 'INVITED',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "icps" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "criteria" JSONB NOT NULL,
    "status" "icp_status" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "icps_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "normalized_domain" TEXT,
    "website_url" TEXT,
    "industry" TEXT,
    "employee_count" INTEGER,
    "country_code" CHAR(2),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "organization_id" UUID,
    "first_name" TEXT,
    "last_name" TEXT,
    "title" TEXT,
    "email" TEXT,
    "normalized_email" TEXT,
    "email_domain" TEXT,
    "linkedin_url" TEXT,
    "phone" TEXT,
    "country_code" CHAR(2),
    "status" "contact_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "lead_lists" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "icp_id" UUID,
    "status" "lead_list_status" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lead_lists_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "lead_list_members" (
    "tenant_id" UUID NOT NULL,
    "lead_list_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "added_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_list_members_pkey" PRIMARY KEY ("tenant_id","lead_list_id","contact_id")
);

-- CreateTable
CREATE TABLE "imports" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "source" "import_source" NOT NULL,
    "status" "import_status" NOT NULL DEFAULT 'PENDING',
    "file_name" TEXT,
    "lead_list_id" UUID,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "imported_rows" INTEGER NOT NULL DEFAULT 0,
    "skipped_rows" INTEGER NOT NULL DEFAULT 0,
    "failed_rows" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "imports_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "source_records" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "provider" "source_provider" NOT NULL,
    "external_id" TEXT,
    "import_id" UUID,
    "import_row_number" INTEGER,
    "contact_id" UUID,
    "organization_id" UUID,
    "payload" JSONB NOT NULL,
    "payload_sha256" CHAR(64) NOT NULL,
    "fetched_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_records_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "research" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "contact_id" UUID,
    "organization_id" UUID,
    "icp_id" UUID,
    "status" "research_status" NOT NULL DEFAULT 'PENDING',
    "summary" TEXT,
    "findings" JSONB,
    "model" TEXT,
    "prompt_version" TEXT,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "error_code" TEXT,
    "started_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "research_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "evidence" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "kind" "evidence_kind" NOT NULL,
    "contact_id" UUID,
    "organization_id" UUID,
    "research_id" UUID,
    "source_record_id" UUID,
    "source_url" TEXT,
    "excerpt" TEXT NOT NULL,
    "captured_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidence_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "scores" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "icp_id" UUID NOT NULL,
    "contact_id" UUID,
    "organization_id" UUID,
    "research_id" UUID,
    "value" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "method" "score_method" NOT NULL,
    "method_version" TEXT,
    "scored_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scores_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "normalized_email" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "verification_status" NOT NULL,
    "checked_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_normalized_email_key" ON "users"("normalized_email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenant_id_key_key" ON "roles"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "role_permissions_permission_key_idx" ON "role_permissions"("permission_key");

-- CreateIndex
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");

-- CreateIndex
CREATE INDEX "memberships_tenant_id_role_id_idx" ON "memberships"("tenant_id", "role_id");

-- CreateIndex
CREATE UNIQUE INDEX "memberships_tenant_id_user_id_key" ON "memberships"("tenant_id", "user_id");

-- CreateIndex
CREATE INDEX "icps_tenant_id_status_idx" ON "icps"("tenant_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "icps_tenant_id_name_key" ON "icps"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "organizations_tenant_id_name_idx" ON "organizations"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_tenant_id_normalized_domain_key" ON "organizations"("tenant_id", "normalized_domain");

-- CreateIndex
CREATE INDEX "contacts_tenant_id_organization_id_idx" ON "contacts"("tenant_id", "organization_id");

-- CreateIndex
CREATE INDEX "contacts_tenant_id_email_domain_idx" ON "contacts"("tenant_id", "email_domain");

-- CreateIndex
CREATE INDEX "contacts_tenant_id_status_created_at_idx" ON "contacts"("tenant_id", "status", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "contacts_tenant_id_normalized_email_key" ON "contacts"("tenant_id", "normalized_email");

-- CreateIndex
CREATE INDEX "lead_lists_tenant_id_icp_id_idx" ON "lead_lists"("tenant_id", "icp_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_lists_tenant_id_name_key" ON "lead_lists"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "lead_list_members_tenant_id_lead_list_id_added_at_idx" ON "lead_list_members"("tenant_id", "lead_list_id", "added_at" DESC);

-- CreateIndex
CREATE INDEX "lead_list_members_tenant_id_contact_id_idx" ON "lead_list_members"("tenant_id", "contact_id");

-- CreateIndex
CREATE INDEX "imports_tenant_id_status_idx" ON "imports"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "imports_tenant_id_created_at_idx" ON "imports"("tenant_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "imports_tenant_id_lead_list_id_idx" ON "imports"("tenant_id", "lead_list_id");

-- CreateIndex
CREATE INDEX "source_records_tenant_id_contact_id_idx" ON "source_records"("tenant_id", "contact_id");

-- CreateIndex
CREATE INDEX "source_records_tenant_id_organization_id_idx" ON "source_records"("tenant_id", "organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_records_tenant_id_provider_external_id_key" ON "source_records"("tenant_id", "provider", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_records_tenant_id_import_id_import_row_number_key" ON "source_records"("tenant_id", "import_id", "import_row_number");

-- CreateIndex
CREATE INDEX "research_tenant_id_contact_id_created_at_idx" ON "research"("tenant_id", "contact_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "research_tenant_id_organization_id_created_at_idx" ON "research"("tenant_id", "organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "research_tenant_id_status_idx" ON "research"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "research_tenant_id_icp_id_idx" ON "research"("tenant_id", "icp_id");

-- CreateIndex
CREATE INDEX "evidence_tenant_id_contact_id_idx" ON "evidence"("tenant_id", "contact_id");

-- CreateIndex
CREATE INDEX "evidence_tenant_id_organization_id_idx" ON "evidence"("tenant_id", "organization_id");

-- CreateIndex
CREATE INDEX "evidence_tenant_id_research_id_idx" ON "evidence"("tenant_id", "research_id");

-- CreateIndex
CREATE INDEX "evidence_tenant_id_source_record_id_idx" ON "evidence"("tenant_id", "source_record_id");

-- CreateIndex
CREATE INDEX "scores_tenant_id_icp_id_value_idx" ON "scores"("tenant_id", "icp_id", "value" DESC);

-- CreateIndex
CREATE INDEX "scores_tenant_id_contact_id_scored_at_idx" ON "scores"("tenant_id", "contact_id", "scored_at" DESC);

-- CreateIndex
CREATE INDEX "scores_tenant_id_organization_id_scored_at_idx" ON "scores"("tenant_id", "organization_id", "scored_at" DESC);

-- CreateIndex
CREATE INDEX "scores_tenant_id_research_id_idx" ON "scores"("tenant_id", "research_id");

-- CreateIndex
CREATE INDEX "verifications_tenant_id_contact_id_checked_at_idx" ON "verifications"("tenant_id", "contact_id", "checked_at" DESC);

-- CreateIndex
CREATE INDEX "verifications_tenant_id_normalized_email_idx" ON "verifications"("tenant_id", "normalized_email");

-- AddForeignKey
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_tenant_id_role_id_fkey" FOREIGN KEY ("tenant_id", "role_id") REFERENCES "roles"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_key_fkey" FOREIGN KEY ("permission_key") REFERENCES "permissions"("key") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_role_id_fkey" FOREIGN KEY ("tenant_id", "role_id") REFERENCES "roles"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "icps" ADD CONSTRAINT "icps_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_organization_id_fkey" FOREIGN KEY ("tenant_id", "organization_id") REFERENCES "organizations"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lead_lists" ADD CONSTRAINT "lead_lists_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lead_lists" ADD CONSTRAINT "lead_lists_tenant_id_icp_id_fkey" FOREIGN KEY ("tenant_id", "icp_id") REFERENCES "icps"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lead_list_members" ADD CONSTRAINT "lead_list_members_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lead_list_members" ADD CONSTRAINT "lead_list_members_tenant_id_lead_list_id_fkey" FOREIGN KEY ("tenant_id", "lead_list_id") REFERENCES "lead_lists"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lead_list_members" ADD CONSTRAINT "lead_list_members_tenant_id_contact_id_fkey" FOREIGN KEY ("tenant_id", "contact_id") REFERENCES "contacts"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "imports" ADD CONSTRAINT "imports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "imports" ADD CONSTRAINT "imports_tenant_id_lead_list_id_fkey" FOREIGN KEY ("tenant_id", "lead_list_id") REFERENCES "lead_lists"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_tenant_id_import_id_fkey" FOREIGN KEY ("tenant_id", "import_id") REFERENCES "imports"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_tenant_id_contact_id_fkey" FOREIGN KEY ("tenant_id", "contact_id") REFERENCES "contacts"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_tenant_id_organization_id_fkey" FOREIGN KEY ("tenant_id", "organization_id") REFERENCES "organizations"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "research" ADD CONSTRAINT "research_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "research" ADD CONSTRAINT "research_tenant_id_contact_id_fkey" FOREIGN KEY ("tenant_id", "contact_id") REFERENCES "contacts"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "research" ADD CONSTRAINT "research_tenant_id_organization_id_fkey" FOREIGN KEY ("tenant_id", "organization_id") REFERENCES "organizations"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "research" ADD CONSTRAINT "research_tenant_id_icp_id_fkey" FOREIGN KEY ("tenant_id", "icp_id") REFERENCES "icps"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_tenant_id_contact_id_fkey" FOREIGN KEY ("tenant_id", "contact_id") REFERENCES "contacts"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_tenant_id_organization_id_fkey" FOREIGN KEY ("tenant_id", "organization_id") REFERENCES "organizations"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_tenant_id_research_id_fkey" FOREIGN KEY ("tenant_id", "research_id") REFERENCES "research"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "evidence" ADD CONSTRAINT "evidence_tenant_id_source_record_id_fkey" FOREIGN KEY ("tenant_id", "source_record_id") REFERENCES "source_records"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_tenant_id_icp_id_fkey" FOREIGN KEY ("tenant_id", "icp_id") REFERENCES "icps"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_tenant_id_contact_id_fkey" FOREIGN KEY ("tenant_id", "contact_id") REFERENCES "contacts"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_tenant_id_organization_id_fkey" FOREIGN KEY ("tenant_id", "organization_id") REFERENCES "organizations"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_tenant_id_research_id_fkey" FOREIGN KEY ("tenant_id", "research_id") REFERENCES "research"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "verifications" ADD CONSTRAINT "verifications_tenant_id_contact_id_fkey" FOREIGN KEY ("tenant_id", "contact_id") REFERENCES "contacts"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
