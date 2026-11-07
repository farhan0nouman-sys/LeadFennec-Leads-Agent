-- CreateEnum
CREATE TYPE "score_band" AS ENUM ('HIGH_PRIORITY', 'REVIEW', 'LOW_PRIORITY');

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "scoring" JSONB;

-- AlterTable
ALTER TABLE "scores" ADD COLUMN     "band" "score_band",
ADD COLUMN     "campaign_id" UUID,
ADD COLUMN     "campaign_version" INTEGER,
ADD COLUMN     "input_sha256" CHAR(64),
ADD COLUMN     "inputs" JSONB,
ADD COLUMN     "verification_id" UUID,
ADD COLUMN     "version" INTEGER,
ALTER COLUMN "icp_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "score_evidence" (
    "tenant_id" UUID NOT NULL,
    "score_id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "score_evidence_pkey" PRIMARY KEY ("tenant_id","score_id","evidence_id")
);

-- CreateIndex
CREATE INDEX "score_evidence_tenant_id_evidence_id_idx" ON "score_evidence"("tenant_id", "evidence_id");

-- CreateIndex
CREATE INDEX "scores_tenant_id_campaign_id_contact_id_scored_at_idx" ON "scores"("tenant_id", "campaign_id", "contact_id", "scored_at" DESC);

-- CreateIndex
CREATE INDEX "scores_tenant_id_verification_id_idx" ON "scores"("tenant_id", "verification_id");

-- CreateIndex
CREATE UNIQUE INDEX "scores_lead_version_key" ON "scores"("tenant_id", "campaign_id", "contact_id", "version") WHERE (version IS NOT NULL);

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_tenant_id_campaign_id_fkey" FOREIGN KEY ("tenant_id", "campaign_id") REFERENCES "campaigns"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "scores" ADD CONSTRAINT "scores_tenant_id_verification_id_fkey" FOREIGN KEY ("tenant_id", "verification_id") REFERENCES "verifications"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "score_evidence" ADD CONSTRAINT "score_evidence_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "score_evidence" ADD CONSTRAINT "score_evidence_tenant_id_score_id_fkey" FOREIGN KEY ("tenant_id", "score_id") REFERENCES "scores"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "score_evidence" ADD CONSTRAINT "score_evidence_tenant_id_evidence_id_fkey" FOREIGN KEY ("tenant_id", "evidence_id") REFERENCES "evidence"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

