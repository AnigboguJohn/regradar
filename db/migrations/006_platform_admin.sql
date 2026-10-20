-- Platform admin console (/admin): the RegRadar operator's accounts, kept completely separate
-- from company users. Each admin signs in with a password plus an authenticator-app code (TOTP).
CREATE TABLE IF NOT EXISTS platform_admins (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL UNIQUE,
  name           text NOT NULL,
  password_hash  text NOT NULL,
  totp_secret    text,                         -- encrypted with the server secret; NULL until set up
  totp_enabled   boolean NOT NULL DEFAULT false,
  token_version  integer NOT NULL DEFAULT 0,   -- bumped on sign-out / password change to end sessions
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_login_at  timestamptz,
  disabled_at    timestamptz
);

-- What admins did (kept apart from each company's own audit log).
CREATE TABLE IF NOT EXISTS admin_audit (
  id          bigserial PRIMARY KEY,
  admin_id    uuid REFERENCES platform_admins(id) ON DELETE SET NULL,
  action      text NOT NULL,
  details     jsonb NOT NULL DEFAULT '{}',
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit (created_at DESC);

-- Suspending a company signs out and blocks all its users; suspending a user blocks just them.
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS suspended_at timestamptz;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at timestamptz;

CREATE INDEX IF NOT EXISTS audit_log_created_idx ON audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS users_created_idx ON users (created_at DESC);
