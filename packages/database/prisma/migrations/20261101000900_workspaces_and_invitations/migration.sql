-- AlterEnum
ALTER TYPE "auth_throttle_scope" ADD VALUE 'INVITATION_EMAIL';

-- AlterEnum
BEGIN;
CREATE TYPE "membership_status_new" AS ENUM ('ACTIVE', 'SUSPENDED');
ALTER TABLE "memberships" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "memberships" ALTER COLUMN "status" TYPE "membership_status_new" USING ("status"::text::"membership_status_new");
ALTER TYPE "membership_status" RENAME TO "membership_status_old";
ALTER TYPE "membership_status_new" RENAME TO "membership_status";
DROP TYPE "membership_status_old";
ALTER TABLE "memberships" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';
COMMIT;

-- AlterTable
ALTER TABLE "memberships" ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

-- CreateTable
CREATE TABLE "invitations" (
    "tenant_id" UUID NOT NULL,
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "normalized_email" TEXT NOT NULL,
    "role_id" UUID NOT NULL,
    "invited_by_membership_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "accepted_membership_id" UUID,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("tenant_id","id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_tenant_id_role_id_idx" ON "invitations"("tenant_id", "role_id");

-- CreateIndex
CREATE INDEX "invitations_tenant_id_invited_by_membership_id_idx" ON "invitations"("tenant_id", "invited_by_membership_id");

-- CreateIndex
CREATE INDEX "invitations_tenant_id_accepted_membership_id_idx" ON "invitations"("tenant_id", "accepted_membership_id");

-- CreateIndex
CREATE INDEX "invitations_open_idx" ON "invitations"("tenant_id", "id" DESC) WHERE ((accepted_at IS NULL) AND (revoked_at IS NULL));

-- CreateIndex
CREATE UNIQUE INDEX "invitations_one_open_key" ON "invitations"("tenant_id", "normalized_email") WHERE ((accepted_at IS NULL) AND (revoked_at IS NULL));

-- CreateIndex
CREATE UNIQUE INDEX "job_tasks_id_key" ON "job_tasks"("id");

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_role_id_fkey" FOREIGN KEY ("tenant_id", "role_id") REFERENCES "roles"("tenant_id", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_invited_by_membership_id_fkey" FOREIGN KEY ("tenant_id", "invited_by_membership_id") REFERENCES "memberships"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_accepted_membership_id_fkey" FOREIGN KEY ("tenant_id", "accepted_membership_id") REFERENCES "memberships"("tenant_id", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
