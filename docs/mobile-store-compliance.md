# App Store / Google Play compliance review

Reviewed against the official pages on 2026-09-30 (fetched, not recalled). Policies change; **re-check before each
submission.** Nothing here is a guarantee of approval.

## Verified requirements

| Requirement | Finding | Where applied |
| --- | --- | --- |
| Google Play target API | From **31 Aug 2026** new apps and updates must target **Android 16 (API 36)** or higher (extension possible to 1 Nov 2026). Source: developer.android.com/google/play/requirements/target-sdk | Capacitor 8 generates `targetSdkVersion 36`, `compileSdkVersion 36` (`variables.gradle`); verified after `cap add android` — see `docs/android-release.md`. |
| Apple build toolchain | Since **28 Apr 2026** uploads must be built with **Xcode 26** / iOS 26 SDK or later. Source: developer.apple.com/news/upcoming-requirements | `docs/ios-release.md`; CI uses Xcode 26 runners. |

## Not a WebView wrapper
Apple 4.2 (minimum functionality) and Google's "webview spam" / minimum functionality rules
reject thin website wrappers. The app bundles its UI locally and adds native behaviour that the
website cannot provide: push notifications with deep-linked taps, Keychain/Keystore session
storage, universal/app links, native share sheet, haptics, network-state handling and lifecycle,
Android back button, pull-to-refresh, safe-area layout. Keep shipping native value; reviewers look
for it.

## Decisions you must make (real risks)

1. **Payments (highest risk).** EGXpert activates subscriptions manually after an InstaPay transfer.
   * Apple 3.1.1: features/content unlocked in the app must use in-app purchase; apps may not direct users to other purchase methods (3.1.3 has narrow exceptions, e.g. "Reader" apps, and storefront-specific link-out rules that have been changing — check your target storefronts).
   * Google Play payments policy: digital goods consumed in the app must use Play Billing (with region-specific alternative-billing programs).
   * **What the app does now:** no prices, no payment instructions, no purchase links, and the support bot won't hand out InstaPay details in the app. It shows only subscription status plus a refresh button. A user whose trial expired sees that the subscription is managed outside the app.
   * **Your options:** (a) ship as is and treat the app as a companion for existing customers (check with current Apple/Google guidance that this is acceptable for your category and storefronts); (b) add StoreKit / Play Billing and a server-side receipt check → `subscriptions` (significant work, 15–30 % fees); (c) make the app free with paid features removed. Consult current store policy or counsel before submitting.
2. **Account deletion.** Required by both stores when accounts can be created — implemented (`/api/account/delete`, Settings). Google also wants a public web URL for deletion requests: add it to the privacy page.
3. **Sign in with Apple (4.8).** Triggered if you offer a third-party social login. The native app offers email/password only (Google sign-in hidden). Adding Google sign-in to iOS requires adding Apple too.
4. **Financial-app content.** Declare correctly: EGXpert gives analysis and AI recommendations, not brokerage. Apple 1.1/5.x and Google's financial-services policy expect clear disclaimers, accurate claims and, where recommendations are presented, a "not investment advice" statement and source/lag disclosure (TradingView data is delayed ~15 min for non-subscribers). Check the existing disclaimers render in the app; Google asks whether the app offers personal loans / trading — answer honestly (it does not trade).
5. **AI content.** Apple 5.1.2(i) (AI data sharing) and Google's AI-generated content policy: disclose that analyses are AI-generated, provide a way to report concerns (the support chat), and disclose that portfolio data/screenshots are sent to a model provider (OpenRouter) in the privacy policy.
6. **Privacy forms.** See `docs/mobile-privacy.md`.
7. **Login for review.** Give reviewers a working demo account with an active trial (Play: *App access*; Apple: *Sign-in required*), since email verification and phone are normally required.
8. **Arabic/RTL and metadata.** Provide screenshots (Arabic), support URL, privacy URL, age rating (financial information → likely 4+/Everyone, answer questionnaires honestly).

## Submission checklists
See `docs/android-release.md` (Google Play) and `docs/ios-release.md` (App Store).
