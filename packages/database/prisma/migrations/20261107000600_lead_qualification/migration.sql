-- CreateEnum
CREATE TYPE "qualification_state" AS ENUM ('QUALIFIED', 'REVIEW', 'REJECTED');

-- CreateEnum
CREATE TYPE "qualification_origin" AS ENUM ('AUTOMATIC', 'PERSON');

-- CreateTable
CREATE TABLE "lead_qualifications" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "state" "qualification_state" NOT NULL,
    "origin" "qualification_origin" NOT NULL,
    "score_id" UUID,
    "eligibility_status" TEXT NOT NULL,
    "reasons" JSONB NOT NULL,
    "accepted_review_reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "note" TEXT,
    "decided_by_membership_id" UUID,
    "decided_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_qualifications_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateIndex
CREATE INDEX "lead_qualifications_tenant_id_contact_id_idx" ON "lead_qualifications"("tenant_id", "contact_id");

-- CreateIndex
CREATE INDEX "lead_qualifications_tenant_id_campaign_id_state_idx" ON "lead_qualifications"("tenant_id", "campaign_id", "state");

-- CreateIndex
CREATE INDEX "lead_qualifications_tenant_id_score_id_idx" ON "lead_qualifications"("tenant_id", "score_id");

-- CreateIndex
CREATE INDEX "lead_qualifications_tenant_id_decided_by_membership_id_idx" ON "lead_qualifications"("tenant_id", "decided_by_membership_id");

-- CreateIndex
CREATE UNIQUE INDEX "lead_qualifications_tenant_id_campaign_id_contact_id_versio_key" ON "lead_qualifications"("tenant_id", "campaign_id", "contact_id", "version");

-- AddForeignKey
ALTER TABLE "lead_qualifications" ADD CONSTRAINT "lead_qualifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lead_qualifications" ADD CONSTRAINT "lead_qualifications_tenant_id_campaign_id_fkey" FOREIGN KEY ("tenant_id", "campaign_id") REFERENCES "campaigns"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lead_qualifications" ADD CONSTRAINT "lead_qualifications_tenant_id_contact_id_fkey" FOREIGN KEY ("tenant_id", "contact_id") REFERENCES "contacts"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lead_qualifications" ADD CONSTRAINT "lead_qualifications_tenant_id_score_id_fkey" FOREIGN KEY ("tenant_id", "score_id") REFERENCES "scores"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "lead_qualifications" ADD CONSTRAINT "lead_qualifications_tenant_id_decided_by_membership_id_fkey" FOREIGN KEY ("tenant_id", "decided_by_membership_id") REFERENCES "memberships"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

