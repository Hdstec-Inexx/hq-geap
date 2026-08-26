#!/bin/sh
set -eu

cd /app

echo "Validating API config..."
node /app/apps/api/dist/check-config.js

echo "Applying database migrations..."
node /app/scripts/database.js migrate

if [ "${SKIP_DB_SEED:-0}" != "1" ]; then
  echo "Applying database seeds..."
  node /app/scripts/database.js seed
else
  echo "Skipping database seeds (SKIP_DB_SEED=1)."
fi

if [ "${AUTO_REPROCESS_AUDIOS:-1}" = "1" ] && [ -f /app/scripts/reprocessar-audios.js ]; then
  echo "Iniciando reprocessamento automático de áudios pendentes em background..."
  node /app/scripts/reprocessar-audios.js --loop >/tmp/reprocessar-audios.log 2>&1 &
fi

echo "Starting HQ GEAP API..."
exec node /app/apps/api/dist/server.js
