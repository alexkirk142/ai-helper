-- Migration: add mediaUrl and apiUrl to max_personal_accounts
-- GREEN-API provides separate hosts for API calls and file uploads.
-- mediaUrl is REQUIRED for sendFileByUpload; apiUrl is the standard API host.
-- Both are visible in the GREEN-API personal account dashboard.

ALTER TABLE "max_personal_accounts"
  ADD COLUMN IF NOT EXISTS "media_url" TEXT;

ALTER TABLE "max_personal_accounts"
  ADD COLUMN IF NOT EXISTS "api_url" TEXT;
