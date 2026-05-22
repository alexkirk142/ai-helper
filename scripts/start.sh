#!/bin/sh
# Container startup script.
# Applies SQL migration files via run-migrations.mjs (fast, no schema introspection).
# drizzle-kit push was removed — it hangs on schema introspection in Railway containers.
# If migrations fail, a warning is logged but the app still starts to avoid
# a broken deploy making the service completely unavailable.

echo "[startup] Running database migrations..."
if node scripts/run-migrations.mjs; then
  echo "[startup] Migrations complete."
else
  echo "[startup] WARNING: Migration script failed — starting app anyway. Check DB schema manually."
fi

echo "[startup] Starting application..."
exec npm run start
