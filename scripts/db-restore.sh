#!/usr/bin/env bash
# Loads a plain-SQL pg_dump of the `public` schema into another schema,
# replacing that schema, in one transaction.
#
#   usage: DATABASE_URL=... scripts/db-restore.sh <dump.sql | dump.sql.gz> <schema>
#
# Used by the nightly backup (schema `backup`) and the restore drill (schema
# `restore_drill`). `public` is refused: in the backup project it belongs to
# the test suite, and this script must never be pointed at production's.
set -euo pipefail

dump=${1:?usage: db-restore.sh <dump> <schema>}
schema=${2:?usage: db-restore.sh <dump> <schema>}
: "${DATABASE_URL:?DATABASE_URL is not set}"

case "$schema" in
  public | *[!a-z0-9_]*) echo "::error::refusing to restore into schema '$schema'"; exit 1 ;;
esac

read_dump() { case "$dump" in *.gz) gzip -dc "$dump" ;; *) cat "$dump" ;; esac; }

# Rewrite `public.` to the target schema in statements and COPY headers only,
# never inside COPY row data (a blog post that mentions "public." must come
# through untouched).
{
  echo 'BEGIN;'
  echo "DROP SCHEMA IF EXISTS $schema CASCADE;"
  echo "CREATE SCHEMA $schema;"
  read_dump | TARGET="$schema" perl -ne '
    if ($c) { print; $c = 0 if /^\\\.\r?$/; next }
    if (/^COPY .* FROM stdin;\r?$/) { $c = 1; s/(?<![A-Za-z0-9_])public\./$ENV{TARGET}./; print; next }
    next if /^(CREATE SCHEMA public;|ALTER SCHEMA public )/;
    s/(?<![A-Za-z0-9_])public\./$ENV{TARGET}./g;
    print;
  '
  # Keep the copy out of reach of the API roles; it holds real user data.
  cat <<SQL
DO \$\$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON SCHEMA $schema FROM anon;
    REVOKE ALL ON ALL TABLES IN SCHEMA $schema FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON SCHEMA $schema FROM authenticated;
    REVOKE ALL ON ALL TABLES IN SCHEMA $schema FROM authenticated;
  END IF;
END \$\$;
COMMENT ON SCHEMA $schema IS 'Copy of production public schema, restored by scripts/db-restore.sh';
COMMIT;
SQL
} | psql "$DATABASE_URL" -X -q -v ON_ERROR_STOP=1 > /dev/null
