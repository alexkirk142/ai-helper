-- Migration: Add commercial pricing fields to price_snapshots

ALTER TABLE price_snapshots
  ADD COLUMN IF NOT EXISTS market_min_price integer,
  ADD COLUMN IF NOT EXISTS market_max_price integer,
  ADD COLUMN IF NOT EXISTS market_avg_price integer,
  ADD COLUMN IF NOT EXISTS sale_price integer,
  ADD COLUMN IF NOT EXISTS margin_pct integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price_note text;
