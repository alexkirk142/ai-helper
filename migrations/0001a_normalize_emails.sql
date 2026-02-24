-- Migration: Normalize existing user emails
-- Purpose: Prepare for unique index by normalizing email format
-- Safety: Transaction-safe, idempotent, can be run by Drizzle migrate
--
-- This is Step 1 of 2 for email uniqueness.
-- Step 2 (CREATE INDEX CONCURRENTLY) must be run manually - see migrations/manual/

-- Normalize existing emails: lowercase + trim
-- Only updates rows where normalization would change the value
-- Safe to run multiple times (idempotent)
UPDATE users 
SET email = LOWER(TRIM(email)) 
WHERE email IS NOT NULL 
  AND email != LOWER(TRIM(email));
