-- Migration: Internal prices (tenant's own price list per OEM)

CREATE TABLE IF NOT EXISTS internal_prices (
  id VARCHAR PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  tenant_id VARCHAR NOT NULL REFERENCES tenants (id),
  oem TEXT NOT NULL,
  price INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'RUB',
  condition TEXT,
  supplier TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS internal_prices_tenant_oem_condition_supplier_idx
  ON internal_prices (tenant_id, oem, condition, supplier);

CREATE INDEX IF NOT EXISTS internal_prices_tenant_oem_idx
  ON internal_prices (tenant_id, oem);
