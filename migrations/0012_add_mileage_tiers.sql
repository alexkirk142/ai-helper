-- Migration: 0012_add_mileage_tiers
-- Adds mileage tier threshold columns to tenant_agent_settings.
-- These define how to split found listings into 3 price/mileage tiers
-- for the two-step price dialog (price_options template).
--
--   quality tier:  mileage <= mileage_low  → expensive, low mileage
--   mid tier:      mileage <= mileage_mid  → average
--   budget tier:   mileage >  mileage_mid  → cheap, high mileage

ALTER TABLE tenant_agent_settings
  ADD COLUMN IF NOT EXISTS mileage_low  integer,
  ADD COLUMN IF NOT EXISTS mileage_mid  integer,
  ADD COLUMN IF NOT EXISTS mileage_high integer;
