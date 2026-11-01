-- Integrity rules for authentication (task 04A, docs/decisions.md D-04A-*). Hand-written;
-- Prisma does not model CHECK constraints or functions, so it neither generates nor drops them.

-- SHA-256 in lower-case hex: the only form in which session and emailed tokens are stored.
CREATE FUNCTION "is_sha256_hex"(value text) RETURNS boolean
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  RETURN value ~ '^[0-9a-f]{64}$';

ALTER TABLE "user_credentials"
  -- An Argon2id PHC string. A plain password cannot take this shape.
  ADD CONSTRAINT "user_credentials_password_hash_check" CHECK (
    "password_hash" ~ '^\$argon2id\$v=19\$m=[0-9]+,t=[0-9]+,p=[0-9]+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$'
    AND char_length("password_hash") <= 255
  );

ALTER TABLE "user_sessions"
  ADD CONSTRAINT "user_sessions_token_hash_check" CHECK ("is_sha256_hex"("token_hash")),
  -- The idle end never passes the absolute end; both come after the start.
  ADD CONSTRAINT "user_sessions_timing_check" CHECK (
    "last_seen_at" >= "created_at"
    AND "idle_expires_at" > "created_at"
    AND "idle_expires_at" <= "absolute_expires_at"
  ),
  ADD CONSTRAINT "user_sessions_end_check" CHECK (
    ("ended_at" IS NULL) = ("end_reason" IS NULL) AND "ended_at" >= "created_at"
  );

ALTER TABLE "auth_tokens"
  ADD CONSTRAINT "auth_tokens_token_hash_check" CHECK ("is_sha256_hex"("token_hash")),
  ADD CONSTRAINT "auth_tokens_email_check" CHECK ("is_normalized_email"("email")),
  -- A token is used, if at all, between its creation and its expiry.
  ADD CONSTRAINT "auth_tokens_timing_check" CHECK (
    "expires_at" > "created_at" AND "used_at" BETWEEN "created_at" AND "expires_at"
  );

ALTER TABLE "auth_throttles"
  ADD CONSTRAINT "auth_throttles_key_hash_check" CHECK ("is_sha256_hex"("key_hash")),
  ADD CONSTRAINT "auth_throttles_attempts_check" CHECK ("attempts" >= 0),
  ADD CONSTRAINT "auth_throttles_lock_check" CHECK ("locked_until" > "window_started_at");
