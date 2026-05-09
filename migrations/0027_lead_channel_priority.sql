-- Migration: add lead_channel_priority to tenants
-- Stores the ordered list of channels for Marquiz lead auto-send routing.
-- NULL means legacy behaviour (MAX → Telegram hardcoded order).

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS lead_channel_priority TEXT[];
