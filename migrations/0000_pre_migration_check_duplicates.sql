-- PRE-MIGRATION: Detect duplicate emails before running migration
-- Run this BEFORE applying 0001_add_users_email_unique_index.sql
-- If duplicates exist, resolve them manually before proceeding.
--
-- NOTE: This script is now safe to run against a **fresh database** where the
-- `users` table does not yet exist. In that case it simply emits a NOTICE and
-- does nothing, so automated tools like drizzle-kit migrate won't fail.

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
        RAISE NOTICE 'Table "users" does not exist, skipping duplicate email pre-check.';
        RETURN;
    END IF;

    RAISE NOTICE 'Running duplicate email pre-check for existing "users" table...';

    -- Query 1: Find all duplicate emails (case-insensitive)
    EXECUTE $SQL$
        SELECT 
            LOWER(TRIM(email)) as normalized_email,
            COUNT(*) as duplicate_count,
            ARRAY_AGG(id) as user_ids,
            ARRAY_AGG(username) as usernames,
            ARRAY_AGG(auth_provider) as auth_providers,
            ARRAY_AGG(email_verified_at IS NOT NULL) as verified_status
        FROM users 
        WHERE email IS NOT NULL
        GROUP BY LOWER(TRIM(email))
        HAVING COUNT(*) > 1
        ORDER BY duplicate_count DESC;
    $SQL$;

    -- Query 2: Summary count
    EXECUTE $SQL$
        SELECT 
            COUNT(*) as total_duplicate_groups,
            SUM(cnt - 1) as total_records_to_resolve
        FROM (
            SELECT LOWER(TRIM(email)) as email, COUNT(*) as cnt
            FROM users 
            WHERE email IS NOT NULL
            GROUP BY LOWER(TRIM(email))
            HAVING COUNT(*) > 1
        ) duplicates;
    $SQL$;
END;
$$;
