-- Migration: add telegram_last_seen_whatsapp_fallback to tenants
-- When true, sending via Telegram is preceded by a last-seen check.
-- If the user was last online > 24 hours ago, the system automatically
-- tries WhatsApp Personal instead of (or before) Telegram.

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS telegram_last_seen_whatsapp_fallback BOOLEAN NOT NULL DEFAULT false;
