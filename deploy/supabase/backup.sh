#!/usr/bin/env bash
# Nightly backup of a self-hosted Supabase: the whole Postgres database plus the
# Storage files, kept locally for KEEP_DAYS and (if RCLONE_REMOTE is set)
# copied off this server. A backup that only lives on the same VPS dies with
# it — set RCLONE_REMOTE. See docs/self-hosting-supabase.md.
#
#   SUPABASE_DIR=~/supabase-project RCLONE_REMOTE=b2:alytic-backups bash backup.sh
#
# cron (03:17 every night):
#   17 3 * * * SUPABASE_DIR=/root/supabase-project RCLONE_REMOTE=b2:alytic-backups /root/alytic/deploy/supabase/backup.sh >> /var/log/alytic-backup.log 2>&1

set -euo pipefail

SUPABASE_DIR="${SUPABASE_DIR:-$HOME/supabase-project}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/alytic}"
KEEP_DAYS="${KEEP_DAYS:-14}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"
STAMP="$(date +%F-%H%M)"

mkdir -p "$BACKUP_DIR"
cd "$SUPABASE_DIR"

db_file="$BACKUP_DIR/db-$STAMP.dump"
storage_file="$BACKUP_DIR/storage-$STAMP.tar.gz"

# Custom format (-Fc): compressed, and pg_restore can restore it selectively.
# Written to a temp name first so a failed dump never looks like a good one.
docker compose exec -T db pg_dump -U postgres -d postgres -Fc > "$db_file.partial"
mv "$db_file.partial" "$db_file"

tar -czf "$storage_file.partial" -C volumes storage
mv "$storage_file.partial" "$storage_file"

echo "[backup] $(date -Is) wrote $(du -h "$db_file" | cut -f1) db, $(du -h "$storage_file" | cut -f1) storage"

if [ -n "$RCLONE_REMOTE" ]; then
  rclone copy "$db_file" "$RCLONE_REMOTE/"
  rclone copy "$storage_file" "$RCLONE_REMOTE/"
  echo "[backup] copied to $RCLONE_REMOTE"
else
  echo "[backup] WARNING: RCLONE_REMOTE not set — this backup exists only on this server"
fi

find "$BACKUP_DIR" -name 'db-*.dump' -mtime +"$KEEP_DAYS" -delete
find "$BACKUP_DIR" -name 'storage-*.tar.gz' -mtime +"$KEEP_DAYS" -delete
