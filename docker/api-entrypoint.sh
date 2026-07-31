#!/bin/sh
set -eu

cd /app
# pnpm coloca `pg` sob apps/api; scripts precisam resolver a partir daí.
export NODE_PATH="/app/apps/api/node_modules${NODE_PATH:+:$NODE_PATH}"

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
