-- Migration: Vehicle lookup cache and cases (Podzamenu VIN/FRAME)
-- Creates vehicle_lookup_cache and vehicle_lookup_cases tables with indexes.

-- Table: vehicle_lookup_cache
CREATE TABLE IF NOT EXISTS vehicle_lookup_cache (
  id VARCHAR PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  lookup_key TEXT NOT NULL,
  id_type TEXT NOT NULL,
  raw_value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  result JSONB NOT NULL,
  source TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS vehicle_lookup_cache_lookup_key_unique ON vehicle_lookup_cache (lookup_key);
CREATE INDEX IF NOT EXISTS vehicle_lookup_cache_normalized_value_idx ON vehicle_lookup_cache (normalized_value);

-- Table: vehicle_lookup_cases
CREATE TABLE IF NOT EXISTS vehicle_lookup_cases (
  id VARCHAR PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  tenant_id VARCHAR NOT NULL REFERENCES tenants (id),
  conversation_id VARCHAR NOT NULL REFERENCES conversations (id),
  message_id VARCHAR REFERENCES messages (id),
  id_type TEXT NOT NULL,
  raw_value TEXT NOT NULL,
  normalized_value TEXT NOT NULL,
  status TEXT NOT NULL,
  verification_status TEXT NOT NULL,
  cache_id VARCHAR REFERENCES vehicle_lookup_cache (id),
  error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS vehicle_lookup_cases_tenant_conversation_idx ON vehicle_lookup_cases (tenant_id, conversation_id);
CREATE INDEX IF NOT EXISTS vehicle_lookup_cases_status_idx ON vehicle_lookup_cases (status);
CREATE INDEX IF NOT EXISTS vehicle_lookup_cases_normalized_value_idx ON vehicle_lookup_cases (normalized_value);
