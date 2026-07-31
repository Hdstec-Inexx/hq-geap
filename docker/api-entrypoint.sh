#!/bin/sh
set -eu

cd /app

echo "Applying database migrations..."
node /app/scripts/database.js migrate

if [ "${SKIP_DB_SEED:-0}" != "1" ]; then
  echo "Applying database seeds..."
  node /app/scripts/database.js seed
else
  echo "Skipping database seeds (SKIP_DB_SEED=1)."
fi

echo "Starting HQ GEAP API..."
exec node /app/apps/api/dist/server.js
