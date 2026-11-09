
-- CreateEnum
CREATE TYPE "export_kind" AS ENUM ('LEADS');

-- CreateEnum
CREATE TYPE "export_status" AS ENUM ('READY', 'EXPIRED');

-- AlterEnum
ALTER TYPE "import_source" ADD VALUE 'CONTACT_CSV';

-- AlterEnum
ALTER TYPE "suppression_reason" ADD VALUE 'DELETION_REQUEST';

-- CreateTable
CREATE TABLE "exports" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "kind" "export_kind" NOT NULL,
    "status" "export_status" NOT NULL DEFAULT 'READY',
    "requested_by_membership_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "row_count" INTEGER NOT NULL,
    "truncated" BOOLEAN NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "content_sha256" CHAR(64) NOT NULL,
    "content" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "downloaded_at" TIMESTAMPTZ(3),
    "download_count" INTEGER NOT NULL DEFAULT 0,
    "purged_at" TIMESTAMPTZ(3),

    CONSTRAINT "exports_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateIndex
CREATE INDEX "exports_tenant_id_requested_by_membership_id_created_at_idx" ON "exports"("tenant_id", "requested_by_membership_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "exports_tenant_id_status_expires_at_idx" ON "exports"("tenant_id", "status", "expires_at");

-- AddForeignKey
ALTER TABLE "exports" ADD CONSTRAINT "exports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "exports" ADD CONSTRAINT "exports_tenant_id_requested_by_membership_id_fkey" FOREIGN KEY ("tenant_id", "requested_by_membership_id") REFERENCES "memberships"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

