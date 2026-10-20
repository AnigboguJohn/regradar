-- Conversations: chat messages are grouped into threads that each user can come back to.
-- Remi reads a conversation's earlier turns so follow-up questions keep their context.
CREATE TABLE IF NOT EXISTS conversations (
  id          bigserial PRIMARY KEY,
  org_id      uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  title       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS conversations_user_idx ON conversations (org_id, user_id, updated_at DESC);

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS conversation_id bigint REFERENCES conversations(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS chat_conversation_idx ON chat_messages (conversation_id, id);

-- Questions asked before conversations existed each become a conversation of their own.
DO $$
DECLARE m record; cid bigint;
BEGIN
  FOR m IN SELECT id, org_id, user_id, question, created_at FROM chat_messages WHERE conversation_id IS NULL ORDER BY id LOOP
    INSERT INTO conversations (org_id, user_id, title, created_at, updated_at)
    VALUES (m.org_id, m.user_id, left(regexp_replace(m.question, '\s+', ' ', 'g'), 80), m.created_at, m.created_at)
    RETURNING id INTO cid;
    UPDATE chat_messages SET conversation_id = cid WHERE id = m.id;
  END LOOP;
END $$;
