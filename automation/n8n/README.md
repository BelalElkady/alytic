# n8n workflows

Exported n8n workflows, kept here so changes go through review. **No secrets in these files.** Credentials live only in n8n, and the JSON refers to them by name.

## `whatsapp-lifecycle.json`

Delivers EGXpert's WhatsApp lifecycle messages. The backend decides who gets which step and builds the Graph API body. This workflow only sends it and reports back. Design: `docs/superpowers/specs/2026-10-23-whatsapp-lifecycle-design.md`.

```
Event Webhook ─────────────────────────┐
Every 30 min → Fetch Due → Split Items ┴→ Message → Loop Items ⇄ (Send Template → Build Result → Report Result)
WhatsApp Trigger → Parse Meta Event → Report Event → Has Reply? → Send Reply
```

### Import

1. n8n → Workflows → Import from file → `whatsapp-lifecycle.json`.
2. Create the three credentials and attach them to the nodes that show a credential warning:

   | Credential (n8n type) | Value | Used by |
   |---|---|---|
   | **Alytic automation secret** (Header Auth) | Name `Authorization`, value `Bearer <WHATSAPP_AUTOMATION_SECRET>`, the same value as in `backend/.env` | Event Webhook, Fetch Due, Report Result, Report Event |
   | **WhatsApp Cloud API token** (Header Auth) | Name `Authorization`, value `Bearer <Meta System User permanent token>` | Send Template, Send Reply |
   | **WhatsApp app (trigger)** (WhatsApp OAuth / trigger API) | Meta app ID and app secret | WhatsApp Trigger |

3. The sending number is not set in n8n: put its Phone Number ID (WhatsApp Manager → API Setup) in the backend's `WHATSAPP_PHONE_NUMBER_ID`. The backend sends it with every message and reply, and Send Template / Send Reply build their URL from it.
4. The URLs point at production (`https://egxpert.com`). To test against a test backend, change the host in Fetch Due, Report Result and Report Event.
5. Activate the workflow. Then:
   - Copy **Event Webhook**'s production URL into `N8N_WHATSAPP_WEBHOOK_URL` in `backend/.env`.
   - In the Meta app's WhatsApp → Configuration, the callback URL is **WhatsApp Trigger**'s production URL; subscribe to `messages`.

### Behaviour worth knowing

- Messages go out one at a time through **Loop Items**: each is sent and reported to the backend before the next, so Meta's delivery updates always find their message. A failed send keeps the loop going. The failure is reported to the backend as `failed` and isn't retried; the backend never re-sends a step.
- The schedule fires every 30 minutes, all day. The backend returns an empty list outside 10:00–21:00 Cairo time, so nothing goes out at night.
- Every incoming WhatsApp message goes to the backend. Its answer decides whether to reply (opt-out confirmation, support chat pointer, survey thanks).

### Stage 2: real messages on the test project

Before production, send every template to the team's own phones from a test backend:

1. In a test copy of `backend/.env`: `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` set to the test project (`qfxuejkbnrdszycqxvdx`), plus `WHATSAPP_AUTOMATION_SECRET`, `WHATSAPP_LAUNCH_AT` (any past date), `WHATSAPP_ALLOWED_PHONES` (the team's numbers) and `N8N_WHATSAPP_WEBHOOK_URL` (the test workflow's Event Webhook URL). Outside production the backend only ever messages numbers on that list.
2. Apply the "WhatsApp lifecycle messages" block of `backend/supabase/schema.sql` to the test project, start the backend, and switch the steps on in the admin tab "رسايل واتساب".
3. `npm --prefix backend run whatsapp:seed-test-users -- --phones +2010...,+2011...` creates one user per lifecycle point on those phones (`--points` picks which).
4. Duplicate the workflow in n8n, point Fetch Due, Report Result and Report Event at the test backend, and run Fetch Due by hand between 10:00 and 21:00 Cairo time.
5. Check: each template arrives with the right values; replying "إيقاف" stops everything after it; delivered/read come back on the admin tab; running Fetch Due again sends nothing twice.

### Changing it

Edit in n8n, export (⋯ → Download), replace the file here, and open a PR. Before committing, check the export has no tokens in it, only credential names.
