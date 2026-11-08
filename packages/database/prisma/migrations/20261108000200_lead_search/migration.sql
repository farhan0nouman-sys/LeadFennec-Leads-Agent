-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "last_activity_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "contacts_tenant_id_last_activity_at_id_idx" ON "contacts"("tenant_id", "last_activity_at" DESC, "id");

-- CreateIndex
CREATE INDEX "contacts_tenant_id_country_code_idx" ON "contacts"("tenant_id", "country_code");
