-- Migration: add auto_reply_enabled to max_personal_accounts
-- Allows disabling individual accounts from Marquiz auto-response rotation
-- without deauthorizing them (they still receive/send messages normally).

ALTER TABLE "max_personal_accounts"
  ADD COLUMN IF NOT EXISTS "auto_reply_enabled" BOOLEAN NOT NULL DEFAULT TRUE;
