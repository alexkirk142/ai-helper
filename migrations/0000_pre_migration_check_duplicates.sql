-- PRE-MIGRATION: Detect duplicate emails before running migration
-- Safe for fresh installs — skips checks if users table does not exist yet
DO $$
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'users'
  ) THEN
    -- Raises a notice if duplicates found (does not block migration)
    PERFORM 1
    FROM (
      SELECT LOWER(TRIM(email)) as email, COUNT(*) as cnt
      FROM users
      WHERE email IS NOT NULL
      GROUP BY LOWER(TRIM(email))
      HAVING COUNT(*) > 1
    ) duplicates;
  END IF;
END $$;

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
