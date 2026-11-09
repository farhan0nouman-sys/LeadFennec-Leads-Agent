-- CreateEnum
CREATE TYPE "source_record_outcome" AS ENUM ('CREATED', 'MATCHED', 'EXCLUDED', 'FAILED');

-- AlterEnum
ALTER TYPE "usage_metric" ADD VALUE 'ORGANIZATION_SEARCH_CREDITS';

-- DropIndex
DROP INDEX "source_records_tenant_id_provider_external_id_key";

-- AlterTable
ALTER TABLE "imports" ADD COLUMN     "cursor" TEXT,
ADD COLUMN     "pages_fetched" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "organizations" ADD COLUMN     "name_key" TEXT;

-- AlterTable
ALTER TABLE "source_records" ADD COLUMN     "issues" JSONB,
ADD COLUMN     "outcome" "source_record_outcome";

-- CreateIndex
CREATE INDEX "organizations_tenant_id_name_key_idx" ON "organizations"("tenant_id", "name_key");

-- CreateIndex
CREATE INDEX "source_records_tenant_id_provider_external_id_idx" ON "source_records"("tenant_id", "provider", "external_id");

