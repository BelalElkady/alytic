import { z } from 'zod';

import { safeEqual } from '../security.js';
import { claimDue, handleMetaEvent, isLiveSending, isSendingTenant, recordResult } from './service.js';

/**
 * The WhatsApp lifecycle routes. The /api/automation/whatsapp/* paths are on
 * the login allowlist in server.js — public, protected by the shared secret
 * instead — because n8n calls them, not a signed-in user.
 */

const resultSchema = z.object({
  messageId: z.uuid(),
  status: z.enum(['sent', 'failed']),
  metaMessageId: z.string().min(1).max(200).optional(),
  error: z.string().max(500).optional(),
});

const eventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('status'),
    metaMessageId: z.string().min(1).max(200),
    status: z.enum(['sent', 'delivered', 'read', 'failed']),
    at: z.string().max(40).optional(),
    error: z.string().max(500).nullable().optional(),
  }),
  z.object({
    type: z.literal('message'),
    from: z.string().min(1).max(20),
    metaMessageId: z.string().min(1).max(200),
    text: z.string().max(4096),
  }),
]);

const BAD_BODY = 'بيانات الطلب مش صحيحة';

/** n8n's bearer secret. Answers 401 for anything else, including an unset secret. */
function automationOnly(req, res, next) {
  const secret = process.env.WHATSAPP_AUTOMATION_SECRET;
  if (!secret || !safeEqual(req.get('authorization') ?? '', `Bearer ${secret}`)) {
    return res.status(401).json({ error: 'غير مصرح' });
  }
  next();
}

/** `?at=` moves the clock for tests; it is ignored wherever real users can be messaged. */
function clockOf(req) {
  if (isLiveSending() || typeof req.query.at !== 'string') return new Date();
  const at = new Date(req.query.at);
  return Number.isNaN(at.getTime()) ? new Date() : at;
}

export function mountWhatsappRoutes(app, { wrap }) {
  app.get('/api/automation/whatsapp/due', automationOnly, wrap(async (req, res) => {
    if (!isSendingTenant(req.tenant)) return res.json({ items: [] });
    res.json({ items: await claimDue(clockOf(req)) });
  }));

  app.post('/api/automation/whatsapp/result', automationOnly, wrap(async (req, res) => {
    const parsed = resultSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: BAD_BODY });
    if (isSendingTenant(req.tenant)) await recordResult(parsed.data);
    res.json({ ok: true });
  }));

  app.post('/api/automation/whatsapp/events', automationOnly, wrap(async (req, res) => {
    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: BAD_BODY });
    if (!isSendingTenant(req.tenant)) return res.json({});
    res.json(await handleMetaEvent(parsed.data, clockOf(req)));
  }));
}
