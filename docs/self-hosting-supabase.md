# Self-hosting Supabase on the app's VPS

How to move the platform database from supabase.com to a Supabase running in
Docker on the same VPS as the backend. The backend reaches Supabase over
loopback; nothing Supabase publishes is reachable from the internet except
Storage's read-only object paths, which nginx serves on the site's own domain.

Checked against Supabase's `docker/` directory as of September 2026. Upstream
changes this setup often (the API gateway moved from Kong to Envoy in 2026),
so read [the official guide](https://supabase.com/docs/guides/self-hosting/docker)
alongside this one and trust it where they disagree.

Files this uses, all in `deploy/supabase/`:

| File | What it's for |
|---|---|
| `docker-compose.alytic.yml` | Layer over upstream's compose file: loopback-only ports, memory caps, the cron secret |
| `nginx-storage.conf` | nginx snippet exposing only Storage's public/signed object reads |
| `backup.sh` | Nightly database + Storage backup, copied off the server with rclone |

## What moves and what doesn't

- **Moves:** the platform database (the default site's users, portfolios,
  subscriptions, blog, and the tenant registry), its Storage files, and the
  `evaluate-recommendations` edge function with its pg_cron job.
- **Doesn't:** a white-label client whose `tenants.supabase_url` points at its
  own Supabase project keeps using that project. Moving one of those is the
  same procedure run again against its project, then updating its row in the
  platform panel.

## Before you start

- **Take a VPS snapshot** (the provider's panel), so a botched step can be rolled back.
- **Pick a quiet time.** Writes made to the cloud database between the dump
  (step 7) and the switch-over (step 10) are lost. Stop the backend, or accept
  that, for the ~15 minutes in between.
- **Server:** 4 GB RAM free is plenty; the capped stack below uses about 2–3 GB.

## 1. Install Docker

```bash
curl -fsSL https://get.docker.com | sh
docker compose version    # needs 2.24.4 or newer
```

## 2. Get Supabase's Docker setup

```bash
git clone --depth 1 https://github.com/supabase/supabase
mkdir ~/supabase-project
cp -rf supabase/docker/* ~/supabase-project
cp supabase/docker/.env.example ~/supabase-project/.env
cp /path/to/alytic/deploy/supabase/docker-compose.alytic.yml ~/supabase-project/
cd ~/supabase-project
```

## 3. Set every secret

The example `.env` ships with **public demo keys**; anyone could use them to
get full access to your database. Replace them before the first start:

```bash
sh utils/generate-keys.sh --update-env   # generates JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY, the S3 keys, … into .env
```

Without `--update-env` it only prints them.

Then open `.env` and check by hand:

- every value still showing a placeholder (`your-...`, `this_password_is_insecure...`) is replaced;
- `DASHBOARD_PASSWORD` is long and random;
- `POOLER_TENANT_ID` is set (any short name, e.g. `alytic`).

Add Alytic's lines:

```bash
COMPOSE_FILE=docker-compose.yml:docker-compose.alytic.yml
FUNCTIONS_VERIFY_JWT=false                      # the function checks its own X-Cron-Secret
EVALUATE_CRON_SECRET=<openssl rand -hex 32>
```

Leave `SUPABASE_PUBLIC_URL` at its default `http://localhost:8000`: that's
what the SSH tunnel in step 5 uses, and the gateway grants that origin CORS
access to Studio's database endpoint, so it must not be the public site.
Browsers reach Storage through nginx instead (step 9).

`COMPOSE_FILE` already exists in `.env`; replace that line rather than adding
a second one.

Keep a copy of `.env` somewhere safe off the server. Without `JWT_SECRET` and
`VAULT_ENC_KEY` a restored backup can't be used.

## 4. Check what will run

```bash
docker compose config | grep -A3 -E 'published|host_ip'
```

Every published port must show `host_ip: 127.0.0.1` (API 8000, Postgres 5432,
pooler 6543). Docker writes its own firewall rules, so **ufw does not protect
Docker's published ports** — this binding is what keeps them private.

## 5. Start it

```bash
docker compose pull
docker compose up -d
docker compose ps          # wait until every service is "healthy"
```

To open the dashboard (Studio) from your own computer, tunnel it; don't route
it through nginx:

```bash
ssh -L 8000:127.0.0.1:8000 root@your-server     # then browse http://localhost:8000
```

Log in with `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`.

## 6. Install the edge function

```bash
cp -r /path/to/alytic/backend/supabase/functions/evaluate-recommendations volumes/functions/
docker compose restart functions
```

## 7. Copy the database from supabase.com

Get the **Session pooler** connection string from the cloud project (Connect →
Session pooler). The direct connection is IPv6-only and often unreachable.

```bash
export CLOUD_DB_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres'

npx supabase db dump --db-url "$CLOUD_DB_URL" -f roles.sql  --role-only
npx supabase db dump --db-url "$CLOUD_DB_URL" -f schema.sql
npx supabase db dump --db-url "$CLOUD_DB_URL" -f data.sql   --use-copy --data-only

cat roles.sql schema.sql <(echo 'SET session_replication_role = replica;') data.sql \
  | docker compose exec -T db psql -U postgres -d postgres -v ON_ERROR_STOP=1 --single-transaction
```

`supabase db dump` runs `pg_dump` in Docker and leaves out Supabase's own
schemas (`auth`, `storage`, `vault`, `cron`…), which the self-hosted database
already has. Alytic keeps its users in `public.users`, not `auth.users`, so
nothing is lost by that. Vault secrets and the cron job are recreated in step 8.

If the restore stops on an error, the single transaction means nothing was
written: fix the cause and run the same command again.

## 8. Recreate the recommendations cron job

In Studio's SQL editor (or `docker compose exec db psql -U postgres`):

```sql
select vault.create_secret('http://api-gw:8000', 'recommendations_project_url');
select vault.create_secret('<the EVALUATE_CRON_SECRET value>', 'recommendations_cron_secret');
```

`http://api-gw:8000` is the gateway's name inside Docker's network. The call
starts from inside the database container, where `127.0.0.1` would be the
container itself.

Then run the rest of `backend/supabase/recommendations-cron.sql` (from
`create extension` down). To test it without waiting for the schedule:

```sql
select net.http_post(
  url := 'http://api-gw:8000/functions/v1/evaluate-recommendations',
  headers := jsonb_build_object('Content-Type', 'application/json', 'X-Cron-Secret', '<secret>'),
  body := '{}'::jsonb
);
select status_code, content from net._http_response order by created desc limit 1;   -- expect 200
```

## 9. Storage: files, nginx, URLs

The backend returns Storage URLs to browsers: blog feature images and brand
logos (public buckets) and support-chat attachments (signed links). The
backend reaches Storage on `127.0.0.1`, so browsers need another way in.

**nginx.** Copy `deploy/supabase/nginx-storage.conf` to
`/etc/nginx/snippets/alytic-supabase-storage.conf`, add
`include snippets/alytic-supabase-storage.conf;` inside the site's HTTPS
`server` block, then `sudo nginx -t && sudo systemctl reload nginx`. It
exposes only `GET`/`HEAD` on `/storage/v1/object/public/` and
`/storage/v1/object/sign/`, so nobody can upload, list or delete.

**Backend.** Set `SUPABASE_STORAGE_PUBLIC_URL=https://egxpert.com` (step 10).
The backend then rewrites every Storage URL it hands out from
`http://127.0.0.1:8000/...` to `https://egxpert.com/...` (see
`browserStorageUrl` in `backend/src/supabaseClient.js`).

**Files.** The buckets (`blog-images`, `brand-assets`,
`support-attachments`) are created automatically on first upload, but the
files already in the cloud project have to be copied. Both ends speak S3, so
[rclone](https://rclone.org/) can sync them:

1. Cloud: Storage → Settings → S3 Connection. Note the endpoint, then create an access key.
2. Self-hosted: the key pair is `S3_PROTOCOL_ACCESS_KEY_ID` /
   `S3_PROTOCOL_ACCESS_KEY_SECRET` in `.env` (step 3 generated them). The
   endpoint is `http://127.0.0.1:8000/storage/v1/s3`.
3. Add both as `s3` remotes (`rclone config`, provider "Other", region as shown),
   create the three buckets on the self-hosted side (Studio → Storage; make
   `blog-images` and `brand-assets` public), then for each bucket:
   `rclone copy cloud:blog-images local:blog-images`.

With under 1 MB of files, downloading them from the cloud dashboard and
uploading them in Studio into the same bucket and path works too.

**URLs already saved in the database** still point at `https://<ref>.supabase.co`.
Rewrite them once the files are copied:

```sql
-- replace <ref> with the cloud project's ref
update blog_posts set
  image_url       = replace(image_url,       'https://<ref>.supabase.co', 'https://egxpert.com'),
  image_thumb_url = replace(image_thumb_url, 'https://<ref>.supabase.co', 'https://egxpert.com'),
  content         = replace(content,         'https://<ref>.supabase.co', 'https://egxpert.com')
where concat(image_url, image_thumb_url, content) like '%<ref>.supabase.co%';

update tenants
set brand_json = replace(brand_json::text, 'https://<ref>.supabase.co', 'https://egxpert.com')::jsonb
where brand_json::text like '%<ref>.supabase.co%';
```

A white-label client's own project keeps its own URLs; the rewrite only
touches the platform project's ref.

## 10. Switch the backend over

In `backend/.env`:

```bash
SUPABASE_URL=http://127.0.0.1:8000
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY from ~/supabase-project/.env>
SUPABASE_STORAGE_PUBLIC_URL=https://egxpert.com
```

Restart the backend, then check: sign in, open a portfolio, open the admin
panel, open a blog post with an image, send a support message with a picture.

Keep the cloud project (paused, not deleted) for a week or two in case you
need to switch back: that's just the old two `.env` lines again.

## 11. Backups

The VPS has no automatic backups; this is the only copy of every account and
payment record. Set up both:

1. **Off-site copies:** install [rclone](https://rclone.org/), configure a
   remote at another provider (Backblaze B2, Hetzner Storage Box, …), then:

   ```bash
   crontab -e
   17 3 * * * SUPABASE_DIR=/root/supabase-project RCLONE_REMOTE=b2:alytic-backups /root/alytic/deploy/supabase/backup.sh >> /var/log/alytic-backup.log 2>&1
   ```

   It keeps 14 days locally (`KEEP_DAYS`); set a lifecycle rule on the remote
   bucket for how long to keep the off-site copies.
2. **The provider's snapshot add-on**, for fast whole-server rollback.

**Test a restore once**, into a scratch database, before you depend on it:

```bash
docker compose exec -T db psql -U postgres -c 'create database restore_test'
docker compose exec -T db pg_restore -U postgres -d restore_test --no-owner < /var/backups/alytic/db-<stamp>.dump
docker compose exec -T db psql -U postgres -d restore_test -c 'select count(*) from users'
docker compose exec -T db psql -U postgres -c 'drop database restore_test'
```

## Upkeep

- **Updates:** every month or two, `git pull` the upstream repo, compare its
  `docker/` changes against `~/supabase-project` (new `.env` keys especially),
  then `docker compose pull && docker compose up -d`. Take a backup first.
- **Memory:** `docker stats --no-stream`. If `db` sits near its 2 GB cap,
  raise `mem_limit` in `docker-compose.alytic.yml`.
- **Logs** are Docker's own (`docker compose logs -f rest`). Supabase's log
  collection stack (`docker-compose.logs.yml`) isn't enabled and isn't needed.
