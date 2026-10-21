# Database backups

A GitHub Actions job (`.github/workflows/db-backup.yml`, script `scripts/db-backup.sh`) copies production's `public` schema, structure and data, into a `backup` schema of a second Supabase project every night at 00:30 UTC. It can also be started by hand from the Actions tab.

Production is project `xssjwnevhbpcdmtbatiy`. The second project (`qfxuejkbnrdszycqxvdx`) is also used for testing. The two never meet: the backup lives in the `backup` schema, tests use `public`.

## One-time setup

Add two repository secrets (Settings, Secrets and variables, Actions):

| Secret | Value |
|---|---|
| `PROD_DATABASE_URL` | Production project: Connect, **Session pooler** string (port 5432). GitHub runners are IPv4-only, so the direct `db.<ref>.supabase.co` host will not work. |
| `BACKUP_DATABASE_URL` | Backup project: same, Session pooler string. |

Then run the workflow once by hand and check the log shows both user counts.

## What the job guarantees

- The old `backup` schema is replaced inside one transaction, so a failed run keeps the previous copy.
- It refuses to run if production has no users, or fewer than half the users the last backup had, so a wiped production cannot overwrite the good copy.
- The `backup` schema is closed to the `anon` and `authenticated` roles. It contains real emails and password hashes: do not add `backup` to the project's exposed API schemas, and keep the test project's keys out of shared places.

## Limits (read before relying on it)

- It keeps **one** copy, last night's. It does not protect against a mistake you notice after more than a day. Turn on Supabase's own daily backups or point-in-time recovery on the production project as well.
- It covers the `public` schema only: not VPS files, the production `.env`, or uploads outside the database.
- A backup is only proven by a restore. See "Restore" and do it once.

## Restore

Into a scratch project (never straight over production):

```bash
pg_dump "$BACKUP_DATABASE_URL" --schema=backup --no-owner --no-privileges \
  | perl -pe 's/(?<![A-Za-z0-9_])backup\./public./g' \
  | psql "$SCRATCH_DATABASE_URL" -v ON_ERROR_STOP=1
```

The perl step also rewrites matching text inside row data; for a full production restore, prefer the Supabase backup, or ask for a COPY-aware version of this command.

## If the first run fails

- `pg_dump: error: aborting because of server version mismatch`: production runs a newer Postgres than the client installed in the workflow; raise `postgresql-client-17`.
- Errors about a missing type or extension: a table uses an extension living outside `public`; add the extension in the backup project first.
