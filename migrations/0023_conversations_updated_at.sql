-- Track last conversation row update (e.g. status changes) for metrics like resolvedToday.
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS updated_at timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL;

UPDATE conversations
SET updated_at = COALESCE(last_message_at, created_at);
