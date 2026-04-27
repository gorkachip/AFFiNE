#!/bin/bash
set -euo pipefail

# MOJO: Daily Postgres backup → Cloudflare R2.
# Triggered by Railway's cron schedule on the `backups` service.
# Required env vars (set in Railway):
#   DATABASE_URL                Reference to the Postgres service URL.
#   R2_ENDPOINT                 https://<account>.r2.cloudflarestorage.com
#   R2_BUCKET                   notion-mojo
#   R2_ACCESS_KEY_ID            from Cloudflare R2 API token
#   R2_SECRET_ACCESS_KEY        from Cloudflare R2 API token
# Optional:
#   BACKUP_PREFIX               key prefix in the bucket (default: postgres)

PREFIX="${BACKUP_PREFIX:-postgres}"
TS=$(date -u +%Y/%m/%d/%H%M%SZ)
KEY="${PREFIX}/${TS}.sql.gz"
TMP=/tmp/backup.sql.gz

echo "[mojo-backup] $(date -u +%Y-%m-%dT%H:%M:%SZ) start"
echo "[mojo-backup] target key: ${KEY}"

# pg_dump straight to gzip; --no-owner / --no-acl so the dump can be
# restored to a fresh DB regardless of role names.
pg_dump --no-owner --no-acl --format=plain "$DATABASE_URL" | gzip -9 > "$TMP"

SIZE=$(stat -c%s "$TMP" 2>/dev/null || stat -f%z "$TMP")
echo "[mojo-backup] dump size: ${SIZE} bytes"

if [ "$SIZE" -lt 1024 ]; then
  echo "[mojo-backup] ERROR: dump suspiciously small (<1KB), aborting upload" >&2
  exit 1
fi

AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
AWS_DEFAULT_REGION=auto \
aws s3 cp "$TMP" "s3://${R2_BUCKET}/${KEY}" \
  --endpoint-url "$R2_ENDPOINT" \
  --no-progress

echo "[mojo-backup] $(date -u +%Y-%m-%dT%H:%M:%SZ) done"
