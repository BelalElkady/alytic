# iOS: build, sign and publish

Project: `frontend/ios/App` (Capacitor 8, **Swift Package Manager** — no CocoaPods). Bundle id
`com.egxpert.app`, minimum iOS 15.

> **You need a Mac.** Building, running in the Simulator, archiving and uploading an iOS app
> requires **macOS and Xcode**. Linux and Windows cannot do it. The project was generated on Linux
> and was **never opened in Xcode or run on a device** by the author — treat the first Xcode build
> as the first real test (signing, entitlements and push are configured but unverified). The
> `Mobile — iOS` GitHub Actions workflow builds it on a macOS runner without any signing.
>
> **Xcode requirement (checked 2026-09-30):** since 28 Apr 2026, uploads to App Store Connect must be
> built with **Xcode 26 or later** (iOS 26 SDK) — <https://developer.apple.com/news/upcoming-requirements/>.
> Re-check before each release.

## Prerequisites
macOS, Xcode 26+, Node 22, bun, an Apple Developer Program membership ($99/yr), a physical iPhone
for push (the Simulator cannot receive real APNs pushes).

## Everyday development
```bash
cd frontend && bun install
bun run cap:ios              # builds the web bundle, syncs, opens Xcode
bun run cap:run:ios          # or run on a connected device/simulator
```
Xcode → target **App** → *Signing & Capabilities* → pick your **Team** (this is the only thing you
must set; no team id is committed). Automatic signing is on. Re-run `bun run cap:sync` after any
change in `src/`.

## Apple Developer configuration (one time)
1. **Identifiers → App IDs → +** → *App* → bundle id **`com.egxpert.app`** (explicit, not wildcard).
   Enable capabilities: **Push Notifications**, **Associated Domains**.
2. **Keys → +** → enable **Apple Push Notifications service (APNs)** → download the `.p8`
   **once** (you cannot re-download it); note the **Key ID** and your **Team ID**. Keep it out of git.
3. **App Store Connect → Apps → +** → new iOS app, same bundle id, primary language Arabic,
   SKU e.g. `egxpert-ios`.
4. Firebase: add an iOS app with the same bundle id, download **`GoogleService-Info.plist`**
   and drag it into Xcode's `App` group (target membership: App). It is git-ignored. Upload the
   APNs key (.p8 + Key ID + Team ID) under Firebase → Project settings → Cloud Messaging.
   Full push setup: `docs/push-notifications.md`.

## What is already configured
| Item | Where |
| --- | --- |
| Bundle id, version, deployment target | `ios/App/App.xcodeproj` (`com.egxpert.app`, 1.0 (1), iOS 15) |
| Push entitlement (`aps-environment`) + remote-notification background mode | `App/App.entitlements`, `Info.plist` |
| Associated domains `applinks:egxpert.com`, `www.egxpert.com` | `App/App.entitlements` |
| URL scheme `egxpert://` | `Info.plist` (`CFBundleURLTypes`) |
| APNs token → Firebase plugin, universal-link/URL forwarding | `AppDelegate.swift`, `SceneDelegate.swift` |
| Camera / photo-library purpose strings (portfolio screenshot import only) | `Info.plist` |
| `ITSAppUsesNonExemptEncryption = false` (HTTPS only, no custom crypto) | `Info.plist` |
| Icon (1024) and launch/splash images (light + dark) | `Assets.xcassets`, regenerated with `bun run cap:assets` from `frontend/assets/` |
| SwiftPM identity-collision workaround for the Firebase plugin | `capacitor.config.ts` (`experimental.ios.spm`) |

`aps-environment` is `development` in the file; the App Store distribution profile makes the
archived build use `production` automatically. Build configurations: **Debug** (development,
`CAPACITOR_DEBUG` on, web inspector via Safari → Develop) and **Release** (archive). Development
vs staging vs production *API* is chosen by `MOBILE_ENV` when bundling the web app
(`docs/mobile-environment.md`).

## Universal Links
Host `apple-app-site-association` (template `deploy/well-known/`) with your Team ID — see `docs/deep-links.md`.

## Signing, archive, TestFlight
Manual, in Xcode:
1. `MOBILE_ENV=production bun run cap:sync` (production web bundle).
2. Xcode → scheme **App**, destination **Any iOS Device (arm64)** → set **Version** (marketing) and **Build** (must increase each upload) → **Product → Archive**.
3. Organizer → **Distribute App → App Store Connect → Upload** (automatic signing creates the distribution certificate/profile).
4. App Store Connect → TestFlight: wait for processing, answer the export-compliance prompt (already declared), add **Internal testers** (instant) then **External** (needs Beta App Review).

From CI (macOS runner), using an **App Store Connect API key** so no certificates live in the repo:
run *Mobile — iOS* manually with **testflight = true**. Secrets required:

| Secret | Value |
| --- | --- |
| `APPLE_TEAM_ID` | 10-character Team ID |
| `ASC_KEY_ID`, `ASC_ISSUER_ID` | App Store Connect → Users and Access → Integrations → Keys (role **App Manager**) |
| `ASC_KEY_P8_BASE64` | `base64 -i AuthKey_XXXX.p8` |
| `GOOGLESERVICE_INFO_PLIST_BASE64` | `base64 -i GoogleService-Info.plist` (optional; push needs it) |

This relies on Xcode cloud-managed signing (`-allowProvisioningUpdates` + API key) and was not
exercised by the author; if your account/role can't create distribution certificates that way,
switch to a fastlane `match` or manual certificate + profile secrets. Certificates, provisioning
profiles and `.p8` files are never committed (`.gitignore` blocks them).

## App Store submission
1. App Store Connect → the version → attach the processed build.
2. Metadata: Arabic + English name/subtitle/description/keywords, **screenshots** (6.9" and 6.5" iPhone required; iPad only if you support it), support URL, marketing URL, **privacy policy URL**.
3. **App Privacy** labels — from `docs/mobile-privacy.md`.
4. **Age rating** questionnaire; **Content rights**; **Export compliance** (HTTPS only → exempt).
5. **App Review information**: a working demo account (email verified, active trial) and notes explaining the subscription model.
6. Submit for review. See the checklist below and `docs/mobile-store-compliance.md`.

## App Store checklist
- [ ] Built with **Xcode 26+** ✔ (re-verify)
- [ ] **Payments decision** (guideline 3.1.1): the app shows no prices/payment instructions; decide between companion-app positioning and StoreKit — `docs/mobile-store-compliance.md` §1
- [ ] **Account deletion in app** (5.1.1(v)) ✔ Settings → حذف الحساب
- [ ] No third-party social login (Sign in with Apple, 4.8, only needed if added) ✔
- [ ] Not a web wrapper (4.2): local bundle + push, deep links, secure storage, share, haptics ✔ — say so in review notes
- [ ] Push permission requested in context, not at launch ✔; `aps-environment` production via distribution profile
- [ ] Privacy policy updated; App Privacy labels filled; AI-provider disclosure (5.1.2(i))
- [ ] Financial-advice disclaimers visible; data-delay disclosure
- [ ] Purpose strings accurate (camera/photos only for screenshot import)
- [ ] Universal Links file live and verified on a device
- [ ] Tested on a physical iPhone: sign-in, sign-out, push receive + tap → `/stock/SWDY`, offline banner, share sheet, dark mode, small screen (SE) and Dynamic Island safe areas
