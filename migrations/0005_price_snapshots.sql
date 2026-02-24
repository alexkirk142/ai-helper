-- Migration: Price snapshots (cached price lookup results per OEM)

CREATE TABLE IF NOT EXISTS price_snapshots (
  id VARCHAR PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  tenant_id VARCHAR NOT NULL REFERENCES tenants (id),
  oem TEXT NOT NULL,
  source TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'RUB',
  min_price INTEGER,
  max_price INTEGER,
  avg_price INTEGER,
  raw JSONB DEFAULT '{}',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS price_snapshots_tenant_oem_created_idx
  ON price_snapshots (tenant_id, oem, created_at DESC);

CREATE INDEX IF NOT EXISTS price_snapshots_oem_created_idx
  ON price_snapshots (oem, created_at DESC);
