-- AlterEnum
ALTER TYPE "import_source" ADD VALUE 'CONTACT_ENRICHMENT';

-- DropIndex
DROP INDEX "contacts_tenant_id_organization_id_idx";

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "name_key" TEXT;

-- AlterTable
ALTER TABLE "source_records" ADD COLUMN     "confidence" INTEGER;

-- AlterTable
ALTER TABLE "verifications" ADD COLUMN     "reason" TEXT;

-- CreateIndex
CREATE INDEX "contacts_tenant_id_organization_id_name_key_idx" ON "contacts"("tenant_id", "organization_id", "name_key");

-- CreateIndex
CREATE INDEX "contacts_tenant_id_linkedin_url_idx" ON "contacts"("tenant_id", "linkedin_url");

