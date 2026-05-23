-- Add assignedAccountId to proxies for per-account proxy assignment
-- (no FK constraint — used for Telegram accounts and WhatsApp sessions
--  that live in tables other than channels)
ALTER TABLE proxies ADD COLUMN IF NOT EXISTS assigned_account_id TEXT;
CREATE INDEX IF NOT EXISTS proxies_account_idx ON proxies (assigned_account_id);
