#!/bin/sh
# Container startup script.
# Runs DB migrations via run-migrations.mjs:
#   1. Tries drizzle-kit push --force
#   2. Falls back to applying .sql migration files directly if push fails
# If migrations fail completely (exit 1), the app still starts — but the failure
# is logged clearly so it can be investigated. This prevents a broken deploy from
# making the service completely unavailable.

echo "[startup] Running database migrations..."
if node scripts/run-migrations.mjs; then
  echo "[startup] Migrations complete."
else
  echo "[startup] WARNING: Migration script failed — starting app anyway. Check DB schema manually."
fi

echo "[startup] Starting application..."
exec npm run start
