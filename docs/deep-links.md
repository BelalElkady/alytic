# Deep links

Supported, all resolved by one allow-list (`frontend/src/native/deep-links.ts`):

| URL | Opens |
| --- | --- |
| `https://egxpert.com/stocks/SWDY` (also `/stock/SWDY`) | `/stock/SWDY` |
| `https://egxpert.com/portfolio` (and `/`) | `/portfolio` |
| `https://egxpert.com/alerts` (also `/targets`) | `/targets` (targets, stops, alerts) |
| `/market`, `/indices`, `/calendar`, `/charts`, `/cash`, `/settings`, `/subscribe` | same |
| `/reset-password?token=…`, `/verify-email?token=…` | same (token validated as opaque `[A-Za-z0-9_-]{8,256}`) |
| `egxpert://stock/SWDY` | custom-scheme fallback |
| push payload `path` | same table |

Anything else — another host, `http://`, `javascript:`, unknown path, malformed
stock code — opens nothing. Note the public site links `/stocks/…` and `/alerts`
but the app's own routes are `/stock/$code` and `/targets`; the aliasing lives in
that one table. **Add new public paths there and to the two domain files below.**

The share button builds `https://egxpert.com/stocks/CODE`: a normal web URL that
opens the app when installed and the website otherwise (the website has no
`/stocks/` page today — **add a redirect `/stocks/:code → /stock/:code` on the
web app** so the link works for people without the app).

## Domain configuration (required for https links)

The links only open the app once the domain vouches for it.

### Android App Links
1. Get the SHA-256 fingerprints: Play Console → *Setup → App signing* (the **app signing key**) and your **upload key**
   (`keytool -list -v -keystore upload.jks`).
2. Copy `deploy/well-known/assetlinks.json.example` → host at
   `https://egxpert.com/.well-known/assetlinks.json` (HTTP 200, `application/json`, **no redirect**).
3. `AndroidManifest.xml` already contains the verified intent filter (`android:autoVerify="true"`) for `egxpert.com` and `www.egxpert.com`, plus the `egxpert://` scheme.
4. Verify: `adb shell pm get-app-links com.egxpert.app` → `verified`; or Google's
   <https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://egxpert.com&relation=delegate_permission/common.handle_all_urls>.
   Test: `adb shell am start -a android.intent.action.VIEW -d https://egxpert.com/stocks/SWDY`.

### iOS Universal Links
1. Your Apple **Team ID** (developer.apple.com → Membership).
2. Copy `deploy/well-known/apple-app-site-association.example` (replace `REPLACE_TEAM_ID`) → host at
   `https://egxpert.com/.well-known/apple-app-site-association` (**no file extension**, `application/json`, no redirect).
3. The app has the **Associated Domains** entitlement `applinks:egxpert.com` and `applinks:www.egxpert.com` (`App.entitlements`); enable the capability on the App ID.
4. Verify on a device (not the simulator's Safari address bar): tap a link in Notes/Messages. Apple's CDN caches the file — changes can take hours; in development add `?mode=developer` to the entitlement domain.

nginx snippet for both files: `deploy/nginx/well-known-mobile.conf.example`.
If you serve several white-label domains, each needs its own files and
entitlement/intent entries (and `VITE_LINK_HOSTS`).

## Cold start and notifications
`App.getLaunchUrl()` handles the link that launched the app, `appUrlOpen` the
ones that arrive while it runs, and notification taps use the same resolver via
`payload.path`. Auth guard: a link to a signed-in page while signed out goes to
login first (existing `DeskShell` behaviour).
