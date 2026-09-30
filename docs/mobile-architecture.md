# EGXpert mobile architecture

Assessment of the existing project and the architecture of the Capacitor apps
(Android + iOS). Written from the repository as it was before the mobile work;
nothing here is assumed from the product name.

## 1. What the project is today

| Question | Finding |
| --- | --- |
| Frontend framework | React 19 + **TanStack Start / Router** (file routes in `frontend/src/routes`), Tailwind 4, Radix/shadcn UI, Recharts, TanStack Query. Scaffolded by Lovable (`@lovable.dev/vite-tanstack-config`). Arabic-first, RTL. |
| Build system | Vite 8. `vite build` produces a **server-rendered Node server** (Nitro `node_server` preset → `frontend/.output`). |
| Package manager | **bun** for `frontend/` (`bun.lock`), **npm** for `backend/` and the repo root. |
| Routing | File-based. `_app.*` routes are the signed-in "desk" (`/portfolio`, `/stock/$code`, `/targets`, `/indices`, `/calendar`, `/charts`, `/cash`, `/market`, `/settings`, `/admin`, `/track-record`); marketing + blog + auth pages are public and SSR'd for SEO. |
| Authentication | Custom. Email + password (scrypt), Google sign-in, email verification, password reset. Session = HMAC-signed token (`sub`, tenant, `exp`, password fingerprint, 30-day TTL) in an **HttpOnly, SameSite=Lax cookie** `alytic_session`. Changing the password invalidates old sessions. Per-IP and per-account throttling. |
| API | Express 5 REST under `/api/*` (`backend/src/api/server.js`). The browser never calls it directly: the frontend has a same-origin proxy, `routes/api/public/$.ts` (`/api/public/*` → Express), which also sets `X-Forwarded-Host` for white-label tenancy and blocks `/api/cron/*`. |
| Backend | Node ≥ 20, Express, `@supabase/supabase-js` (service-role), OpenRouter for AI, scrypt auth, Resend email. Multi-tenant (white-label): `backend/src/tenancy`. Schedulers run in-process (daily close, stop-plan warmer). |
| Environment variables | `backend/.env.example` (Supabase, OpenRouter, session secret, cron secrets, Resend, InstaPay, Oanor…), `frontend/.env.example` (`VITE_GOOGLE_CLIENT_ID`, `ALYTIC_API_URL`). |
| Database | Supabase Postgres (`backend/supabase/schema.sql`), RLS on, service-role only. One database per white-label tenant. |
| Notification infrastructure | **None** for push. Email only (Resend). No device/token storage, no notification log. |
| User/account system | `users` table, roles `admin` / `marketer` / `user`, phone number required, 5-day trial after email verification. |
| Subscription / payment | **Manual.** The user transfers via InstaPay and an admin activates the period. No payment gateway. (See §7: this matters for the app stores.) |
| Charts | Recharts. `price-history-chart.tsx` has six range buttons (intraday → 5y), tooltip on touch-drag. No pinch-zoom. |
| Stock data providers | TradingView scanner/history, Mubasher, Yahoo, stockanalysis.com, optional Oanor live quotes for subscribers (`docs/adr/0001`). |
| AI | OpenRouter: portfolio/stock/cash reviews, market analysis, stop plans, blog generation, support bot. **No streaming** responses — the client polls `/status` endpoints. |
| Wallet / portfolio | Server-side. `/api/portfolio*` does all valuation, P/L, levels, cash flow and corporate actions; the client only renders and re-prices with live quotes. |
| Responsive / mobile UI | Already mobile-aware: a bottom tab bar (`MobileNav`, `md:hidden`) with a "more" sheet, responsive grids. |
| PWA | None (no manifest, no service worker). |
| Deployment | GitHub Actions → tarball → VPS (systemd + nginx). `deploy.yml`, cron workflows. The test workflow is currently commented out. |

Baseline before changes: frontend `vitest` 92 passing; `bun run build` green;
backend API tests need a live Supabase project (they cannot run in an isolated
environment), backend unit tests run standalone.

## 2. Mobile readiness and risks

| Risk | Why it matters | What was done |
| --- | --- | --- |
| **SSR-only build** | A native app has no server. `createServerFn` (tenant lookup, blog) and server routes cannot run inside the app. | A second Vite config builds the same routes as a static SPA (`frontend/vite.config.mobile.ts`). The two server-function modules are swapped for client equivalents by alias (`src/native/server-fn-shims`). No route or component was forked. |
| **Cookie auth doesn't work cross-origin** | The app's origin is `capacitor://localhost` / `https://localhost`; cookies would be third-party and WebView cookie stores are unreliable and not hardware-backed. | Same signed token, sent as `Authorization: Bearer`, kept in Keychain/Keystore. The token is put in a login response **only** for requests carrying the app's own `Origin`; the website keeps its HttpOnly cookie and never sees a token. |
| **CORS / CSRF guard** | The backend's write guard rejects unknown origins. | Native origins are allow-listed exactly (`MOBILE_ORIGINS`); the proxy answers CORS only for them, without credentials. |
| **Store payment policy** | Apple 3.1.1 / Google Play payments policy: paid digital features need in-app purchase, and steering to other payment methods is restricted. EGXpert sells via manual InstaPay. | The apps show **no prices, payment instructions or purchase links** (subscription status only). A real decision is still required — see `docs/mobile-store-compliance.md`. |
| **Third-party scripts** | The site loads AdSense, Google Analytics, Meta Pixel. | Not loaded in the native build. |
| **Google sign-in** | GIS web button cannot run from the app's origin; offering it on iOS would also trigger Sign in with Apple (guideline 4.8). | Hidden in the app; email + password only. Native Google/Apple sign-in is follow-up work. |
| No push infrastructure | Needed for the main requirement. | Built (§4). |
| Stale prices shown as live | Users act on prices. | Polling pauses offline; a banner states data may be old; no price is cached. |

## 3. Architecture

```
                         ┌────────────────────────────────────────────┐
                         │                EGXpert backend             │
                         │ Express API · Supabase · AI · schedulers   │
                         │   /api/*  (+ /api/mobile/*, notifications) │
                         └───────────────▲────────────────────────────┘
                                         │  /api/public/*  (same proxy, CORS for the app origins)
        ┌────────────────────────────────┴───────────────────────────────┐
        │                      Web app (frontend/src)                    │
        │   React · TanStack Router · shared components and stores       │
        └───────────────┬───────────────────────────────┬────────────────┘
                        │ vite build (SSR, Nitro)       │ vite build -c vite.config.mobile.ts (static SPA)
                        ▼                               ▼
                 Browser (egxpert.com)          dist-mobile/client  ──► Capacitor
                 cookie session                                        │
                                                          ┌────────────┴───────────┐
                                                          ▼                        ▼
                                                   Android shell              iOS shell
                                                   (frontend/android)         (frontend/ios)
                                              bearer token in Keystore    bearer token in Keychain
```

* **One codebase.** `src/native/*` is the only native-aware code; every entry point
  checks `isNative()` and is inert in a browser, so the website behaves exactly
  as before (the existing 92 tests still pass untouched).
* **Local bundle, not a wrapped URL.** `capacitor.config.ts` has no `server.url`.
  The app ships its own HTML/JS/CSS and talks to the API over HTTPS.
* **Native capabilities** (all in `frontend/src/native`): secure session storage,
  push (FCM), deep links, native share, haptics, network state, app lifecycle and
  Android back button, status bar / splash / keyboard, offline cache, pull-to-refresh.
* **Same backend.** No second API. New endpoints are additive.

### Where things live

| Concern | Location |
| --- | --- |
| Mobile SPA build | `frontend/vite.config.mobile.ts`, `frontend/scripts/build-mobile.mjs` |
| Capacitor config | `frontend/capacitor.config.ts` |
| Public env per environment | `frontend/env/mobile.{development,staging,production}.env` |
| Native layer | `frontend/src/native/` |
| Native CORS for the proxy | `frontend/src/lib/native-cors.ts` |
| Bearer auth, refresh | `backend/src/auth.js` (`resolveSession`, `refreshedSessionToken`) |
| Devices + inbox API | `backend/src/mobile/` |
| Notification model, FCM, alerts | `backend/src/notifications/` |
| Tables | `backend/supabase/mobile.sql` (also in `schema.sql`) |

## 4. Push notifications

```
App ──register(deviceId, FCM token)──► POST /api/mobile/devices ──► mobile_devices
Backend event (price alert, …) ──► notification service ──► notifications (stored)
                                                     └──► FCM HTTP v1 ──► Android / APNs ──► device
Tap ──► deep link from payload.path ──► /stock/SWDY
```

Details in `docs/push-notifications.md`.

## 5. Mobile UX decisions

The existing information architecture was kept rather than replaced: the bottom
tab bar already gives one-tap access to الأسهم (portfolio + watchlist),
المؤشرات, الأهداف (targets/stops/alerts), التقويم and الرسوم, with the rest under
"المزيد". Added for the app: safe-area handling (notch / home indicator), 44 px
touch targets, pull-to-refresh, offline banner, native share on the stock page,
a contextual (non-launch) notification prompt, and overscroll/selection tuning.

## 6. What is not done (honest list)

* **Pinch-zoom / crosshair charts** — Recharts stays; ranges and touch tooltip only.
* **AI streaming** — the backend doesn't stream; nothing to consume.
* **A dedicated watchlist screen and a redesigned tab bar** — the watchlist lives
  inside the existing portfolio screen.
* **Native Google / Apple sign-in, in-app purchase** — see compliance doc.
* **Real-device verification** — no Android SDK / Xcode / device was available when
  this was written. Native builds are configured and synced but **not** run on
  hardware; follow the release docs and test on real devices before submitting.
* **Backend API tests** for the new routes need a Supabase test project; the pure
  logic (validation, FCM sender, alert engine, origin guard) is unit-tested.
