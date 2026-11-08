-- AlterEnum
ALTER TYPE "draft_status" ADD VALUE 'INVALIDATED';

-- AlterEnum
ALTER TYPE "outbound_intent_cancel_reason" ADD VALUE 'LEAD_DATA_CHANGED';

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "contact_notes" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "body" TEXT NOT NULL,
    "created_by_membership_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_notes_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateTable
CREATE TABLE "contact_tags" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "tag" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_tags_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateIndex
CREATE INDEX "contact_notes_tenant_id_contact_id_created_at_idx" ON "contact_notes"("tenant_id", "contact_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "contact_notes_tenant_id_created_by_membership_id_idx" ON "contact_notes"("tenant_id", "created_by_membership_id");

-- CreateIndex
CREATE INDEX "contact_tags_tenant_id_tag_idx" ON "contact_tags"("tenant_id", "tag");

-- CreateIndex
CREATE UNIQUE INDEX "contact_tags_tenant_id_contact_id_tag_key" ON "contact_tags"("tenant_id", "contact_id", "tag");

-- AddForeignKey
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_tenant_id_contact_id_fkey" FOREIGN KEY ("tenant_id", "contact_id") REFERENCES "contacts"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "contact_notes" ADD CONSTRAINT "contact_notes_tenant_id_created_by_membership_id_fkey" FOREIGN KEY ("tenant_id", "created_by_membership_id") REFERENCES "memberships"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "contact_tags" ADD CONSTRAINT "contact_tags_tenant_id_contact_id_fkey" FOREIGN KEY ("tenant_id", "contact_id") REFERENCES "contacts"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

