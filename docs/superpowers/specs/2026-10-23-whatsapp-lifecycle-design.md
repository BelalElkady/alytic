# WhatsApp lifecycle messages: design

Status: draft for review · 2026-10-23
Depends on: PR #196 (the trial starts at email confirmation)

## Goal

Turn more Trial users into paid subscribers, and bring Expired users back, with a short series of WhatsApp messages sent through Meta's Cloud API by an n8n workflow. Only EGXpert (the main site) sends them; white-label sites are out of scope.

Success means more Activations per verified signup, and more renewals among Expired users, than before launch. We count both from `whatsapp_messages` and `subscriptions`.

## Decisions

| Topic | Decision |
|---|---|
| Channel | Meta's WhatsApp Cloud API. Every message that starts a conversation is an approved template |
| Consent | Opt-in by notice. New users see a line under the phone field at signup; existing users see an announcement and get a 3-day grace period. Users can stop by replying "إيقاف" or with the switch in settings |
| Who decides | The backend owns every rule (trading days, Renewal status, opt-out, once per step, offer expiry). n8n only delivers |
| Triggers | Events (verified with a phone, first Activation) are pushed to an n8n webhook. Time-based steps are pulled by an n8n schedule every 30 minutes |
| Offers | A time-limited percentage discount, recorded per user, which the Admin honors at Activation |
| Customizing | Admin page "رسايل واتساب": per step on/off, template name and offer values. The wording is edited in Meta's WhatsApp Manager and needs re-approval |

## Steps

Days are **trading days** counted from `email_verified_at`, the same calendar as `trialInfo`.

| Key | Meta category | When | Placeholders |
|---|---|---|---|
| `trial_welcome` | utility | **Event**: email confirmed and phone present, whichever happens second. Caught up by `/due` on trading day 0 only | name, trial days, app link |
| `trial_stoploss` | marketing | Trading day 2 reached, trial active | name, portfolio link |
| `trial_ending` | marketing | Last trading day of the trial | name, plan name, discount %, discounted price, offer end date, subscribe link |
| `trial_ended` | marketing | Trial over, no Activation, within 2 days of the end | name, discount %, offer end date, subscribe link |
| `paid_welcome` | utility | **Event**: the user's first Activation ever | name, plan name, period end date, app link |
| `survey` | marketing | Never subscribed, at least 3 days after the trial ended | name (quick-reply buttons carry the answers) |
| `renewal` | marketing | Expired, subscription ended at least 1 day ago, once per lapse | name, what's new, plan name, discount %, discounted price, offer end date, subscribe link |

Note: §3 of the chat design put `trial_stoploss` in Meta's utility category. Meta treats educational tips as marketing, so it's marketing here.

**Joining late.** For the trial steps, a user only ever gets the latest step that's currently due, and nothing is sent if a later step already went out. A user who's mid-trial at launch joins at the step matching their day. An existing Never-subscribed user gets `survey` only. An Active subscriber gets nothing.

**Only confirmed users with a phone.** This is the gate before every other rule: a user who hasn't confirmed their email, or has no phone, gets nothing until both are true. In the backup copy of 2026-10-22: 572 users, 516 confirmed, 417 confirmed with a phone, and 410 of those eligible once staff and suspended accounts are excluded. The 99 confirmed users without a phone (mostly Google sign-ups that skipped the phone step) and the 56 unconfirmed users with a phone are left out.

**Rules every step shares.** A user gets a step only if all of these hold: phone present, `email_verified_at` set, `whatsapp_opt_out_at` null, not suspended, not Admin/Marketer/`local`, the step is enabled, the request's tenant is the main site (`defaultTenant()`; on any white-label host `/due` returns nothing and events are ignored), and the user was created after `WHATSAPP_LAUNCH_AT` or that moment is at least 3 days ago (grace period for the announcement).

**Send window.** `/due` returns nothing outside 10:00–21:00 Cairo time. Event steps go out immediately, because the user has just acted.

## Data model

Appended to `backend/supabase/schema.sql` with `if not exists`.

```sql
alter table users add column if not exists whatsapp_opt_out_at timestamptz;

create table if not exists whatsapp_steps (
  key text primary key,            -- one of the seven step keys
  enabled boolean not null default false,
  template_name text not null,
  template_lang text not null default 'ar',
  params jsonb not null default '{}', -- e.g. {"discountPct":20,"validDays":7,"plan":"long_yearly","whatsNew":"..."}
  updated_by text,
  updated_at timestamptz not null default now()
);

create table if not exists whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users(id) on delete cascade,
  step text not null,
  cycle_key text not null default '',  -- '' except renewal: the lapsed period's end date
  phone text not null,                 -- the number at send time
  rendered_params jsonb not null,      -- exactly what was sent, offer included
  offer_expires_at timestamptz,
  status text not null default 'queued' check (status in ('queued','sent','delivered','read','failed')),
  meta_message_id text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, step, cycle_key)
);
create index if not exists idx_whatsapp_messages_meta on whatsapp_messages(meta_message_id) where meta_message_id is not null;

create table if not exists whatsapp_inbound (
  id uuid primary key default gen_random_uuid(),
  user_id text references users(id) on delete set null,
  phone text not null,
  text text not null,
  meta_message_id text unique,
  created_at timestamptz not null default now()
);
```

- `whatsapp_messages` is append-only except for its delivery status (`status`, `meta_message_id`, `error`, `updated_at`). The unique key is what keeps a step from being sent twice.
- RLS is on for all three tables with no policies, the same as the other app tables. Only the service role touches them.
- When a step reaches `delivered`, the backend fills `user_follow_ups.whatsapp_at` if it's empty, so the manual checkbox shows the user has been reached.

## Backend API

The three `/api/automation/whatsapp/*` paths are added to the login allowlist in `server.js` and **called out in the PR as public paths**. Each one requires `Authorization: Bearer ${WHATSAPP_AUTOMATION_SECRET}`, compared with `safeEqual`, and answers 401 otherwise. None of them is in `PAID_PATHS`. Bodies are validated with zod `safeParse`, and every handler is wrapped in `wrap()`.

### Backend → n8n (event push)

On `trial_welcome` and `paid_welcome` the backend claims the message (inserts the `queued` row) and POSTs one item to `N8N_WHATSAPP_WEBHOOK_URL` with the same bearer header. If the POST fails, the row stays `queued`. `trial_welcome` is then caught up by `/due`, and a stale `paid_welcome` turns `failed` (see the claiming rules).

### `GET /api/automation/whatsapp/due`

Claims and returns everything due right now, at most 50 per call:

```json
{ "items": [ { "messageId": "uuid", "request": { /* Graph API body, ready to send */ } } ] }
```

`request` is the exact body for `POST https://graph.facebook.com/v21.0/{phone-number-id}/messages`:

```json
{
  "messaging_product": "whatsapp",
  "to": "201012345678",
  "type": "template",
  "template": {
    "name": "trial_ending",
    "language": { "code": "ar" },
    "components": [ { "type": "body", "parameters": [ { "type": "text", "text": "أحمد" } ] } ]
  }
}
```

The phone is in E.164 without the `+`. The event push sends the same item shape.

**Claiming.** A `queued` row is inserted before the item is returned, and the unique key rejects a second claim. A `queued` row with no result after 2 hours turns `failed` and is never retried: a missed message is better than a duplicate.

### `POST /api/automation/whatsapp/result`

```json
{ "messageId": "uuid", "status": "sent" | "failed", "metaMessageId": "wamid...", "error": "..." }
```

### `POST /api/automation/whatsapp/events`

One Meta event per call, already reshaped by n8n:

```json
{ "type": "status", "metaMessageId": "wamid...", "status": "delivered" | "read" | "failed", "at": "ISO", "error": null }
{ "type": "message", "from": "+201012345678", "metaMessageId": "wamid...", "text": "إيقاف" }
```

- `status`: updates the row matched by `meta_message_id`. Status never moves backwards (`read` beats `delivered`).
- `message`: stored in `whatsapp_inbound`, and matched to a user by phone. Stop words (`إيقاف`, `ايقاف`, `stop`, `الغاء`, `إلغاء`), compared after trimming, set `whatsapp_opt_out_at`. The answer can include a reply for n8n to send (free-form text is allowed within 24 hours of the user's message):

```json
{ "reply": { "to": "201012345678", "text": "تمام، مش هنبعتلك رسايل تاني. تقدر ترجّعها من الإعدادات." } }
```

  Any other text gets a reply pointing to the support chat on the site, at most once per user every 24 hours. A survey button answer is stored and answered with "شكراً، وصلنا ردك 🙏".

### User and Admin

- `PATCH /api/account/whatsapp` `{ "enabled": boolean }` (session): sets or clears `whatsapp_opt_out_at`. `GET /api/auth/me` exposes `whatsappEnabled`.
- `GET /api/admin/whatsapp/steps` (Admin, plus `MARKETER_READS`): the steps, the last 30 days of counts per step and status, and the survey answer counts.
- `PUT /api/admin/whatsapp/steps/:key` (Admin with a verified email): `enabled`, `template_name` (`^[a-z0-9_]{1,512}$`), `params` (zod, per step: `discountPct` 0–90, `validDays` 1–30, `plan` a key in `PLANS`, `whatsNew` up to 200 characters with no newlines).
- The admin users list gets `whatsapp: { lastStep, lastStatus, offer: { discountPct, expiresAt } | null }` for each user.

## n8n

The workflow is in `automation/n8n/whatsapp-lifecycle.json`. Setup is in `automation/n8n/README.md`. It has three entry points that feed shared nodes:

1. **Event Webhook** (header auth) and **Every 30 min → Fetch Due → Split Items** both go into **Message** → **Send Template** (Graph API, 1 per second, continues on error) → **Build Result** → **Report Result**.
2. **WhatsApp Trigger** (Meta webhook) → **Parse Meta Event** → **Report Event** → **Has Reply?** → **Send Reply**.

n8n holds three credentials: the Meta token, the automation secret (both directions) and Meta's app credentials for the trigger. The JSON contains no secrets.

Note: §3 of the chat design said HMAC for the event push. A bearer secret over HTTPS, the same one used in the other direction, is what's specified here instead. It's simpler, and n8n's webhook node checks it natively.

## Meta setup (you)

1. Verify the business in Meta Business Manager, add a WhatsApp Business number on the Cloud API (one not already used in the WhatsApp app), and create a System User with a permanent token (`whatsapp_business_messaging`, `whatsapp_business_management`).
2. Submit the templates for the steps you will switch on, in Arabic (`ar`), each with the footer "ابعت إيقاف لو مش عايز رسايل تاني". To start (see Rollout, cost): `trial_welcome` and `trial_ending`. The other drafts are kept below for later.
3. Point the app's webhook at the n8n WhatsApp Trigger URL and subscribe to `messages`.

### Template drafts

Placeholders are numbered in the order the backend fills them.

- **trial_welcome**: أهلاً {{1}} 👋 حسابك على EGXpert اتفعّل وتجربتك المجانية ({{2}} أيام تداول) بدأت. أسرع بداية: ارفع سكرين شوت لمحفظتك من تطبيق السمسار وهنقرأها لك في ثواني. ابدأ من هنا: {{3}}
- **trial_stoploss**: {{1}}، أهم عادة للمستثمر: وقف خسارة لكل سهم. EGXpert بيحسبلك وقف الخسارة والمستهدف لكل سهم في محفظتك. شوفهم هنا: {{2}}
- **trial_ending**: {{1}}، تجربتك المجانية فاضلها يوم واحد. اشترك في {{2}} السنوي بخصم {{3}}٪ (بـ {{4}} جنيه بدل السعر الكامل) — العرض لحد {{5}}. اشترك من هنا: {{6}}
- **trial_ended**: {{1}}، تجربتك المجانية خلصت، ومحفظتك وبياناتك محفوظة زي ما هي. عرض الاشتراك بخصم {{2}}٪ لسه شغال لحد {{3}}: {{4}}
- **paid_welcome**: أهلاً بيك في {{2}} يا {{1}} 🎉 اشتراكك اتفعّل لحد {{3}}. كل المزايا مفتوحة دلوقتي — ابدأ من هنا: {{4}}
- **survey**: {{1}}، جربت EGXpert ومكمّلتش، ويهمنا نعرف ليه عشان نحسّن. اختار سبب واحد: (quick-reply buttons: السعر · مش محتاجه دلوقتي · فيه حاجة ناقصة)
- **renewal**: {{1}}، وحشتنا! من آخر مرة ضفنا: {{2}}. جدّد {{3}} بخصم {{4}}٪ (بـ {{5}} جنيه) لحد {{6}}: {{7}}

The subscribe link opens the in-app support chat, where subscriptions already happen (InstaPay, then Activation).

## Screens (frontend, following `frontend/AGENTS.md`)

- **Signup, phone field:** "هنبعتلك على واتساب رسايل عن حسابك وتجربتك. تقدر توقفها في أي وقت."
- **Settings:** a "رسايل واتساب" switch.
- **Admin → رسايل واتساب:** one card per step with on/off, template name, offer fields, a preview of the final text with sample values, 30-day counts, and survey answer counts. Only Admins can edit; Marketers can view.
- **Admin users screen:** last step and its status, plus an "عرض ساري: خصم ٢٠٪ لحد ٢٨ أكتوبر" badge while an offer is valid.
- **Announcement** (existing announcements system, all audiences): the same notice text plus where to switch it off. It's published on launch day, which is `WHATSAPP_LAUNCH_AT`.

## Testing

### Safety guard (every environment except production)
`WHATSAPP_ALLOWED_PHONES` (comma-separated E.164) is required whenever `NODE_ENV` isn't `production` or the Supabase URL isn't the production project. Outside production the backend claims and sends **only** to numbers on that list and skips every other user. If the variable is missing, `/due` returns nothing and the event push is off. This is what makes it safe to point the flow at data that contains real phones.

### Stage 1: dry run on the backup copy (real data, nothing sent)
`npm --prefix backend run whatsapp:dry-run -- --at "2026-11-02T11:00:00+02:00"` reads the `backup` schema of `qfxuejkbnrdszycqxvdx` (last night's copy of production) through `BACKUP_DATABASE_URL`, read-only. It runs the same `dueStepFor()` the endpoints use, for the given moment, against those users and the default step config. It prints the number of users per step and per reason they were skipped (no phone, unconfirmed, opted out, grace period, staff, …), plus up to 10 user ids per step. **It never prints phones and never writes or sends anything.** Run it for a few moments (launch day, launch + 3 days, a holiday) and check the counts make sense before anything is sent.

### Stage 2: real messages on the test project, team phones only
The backend runs against the test project (`public` schema) with `WHATSAPP_ALLOWED_PHONES` set to the team's numbers. A seed script creates test users with those numbers at each point of the lifecycle (just confirmed, trading day 2, last trial day, trial ended, Never subscribed, Expired). A copy of the n8n workflow points at that backend. Check that each template arrives with the right values, "إيقاف" stops everything after it, delivered/read statuses come back, and a re-run sends nothing twice.

### Automated
- **Unit (pure function `dueStepFor(user, subscription, sent, now)`):** fixed dates that include a weekend and an EGX holiday; each step's timing; late join; Never subscribed goes to `survey` only; Expired gets `renewal` once per lapse; the grace period; the send window; opt-out; suspended and staff users.
- **API:** the secret is required on all three automation paths; a double claim inserts once; a stale `queued` row turns `failed`; `إيقاف` opts out and returns the reply; status never moves backwards; Marketer can read but not write; a white-label tenant gets an empty `/due`; outside production a user whose phone isn't on `WHATSAPP_ALLOWED_PHONES` is never claimed, and a missing list sends nothing.
- No real Meta calls in automated tests.

## Rollout

1. Merge PR #196 (the trial clock).
2. Testing stages 1 and 2 above pass.
3. Apply the trial-clock and WhatsApp blocks of `schema.sql` to **every tenant database** (production and each white-label client, see `WHITE-LABEL.md`) and the test project, **before merging**: a merge to `main` deploys at once, and the code reads the new columns and tables on every site. Every step ships `enabled = false`.
4. Meta setup and template approval. Import the n8n workflow and point it at production.
5. Publish the announcement and set `WHATSAPP_LAUNCH_AT`.
6. Switch on only `trial_welcome` (utility, cheap) and `trial_ending` (the discount offer, the step most likely to convert). Every other step stays off. Decided 2026-10-24 to keep Meta's per-message cost to about one marketing template per trial user; the other steps can be switched on later from the admin tab without code changes. `paid_welcome` is a cheap utility template and a candidate to add next.

## Out of scope

White-label tenants sending from their own numbers; A/B tests of wording; a WhatsApp inbox in the admin panel; sending support-chat replies over WhatsApp.
