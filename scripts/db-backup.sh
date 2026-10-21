#!/usr/bin/env bash
# Copies production's `public` schema (structure + data) into a `backup`
# schema of a second Supabase project.
#
#   PROD_DATABASE_URL    Postgres connection string of the production project
#   BACKUP_DATABASE_URL  Postgres connection string of the backup/test project
#
# The copy is restored inside one transaction: if anything fails, the previous
# night's backup is left exactly as it was. The target's own `public` schema
# (used by the test suite) is never touched.
set -euo pipefail

: "${PROD_DATABASE_URL:?PROD_DATABASE_URL is not set}"
: "${BACKUP_DATABASE_URL:?BACKUP_DATABASE_URL is not set}"

if [ "$PROD_DATABASE_URL" = "$BACKUP_DATABASE_URL" ]; then
  echo "::error::PROD_DATABASE_URL and BACKUP_DATABASE_URL are identical; refusing to run."
  exit 1
fi

count() { psql "$1" -X -At -v ON_ERROR_STOP=1 -c "$2"; }

# Prints "user@host" of a connection string, never the password.
who() { printf '%s' "$1" | sed -nE 's#^[a-z]+://([^:@/]+)(:.*)?@([^@/:?]+)(:[0-9]+)?(/.*)?$#\1@\3#p'; }

# Fail early, saying which of the two connections is the broken one.
preflight() {
  local label=$1 url=$2 target
  target=$(who "$url")
  target=${target:-unparseable-string}
  if ! psql "$url" -X -At -v ON_ERROR_STOP=1 -c 'select 1' > /dev/null; then
    echo "::error::$label connection failed (login: $target)."
    case "$target" in
      postgres@*pooler.supabase.com)
        echo "::error::$label uses the pooler but the username is plain 'postgres'; it must be 'postgres.<project-ref>'." ;;
      *.supabase.co)
        echo "::error::$label uses the direct host, which is IPv6-only; use the Session pooler string." ;;
    esac
    exit 1
  fi
  echo "$label connection ok ($target)"
}

preflight PROD_DATABASE_URL "$PROD_DATABASE_URL"
preflight BACKUP_DATABASE_URL "$BACKUP_DATABASE_URL"

prod_users=$(count "$PROD_DATABASE_URL" 'select count(*) from public.users')
# Separate queries: one statement naming backup.users fails to plan on the
# very first run, when that table does not exist yet.
prev_users=0
if [ -n "$(count "$BACKUP_DATABASE_URL" "select to_regclass('backup.users')")" ]; then
  prev_users=$(count "$BACKUP_DATABASE_URL" 'select count(*) from backup.users')
fi
echo "production users: $prod_users · previous backup users: $prev_users"

# A wiped or emptied production database must never replace a good backup.
if [ "$prod_users" -eq 0 ] || { [ "$prev_users" -gt 0 ] && [ $((prod_users * 2)) -lt "$prev_users" ]; }; then
  echo "::error::production has $prod_users users but the last backup had $prev_users; keeping the old backup and failing."
  exit 1
fi

dump=$(mktemp)
trap 'rm -f "$dump"' EXIT

pg_dump "$PROD_DATABASE_URL" --schema=public --no-owner --no-privileges --no-comments > "$dump"

# The workflow keeps an encrypted copy of this exact dump as an artifact, so
# a backup older than last night's can still be restored.
if [ -n "${DUMP_OUT:-}" ]; then
  gzip -c "$dump" > "$DUMP_OUT"
  echo "dump saved: $(du -h "$DUMP_OUT" | cut -f1)"
fi

DATABASE_URL="$BACKUP_DATABASE_URL" bash "$(dirname "$0")/db-restore.sh" "$dump" backup

new_users=$(count "$BACKUP_DATABASE_URL" 'select count(*) from backup.users')
echo "backup users: $new_users"
if [ "$new_users" -eq 0 ]; then
  echo "::error::restore finished but backup.users is empty."
  exit 1
fi
echo "backup complete: $(date -u +%FT%TZ)"
