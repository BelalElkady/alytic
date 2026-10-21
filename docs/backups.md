# Backups

Production is Supabase project `xssjwnevhbpcdmtbatiy`. The second project, `qfxuejkbnrdszycqxvdx`, holds the backup and is also used for testing. The two never meet: the backup lives in the `backup` schema, tests use `public`.

Three layers, all in `.github/workflows/db-backup.yml`, every night at 00:30 UTC (also runnable by hand from the Actions tab):

| What | Where | Kept |
|---|---|---|
| Live copy of production's `public` schema | `backup` schema of the backup project | Last night only |
| Encrypted SQL dump of the same data | Artifact `db-dump` on each backup run | 7 days |
| Encrypted VPS config: backend/frontend `.env`, nginx site files, systemd units, deployed commit | Artifact `vps-config` on each backup run | 30 days |

A monthly drill (`.github/workflows/db-restore-drill.yml`) restores the newest dump into a scratch schema and checks it.

## One-time setup

Repository secrets (Settings, Secrets and variables, Actions):

| Secret | Value |
|---|---|
| `PROD_DATABASE_URL` | Production project: Connect, **Session pooler** string (port 5432, username `postgres.xssjwnevhbpcdmtbatiy`). GitHub runners are IPv4-only, so the direct `db.<ref>.supabase.co` host will not work. |
| `BACKUP_DATABASE_URL` | Backup project: same, username `postgres.qfxuejkbnrdszycqxvdx`. |
| `BACKUP_ENCRYPTION_KEY` | A long random passphrase. Encrypts both artifacts. |

The VPS job reuses `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY` (and `DEPLOY_PORT`) from the `production` environment.

**Store `BACKUP_ENCRYPTION_KEY` outside GitHub too** (password manager). GitHub secrets cannot be read back, and without the key the artifacts cannot be opened. Losing it means losing every dated backup.

## What the jobs guarantee

- The `backup` schema is replaced inside one transaction, so a failed run keeps the previous copy.
- The copy refuses to run if production has no users, or fewer than half the users the last backup had, so a wiped production cannot overwrite the good copy. The dated dumps are taken either way, so they still hold the days before.
- The `backup` schema is closed to the `anon` and `authenticated` roles. It contains real emails and password hashes: do not add `backup` to the project's exposed API schemas.
- Dumps and VPS config are never uploaded unencrypted (AES-256, gpg symmetric).
- The VPS job fails if the backend `.env` was not captured. Its log lists the captured file names, never their contents.

## Limits

- Dated dumps go back **7 days**. A mistake noticed later than that cannot be undone from these. Supabase's Pro plan adds its own 7-day daily backups, and point-in-time recovery is a paid add-on; both are a cost decision.
- Only the `public` schema is covered. **Files in Supabase Storage are not backed up**: blog images, announcement images and other uploads (`backend/src/blogImages.js`, `announcementImages.js`, `supportAttachments.js`). The database rows point at them, so a restore brings back the posts but not their images. Supabase Auth is not used (the app has its own `users` table).
- Let's Encrypt certificates are not copied (root-only); certbot reissues them on a new server.
- Artifacts count against the repo's Actions storage quota. A dump is a few MB compressed today; watch it as the database grows.

## Restore

Never straight over production. Restore into a scratch schema or project first, check it, then decide.

1. Actions, **Database backup**, open the run for the day you want, download the `db-dump` artifact, unzip it.
2. Decrypt:
   ```bash
   gpg -o db.sql.gz -d db.sql.gz.gpg      # asks for BACKUP_ENCRYPTION_KEY
   ```
3. Load it into a schema of any database (refuses `public`; COPY-aware, so row data is never altered):
   ```bash
   DATABASE_URL="<target pooler string>" bash scripts/db-restore.sh db.sql.gz restored
   ```
   To rebuild production itself from it, restore into a fresh project's `public` with plain `gzip -dc db.sql.gz | psql "<fresh project>"`: the dump is an ordinary `pg_dump` of `public`.

VPS config: download `vps-config`, `gpg -o vps-config.tar.gz -d vps-config.tar.gz.gpg`, `tar xzf vps-config.tar.gz`. Paths inside mirror the server (`opt/alytic/backend/.env`, `etc/nginx/...`).

## Restore drill

`Database restore drill` runs on the 1st of each month and by hand. It downloads the newest `db-dump`, decrypts it, restores it into `restore_drill` in the backup project, compares every table's row count against the `backup` schema written by the same run, and drops `restore_drill` again. It fails on any difference.

If the newest backup run copied the schema but failed to keep a dump (for example a missing key), the two will differ and the drill fails; rerun the backup, then the drill.

### Drill log

| Date | Backup run | Result | Restore time | Notes |
|---|---|---|---|---|
| | | | | First drill pending |

## Troubleshooting

- `pg_dump: error: aborting because of server version mismatch`: production moved to a newer Postgres; raise the version in `.github/actions/setup-pg17`.
- `password authentication failed for user "postgres"`: the pooler username must be `postgres.<project-ref>`.
- `Network is unreachable` to `db.<ref>.supabase.co`: use the Session pooler string, not the direct one.
- VPS job: `backend .env was not captured`: the file moved, or `DEPLOY_USER` cannot read it.
