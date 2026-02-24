-- Migration: Normalize existing user emails
-- Purpose: Prepare for unique index by normalizing email format
-- Safety: Transaction-safe, idempotent, can be run by Drizzle migrate
--
-- This is Step 1 of 2 for email uniqueness.
-- Step 2 (CREATE INDEX CONCURRENTLY) must be run manually - see migrations/manual/

-- Normalize existing emails: lowercase + trim
-- Only updates rows where normalization would change the value
-- Safe to run multiple times (idempotent)
-- NOTE: On a fresh database where the legacy `users` table does not exist,
-- this migration should be a no-op. The block below checks for the table
-- first so that drizzle-kit migrate won't fail on new installations.

DO $$
DECLARE
    users_table_exists boolean;
BEGIN
    SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_schema = 'public'
          AND table_name = 'users'
    ) INTO users_table_exists;

    IF NOT users_table_exists THEN
        RAISE NOTICE 'Table "users" does not exist, skipping email normalization migration.';
        RETURN;
    END IF;

    RAISE NOTICE 'Normalizing emails in existing "users" table...';

    -- Normalize existing emails: lowercase + trim
    -- Only updates rows where normalization would change the value
    -- Safe to run multiple times (idempotent)
    UPDATE users 
    SET email = LOWER(TRIM(email)) 
    WHERE email IS NOT NULL 
      AND email != LOWER(TRIM(email));
END;
$$;
