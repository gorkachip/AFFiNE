# MOJO Postgres backup → Cloudflare R2

Runs daily as a Railway cron service. Dumps the AFFiNE Postgres database
and uploads a gzipped `.sql.gz` to a Cloudflare R2 bucket keyed by date.

## Railway service setup

- New empty service in the `mojo-notion` project named `backups`.
- Source: this repo (`gorkachip/AFFiNE`), branch `canary`, root directory
  `.github/backup-cron`.
- Cron schedule (Settings → Service → Cron Schedule): `0 3 * * *`
  (daily at 03:00 UTC).
- Environment variables:
  - `DATABASE_URL` — reference variable from the Postgres service.
  - `R2_ENDPOINT` — `https://<account-id>.r2.cloudflarestorage.com`.
  - `R2_BUCKET` — `notion-mojo`.
  - `R2_ACCESS_KEY_ID` — from the R2 API token.
  - `R2_SECRET_ACCESS_KEY` — from the R2 API token.
  - `BACKUP_PREFIX` (optional) — bucket key prefix, default `postgres`.

## Restore

```bash
# Pick a backup key from the R2 bucket
aws s3 cp s3://notion-mojo/postgres/2026/04/27/030000Z.sql.gz . \
  --endpoint-url $R2_ENDPOINT
gunzip 030000Z.sql.gz
psql $TARGET_DATABASE_URL < 030000Z.sql
```

## Retention

Cloudflare R2 lifecycle rule (configured in the CF dashboard) handles
old backup expiry. Recommended: keep daily backups for 30 days, then
delete.
