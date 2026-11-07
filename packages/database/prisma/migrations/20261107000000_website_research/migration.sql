-- CreateEnum
CREATE TYPE "research_origin" AS ENUM ('MODEL', 'REUSED', 'CORRECTION');

-- CreateEnum
CREATE TYPE "research_result_status" AS ENUM ('COMPLETED', 'REVIEW_REQUIRED', 'NO_CONTENT');

-- AlterTable
ALTER TABLE "evidence" ADD COLUMN     "content_sha256" CHAR(64),
ADD COLUMN     "extract_label" TEXT;

-- AlterTable
ALTER TABLE "research" ADD COLUMN     "based_on_id" UUID,
ADD COLUMN     "context_sha256" CHAR(64),
ADD COLUMN     "cost_micro_usd" BIGINT,
ADD COLUMN     "input_sha256" CHAR(64),
ADD COLUMN     "model_provider" TEXT,
ADD COLUMN     "origin" "research_origin",
ADD COLUMN     "prompt_sha256" CHAR(64),
ADD COLUMN     "refresh" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "result_status" "research_result_status",
ADD COLUMN     "schema_version" TEXT,
ADD COLUMN     "version" INTEGER;

-- CreateIndex
CREATE INDEX "research_tenant_id_organization_id_input_sha256_idx" ON "research"("tenant_id", "organization_id", "input_sha256");

-- CreateIndex
CREATE INDEX "research_tenant_id_based_on_id_idx" ON "research"("tenant_id", "based_on_id");

-- CreateIndex
CREATE UNIQUE INDEX "research_one_active_per_organization_key" ON "research"("tenant_id", "organization_id") WHERE ((status = ANY (ARRAY['PENDING'::research_status, 'RUNNING'::research_status])) AND (contact_id IS NULL));

-- CreateIndex
CREATE UNIQUE INDEX "research_organization_version_key" ON "research"("tenant_id", "organization_id", "version") WHERE (version IS NOT NULL);

-- AddForeignKey
ALTER TABLE "research" ADD CONSTRAINT "research_tenant_id_based_on_id_fkey" FOREIGN KEY ("tenant_id", "based_on_id") REFERENCES "research"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

