#!/bin/sh
echo "Running database migrations..."
npx drizzle-kit migrate
echo "Starting application..."
NODE_ENV=production node dist/index.cjs
