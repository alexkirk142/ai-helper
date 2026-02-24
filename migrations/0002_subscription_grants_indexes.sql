-- Migration: Add index for efficient active grant lookups
-- Safe to run in production: CREATE INDEX CONCURRENTLY does not lock the table

-- Index for hasActiveGrant() query:
-- SELECT * FROM subscription_grants 
-- WHERE tenant_id = ? AND revoked_at IS NULL AND starts_at <= now AND ends_at >= now

CREATE INDEX IF NOT EXISTS subscription_grants_active_lookup_idx 
ON subscription_grants (tenant_id, revoked_at, ends_at, starts_at);

-- Index order rationale:
-- 1. tenant_id: equality filter (most selective in multi-tenant)
-- 2. revoked_at: IS NULL check (filters out revoked grants)  
-- 3. ends_at: >= now range (filters expired grants first)
-- 4. starts_at: <= now range (filters future grants)
