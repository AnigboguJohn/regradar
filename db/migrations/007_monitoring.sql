-- Built-in error tracking and operational alerts (shown in the admin console).
--
-- app_errors groups identical errors by fingerprint, so one bug that happens 500 times is one
-- row with count = 500, not 500 rows. Sources: 'api' (server), 'web' (users' browsers), 'ai'.
CREATE TABLE IF NOT EXISTS app_errors (
  id           bigserial PRIMARY KEY,
  fingerprint  text NOT NULL UNIQUE,
  source       text NOT NULL CHECK (source IN ('api', 'web', 'ai')),
  message      text NOT NULL,
  stack        text,
  path         text,
  count        integer NOT NULL DEFAULT 1,
  first_seen   timestamptz NOT NULL DEFAULT now(),
  last_seen    timestamptz NOT NULL DEFAULT now(),
  last_context jsonb NOT NULL DEFAULT '{}',
  resolved_at  timestamptz
);
CREATE INDEX IF NOT EXISTS app_errors_last_seen_idx ON app_errors (last_seen DESC);

-- One row per alert condition (e.g. "ai_down"). firing -> emails admins; resolved -> "all clear" email.
CREATE TABLE IF NOT EXISTS ops_alerts (
  key           text PRIMARY KEY,
  status        text NOT NULL CHECK (status IN ('firing', 'resolved')),
  severity      text NOT NULL CHECK (severity IN ('critical', 'warning')),
  title         text NOT NULL,
  detail        text NOT NULL DEFAULT '',
  first_fired   timestamptz NOT NULL DEFAULT now(),
  last_notified timestamptz,
  resolved_at   timestamptz,
  fire_count    integer NOT NULL DEFAULT 1
);
