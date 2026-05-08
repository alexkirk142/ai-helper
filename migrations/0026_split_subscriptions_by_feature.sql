-- Migration: split subscriptions by feature (channels vs ai_agent)
-- Allows each tenant to have separate subscription records per feature.

-- 1. Add plan_type column to plans (default 'channels' for existing rows)
ALTER TABLE plans ADD COLUMN IF NOT EXISTS plan_type VARCHAR NOT NULL DEFAULT 'channels';

-- 2. Add feature column to subscriptions (default 'channels' for existing rows)
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS feature VARCHAR NOT NULL DEFAULT 'channels';

-- 3. Drop the old single-column unique constraint on tenant_id
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_tenant_id_unique;

-- 4. Create new composite unique index on (tenant_id, feature)
CREATE UNIQUE INDEX IF NOT EXISTS subscriptions_tenant_feature_unique
  ON subscriptions (tenant_id, feature);
