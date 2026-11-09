-- AlterEnum
ALTER TYPE "import_source" ADD VALUE 'ORGANIZATION_SEARCH';

-- AlterEnum
ALTER TYPE "source_provider" ADD VALUE 'FAKE';

-- AlterTable
ALTER TABLE "imports" ADD COLUMN     "error_code" TEXT,
ADD COLUMN     "icp_id" UUID,
ADD COLUMN     "query_sha256" CHAR(64),
ADD COLUMN     "result_limit" INTEGER,
ADD COLUMN     "search_filters" JSONB,
ADD COLUMN     "search_provider" "source_provider",
ADD COLUMN     "source_metadata" JSONB;

-- CreateIndex
CREATE INDEX "imports_tenant_id_icp_id_idx" ON "imports"("tenant_id", "icp_id");

-- AddForeignKey
ALTER TABLE "imports" ADD CONSTRAINT "imports_tenant_id_icp_id_fkey" FOREIGN KEY ("tenant_id", "icp_id") REFERENCES "icps"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
