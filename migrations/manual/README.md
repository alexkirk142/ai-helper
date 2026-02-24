# Manual Migrations

This folder contains SQL migrations that **cannot be run through Drizzle migrate** because they use PostgreSQL features incompatible with transaction blocks.

## 0001b_create_email_unique_index.sql

Creates a unique index on `users.email` with `CONCURRENTLY` to avoid table locks.

### Why Manual?

PostgreSQL's `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block. Drizzle wraps migrations in transactions by default, so this must be executed separately.

### Production Rollout Steps

1. **Run Drizzle migrations first** (includes normalization):
   ```bash
   npm run db:push
   # or: npx drizzle-kit migrate
   ```

2. **Verify no duplicate emails exist**:
   ```sql
   SELECT LOWER(email) as email, COUNT(*) 
   FROM users 
   WHERE email IS NOT NULL 
   GROUP BY LOWER(email) 
   HAVING COUNT(*) > 1;
   ```
   If duplicates are found, resolve them before proceeding.

3. **Connect to production database via psql**:
   ```bash
   psql $DATABASE_URL
   ```

4. **Run the manual migration**:
   ```sql
   \i migrations/manual/0001b_create_email_unique_index.sql
   ```
   Or copy-paste the SQL directly.

5. **Verify index was created**:
   ```sql
   SELECT indexname, indexdef 
   FROM pg_indexes 
   WHERE tablename = 'users' 
     AND indexname = 'users_email_unique_lower_idx';
   ```

### Rollback

If needed, drop the index:
```sql
DROP INDEX CONCURRENTLY IF EXISTS users_email_unique_lower_idx;
```

### Timing

- `CONCURRENTLY` allows normal operations during index creation
- Index build time depends on table size (~seconds for <100k rows)
- Safe to run during business hours for small-medium tables
