ALTER TABLE price_snapshots
  ADD COLUMN IF NOT EXISTS search_key text;

CREATE INDEX IF NOT EXISTS price_snapshots_search_key_idx
  ON price_snapshots (tenant_id, search_key);

-- Backfill: set search_key = oem for existing rows
UPDATE price_snapshots SET search_key = oem WHERE search_key IS NULL;
