# EGXpert / Alytic — End-user test scenarios

Manual, black-box test scenarios covering the whole site from the point of view
of the people who use it: a visitor, a trial user, a paying subscriber, a lapsed
user, and an admin. Nothing here needs access to the code — every step is
something you can do in a browser.

The UI is Arabic and right-to-left; Arabic labels are quoted exactly as they
appear on screen so you can search for them.

For the developer-facing automated suites (unit / API / Playwright) see
[TESTING.md](TESTING.md). This file is the human layer on top of that.

---

## 1. How to use this document

Each scenario has an ID, a priority, preconditions, steps and the expected
result. Run a section at a time; record **Pass / Fail / Blocked** plus the
build or commit you tested.

| Priority | Meaning |
| --- | --- |
| **P1** | Money, access or data loss. A failure here blocks release. |
| **P2** | Core daily use. A failure degrades the product badly but isn't fatal. |
| **P3** | Polish, edge cases, cosmetics. |

Recommended pass order: §4 accounts → §5 access & billing → §7–§15 the desk →
§16 admin → §17 non-functional. Section §3 (public site) can be run any time.

---

## 2. Environments, accounts and data you need

**Environment**

- Frontend and backend both running (see README). The frontend talks to the API
  through its own `/api/public/*` proxy, so test through the frontend URL only —
  hitting the API port directly is not an end-user path.
- Needed for full coverage: a working `OPENROUTER_API_KEY` (AI features), SMTP
  (verification / reset / contact emails), the Supabase storage bucket
  `support-attachments` (chat image upload), `GOOGLE_CLIENT_ID` (Google sign-in).
- Without an AI key: screenshot import, market analysis, per-stock analysis and
  fundamentals must degrade with a clear Arabic message (`503`), never a blank
  screen. That is itself a scenario — see AI-01.

**Accounts to prepare**

| Alias | Description |
| --- | --- |
| `VISITOR` | Not signed in. |
| `NEW` | A brand new account, email not yet verified. |
| `TRIAL` | Account created today — inside the 4-trading-day free trial. |
| `LAPSED` | Account created ≥ 10 days ago (4 trading days can span a weekend plus a holiday), never subscribed. |
| `EXPIRED` | Had a paid period that has already ended. |
| `PAID` | Live subscription (granted by an admin). |
| `GOOGLE` | Created via Google sign-in, so it has no phone number yet. |
| `ADMIN` | Email listed in `ADMIN_EMAILS`. Admins bypass billing entirely. |

**Test data**

- At least two EGX tickers with price history available (e.g. `COMI`, `SWDY`,
  `ABUK`).
- A screenshot of a broker portfolio app showing tickers, quantities and cash —
  plus one deliberately bad image (a photo of a wall) for the negative case.
- A CSV and an `.xlsx` of index constituents for the admin index upload.
- An image file larger than 8 MB and a `.pdf` for negative upload tests.

---

## 3. Public / marketing site

**PUB-01 — Landing page renders and sells the product** · P2
- Pre: `VISITOR`
- Steps: open `/`.
- Expect: hero "خبير البورصة المصرية في جيبك", the "تجربة مجانية ٤ أيام تداول — بدون بطاقة"
  badge, 8 feature cards, the 3-step section, the tool explainer and a latest-posts
  strip. Both hero CTAs go to `/pricing`.

**PUB-02 — Marketing navigation** · P3
- Steps: from `/`, visit every header link — الرئيسية, تابع اخبار البورصة, طريقة الاستخدام,
  الأسعار, تواصل معنا — then both footer links.
- Expect: each loads its page, the active link is highlighted, and the browser tab
  title changes per page.

**PUB-03 — Header reflects session state** · P2
- Steps: open `/pricing` as `VISITOR` and note the header; sign in as `TRIAL` and
  return to `/pricing`.
- Expect: signed out shows "دخول" + "ابدأ مجانًا"; signed in shows a single green
  "لوحة التحكم" button instead. A signed-in user must never see "دخول" here.

**PUB-04 — Pricing page content** · P2
- Steps: open `/pricing`.
- Expect: three cards — تجربة مجانية (مجانًا / ٤ أيام تداول), شهري (١٤٩), سنوي (١٥٩٩ with
  "وفّر ١٨٩ جنيه"). The trial CTA goes to registration; both paid CTAs go to
  `/subscribe`. The "كل الخطط بتشمل" list and four FAQ cards render, and the
  first FAQ answer says تحليل الكاش is available twice for the whole trial
  (see CASH-11 / SCAN-09).

**PUB-05 — Prices are consistent everywhere** · P1
- Steps: compare the figures on `/pricing`, on `/subscribe`, in the chat bot's
  "الأسعار كام؟" answer, and in its "عايز أشترك" reply.
- Expect: identical monthly and yearly numbers in all four places. A mismatch is a
  billing defect, not a copy nit.

**PUB-06 — How-to-use page** · P3
- Steps: open `/how-to-use`.
- Expect: "تبدأ إزاي" steps, the top-bar buttons section, the dashboard screens
  section, quick tips and the daily-log FAQ. Every button it describes actually
  exists in the app (see KNOWN-02).

**PUB-07 — Contact form happy path** · P2
- Steps: `/contact` → fill name, email, message → send.
- Expect: the form is replaced by "وصلتنا رسالتك"; the configured contact mailbox
  receives the message.

**PUB-08 — Contact form validation** · P3
- Steps: submit empty; submit with a malformed email; submit a very long message.
- Expect: required fields block submission, a bad email is refused with an Arabic
  message, and nothing produces an unhandled error.

**PUB-09 — Contact form rate limit** · P3
- Steps: send 7 messages within an hour from the same IP.
- Expect: after 6, the Arabic "محاولات كتير في وقت قصير" message — not a crash.

**PUB-10 — Blog index** · P2
- Steps: open `/blog`.
- Expect: published posts as cards (title, dek, image, date). With none published,
  the empty state "لسه مفيش مقالات منشورة" — never an endless spinner.

**PUB-11 — Blog post page** · P2
- Steps: open a post from the index.
- Expect: tags, title, hero image with its Unsplash credit, dek, date, and the body
  rendered as headings / paragraphs / lists. "← كل المقالات" returns to the index,
  including via keyboard Enter or Space.

**PUB-12 — Unknown blog slug** · P3
- Steps: open `/blog/does-not-exist`.
- Expect: a readable Arabic error state — not a blank page or a raw stack trace.

**PUB-13 — Blog ticker** · P3
- Steps: look under the header on a marketing page and on the desk.
- Expect: a scrolling strip of recent titles that pauses on hover and links to each
  post. With zero published posts the strip is absent, not an empty bar.

**PUB-14 — Sitemap** · P3
- Steps: open `/sitemap.xml`.
- Expect: valid XML listing the static pages plus every published post slug.

**PUB-15 — Unknown route** · P3
- Steps: open `/not-a-page`.
- Expect: the app's own not-found screen with a way back home.

**PUB-16 — Theme toggle persists** · P3
- Steps: toggle dark mode from the marketing header, navigate elsewhere, reload.
- Expect: the choice survives navigation and reload, and both themes stay legible.

---

## 4. Registration, verification and sign-in

**AUTH-01 — Register a new account** · P1
- Steps: `/login?mode=register` → name, email, Egyptian mobile (`01xxxxxxxxx`),
  password of 8+ characters → "إنشاء الحساب".
- Expect: a "تحقق من بريدك الإلكتروني" panel — **you are not signed in** and no desk
  appears. A verification email arrives.

**AUTH-02 — Registering an email that already exists** · P1
- Steps: register again with an address that already has an account.
- Expect: **exactly the same** "تحقق من بريدك الإلكتروني" screen — the UI must not reveal
  that the address is taken. The mailbox instead receives an "already registered"
  notice.

**AUTH-03 — Password shorter than 8 characters** · P2
- Steps: register with a 5-character password.
- Expect: inline error "كلمة المرور لازم تكون 8 حروف على الأقل"; nothing is created.

**AUTH-04 — Invalid phone number** · P2
- Steps: register with `12345`, then `0991234567`, then a valid `010…` number.
- Expect: the first two are refused with "اكتب رقم موبايل مصري صحيح (01xxxxxxxxx)"; the
  third succeeds. Accepted prefixes are 010 / 011 / 012 / 015.

**AUTH-05 — Invalid email format** · P3
- Steps: register with `abc@`.
- Expect: refused (browser validation or "اكتب بريد إلكتروني صحيح").

**AUTH-06 — Verify email via the link** · P1
- Steps: open the link from the verification email.
- Expect: `/verify-email?token=…` shows "تم تفعيل بريدك الإلكتروني بنجاح" plus a button to
  the portfolio (if signed in) or to login (if not).

**AUTH-07 — Reusing or tampering with the verification token** · P2
- Steps: open the same verification link twice; then change a character in the token.
- Expect: "تعذر تفعيل البريد الإلكتروني" with the reason and a link back to login. Never
  a 500.

**AUTH-08 — Expired verification token** · P3
- Steps: use a token older than its TTL.
- Expect: "رابط التفعيل منتهي الصلاحية، اطلب رابط جديد".

**AUTH-09 — Unverified user can still sign in, with a banner** · P2
- Pre: `NEW`
- Steps: sign in.
- Expect: the desk loads with an amber banner "لسه ما فعّلتش بريدك الإلكتروني (email)" and
  an "إعادة إرسال الرابط" button.

**AUTH-10 — Resend verification** · P2
- Steps: click "إعادة إرسال الرابط".
- Expect: toast "اتبعت رابط تفعيل جديد على بريدك", the button becomes "اتبعت" and disables,
  and the new email's link works.

**AUTH-11 — Sign in with correct credentials** · P1
- Steps: `/login` → correct email and password → "دخول".
- Expect: lands on the desk; the header shows the account name or email.

**AUTH-12 — Wrong password** · P1
- Expect: "البريد الإلكتروني أو كلمة المرور غير صحيحة" — the same message as for an unknown
  email, so accounts cannot be enumerated.

**AUTH-13 — Unknown email** · P2
- Expect: byte-for-byte the same message as AUTH-12.

**AUTH-14 — Login rate limit** · P2
- Steps: 11 failed logins from one IP within 15 minutes.
- Expect: "محاولات كتير في وقت قصير — استنى شوية وجرّب تاني", then normal service after the
  window.

**AUTH-15 — "فضّلني مسجّل دخول" on** · P2
- Steps: sign in with the box ticked, close the browser entirely, reopen the site.
- Expect: still signed in.

**AUTH-16 — "فضّلني مسجّل دخول" off** · P2
- Steps: sign in with it unticked, close the browser, reopen.
- Expect: signed out — the cookie was a browser-session cookie.

**AUTH-17 — Sign out** · P1
- Steps: click the exit icon in the desk header.
- Expect: the page reloads to the login screen; browser Back, or opening
  `/portfolio`, does not restore the desk.

**AUTH-18 — The desk requires a session** · P1
- Steps: as `VISITOR`, open `/portfolio`, `/cash`, `/calendar`, `/charts`,
  `/targets`, `/indices`, `/settings` and `/admin` directly.
- Expect: each redirects to `/login`.

**AUTH-19 — `/login` while already signed in** · P3
- Expect: bounced to `/` — the form is not shown again.

**AUTH-20 — Toggle between login and register** · P3
- Steps: use "لسه جديد؟ إنشاء حساب" / "عندك حساب؟ تسجيل الدخول".
- Expect: the form swaps, name and phone fields appear and disappear, and any
  previous error is cleared.

**AUTH-21 — Password visibility toggle** · P3
- Expect: the eye icon reveals and re-hides the value without clearing the field.

**AUTH-22 — Forgot password request** · P1
- Steps: `/forgot-password` → an address that exists → send; then repeat with one
  that does not.
- Expect: "تحقق من بريدك الإلكتروني" in both cases (no leak); only the real account
  receives a reset email.

**AUTH-23 — Reset password** · P1
- Steps: open the reset link, enter a new password twice, submit, then sign in.
- Expect: "تم تغيير كلمة السر بنجاح"; the new password works and the old one fails.

**AUTH-24 — Mismatched confirmation** · P2
- Expect: "كلمة السر غير متطابقة"; nothing is changed.

**AUTH-25 — Reset link missing / invalid / reused** · P2
- Steps: open `/reset-password` with no token; with a mangled token; and reuse a
  link already consumed.
- Expect: "رابط إعادة التعيين غير صالح" with "اطلب رابط جديد" — never a 500.

**AUTH-26 — Reset with a short password** · P3
- Expect: refused with the 8-character message.

**AUTH-27 — Old sessions after a password reset** · P1
- Steps: sign in on browser A, reset the password from browser B, then act in A.
- Expect: A's session is no longer accepted and it is sent to login.

**AUTH-28 — Email-action rate limit** · P3
- Steps: request 7 password resets in an hour.
- Expect: throttled with the Arabic message.

**AUTH-29 — Google sign-in** · P2
- Pre: `GOOGLE_CLIENT_ID` configured
- Steps: click the Google button and complete the flow.
- Expect: signed in and on the desk; an email matching an existing account is
  linked, not duplicated.

**AUTH-30 — A Google account must supply a phone number** · P1
- Pre: `GOOGLE` with no phone on record
- Steps: sign in with Google.
- Expect: a blocking dialog "محتاجين رقم موبايلك" that cannot be dismissed with Escape,
  an outside click, or a cancel button. The desk stays unusable until a valid
  Egyptian number is saved; an invalid one shows an inline error and keeps the
  dialog open. After saving, it never returns.

**AUTH-31 — Google button with no client ID on the server** · P3
- Expect: a clear message rather than a dead button or a console-only failure.

---

## 5. Trial, paywall and subscribing

**SUB-01 — Trial badge and countdown** · P1
- Pre: `TRIAL`
- Expect: an outlined header badge "تجربة مجانية: باقي N أيام تداول" linking to `/subscribe`,
  counting down one per calendar day from registration, 4 → 1.

**SUB-02 — Trial expiry banner** · P2
- Expect: the amber banner "تجربتك المجانية بتنتهي بعد N أيام / بكرة / النهارده" with a
  "طريقة الاشتراك" button. It has no dismiss control — that is intentional.

**SUB-03 — The desk is fully usable during the trial** · P1
- Steps: as `TRIAL`, exercise live prices, market analysis, per-stock analysis and
  screenshot import.
- Expect: everything works — the trial is the full product.

**SUB-04 — Trial ends: the wall appears** · P1
- Pre: `LAPSED`
- Expect: the header stays (status badge, sign-out) but the desk body is replaced by
  "خلصت التجربة المجانية" plus the subscribe panel, and the top action buttons
  (تحليل السوق, رفع صور المحفظة, إدخال يدوي) are hidden.

**SUB-05 — An expired subscription reads differently from a spent trial** · P2
- Pre: `EXPIRED`
- Expect: the wall says "اشتراكك انتهى يوم …", not "خلصت التجربة المجانية".

**SUB-06 — Nothing is deleted when access lapses** · P1
- Steps: note positions, trades, cash and the daily log before access lapses, then
  subscribe and look again.
- Expect: every position, trade, watchlist entry, note and logged day is exactly as
  it was — the wall promises this in writing.

**SUB-07 — Expiry mid-session is handled gracefully** · P1
- Steps: with a tab open as `TRIAL`, have an admin revoke access (or cross the
  expiry), then trigger a price refresh or open a stock.
- Expect: the UI switches itself to the subscribe wall with the Arabic explanation —
  never a bare "فشل الطلب (402)" where the portfolio used to be.

**SUB-08 — Subscribe page** · P2
- Steps: open `/subscribe` signed in and signed out.
- Expect: both plan cards with the yearly saving badge, the "كلّمنا في الشات" panel, and
  — signed out only — a "لسه معندكش حساب؟" block with a registration CTA. **No InstaPay
  account number appears on this public page.**

**SUB-09 — "حوّلت بالفعل — تحقّق"** · P2
- Steps: click it as `LAPSED` before any grant; have an admin activate the account;
  click it again.
- Expect: first "الاشتراك لسه ما اتفعلش…"; afterwards "تم تفعيل اشتراكك — أهلًا بيك!" and the
  desk unlocks without signing out.

**SUB-10 — Activation is picked up on tab focus** · P2
- Steps: leave the app open as `LAPSED`, grant a subscription from an admin session,
  switch back to the user's tab.
- Expect: on regaining focus the badge and the wall update by themselves.

**SUB-11 — Paid badge** · P2
- Pre: `PAID`
- Expect: header badge "اشتراك شهري/سنوي حتى <date>", no trial badge, no wall.

**SUB-12 — Renewal warning in the last 5 days** · P2
- Expect: the amber banner "اشتراكك بينتهي بعد N أيام (date). جدّده عشان متفقدش الوصول."

**SUB-13 — Granting mid-trial does not burn the remaining trial days** · P1
- Steps: as `TRIAL` with 3 days left, have an admin grant "+ شهر".
- Expect: the period ends one month **after the trial would have ended**, not one
  month from today.

**SUB-14 — Renewing early stacks** · P1
- Steps: grant "+ شهر" to a `PAID` account with 10 days left.
- Expect: the end date moves a month past the existing end, never truncating it.

**SUB-15 — Support chat stays reachable behind the wall** · P1
- Pre: `LAPSED`
- Expect: the chat bubble opens and messages send — it is the only route back to
  paying and must never be paywalled.

---

## 6. Support chat (the subscription path)

**CHAT-01 — Visitor sees a sign-in prompt** · P2
- Steps: as `VISITOR`, open the chat bubble on a marketing page.
- Expect: an explanation plus "دخول" / "حساب جديد" buttons and a link to `/contact`. No
  message box.

**CHAT-02 — First-time menu** · P2
- Expect: "أهلًا! تحب أساعدك في إيه؟" and three choices — عايز أشترك, عندي سؤال مش فاهمه,
  عايز اكلم خدمة العملاء.

**CHAT-03 — "عايز أشترك" delivers the payment details** · P1
- Expect: plans and prices in one message plus an InstaPay card with the address, the
  account name and a working "نسخ" button (toast "اتنسخ"). The composer becomes available.

**CHAT-04 — InstaPay details are never public** · P1
- Steps: signed out, try to reach the same information from `/subscribe`, `/pricing`
  or the chat.
- Expect: the account number appears only inside a signed-in user's chat.

**CHAT-05 — FAQ topics** · P2
- Steps: choose "عندي سؤال مش فاهمه", then each of the five topics.
- Expect: each echoes the question as the user's bubble, gives an answer, and offers
  a working link to the right page (`/`, `/how-to-use`, `/pricing`).

**CHAT-06 — Escalate to a human** · P2
- Steps: choose "عايز اكلم خدمة العملاء" and send a message.
- Expect: it appears immediately with a timestamp, reaches the admin inbox, and
  triggers a notification email.

**CHAT-07 — Notification bursts are collapsed** · P3
- Steps: send 4 messages within a couple of minutes.
- Expect: one notification email for the burst, not four.

**CHAT-08 — Empty and over-long messages** · P2
- Steps: press send with an empty box; paste 2,100 characters and send.
- Expect: empty is refused or the button is disabled; over-long is refused with the
  character limit named.

**CHAT-09 — Enter vs Shift+Enter** · P3
- Expect: Enter sends; Shift+Enter inserts a newline that survives into the bubble.

**CHAT-10 — Attach a receipt image** · P1
- Steps: attach a JPEG/PNG/WebP via the paperclip, and separately paste one from the
  clipboard.
- Expect: both upload and render as a thumbnail that opens full size in a new tab.

**CHAT-11 — Rejected attachments** · P2
- Steps: try a `.pdf`, then an image larger than 8 MB.
- Expect: refused with an Arabic message — and the oversized file must be refused
  instantly, not after a full upload.

**CHAT-12 — Attachment links are private** · P1
- Steps: copy an attachment URL and open it in a private window later.
- Expect: a short-lived signed URL, not a permanent public link.

**CHAT-13 — Unread badge** · P2
- Steps: with the chat closed, have an admin reply, and watch the bubble.
- Expect: an unread count within ~15 s that clears only when the panel is actually
  opened — background polling must not clear it.

**CHAT-14 — Back to the menu keeps history** · P2
- Steps: after a real conversation, press the back arrow in the chat header.
- Expect: the menu returns and the earlier thread folds into a collapsible
  "المحادثة السابقة" box that can be expanded.

**CHAT-15 — Returning later** · P3
- Steps: reload the page with an existing thread and open the chat.
- Expect: it opens straight into the conversation, not back at the greeting menu.

**CHAT-16 — Chat rate limit** · P3
- Steps: send 41 messages within 15 minutes.
- Expect: throttled with the Arabic message; earlier messages are unaffected.

---

## 7. Desk shell, header and navigation

**DESK-01 — Header summary bar** · P2
- Expect: five stats — التكلفة الكلية, قيمة الأسهم, ربح/خسارة من الشراء (with %), تغيّر اليوم,
  الكاش (with "إجمالي … ج"). Gains green, losses red, and a missing day change shows
  "—" rather than 0.

**DESK-02 — Date and price-sync line** · P3
- Expect: today's date in Arabic plus "تحديث الأسعار HH:MM"; before the first sync,
  "بيتابع الأسعار".

**DESK-03 — Price feed failure is visible** · P2
- Steps: block the quotes request (devtools offline, or stop the backend) and wait.
- Expect: the line turns red with "تعذر تحديث الأسعار", the last known prices stay on
  screen, and recovery restores the timestamp automatically.

**DESK-04 — Prices refresh on a timer** · P2
- Steps: watch a position for about a minute during market hours.
- Expect: price, day change, market value and unrealised P&L update roughly every
  20 seconds with no page reload.

**DESK-05 — Background tabs don't poll** · P3
- Steps: switch away for a minute, then return.
- Expect: no polling while hidden and an immediate refresh on return.

**DESK-06 — Desktop navigation** · P2
- Steps: visit every tab — الأسهم, المؤشرات, الأهداف, التقويم, الرسوم, الكاش,
  الإعدادات, تابع اخبار البورصة, طريقة الاستخدام.
- Expect: each loads, the active tab is highlighted, and the strip scrolls
  horizontally on a narrow window.

**DESK-07 — الإدارة is admin-only** · P1
- Expect: the tab is absent for non-admins, and opening `/admin` directly as a normal
  user shows "الصفحة دي للمشرفين بس." — never real admin data.

**DESK-08 — Mobile navigation** · P2
- Steps: at ~390 px width, use the bottom bar.
- Expect: one button showing the current tab's name opens a bottom sheet of all
  tabs; picking one navigates and closes the sheet.

**DESK-09 — Invest-style badge** · P3
- Expect: "سلوكك الاستثماري: <style>" with "(تلقائي)" when inferred; clicking it opens
  `/settings`.

**DESK-10 — Dark mode across the desk** · P3
- Steps: toggle the moon/sun icon and walk every tab and dialog.
- Expect: no unreadable text, no white boxes on dark, charts and badges legible in
  both themes.

**DESK-11 — Footer disclaimer** · P3
- Expect: on every desk page — "EGXpert أداة تحليل ومساعدة في القرار — وليست توصية مالية
  مرخّصة." plus the two footer links.

---

## 8. Portfolio (الأسهم)

**POS-01 — Empty state** · P2
- Expect: "مفيش مراكز مفتوحة" with a hint pointing at إدخال يدوي → إدخال صفقة جديدة or the screenshot upload.

**POS-02 — A position renders completely** · P1
- Expect: code, company name, share count at average cost, live price, day change %,
  a recommendation badge, the price rail, and five stats — قيمة الشراء, القيمة السوقية,
  الربح (EGP and %), للوقف, للهدف.

**POS-03 — Index membership badges** · P3
- Steps: hold a stock that is in EGX30.
- Expect: a small badge naming each index it belongs to.

**POS-04 — The price rail is positioned correctly** · P2
- Expect: the marker sits between stop and target in proportion to the live price,
  cost and long-term levels are marked, and the rail moves as the price ticks.

**POS-05 — Alerts block** · P1
- Steps: arrange (or wait for) each case — price below the stop, within 3 % of the
  stop, and at the target.
- Expect: respectively a red "أغلق تحت وقف الخسارة … — خروج", an amber "قريب من الوقف (x%)",
  and a green "وصل الهدف …". With none of those, the single green line "لا توجد تنبيهات —
  كل الأسهم داخل نطاقها."

**POS-06 — Card borders follow severity** · P3
- Expect: a stop-breached card is outlined red, a near-stop card amber.

**POS-07 — Recommendation changes with the invest style** · P1
- Steps: note the badge and the "توصية اليوم" text, switch style in `/settings`
  (مضارب ↔ متوسط المدى ↔ طويل المدى), return.
- Expect: the badge, the wording and the suggested order can all change — immediately,
  without a reload.

**POS-08 — The suggested order is arithmetically right** · P1
- Expect: "الأمر: شراء/بيع N سهم عند P ≈ N×P ج" — check the multiplication and that the
  side matches the recommendation.

**POS-09 — Estimated share count warning** · P2
- Pre: a position imported from a screenshot where quantity was derived
- Expect: a "⚠️ عدد تقديري" badge whose tooltip explains it was computed from market
  value and points to إدخال يدوي.

**POS-10 — Open the detail dialog** · P2
- Steps: click the stock code.
- Expect: a dialog with price / score / trend / RSI, the plan (entry, stop with
  risk %, targets with horizon and R:R), supports and resistances, and the
  bullish/bearish reason lists.

**POS-11 — Fundamentals line in the detail dialog** · P3
- Pre: AI key present
- Expect: an "الأساسيات" note when data exists; its absence must not break the dialog.

**POS-12 — Insufficient data for a stock** · P2
- Steps: open a stock whose bars fail the quality gate.
- Expect: "مفيش بيانات كافية لهذا السهم." or a clear Arabic error — not a forever
  spinner and not a raw 422.

**POS-13 — Delete a position** · P1
- Steps: click the trash icon, read the dialog, confirm.
- Expect: the dialog names the stock and warns it cannot be undone; on confirm a
  toast "تم حذف <CODE> من المحفظة", the card disappears, and the header totals drop.

**POS-14 — Cancel a deletion** · P1
- Expect: "إلغاء" leaves the position untouched.

**POS-15 — Reload resilience** · P2
- Steps: stop the backend and open `/portfolio`.
- Expect: an error state with a "حاول تاني" button that actually retries.

---

## 9. Trades (إدخال يدوي → إدخال صفقة جديدة)

There is no trades tab: trades are entered from the "إدخال صفقة جديدة" button inside
the إدخال يدوي dialog, and the history is the collapsible "سجل الصفقات" at the bottom
of that dialog.

**TRD-01 — Record a buy** · P1
- Steps: إدخال يدوي → إدخال صفقة جديدة; pick a stock, النوع = شراء, shares, price,
  optional date → تسجيل الصفقة.
- Expect: toast "تم تسجيل الصفقة وتحديث المحفظة", the popup closes, the trade tops the
  history, the position appears or grows in الأسهم, and cash falls by cost plus
  commission.

**TRD-02 — Average cost after a second buy** · P1
- Steps: buy 100 @ 10, then 100 @ 20.
- Expect: 200 shares at an average of about 15 (plus commission handling), shown on
  the position card.

**TRD-03 — Record a partial sell** · P1
- Steps: sell part of a holding above cost.
- Expect: the share count drops, cash rises, "ربح محقق" increases by the realised
  amount, and the row's محقق column shows it.

**TRD-04 — Sell the whole position** · P1
- Expect: the position leaves الأسهم, the realised P&L is kept, and the trade stays in
  the history.

**TRD-05 — Sell more shares than held** · P1
- Expect: refused with an Arabic error; nothing is changed.

**TRD-06 — Submit with no stock picked** · P2
- Expect: "اختار سهم من القائمة الأول." and no request is sent.

**TRD-07 — Zero, negative or non-numeric quantity or price** · P2
- Expect: refused with an Arabic message; no trade is created.

**TRD-08 — Backdated trade** · P2
- Expect: accepted and sorted correctly in the history (newest first).

**TRD-09 — Future-dated trade** · P3
- Expect: defined, sane behaviour — either refused or clearly shown; never a
  corrupted log.

**TRD-10 — Stock picker search** · P2
- Steps: open the picker and type a code (`COMI`), then an Arabic company name.
- Expect: both match, gibberish gives "مفيش نتائج.", and picking one fills the field.

**TRD-11 — History table** · P2
- Expect: date, code, buy/sell in green/red, quantity, price, commission and
  realised — newest first, horizontally scrollable on mobile.

**TRD-12 — Commission is applied** · P2
- Expect: the commission column is non-zero and consistent with the configured rate.

**TRD-13 — Empty history** · P3
- Expect: "لا توجد صفقات مسجلة بعد" with a hint.

---

## 10. Cash and favourites (الكاش)

**CASH-01 — Update cash** · P1
- Steps: type an amount → حفظ.
- Expect: toast "تم تحديث الكاش"; the header الكاش stat and the capital total update.

**CASH-02 — Negative cash is refused** · P2
- Expect: an Arabic "مبلغ غير صالح" and no change.

**CASH-03 — Cash advice tiers** · P2
- Steps: set cash to 0, then to about 5 % of capital, then 20 %, then 50 %.
- Expect: four distinct advice texts — no cash / قليل / نسبة صحية / عالي — and the
  percentage quoted matches the نسبة الكاش من الإجمالي stat.

**CASH-04 — Capital stats are consistent** · P2
- Expect: value + cash = إجمالي رأس المال, and نسبة الكاش matches that arithmetic.

**CASH-05 — Add a favourite with a note** · P2
- Expect: toast "تمت الإضافة للأسهم المفضلة" and a row with name, sector, price, day
  change, score, signal and the note.

**CASH-06 — Favourite with no stock picked** · P3
- Expect: "اختار سهم من القائمة الأول."

**CASH-07 — Favourites are live** · P2
- Expect: price, change and score are fetched for the list — not blank dashes — and
  refresh when the list changes.

**CASH-08 — Duplicate favourite** · P3
- Expect: no duplicate row and no error dump.

**CASH-09 — Remove a favourite** · P2
- Expect: the row disappears immediately and stays gone after a reload.

**CASH-10 — Empty favourites** · P3
- Expect: "مفيش أسهم مفضلة لسه" with a hint.

**CASH-11 — "حلل استخدام الكاش"** · P1
- Steps: click it with cash available, on a trial (unsubscribed) account that
  hasn't used it twice yet.
- Expect: the "أفضل توزيع للكاش" dialog opens — see SCAN-05.

---

## 11. Targets (الأهداف)

**TGT-01 — Table contents** · P2
- Expect: one row per position with a computed target — السهم/القطاع, الحالي, الهدف,
  المسافة, اليوم, التقدير الزمني, ع/م من هنا.

**TGT-02 — Sorted nearest first** · P2
- Expect: rows ascend by distance to target.

**TGT-03 — ETA colour bands** · P3
- Expect: ≤ 2 weeks green, ≤ 6 neutral, ≤ 16 amber, beyond that red.

**TGT-04 — R:R tooltip** · P3
- Steps: hover "ع/م من هنا".
- Expect: an explanation of reward ÷ risk in R units.

**TGT-05 — A row opens the stock detail** · P2
- Expect: clicking anywhere on a row opens that stock's analysis dialog.

**TGT-06 — Caveat notice** · P3
- Expect: the amber "التقديرات الزمنية تقريبية … أي كسر للوقف يلغي الهدف." under the table.

**TGT-07 — Empty state** · P3
- Expect: "مفيش أهداف محسوبة" when there are no positions.

---

## 12. Calendar (التقويم)

**CAL-01 — Month grid** · P2
- Expect: Sunday-first week headers, correct leading blanks, shaded weekends, and
  today selectable.

**CAL-02 — Month and year navigation** · P2
- Steps: use the month select, the year select and both arrows.
- Expect: all three agree, the arrows roll over year boundaries correctly, and the
  panel title updates.

**CAL-03 — Logged days are marked** · P1
- Expect: the day cell is tinted green or red by that day's change and shows its
  percentage.

**CAL-04 — Day detail** · P1
- Steps: click a logged day.
- Expect: قيمة المحفظة, تغيّر اليوم, إجمالي الربح, a per-stock table of close / stop /
  recommendation, and any stop or target change notes.

**CAL-05 — A day with no data** · P2
- Expect: "مفيش بيانات محفوظة لهذا اليوم" — not an empty panel.

**CAL-06 — Save a note** · P2
- Steps: type a note on a logged day → حفظ الملاحظة.
- Expect: toast "تم حفظ الملاحظة"; the note survives switching days and reloading.

**CAL-07 — Editing an existing note** · P3
- Expect: the box is pre-filled and saving replaces the previous text.

**CAL-08 — The daily close is automatic** · P1
- Steps: with open positions, check the calendar after 2:30 pm Cairo on a trading day.
- Expect: today's entry exists with no user action — the close is written by a
  scheduled job, and there is **no** "سجّل إغلاق اليوم" button in the app any more (see
  KNOWN-02 for the stale copy that still mentions one).

**CAL-09 — No duplicate or double-counted entries** · P2
- Expect: exactly one entry per day even if the job runs more than once.

---

## 13. Charts (الرسوم)

**CHT-01 — Equity curve** · P2
- Pre: at least 2 logged days
- Expect: an area chart, the latest value in EGP, the change over the period in EGP
  and %, a dashed reference line at the period's start, and the "من … إلى … · N يوم
  محفوظ" caption.

**CHT-02 — Range toggles** · P3
- Pre: more than 22 logged days
- Steps: switch شهر / 3 شهور / الكل.
- Expect: the series, the headline change and the caption all follow the range.

**CHT-03 — Tooltip** · P3
- Expect: the Arabic date, the value in EGP and the difference from the period start.

**CHT-04 — Too little history** · P2
- Expect: "محتاج يومين محفوظين على الأقل لرسم الخط" plus the backfill button.

**CHT-05 — Backfill 90 days** · P1
- Steps: press "ابنِ السجل من أسعار السوق التاريخية".
- Expect: an amber notice naming how many days were built and the date range, and
  stating plainly that it is valued on **today's** share counts — a hypothetical, not
  a real history. The chart and calendar then populate.

**CHT-06 — Backfill never overwrites a real close** · P1
- Steps: save a real close, then backfill.
- Expect: that day's figures are unchanged.

**CHT-07 — Backfill with no positions** · P2
- Expect: a clear Arabic refusal, not a silent no-op.

**CHT-08 — Per-stock P&L bars** · P2
- Expect: one bar per position, sorted best to worst, green right and red left from
  the centre, with the percentage at the end; the longest bar is the largest
  absolute move.

**CHT-09 — Empty positions** · P3
- Expect: "مفيش مراكز." in the second panel.

---

## 14. Indices and settings

**IDX-01 — Indices page** · P2
- Expect: cards for EGX30, EGX70 EWI, EGX33 (شريعة) and EGX100, each with the day's
  percentage, point change, tracked-constituent count and the best and worst mover.

**IDX-02 — Last-updated time** · P3
- Expect: "آخر تحديث HH:MM" in Arabic locale.

**IDX-03 — No live quotes** · P2
- Expect: "مفيش أسعار حية متاحة دلوقتي لأسهم المؤشر." rather than zeros or "NaN".

**IDX-04 — Load failure** · P3
- Expect: an error state with a working "حاول تاني".

**SET-01 — Automatic invest style** · P2
- Steps: open الإعدادات on an account with few trades, then on one with real history.
- Expect: the notice explains either that there aren't enough trades (defaulting to
  متوسط المدى) or which style was inferred from the trades.

**SET-02 — Pin a style manually** · P1
- Steps: click مضارب.
- Expect: toast "تم تفعيل قواعد …", the card marked active, the notice switching to
  "مثبّت يدويًا", and the header badge losing "(تلقائي)".

**SET-03 — Back to automatic** · P2
- Steps: click "رجّعه تلقائي".
- Expect: a toast and the inferred style in force again.

**SET-04 — The style choice survives a reload** · P2
- Expect: a pinned style is still pinned after a refresh.

**SET-05 — Reset requires two clicks** · P1
- Steps: click "مسح كل البيانات" once.
- Expect: it becomes "تأكيد مسح كل البيانات" with "اضغط تاني للتأكيد — هيتمسح كل حاجة" —
  the first click must not delete anything.

**SET-06 — Reset does exactly what it says** · P1
- Steps: confirm the reset.
- Expect: toast "تم مسح كل البيانات"; positions, cash, trades, realised P&L, the daily log
  and the watchlist are all gone. The invest style, today's screenshot count, the trial
  cash-scan count and admin-granted credits **remain**.

---

## 15. Analysis dialogs, screenshot import and manual entry

**SCAN-01 — Market analysis dialog** · P1
- Steps: click "تحليل السوق".
- Expect: a ranked list (up to 60) with score /100, price, stop, an action badge,
  targets, a buy plan for stocks you don't hold, and a summary line with available
  cash, opportunity count, your position count and the as-of time.

**SCAN-02 — Index filter** · P2
- Steps: switch between الكل / EGX30 / EGX70 / EGX33 / EGX100.
- Expect: the list re-queries and the header text names the filter.

**SCAN-03 — Style is respected** · P2
- Expect: the subtitle names the active style ("مستنتج من سلوكك في التداول" when
  automatic), and changing the style in settings changes the results.

**SCAN-04 — Held stocks are marked** · P2
- Expect: stocks you own show "موجود عندك · <signal>" and get no buy plan.

**SCAN-05 — Cash allocation plan** · P1
- Steps: open it from الكاش → "حلل استخدام الكاش".
- Expect: title "أفضل توزيع للكاش", a handful of selected stocks (count scales with
  investable cash — more of it picks more names, up to 6, and a small balance
  picks just one or two rather than slicing tickets too thin) diversified across
  sectors, القابل للتوزيع plus متوسط لكل سهم plus the reserve, and per-stock share
  counts whose total cost never exceeds the investable cash. Allocation is
  weighted by each stock's score/risk-reward rank, not split evenly — a
  clearly stronger setup among the selected names gets a visibly larger cut
  than a weaker one, and a stock whose price would round its share down to
  zero shares gets skipped in favor of names cash can actually buy.

**SCAN-06 — No cash** · P2
- Steps: set cash to 0 and run the cash plan.
- Expect: an honest "لا يوجد كاش متاح" reason rather than a plan you cannot execute.

**SCAN-07 — Partial data failures** · P3
- Expect: "تعذر تحليل N سهم بسبب نقص البيانات." at the bottom, with the rest of the list
  still rendered.

**SCAN-08 — Closing and re-opening** · P3
- Expect: Escape and the X both close it, and re-opening re-fetches rather than
  showing stale results.

**SCAN-09 — Cash-scan trial cap** · P1
- Steps: on an unsubscribed trial account, open "تحليل الكاش" and flip between a
  couple of index tabs while it's open (still one dialog session), close it,
  then reopen and run it a second time (a separate session — 10+ minutes
  apart, or wait out that window), then try a third time.
- Expect: switching index tabs inside one open dialog never costs an extra
  use — every index and the full stock universe stay available within it.
  The first two separate sessions work normally; the third gets a clear "خلصت
  محاولات تحليل الكاش المتاحة في فترة التجربة" message instead of a plan, and a
  plain market scan afterward still works. On an admin or subscribed account,
  running it more than twice never blocks.

**AI-01 — Everything degrades without an AI key** · P1
- Pre: server running with no `OPENROUTER_API_KEY`
- Steps: try screenshot import, market analysis, stock detail and fundamentals.
- Expect: an Arabic 503 message explaining the key is missing — and the purely
  technical product (positions, prices, stops, targets, calendar) keeps working.

**IMP-01 — Import a single screenshot (merge)** · P1
- Steps: "رفع صور المحفظة" → one image → "إضافة/تحديث".
- Expect: a confirmation dialog explains the difference first; then a toast naming
  how many stocks were updated from how many images and "اتضاف/اتحدّث الأسهم دي بس — باقي
  المحفظة زي ما هو." Positions not in the image are untouched.

**IMP-02 — Import with "استبدال المحفظة بالكامل"** · P1
- Expect: the toast says "استُبدلت المحفظة بالكامل."; stocks absent from the image are
  removed; the trade history is **not** erased.

**IMP-03 — Cancel the import** · P1
- Steps: pick files, then إلغاء.
- Expect: nothing is uploaded and the file input is cleared, so the same file can be
  picked again.

**IMP-04 — Multiple images at once** · P2
- Steps: select 3 screenshots covering different parts of the portfolio.
- Expect: all are processed; with "replace" only the first replaces and the rest
  merge, so the final book is the union of the images.

**IMP-05 — Derived share counts are flagged** · P1
- Steps: import an image where quantity is not visible but market value and price are.
- Expect: the toast carries the "⚠️ N منهم عدد الأسهم اتحسب تقديريًا — راجعه من «إدخال يدوي»"
  warning for about 12 seconds, and those positions show the "عدد تقديري" badge.

**IMP-06 — Unreadable image** · P2
- Steps: upload a photo with no portfolio in it.
- Expect: "الصورة لم تعطِ بيانات محفظة قابلة للقراءة" (or similar) and no change to the
  portfolio.

**IMP-07 — Oversized or wrong file type** · P2
- Steps: upload an image over 8 MB and a non-image file.
- Expect: an Arabic refusal, and the button returns to its normal state — no stuck
  spinner.

**IMP-08 — Cash is read from the image** · P2
- Expect: when a cash figure is visible, الكاش is updated accordingly.

**IMP-09 — Ticker resolution** · P2
- Steps: import images using common aliases (CIB, TMG, EFG Hermes) and Arabic names.
- Expect: they map to COMI, TMGH, HRHO and the right codes rather than being dropped.

**IMP-10 — ETF holdings are refused** · P1
- Steps: upload a screenshot that contains an ETF / fund (alone or next to stocks).
- Expect: "الصورة فيها صندوق مؤشرات (ETF)…" and nothing is added — no positions, no
  cash change — and today's screenshot count is not used up.

**MAN-01 — Manual entry dialog opens pre-filled** · P1
- Expect: every position with its current shares, average cost, stop and target
  already in the fields.

**MAN-02 — Correct an estimated share count** · P1
- Steps: fix the quantity on a "⚠️" position → حفظ التعديلات.
- Expect: toast "تم حفظ التعديلات", the warning badge gone, and market value, P&L and
  the header totals all recomputed.

**MAN-03 — Manual stop and target** · P2
- Expect: the price rail and the للوقف / للهدف stats follow the new levels, and they
  survive a reload.

**MAN-04 — Clearing the target** · P3
- Steps: empty the target field and save.
- Expect: accepted as "no target" rather than saved as 0.

**MAN-05 — Only changed rows are written** · P3
- Steps: open the dialog and save without editing anything.
- Expect: no visible change and no error.

**MAN-06 — Empty portfolio** · P3
- Expect: "مفيش مراكز." with a hint and no save button.

---

## 16. Admin

**ADM-01 — Admin login rejects a normal account** · P1
- Steps: `/admin/login` with a non-admin account.
- Expect: "الحساب ده مش حساب مشرف" **and the session is dropped** — you are not left
  signed in as that user on an admin page.

**ADM-02 — Admin login success** · P1
- Expect: lands on `/admin` with four tabs — المؤشرات, المستخدمين, الدعم, المدونة.

**ADM-03 — Index list** · P2
- Expect: per index, the constituent count, whether it is default or uploaded, the
  last update time, and the full ticker list.

**ADM-04 — Search a ticker across indices** · P2
- Steps: type a code or company name in the search box.
- Expect: a notice naming which indices contain it (or that none do), with matching
  chips highlighted in the lists.

**ADM-05 — Upload a constituents CSV** · P1
- Steps: upload a CSV with a `Ticker` column.
- Expect: toast "تم حفظ N كود لمؤشر …", the panel flipping to "مرفوع يدويًا" with a fresh
  timestamp, and unknown codes listed in an amber notice as newly added without
  sector or shariah data.

**ADM-06 — Upload an .xlsx** · P2
- Expect: the same behaviour as CSV.

**ADM-07 — Malformed upload** · P2
- Steps: upload a file with no recognisable ticker column, and one over 256 KB.
- Expect: an Arabic error toast; the existing list is unchanged.

**ADM-08 — Restore the built-in list** · P2
- Steps: "استرجاع الافتراضي" on an uploaded index.
- Expect: the count returns to the built-in one and the source reads "افتراضي".

**ADM-09 — Custom stocks become tradeable** · P2
- Steps: upload an index file containing an unknown code, then open the stock picker
  in إدخال صفقة جديدة.
- Expect: the new code is selectable straight away, with no server restart.

**ADM-10 — Users table** · P2
- Expect: per user — email, name, phone, registration date, last login, capital,
  realised P&L, activity counts, inferred style, subscription state, and status
  badges (مشرف / بريد غير مفعّل / Google).

**ADM-11 — User search** · P3
- Steps: search by email, name and phone.
- Expect: the "N من M مستخدم" line updates; no match shows the empty state.

**ADM-12 — Grant a monthly subscription** · P1
- Steps: تفعيل → optional InstaPay reference → "+ شهر".
- Expect: toast "تم تفعيل اشتراك <email>", the badge becoming "شهري · حتى <date>", and the
  user's own session unlocking (see SUB-09 / SUB-10).

**ADM-13 — Grant a yearly subscription** · P1
- Expect: as above with a 12-month period.

**ADM-14 — Custom end date** · P2
- Steps: pick a date → حفظ.
- Expect: the period ends on that date; the save button stays disabled until a date
  is chosen.

**ADM-15 — Revoke immediately** · P1
- Steps: "إيقاف الاشتراك فورًا".
- Expect: a toast, the badge becoming "انتهى …", and the user's desk showing the wall
  on their next request.

**ADM-16 — The grant history is kept** · P2
- Steps: grant, extend, then revoke the same user.
- Expect: each action is recorded (who, when, amount or reference) so a disputed
  payment can be checked later — the current badge alone is not the record.

**ADM-17 — Support inbox** · P1
- Expect: threads sorted by recency with the user's email, a preview, a timestamp
  and an unread count; opening one shows the whole conversation including images.

**ADM-18 — Reply to a user** · P1
- Expect: the reply appears in the thread and reaches the user's chat widget within
  a poll cycle, marked unread for them.

**ADM-19 — Unread badge on the browser tab** · P3
- Steps: sit on any الإدارة tab while a user sends a message.
- Expect: the tab title becomes "(N) الإدارة — EGXpert" and clears once read; it must
  not leak onto another page's title after navigating away.

**ADM-20 — Blog drafts: approve** · P2
- Expect: toast "اتنشرت المقالة"; it leaves the queue and appears on public `/blog` and
  in the المنشور tab.

**ADM-21 — Blog drafts: reject** · P2
- Expect: toast "اترفضت المسودة"; it leaves the queue and never reaches `/blog`.

**ADM-22 — Edit a published post** · P2
- Steps: edit the title and dek, add and remove content blocks (paragraph, heading,
  list) → save.
- Expect: toast "اتحفظت التعديلات" and the public page shows the edit.

**ADM-23 — Unpublish** · P2
- Expect: toast "اتشالت المقالة من الموقع ورجعت مسودة"; the public URL no longer serves it
  and it returns to the drafts queue.

**ADM-24 — Delete permanently** · P1
- Steps: delete → read the confirmation → confirm.
- Expect: a confirmation is required; afterwards toast "اتحذفت المقالة نهائيًا" and it is
  gone from both tabs and from the sitemap.

**ADM-25 — Admins bypass billing** · P2
- Expect: an admin account never sees the paywall or a trial badge.

---

## 17. Cross-cutting / non-functional

**NFR-01 — One user cannot see another's data** · P1
- Steps: sign in as user A and note portfolio and chat contents; sign in as B in
  another browser.
- Expect: B sees only their own positions, trades, log, favourites and chat.

**NFR-02 — Admin screens reject normal users** · P1
- Steps: as a normal signed-in user, navigate directly to `/admin`.
- Expect: refused — no user list, no support threads, no blog controls.

**NFR-03 — Session cookie hygiene** · P1
- Expect: `HttpOnly`, `SameSite=Lax`, and `Secure` over HTTPS; not readable from JS.

**NFR-04 — Tampered session** · P1
- Steps: alter the session cookie value and reload.
- Expect: treated as signed out and sent to login — never a partial or elevated
  session.

**NFR-05 — Server unreachable** · P2
- Steps: stop the backend and use the app.
- Expect: "تعذر الوصول إلى الخادم. تأكد أن الخدمة شغّالة." — never a blank page or an
  English stack trace.

**NFR-06 — Right-to-left layout** · P2
- Steps: walk every page and dialog.
- Expect: text reads right-to-left; numbers and Latin tickers stay left-to-right and
  unreversed (signed figures such as "+1,234 ج" must not scramble); icons and arrows
  point the correct way.

**NFR-07 — Mobile layout** · P2
- Steps: repeat §8–§14 at ~390 px.
- Expect: no horizontal page scroll; tables scroll inside their own container;
  dialogs fit the screen; the bottom nav does not cover content.

**NFR-08 — Tablet and desktop widths** · P3
- Expect: sensible column counts at ~768 px and ≥ 1280 px, with the desk capped at a
  readable width.

**NFR-09 — Keyboard navigation** · P3
- Steps: tab through the login form, the trade form, the stock picker and a dialog.
- Expect: a visible focus ring everywhere, Escape closing dismissible dialogs, and
  focus never lost behind an overlay.

**NFR-10 — Screen-reader labels** · P3
- Expect: icon-only buttons (خروج, تبديل الوضع الليلي, حذف <code>, إرسال, إرفاق صورة,
  الشهر السابق / التالي) all expose an Arabic accessible name.

**NFR-11 — Numbers are formatted consistently** · P3
- Expect: thousands separators, two decimals for prices, integers for share counts,
  and an em dash "—" for genuinely missing values — never "NaN", "undefined" or "null".

**NFR-12 — Page titles and meta** · P3
- Expect: each public page has its own Arabic title and description, and social
  previews resolve.

**NFR-13 — Browser matrix** · P2
- Steps: smoke-test §4, §8 and §9 in Chrome, Safari (including iOS), Firefox and Edge.
- Expect: identical behaviour, with particular attention to date inputs, file pickers
  and clipboard paste in the chat.

**NFR-14 — Back and forward navigation** · P3
- Steps: navigate several desk tabs, then use browser Back and Forward.
- Expect: the right tab renders each time, with no stale data and no duplicate dialogs.

**NFR-15 — Deep links and reloads** · P2
- Steps: reload on each desk route, and open one from a cold start.
- Expect: the page renders server-side then hydrates; no flash of the login screen
  for a signed-in user beyond the initial skeleton.

**NFR-16 — Long sessions** · P3
- Steps: leave the desk open for several hours.
- Expect: prices still refresh, no memory-driven slowdown, no runaway polling.

**NFR-17 — Concurrent edits** · P1
- Steps: open the app in two tabs as the same user; record a trade in one and edit a
  holding in the other at nearly the same moment.
- Expect: both writes land; nothing is silently lost.

**NFR-18 — Data survives a sign-out cycle** · P1
- Steps: build a portfolio, sign out, sign back in.
- Expect: positions, cash, trades, favourites, notes and log entries are all intact.

---

## 18. Known inconsistencies to verify

These are not test steps — they are things a tester will hit that look like bugs.
Confirm each against current behaviour before filing.

**KNOWN-01 — Registration no longer signs you in.** The Playwright specs in
`tests/e2e/auth.spec.ts` still assert that registering lands on `/portfolio`, and
that a duplicate email shows "البريد الإلكتروني مسجل بالفعل". Current behaviour is the
"check your email" screen and a deliberately identical response for an address that
is already taken (AUTH-01 / AUTH-02). The helpers also never fill the now-required
phone field. The e2e suite needs updating before its results mean anything.

**KNOWN-02 — "سجّل إغلاق اليوم" no longer exists.** The daily close is now written by a
2:30 pm Cairo scheduled job, but the button is still referenced in the calendar empty
state, in `how-to-use`, in the chat bot's FAQ and in the landing page's tool
explainer. A user following that copy will hunt for a button that isn't there (CAL-08).

**KNOWN-03 — A lapsed account cannot reach its own data through the UI.** The API
deliberately leaves portfolio, trades, log and settings open after the trial ends so
the data isn't held hostage, but the desk replaces its entire body with the subscribe
wall, so no screen shows it. Decide whether that is intended (SUB-04 / SUB-06).

---

## 19. Coverage map against the automated suites

| Area | Automated today | Manual only |
| --- | --- | --- |
| Engine maths (indicators, stops, targets, scoring) | backend unit tests | — |
| Auth API (register / login / verify, tampered tokens) | backend module + API tests | Google sign-in, real emails |
| Portfolio API lifecycle, settings, reset, backfill | backend API tests | — |
| AI endpoints degrading to 503 | backend API tests | real-key behaviour |
| Formatting, targets, invest-style, API client | frontend Vitest | — |
| Landing, pricing, register / login, trades, cash, calendar, manual entry | Playwright (see KNOWN-01) | — |
| **Billing, paywall, admin grants** | **none** | §5, §16 |
| **Support chat and attachments** | **none** | §6 |
| **Screenshot import** | **none** | §15 |
| **Blog (public and admin)** | **none** | §3, §16 |
| **Indices page, charts, targets table** | **none** | §11, §13, §14 |
| **RTL, mobile, accessibility, browser matrix** | **none** | §17 |

The unautomated rows are where manual testing earns its keep — and the obvious
candidates for the next set of Playwright specs.
