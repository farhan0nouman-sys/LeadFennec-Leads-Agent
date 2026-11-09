-- AlterTable
ALTER TABLE "tenant_settings" ADD COLUMN     "send_policy" JSONB,
ADD COLUMN     "send_policy_version" INTEGER NOT NULL DEFAULT 0;

