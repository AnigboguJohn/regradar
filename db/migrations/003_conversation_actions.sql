-- Conversation menu actions: pin to the top, archive out of the sidebar, and delete.
-- Delete is a soft delete: the conversation disappears for the user, but its messages stay
-- in the database so the audit trail of questions and answers remains complete.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS pinned_at   timestamptz;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS deleted_at  timestamptz;
