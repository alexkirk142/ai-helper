/**
 * Database migration script.
 * Applies pre-generated SQL migration files from ./migrations/ via drizzle-kit migrate.
 * Migrations must be generated first with: npx drizzle-kit generate
 *
 * Usage: npx tsx server/scripts/migrate.ts
 * Or:    npm run db:migrate
 *
 * WARNING: Do NOT use drizzle-kit push in production — it bypasses migration files,
 * cannot be rolled back, and the --force variant silently drops columns/types.
 */

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

async function runMigrations() {
  console.log("Running database migrations...");

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL environment variable is not set");
    process.exit(1);
  }

  try {
    const { stdout, stderr } = await execAsync("npx drizzle-kit migrate");

    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);

    console.log("Migrations completed successfully");
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

runMigrations();
