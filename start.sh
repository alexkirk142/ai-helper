#!/bin/sh
echo "Syncing database schema..."
npx drizzle-kit push --force
echo "Starting application..."
NODE_ENV=production node dist/index.cjs
