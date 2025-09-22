#!/usr/bin/env bash
set -euo pipefail

# Usage: PROD_DATABASE_URL=postgres://user:pass@host:5432/dbname bash scripts/clone_prod_to_local.sh

if [[ -z "${PROD_DATABASE_URL:-}" ]]; then
  echo "ERROR: PROD_DATABASE_URL is not set in your shell." >&2
  echo "Example: export PROD_DATABASE_URL=postgres://user:pass@host:5432/prod_db" >&2
  exit 1
fi

LOCAL_DB_NAME=${LOCAL_DB_NAME:-portal365_dev}

echo "🔄 Dumping production database..."
pg_dump "$PROD_DATABASE_URL" -Fc -f prod_snapshot.dump

echo "🧹 Dropping and recreating local database: $LOCAL_DB_NAME"
dropdb "$LOCAL_DB_NAME" 2>/dev/null || true
createdb "$LOCAL_DB_NAME"

echo "⬇️ Restoring snapshot into $LOCAL_DB_NAME"
pg_restore -d "$LOCAL_DB_NAME" --clean --no-owner --no-privileges prod_snapshot.dump

echo "🛡️  Sanitizing data for local development"
psql "$LOCAL_DB_NAME" -v ON_ERROR_STOP=1 -f scripts/sanitize_local.sql

echo "🧩 Regenerating Prisma client"
npm run db:generate

echo "👤 Ensuring local admin user (admin@portal365.com / admin123)"
npx tsx scripts/upsert_admin.ts

echo "✅ Clone complete. Set your .env.local DATABASE_URL to point at $LOCAL_DB_NAME if not already."

