#!/bin/sh
set -eu

echo "Applying database migrations..."
corepack pnpm exec tsx scripts/database.ts migrate

echo "Applying database seeds..."
corepack pnpm exec tsx scripts/database.ts seed

echo "Starting HQ GEAP API..."
exec corepack pnpm --filter @hq-geap/api start
