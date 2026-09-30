# Mobile privacy: data, permissions, deletion

What the **native apps** touch. This is an engineering inventory to feed the
privacy policy (`frontend/src/routes/privacy.tsx`) and the store data-safety /
privacy-nutrition-label forms — it is not legal advice; have the policy reviewed.

## Data the app handles

| Category | What | Where it lives | Why |
| --- | --- | --- | --- |
| Account | email, name, phone, password hash (server), role, subscription status | server DB | sign-in, billing, support |
| Session | signed session token | iOS Keychain / Android Keystore-backed storage (never localStorage); server keeps no session table | stay signed in |
| Portfolio | positions, trades, cash, levels, watchlist, notes | server DB (the app caches nothing of this) | the product |
| Device / push | random install id, platform, FCM token, app + OS version, last seen | `mobile_devices` | deliver alerts. Removed on sign-out, when FCM reports the token dead, and on account deletion |
| Notifications | type, text, payload, read/sent times | `notifications` | inbox + dedupe. Removed with the account |
| Support chat | messages and images you send | server DB / storage | support |
| On-device cache | last viewed stock **code**, UI preferences, random device id, theme | Capacitor Preferences / localStorage; wiped by `clearOfflineCache()` | offline hints. **No prices, balances or credentials** |

Not collected: contacts, location, photos library (the screenshot import uses the
picker / camera only when you choose it), advertising id, hardware identifiers,
clipboard, microphone. No third-party analytics, ads, attribution or crash SDKs in
the apps (AdSense, Google Analytics and Meta Pixel are **disabled** in the native
build, `__root.tsx`). `track()` therefore sends nothing from the app; if you add a
collector, update this page, the policy and the store forms first, and keep the
property filter in `analytics.ts` (drops anything named like a password/token/key/session).

Firebase Cloud Messaging is a processor for push delivery (it sees the token and
message content). Declare it in the privacy policy.

## Permissions

| Platform | Permission | When |
| --- | --- | --- |
| Android | `INTERNET`, `ACCESS_NETWORK_STATE` | always (API, offline banner) |
| Android | `POST_NOTIFICATIONS` (13+) | only when the user taps *Enable alerts* |
| Android | `VIBRATE` | haptic feedback |
| iOS | Push notifications | only when the user taps *Enable alerts* |
| iOS | Photo library / Camera usage strings | only for the existing portfolio-screenshot import; strings explain it |

## Notification permission policy
Never asked on first launch; asked after an in-app explanation, from a button.
Users can turn alerts off in system settings or by signing out (device removed).

## Data deletion
* **In app:** Settings → حذف الحساب (type your email to confirm) → `POST /api/account/delete` deletes the user; portfolio, trades, subscription rows, support thread, devices and notifications cascade. Admin accounts are refused (removed from the admin panel).
* **On the web:** same screen on egxpert.com.
* **For the store forms** Apple and Google ask for a web URL where users can request deletion: point it at the account-deletion instructions in the privacy policy (`/privacy`) — **add a short "how to delete your account" section there and, for Google Play, a public page reachable without installing the app.**
* Sign-out removes the device registration and push token immediately.
* Backups/logs: state your retention in the policy (Supabase backups follow your Supabase plan).

## Open items (owner decisions)
1. Update `/privacy` for the app: push tokens, FCM, in-app deletion, no ad/analytics SDKs in the app.
2. Fill Apple "App Privacy" and Google "Data safety" from the table above (Contact info, Financial info [portfolio — user-provided], Identifiers [device id, push token], User content [support messages]); all "linked to user", none for tracking, none shared except processors.
3. The website still runs Google Analytics / Meta Pixel / AdSense for web visitors; that is unchanged and web-only.
