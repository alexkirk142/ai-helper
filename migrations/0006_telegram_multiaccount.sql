-- Migration: Telegram Multi-account support
-- Adds authMethod, isEnabled fields to telegram_sessions table
-- Adds tenant index for efficient lookups

-- Make phoneNumber nullable (QR auth doesn't require phone)
ALTER TABLE "telegram_sessions" ALTER COLUMN "phone_number" DROP NOT NULL;

-- Add new columns
ALTER TABLE "telegram_sessions" ADD COLUMN IF NOT EXISTS "auth_method" text;
ALTER TABLE "telegram_sessions" ADD COLUMN IF NOT EXISTS "is_enabled" boolean NOT NULL DEFAULT true;

-- Add tenant index for multi-account queries
CREATE INDEX IF NOT EXISTS "telegram_sessions_tenant_idx" ON "telegram_sessions" ("tenant_id");
