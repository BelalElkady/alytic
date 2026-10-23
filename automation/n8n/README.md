# n8n workflows

Exported n8n workflows, kept here so changes go through review. **No secrets in these files.** Credentials live only in n8n, and the JSON refers to them by name.

## `whatsapp-lifecycle.json`

Delivers EGXpert's WhatsApp lifecycle messages. The backend decides who gets which step and builds the Graph API body. This workflow only sends it and reports back. Design: `docs/superpowers/specs/2026-10-23-whatsapp-lifecycle-design.md`.

```
Event Webhook ─────────────────────────┐
Every 30 min → Fetch Due → Split Items ┴→ Message → Send Template → Build Result → Report Result
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

3. In **Send Template** and **Send Reply**, replace `REPLACE_PHONE_NUMBER_ID` with the number's ID from WhatsApp Manager → API Setup.
4. The URLs point at production (`https://egxpert.com`). To test against a test backend, change the host in Fetch Due, Report Result and Report Event.
5. Activate the workflow. Then:
   - Copy **Event Webhook**'s production URL into `N8N_WHATSAPP_WEBHOOK_URL` in `backend/.env`.
   - In the Meta app's WhatsApp → Configuration, the callback URL is **WhatsApp Trigger**'s production URL; subscribe to `messages`.

### Behaviour worth knowing

- **Send Template** sends one message per second and keeps going if one fails. The failure is reported to the backend as `failed` and isn't retried; the backend never re-sends a step.
- The schedule fires every 30 minutes, all day. The backend returns an empty list outside 10:00–21:00 Cairo time, so nothing goes out at night.
- Every incoming WhatsApp message goes to the backend. Its answer decides whether to reply (opt-out confirmation, support chat pointer, survey thanks).

### Changing it

Edit in n8n, export (⋯ → Download), replace the file here, and open a PR. Before committing, check the export has no tokens in it, only credential names.
