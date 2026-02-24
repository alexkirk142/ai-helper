-- Migration 0011: Update price_snapshots for global cache + OpenAI web search
-- Changes:
--   1. Make tenant_id nullable (global cache entries have tenant_id = NULL)
--   2. Add new columns for transmission identification and mileage data
--   3. Add expires_at for TTL-based cache invalidation
--   4. Add index on (oem, expires_at DESC) for efficient global cache lookups

-- 1. Make tenant_id nullable
ALTER TABLE price_snapshots ALTER COLUMN tenant_id DROP NOT NULL;

-- 2. New columns
ALTER TABLE price_snapshots ADD COLUMN IF NOT EXISTS model_name text;
ALTER TABLE price_snapshots ADD COLUMN IF NOT EXISTS manufacturer text;
ALTER TABLE price_snapshots ADD COLUMN IF NOT EXISTS origin text;
ALTER TABLE price_snapshots ADD COLUMN IF NOT EXISTS mileage_min integer;
ALTER TABLE price_snapshots ADD COLUMN IF NOT EXISTS mileage_max integer;
ALTER TABLE price_snapshots ADD COLUMN IF NOT EXISTS listings_count integer DEFAULT 0;
ALTER TABLE price_snapshots ADD COLUMN IF NOT EXISTS search_query text;
ALTER TABLE price_snapshots ADD COLUMN IF NOT EXISTS expires_at timestamp;

-- 3. Index for fast global cache lookups by OEM + expiry
CREATE INDEX IF NOT EXISTS idx_price_snapshots_oem_expires
  ON price_snapshots(oem, expires_at DESC);
