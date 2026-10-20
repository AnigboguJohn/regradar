-- Team invites: an admin invites an email address; the person opens the emailed link,
-- chooses their own name and password, and joins the organisation with the given role.
-- Only a SHA-256 hash of the link token is stored. Links expire after 7 days and work once.
CREATE TABLE IF NOT EXISTS invites (
  id           bigserial PRIMARY KEY,
  org_id       uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email        text NOT NULL,
  role         text NOT NULL CHECK (role IN ('admin','member')),
  token_hash   text NOT NULL UNIQUE,
  invited_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  accepted_at  timestamptz,
  revoked_at   timestamptz
);
CREATE INDEX IF NOT EXISTS invites_org_idx ON invites (org_id, created_at DESC);
