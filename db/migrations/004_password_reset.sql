-- Password reset by emailed 6-digit code, and signing out other sessions.
--
-- token_version is copied into every sign-in token; bumping it (password reset or change)
-- makes all earlier tokens invalid, so other devices are signed out.
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version integer NOT NULL DEFAULT 0;

-- Only an HMAC of each code is stored. A code works for 10 minutes and 5 attempts, once.
CREATE TABLE IF NOT EXISTS password_resets (
  id              bigserial PRIMARY KEY,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash       text NOT NULL,
  attempts        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz,
  invalidated_at  timestamptz
);
CREATE INDEX IF NOT EXISTS password_resets_user_idx ON password_resets (user_id, id DESC);
