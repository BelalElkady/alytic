# Mobile environment and configuration

> **Everything that ships inside an APK / IPA is public.** Anyone can unzip it.
> Only public, client-safe values may be bundled. Private API keys, the Supabase
> service-role key, database credentials, the FCM service account, signing keys
> and cron secrets stay on the server or in your CI secret store.

## Environments

| Name | Who | API | Notes |
| --- | --- | --- | --- |
| `development` | you, emulator/device | local backend, `http://10.0.2.2:8080/api/public` (Android emulator) | http allowed **only** here; `allowMixedContent` and WebView debugging on |
| `staging` | testers (TestFlight internal / Play internal track) | `https://staging…/api/public` | separate URL scheme so it can be installed beside production |
| `production` | store release | `https://egxpert.com/api/public` | https enforced in `build-mobile.mjs` **and** at runtime (`nativeApiBase`) |

"Web" is the unchanged SSR site: it ignores all of the variables below.

Select one when building:

```bash
cd frontend
MOBILE_ENV=production  bun run build:mobile      # default
MOBILE_ENV=staging     bun run build:mobile
MOBILE_ENV=development bun run build:mobile
```

The values come from `frontend/env/mobile.<name>.env` (committed — public values
only). Anything already exported in the shell wins, so CI can override.

## Variables bundled into the app (public)

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_APP_ENV` | `production` | `development` / `staging` / `production` |
| `VITE_SITE_URL` | `https://egxpert.com` | Canonical website; share links are built from it |
| `VITE_API_BASE_URL` | `${VITE_SITE_URL}/api/public` | Where the app calls the API (must be https in production) |
| `VITE_LINK_HOSTS` | host of `VITE_SITE_URL` | Hosts whose https links open in the app (keep equal to the Android/iOS link configuration) |
| `VITE_URL_SCHEME` | `egxpert` | Fallback custom scheme (`egxpert://stock/SWDY`) |
| `VITE_APP_VERSION` | `frontend/package.json` version | Sent when registering a device |

Build-time identity (read by `capacitor.config.ts`, not bundled):

| Variable | Default | Purpose |
| --- | --- | --- |
| `CAP_APP_ID` | `com.egxpert.app` | Bundle id (iOS) / application id (Android) |
| `CAP_APP_NAME` | `EGXpert` | Display name |
| `CAP_DEV_SERVER_URL` | – | Live-reload URL; ignored when `VITE_APP_ENV=production` |

### Changing the bundle id

Set `CAP_APP_ID`, then update the native projects, which Capacitor only reads
at `cap add` time: Android `applicationId` in `android/app/build.gradle` (+ the
package directory and `namespace`), iOS `PRODUCT_BUNDLE_IDENTIFIER` in
`ios/App/App.xcodeproj`. Then update: `assetlinks.json` (`package_name`),
`apple-app-site-association` (`appIDs`), the Firebase apps, and the
App Store / Play Console entries. Easiest on a fresh project: delete
`android/`/`ios/` and re-run `npx cap add`.

## Server-side variables added for mobile (never bundled)

Set these where the backend / frontend server run (see `backend/.env.example`).

| Variable | Where | Purpose |
| --- | --- | --- |
| `MOBILE_ORIGINS` | backend **and** frontend server | Comma list of app origins allowed to call the API. Default `capacitor://localhost,https://localhost` |
| `FCM_SERVICE_ACCOUNT_JSON` | backend | Firebase service-account JSON (raw or base64). Without it notifications are stored but not pushed |
| `PRICE_ALERTS_CRON_SECRET` | backend | Secret for `POST /api/cron/price-alerts` (≥ 32 random chars: `openssl rand -hex 32`) |

Existing ones the mobile apps depend on: `SESSION_SECRET`, `FRONTEND_URL` / `APP_URL`,
`ALYTIC_API_URL` (frontend server → backend).

## Files that must never be committed

`google-services.json`, `GoogleService-Info.plist`, `*.jks` / `*.keystore`,
`keystore.properties`, `*.p8` / `*.p12` / `*.mobileprovision`, any
`*service-account*.json`. They are in `.gitignore`; `.gitleaks.toml` and
`security.yml` scan the repo. The mobile build also runs
`scripts/check-mobile-bundle.mjs`, which fails if the bundle contains private
keys, JWTs, service-account JSON or server secret assignments.

(`google-services.json` / `GoogleService-Info.plist` hold Firebase *client* keys
that are public by design, but they identify your Firebase project and are
kept out of git so each environment uses its own project.)

## Database

Apply `backend/supabase/mobile.sql` to the platform database **and to every
white-label tenant database** (it is idempotent; fresh installs get it from
`schema.sql`).
