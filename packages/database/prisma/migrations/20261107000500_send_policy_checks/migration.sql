-- Task 10B (docs/decisions.md D-10B-*): the workspace's send policy. Hand-written: rules Prisma
-- can't express. The application validates the policy first (sendPolicySchema); these keep any
-- other writer within the same bounds.

ALTER TABLE "tenant_settings"
  ADD CONSTRAINT "tenant_settings_send_policy_check" CHECK (
    "send_policy" IS NULL
    OR (jsonb_typeof("send_policy") = 'object' AND octet_length("send_policy"::text) <= 16384)
  ),
  ADD CONSTRAINT "tenant_settings_send_policy_version_check" CHECK ("send_policy_version" >= 0);
