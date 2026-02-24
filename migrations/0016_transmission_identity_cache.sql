CREATE TABLE IF NOT EXISTS transmission_identity_cache (
  id VARCHAR PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  oem TEXT NOT NULL,
  normalized_oem TEXT NOT NULL,
  model_name TEXT,
  manufacturer TEXT,
  origin TEXT,
  confidence TEXT NOT NULL DEFAULT 'high',
  hit_count INTEGER NOT NULL DEFAULT 1,
  last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS
  transmission_identity_cache_normalized_oem_unique
  ON transmission_identity_cache (normalized_oem);

CREATE INDEX IF NOT EXISTS
  transmission_identity_cache_oem_idx
  ON transmission_identity_cache (oem);
