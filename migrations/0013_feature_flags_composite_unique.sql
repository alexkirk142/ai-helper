-- Migration: 0013_feature_flags_composite_unique
--
-- Problem: feature_flags had UNIQUE(name) at the column level, which prevented
-- storing per-tenant flag overrides alongside the global default row.
-- The service stored per-tenant state in an in-memory map + JSON file (ephemeral
-- on Railway), so toggled flags were lost on every deploy.
--
-- Fix: Replace the single column unique with two partial unique indexes that
-- allow both a global row (tenant_id IS NULL) and tenant-specific rows
-- (tenant_id IS NOT NULL) for the same flag name.
--
-- PostgreSQL treats NULLs as distinct in UNIQUE constraints, so a plain
-- UNIQUE(name, tenant_id) would allow multiple global rows. The partial indexes
-- below are the correct pattern for nullable composite uniqueness.

-- Drop the old column-level unique constraint (Drizzle names it with _unique suffix)
ALTER TABLE feature_flags DROP CONSTRAINT IF EXISTS feature_flags_name_unique;

-- Global flags: at most one row per name where tenant_id IS NULL
CREATE UNIQUE INDEX IF NOT EXISTS feature_flags_global_unique
  ON feature_flags (name)
  WHERE tenant_id IS NULL;

-- Per-tenant overrides: at most one row per (name, tenant_id) pair
CREATE UNIQUE INDEX IF NOT EXISTS feature_flags_tenant_unique
  ON feature_flags (name, tenant_id)
  WHERE tenant_id IS NOT NULL;
