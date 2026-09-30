# Push notifications

```
User ─► App registers device ─► POST /api/mobile/devices ─► mobile_devices
Event (target reached) ─► notification service ─► notifications table (stored)
                                        └──────► FCM (HTTP v1) ─► Android (FCM) / iOS (APNs) ─► device
Tap ─► payload.path ─► deep-link allow-list ─► /stock/SWDY
```

One channel for both platforms: the app gets an **FCM registration token** on
Android and iOS (`@capacitor-firebase/messaging`; on iOS Firebase exchanges
the APNs token for an FCM token), and the backend sends everything through
**FCM HTTP v1**. FCM hands iOS messages to APNs using the APNs key you upload
to the Firebase project. Service credentials exist only on the server.

## What was built

| Piece | File |
| --- | --- |
| Device + notification tables | `backend/supabase/mobile.sql` |
| `POST /api/mobile/devices` register/refresh (idempotent per user+device) | `backend/src/mobile/routes.js`, `devices.js` |
| `GET /api/mobile/devices`, `DELETE /api/mobile/devices/:deviceId` | same |
| `GET /api/notifications`, `POST /api/notifications/:id/read` | same |
| Notification types (10, extensible) | `backend/src/notifications/types.js` |
| FCM v1 sender, dead-token detection | `backend/src/notifications/fcm.js` |
| Store → push → mark sent | `backend/src/notifications/service.js` |
| Target / stop-loss alerts + scheduler + cron route | `backend/src/notifications/priceAlerts.js`, `server.js` |
| Permission flow, token register/refresh, tap routing, deregistration | `frontend/src/native/push.ts`, `ui.tsx` |

Registration payload: `{ deviceId, platform, pushToken, appVersion, osVersion, enabled }`.
`deviceId` is a random id generated on first launch (not a hardware identifier);
`user_id` comes from the session, never the body. One user can have many devices.
Tokens are never returned by any endpoint and never logged.

Notification row: `id, user_id, type, title, body, data, created_at, read_at, sent_at`.
`data.path` is the in-app route a tap opens; `data.notificationId` lets the app mark it read.

### Types

`stock_target_reached`, `stop_loss_triggered`, `stock_event`, `portfolio_alert`,
`new_ai_analysis`, `market_open`, `market_close`, `earnings_news`,
`subscription_expiring`, `system_announcement`. **Only the first two have a
producer today** (the price-alert engine). The others are defined so a future
producer is one call: `notifications.notify(userId, { type, title, body, data })`.
Nothing simulates or fakes the rest.

### How the price alerts decide

For users with at least one enabled device, each position's `target` / `stop`
(set through the existing `POST /api/portfolio/levels`) is compared with the
latest live quote every 5 minutes while the EGX session is open. Each
(user, code, kind, level) fires once (the dedupe key is stored on the
notification); raising the target later fires again. Levels the AI engine
computes but the user never saved are **not** alerted on yet — a natural next step.

Run it externally instead (or as well): `POST /api/cron/price-alerts` with header
`X-Cron-Secret: $PRICE_ALERTS_CRON_SECRET`.

## Permission UX

The OS dialog is never shown at launch. Two places ask, both user-initiated:
a one-time in-app card after sign-in ("عايز تنبيه…؟" → *Enable* / *Not now*), and
Settings → التنبيهات. Denied state is explained with a pointer to system
settings (the OS will not ask twice). Token rotation (`tokenReceived`) re-registers
automatically; sign-out calls `DELETE /api/mobile/devices/:id` and deletes the FCM
token, so the next person on that phone isn't sent your alerts. Tokens FCM reports
as `UNREGISTERED` are disabled server-side.

## Setup

### 1. Firebase project
1. <https://console.firebase.google.com> → create a project (one per environment is recommended).
2. Add an **Android app** with package `com.egxpert.app` → download `google-services.json` → put it in `frontend/android/app/` (git-ignored).
3. Add an **iOS app** with bundle id `com.egxpert.app` → download `GoogleService-Info.plist` → add it to the Xcode `App` target (git-ignored).
4. Project settings → Cloud Messaging → **Apple app configuration** → upload an **APNs Authentication Key (.p8)** (key id + team id).
5. Project settings → Service accounts → *Generate new private key*. Base64 it and set on the **server only**:
   `FCM_SERVICE_ACCOUNT_JSON=$(base64 -w0 service-account.json)`. Delete the file afterwards or keep it in a secret manager.

### 2. Apple Developer
Enable the **Push Notifications** capability on the App ID; create the APNs key
(Keys → + → Apple Push Notifications service). Details in `docs/ios-release.md`.

### 3. Backend
Apply `mobile.sql`, set `FCM_SERVICE_ACCOUNT_JSON`, restart. Without it the API
still stores notifications and the scheduler stays off (logged nowhere — by design
nothing can be delivered).

### 4. Test a real push
1. Install a **debug build on a physical device** (emulators rarely receive APNs; the Android emulator needs Google Play images).
2. Sign in, Settings → التنبيهات → فعّل. Check `select * from mobile_devices;`.
3. Save a level: `POST /api/portfolio/levels {"code":"SWDY","target":1}` for a stock above that price, then
   `curl -X POST -H "X-Cron-Secret: …" https://egxpert.com/api/cron/price-alerts` during market hours
   (or call `notifications.notify(...)` from a script with `type: 'system_announcement'` any time).
4. Tap the notification — the app opens `/stock/SWDY`.

## Limitations
* Android 13+ needs the `POST_NOTIFICATIONS` runtime permission (declared; requested through the same flow).
* iOS Focus modes and Android battery optimisation can delay delivery; we send with high priority.
* No in-app notification list screen yet (the API exists: `GET /api/notifications`).
