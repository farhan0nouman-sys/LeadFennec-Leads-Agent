-- CreateEnum
CREATE TYPE "campaign_approval_mode" AS ENUM ('HUMAN', 'AUTOMATIC');

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "approval_mode" "campaign_approval_mode" NOT NULL DEFAULT 'HUMAN',
ADD COLUMN     "audience_filters" JSONB,
ADD COLUMN     "business_profile" JSONB,
ADD COLUMN     "daily_new_lead_limit" INTEGER,
ADD COLUMN     "exclusions" JSONB,
ADD COLUMN     "max_leads" INTEGER,
ADD COLUMN     "offer" JSONB,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;
