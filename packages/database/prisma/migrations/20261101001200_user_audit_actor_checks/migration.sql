-- Task 04C (docs/decisions.md D-04C-03): users' own security events (sign-in, sign-out,
-- password reset…) are platform audit records with the USER actor. Hand-written; it must run
-- after the migration that adds the enum value, in its own transaction.

-- Tenant records: members, platform admins and system actors only; never USER.
ALTER TABLE "audit_records" DROP CONSTRAINT "audit_records_actor_check";
ALTER TABLE "audit_records"
  ADD CONSTRAINT "audit_records_actor_check" CHECK (
    CASE "actor_type"
      WHEN 'MEMBER' THEN "actor_user_id" IS NOT NULL AND "actor_membership_id" IS NOT NULL
        AND "actor_name" IS NULL
      WHEN 'PLATFORM_ADMIN' THEN "actor_user_id" IS NOT NULL AND "actor_membership_id" IS NULL
        AND "actor_name" IS NULL AND "reason" IS NOT NULL
      WHEN 'SYSTEM' THEN "actor_user_id" IS NULL AND "actor_membership_id" IS NULL
        AND "actor_name" IS NOT NULL
      ELSE false
    END
  );

-- Platform records: platform admins (with a reason), system actors, and users acting on their
-- own account (named by user id).
ALTER TABLE "platform_audit_records" DROP CONSTRAINT "platform_audit_records_actor_check";
ALTER TABLE "platform_audit_records"
  ADD CONSTRAINT "platform_audit_records_actor_check" CHECK (
    CASE "actor_type"
      WHEN 'PLATFORM_ADMIN' THEN "actor_user_id" IS NOT NULL AND "actor_name" IS NULL
        AND "reason" IS NOT NULL
      WHEN 'SYSTEM' THEN "actor_user_id" IS NULL AND "actor_name" IS NOT NULL
      WHEN 'USER' THEN "actor_user_id" IS NOT NULL AND "actor_name" IS NULL
      ELSE false
    END
  );
