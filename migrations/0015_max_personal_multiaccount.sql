-- Migration: MAX Personal multi-account support
-- Drops the single-account-per-tenant constraint; adds account_id + label;
-- adds unique constraint on (tenant_id, id_instance) to prevent duplicates.

-- 1. Drop old unique index that enforced one account per tenant
DROP INDEX IF EXISTS "max_personal_accounts_tenant_idx";

-- 2. Add stable public account identifier used in webhook URLs
ALTER TABLE "max_personal_accounts"
  ADD COLUMN IF NOT EXISTS "account_id" VARCHAR NOT NULL DEFAULT gen_random_uuid();

-- 3. Add optional label for admin identification
ALTER TABLE "max_personal_accounts"
  ADD COLUMN IF NOT EXISTS "label" TEXT;

-- 4. New unique constraint: same GREEN-API instance cannot be added twice for the same tenant
CREATE UNIQUE INDEX IF NOT EXISTS "max_personal_accounts_tenant_instance_unique"
  ON "max_personal_accounts" ("tenant_id", "id_instance");

-- 5. Non-unique tenant index for efficient lookups (list all accounts for a tenant)
CREATE INDEX IF NOT EXISTS "max_personal_accounts_tenant_idx"
  ON "max_personal_accounts" ("tenant_id");
