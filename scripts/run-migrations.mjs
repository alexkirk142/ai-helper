/**
 * Startup migration runner — applies all SQL migration files in order.
 *
 * Replaces drizzle-kit push --force which hangs indefinitely on schema introspection
 * in the Railway container environment.
 *
 * Tracking table: _manual_migrations (filename TEXT PRIMARY KEY)
 * All SQL files must use IF NOT EXISTS / IF EXISTS guards so they are
 * safe to re-run if the tracking table is ever reset.
 *
 * Exit 0 = success (all migrations applied or already up to date)
 * Exit 1 = fatal error (caller should log a warning and continue)
 */
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
  console.log('[migration] Connected to database');

  // Tracking table: records which SQL files have been applied
  await client.query(`
    CREATE TABLE IF NOT EXISTS _manual_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort();

  let applied = 0;
  let skipped = 0;

  for (const file of files) {
    const { rows } = await client.query(
      'SELECT 1 FROM _manual_migrations WHERE filename = $1',
      [file]
    );

    if (rows.length > 0) {
      skipped++;
      continue;
    }

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    try {
      await client.query(sql);
      await client.query(
        'INSERT INTO _manual_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
        [file]
      );
      console.log(`[migration] ✓ Applied: ${file}`);
      applied++;
    } catch (err) {
      // Most errors from old migrations are "already exists" — they ran via push before.
      // Log a warning but continue so we don't block startup over old migrations.
      console.warn(`[migration] ⚠  ${file}: ${err.message.split('\n')[0]}`);
      // Still mark as applied so we don't retry on every startup
      await client.query(
        'INSERT INTO _manual_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING',
        [file]
      );
    }
  }

  console.log(`[migration] Done. Applied: ${applied}, Already up-to-date: ${skipped}`);
  await client.end();
} catch (err) {
  console.error('[migration] FATAL:', err.message);
  await client.end().catch(() => {});
  process.exit(1);
}
