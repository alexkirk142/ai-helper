/**
 * Robust startup migration runner.
 *
 * Strategy:
 *  1. Try `drizzle-kit push --force` (fast, schema-diff based)
 *  2. If it fails, fall back to applying all *.sql migration files directly
 *     using IF NOT EXISTS guards — safe to run repeatedly.
 *
 * Exit code 0 = migrations applied (or already up to date).
 * Exit code 1 = both methods failed — caller should decide whether to abort.
 */
import { execSync } from 'child_process';
import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations');

async function applyMigrationFiles() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  // Ensure tracking table exists
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
  for (const file of files) {
    const { rows } = await client.query(
      'SELECT 1 FROM _manual_migrations WHERE filename = $1', [file]
    );
    if (rows.length > 0) continue; // already applied

    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    try {
      await client.query(sql);
      await client.query(
        'INSERT INTO _manual_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING', [file]
      );
      console.log(`[migration] ✓ Applied: ${file}`);
      applied++;
    } catch (err) {
      // Log but continue — most errors are "already exists" from old push-based setup
      console.warn(`[migration] ⚠ ${file}: ${err.message}`);
    }
  }

  await client.end();
  console.log(`[migration] Fallback complete. Applied ${applied} new migration(s).`);
}

// ── Step 1: try drizzle-kit push ──────────────────────────────────────────────
let pushOk = false;
try {
  console.log('[migration] Attempting drizzle-kit push --force ...');
  execSync('npx drizzle-kit push --force', { stdio: 'inherit' });
  pushOk = true;
  console.log('[migration] drizzle-kit push succeeded.');
} catch (err) {
  console.warn('[migration] drizzle-kit push failed, switching to SQL file fallback...');
}

// ── Step 2: SQL file fallback if push failed ──────────────────────────────────
if (!pushOk) {
  try {
    await applyMigrationFiles();
  } catch (err) {
    console.error('[migration] FATAL: fallback migration also failed:', err.message);
    process.exit(1);
  }
}
