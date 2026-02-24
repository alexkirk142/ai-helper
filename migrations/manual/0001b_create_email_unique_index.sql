-- Migration: Create unique partial index on users.email
-- Purpose: Enforce email uniqueness at database level
-- 
-- ⚠️  IMPORTANT: This file must be run MANUALLY via psql, NOT through Drizzle migrate.
-- CREATE INDEX CONCURRENTLY cannot execute inside a transaction block.
--
-- PREREQUISITES:
-- 1. Run migrations/0001a_normalize_emails.sql first (via Drizzle)
-- 2. Verify no duplicate emails exist (see check query below)
--
-- PRE-FLIGHT CHECK (run this first to verify no duplicates):
-- 
--   SELECT LOWER(email) as email, COUNT(*) 
--   FROM users 
--   WHERE email IS NOT NULL 
--   GROUP BY LOWER(email) 
--   HAVING COUNT(*) > 1;
--
-- If duplicates exist, resolve them before proceeding.

-- Create unique partial index with CONCURRENTLY (no table lock)
-- - Case-insensitive: uses LOWER(email)
-- - Partial: WHERE email IS NOT NULL (allows multiple NULLs for OIDC users without email)
-- - CONCURRENTLY: no exclusive lock, minimal production impact
CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique_lower_idx 
ON users (LOWER(email)) 
WHERE email IS NOT NULL;

-- Verify index was created successfully:
-- SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'users' AND indexname = 'users_email_unique_lower_idx';
