-- Campaign configuration rules (task 06A, docs/decisions.md D-06A-*). Hand-written; Prisma
-- does not model CHECK constraints. The application validates the same bounds first (shared
-- campaigns contract); these keep any other writer within them.

ALTER TABLE "campaigns"
  ADD CONSTRAINT "campaigns_version_check" CHECK ("version" >= 1),
  ADD CONSTRAINT "campaigns_name_check" CHECK (char_length(btrim("name")) BETWEEN 1 AND 120),
  ADD CONSTRAINT "campaigns_description_check" CHECK (char_length("description") <= 2000),
  ADD CONSTRAINT "campaigns_lead_limits_check" CHECK (
    ("daily_new_lead_limit" IS NULL OR "daily_new_lead_limit" BETWEEN 1 AND 500)
    AND ("max_leads" IS NULL OR "max_leads" BETWEEN 1 AND 50000)
    AND ("daily_new_lead_limit" IS NULL OR "max_leads" IS NULL
         OR "daily_new_lead_limit" <= "max_leads")
  ),
  -- Each configuration section is one JSON object of bounded size.
  ADD CONSTRAINT "campaigns_configuration_json_check" CHECK (
    ("business_profile" IS NULL OR (jsonb_typeof("business_profile") = 'object'
      AND octet_length("business_profile"::text) <= 16384))
    AND ("offer" IS NULL OR (jsonb_typeof("offer") = 'object'
      AND octet_length("offer"::text) <= 16384))
    AND ("audience_filters" IS NULL OR (jsonb_typeof("audience_filters") = 'object'
      AND octet_length("audience_filters"::text) <= 16384))
    AND ("exclusions" IS NULL OR (jsonb_typeof("exclusions") = 'object'
      AND octet_length("exclusions"::text) <= 65536))
  );
