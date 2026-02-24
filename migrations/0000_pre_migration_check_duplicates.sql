-- PRE-MIGRATION: Detect duplicate emails before running migration
-- Run this BEFORE applying 0001_add_users_email_unique_index.sql
-- If duplicates exist, resolve them manually before proceeding

-- Query 1: Find all duplicate emails (case-insensitive)
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

-- Query 2: Summary count
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

-- REMEDIATION STRATEGIES (choose based on business context):
--
-- Strategy A: Keep verified account, remove duplicate emails from unverified
-- UPDATE users SET email = NULL 
-- WHERE email IN (SELECT email FROM users WHERE email_verified_at IS NULL GROUP BY email HAVING COUNT(*) > 1)
--   AND email_verified_at IS NULL;
--
-- Strategy B: Keep oldest account, merge newer accounts
-- (Requires manual intervention per case)
--
-- Strategy C: Keep OIDC-linked account, remove email from local-only duplicates
-- UPDATE users SET email = NULL 
-- WHERE id IN (
--   SELECT u.id FROM users u
--   WHERE u.email IN (SELECT email FROM users GROUP BY email HAVING COUNT(*) > 1)
--     AND u.oidc_id IS NULL
--     AND EXISTS (SELECT 1 FROM users u2 WHERE u2.email = u.email AND u2.oidc_id IS NOT NULL)
-- );
