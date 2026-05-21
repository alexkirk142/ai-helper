-- Add provider discriminator to max_personal_accounts
-- 'green_api' = existing GREEN-API cloud instances (default, backward compat)
-- 'max_gateway' = new instances created via max-gateway admin API
ALTER TABLE "max_personal_accounts"
  ADD COLUMN IF NOT EXISTS "provider" TEXT NOT NULL DEFAULT 'green_api';
