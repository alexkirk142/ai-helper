#!/bin/sh
# Container startup script.
# Runs DB migrations first; if they fail, logs a warning but always starts the app.
# Using && in nixpacks.toml cmd caused npm run start to be skipped entirely when
# drizzle-kit push failed on cold start (DB temporarily unavailable, migration conflict, etc.).

set -e

echo "[startup] Running database migrations..."
if npx drizzle-kit push --force; then
  echo "[startup] Migrations complete."
else
  echo "[startup] WARNING: Migration failed — starting app with current schema. Check DB logs."
fi

echo "[startup] Starting application..."
exec npm run start
