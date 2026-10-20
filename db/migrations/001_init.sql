-- RegRadar schema (PostgreSQL 16 + pgvector)
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email         text NOT NULL UNIQUE,
  name          text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Regulations (org_id IS NULL, shared by every tenant) and company policies (org_id set, private).
CREATE TABLE IF NOT EXISTS documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid REFERENCES organizations(id) ON DELETE CASCADE,
  kind          text NOT NULL CHECK (kind IN ('regulation','policy')),
  source_id     text NOT NULL,            -- e.g. 'cbn_circulars', 'upload'
  external_id   text NOT NULL,            -- id at the source (or upload hash)
  regulator     text,                     -- 'CBN', 'SEC', 'NDPC' ...
  ref_no        text,
  title         text NOT NULL,
  url           text,
  published_at  date,
  ingested_at   timestamptz NOT NULL DEFAULT now(),
  status        text NOT NULL DEFAULT 'ready' CHECK (status IN ('pending','ready','failed')),
  error         text,
  page_count    int,
  UNIQUE NULLS NOT DISTINCT (source_id, external_id, org_id)
);
CREATE INDEX IF NOT EXISTS documents_org_kind_idx ON documents (org_id, kind, published_at DESC);

CREATE TABLE IF NOT EXISTS chunks (
  id          bigserial PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  org_id      uuid REFERENCES organizations(id) ON DELETE CASCADE,
  ordinal     int  NOT NULL,
  page        int,
  heading     text,
  content     text NOT NULL,
  tsv         tsvector GENERATED ALWAYS AS (
                setweight(to_tsvector('english', coalesce(heading,'')), 'A') ||
                setweight(to_tsvector('english', content), 'B')) STORED,
  embedding   vector(1024)
);
CREATE INDEX IF NOT EXISTS chunks_tsv_idx ON chunks USING gin (tsv);
CREATE INDEX IF NOT EXISTS chunks_doc_idx ON chunks (document_id, ordinal);
CREATE INDEX IF NOT EXISTS chunks_org_idx ON chunks (org_id);
CREATE INDEX IF NOT EXISTS chunks_embedding_idx ON chunks USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS chat_messages (
  id          bigserial PRIMARY KEY,
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  question    text NOT NULL,
  answer      text NOT NULL,
  citations   jsonb NOT NULL DEFAULT '[]',
  mode        text NOT NULL,              -- 'llm' | 'extractive' | 'chat'
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS chat_org_idx ON chat_messages (org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS impact_findings (
  id              bigserial PRIMARY KEY,
  org_id          uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  regulation_id   uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  policy_id       uuid REFERENCES documents(id) ON DELETE CASCADE,
  severity        text NOT NULL CHECK (severity IN ('high','medium','low','info')),
  summary         text NOT NULL,
  recommendation  text,
  evidence        jsonb NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS impact_org_idx ON impact_findings (org_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS alert_settings (
  org_id      uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  emails      text[] NOT NULL DEFAULT '{}',
  regulators  text[] NOT NULL DEFAULT '{}',   -- empty = all
  keywords    text[] NOT NULL DEFAULT '{}',   -- empty = all
  enabled     boolean NOT NULL DEFAULT true
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          bigserial PRIMARY KEY,
  org_id      uuid REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  action      text NOT NULL,
  details     jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_org_idx ON audit_log (org_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ingest_runs (
  id          bigserial PRIMARY KEY,
  source_id   text NOT NULL,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  new_docs    int NOT NULL DEFAULT 0,
  error       text
);
