/**
 * REST API.
 *
 * This exists mainly so the API key stops living in the browser. The previous
 * single-file UI called `api.anthropic.com` straight from the page, which
 * cannot work (CORS, and no key was attached) and would have leaked the key to
 * every visitor if it had. Every model call now happens behind this process.
 *
 * The technical endpoints work with no key at all; only /api/review and
 * /api/fundamentals need one, and they say so plainly when it is missing.
 */

import '../loadEnv.js';
import express from 'express';
import rateLimit from 'express-rate-limit';
import * as XLSX from 'xlsx';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { analyzeTicker, analyzeMany } from '../analyze.js';
import { positionSize } from '../scoring/risk.js';
import { ALL_CODES, UNIVERSE, lookup, registerCustomStocks } from '../config/universe.js';
import { INDICES_AS_OF, UPLOADABLE_INDICES, codesForIndex, effectiveIndices } from '../config/indices.js';
import { getAllIndexOverrides, setIndexOverride, clearIndexOverride, getAllCustomStocks, addCustomStocks, getAllUsers, getAllPortfolios, listPublishedBlogPosts, listAllPublishedBlogSlugs, getPublishedBlogPostBySlug, listBlogPosts, setBlogPostStatus, updateBlogPost, deleteBlogPost, getUserById, deleteUser, getSubscription, getAllSubscriptions, putSubscription, deleteSubscription, recordSubscriptionGrant, listSubscriptionGrants, listSupportMessages, insertSupportMessage, markSupportMessagesRead, listRecentSupportMessages } from '../db.js';
import { PLANS, planFor, addMonths, INSTAPAY } from '../billing/plans.js';
import { STYLE_KEYS, rulesForStyle } from '../config/styles.js';
import RULES from '../config/rules.js';
import { loadPortfolio, withPortfolio, recordTrade, setLevels, trackedCodes, recordSnapshot, setNote } from '../portfolio.js';
import { aiAvailable, callWithRetry, getOpenRouterClient } from '../agent/clientOpenRouter.js';

// Pinned independently of the shared MODEL export so a future ALYTIC_MODEL
// change for the text-analysis path can never silently redirect vision too.
// Configurable via ALYTIC_VISION_MODEL in .env — must be a vision-capable
// OpenRouter model. A stale model override once sent this route to a
// text-only "thinking" model with zero vision-capable endpoints, producing
// an opaque 404 — verified live.
const SCREENSHOT_VISION_MODEL = process.env.ALYTIC_VISION_MODEL ?? 'qwen/qwen2.5-vl-72b-instruct:free';
import { readBars, cairoToday, cairoDateOf, isTradingDay } from '../data/cache.js';
import { fetchLatestQuotes } from '../data/tv-history.js';
import { login, register, userFromRequest, sessionCookie, clearSessionCookie, googleSignIn, verifyEmail, resendVerification, updatePhone, forgotPassword, resetPassword } from '../auth.js';
import { sendEmail } from '../email.js';
import { contactEmailHtml, supportMessageEmailHtml } from '../emailTemplates.js';
import { uploadSupportImage, signedUrlsFor, removeSupportImagesFor, SUPPORT_IMAGE_TYPES } from '../supportAttachments.js';

// Where the public contact form's messages land. Same default as
// ADMIN_EMAILS in auth.js, kept separate so either can change independently.
const CONTACT_EMAIL = process.env.CONTACT_EMAIL ?? 'belal.elkady4@gmail.com';

// Every account is on a 4-trading-day free trial from the moment it's created
// — the window is derived from users.created_at rather than stored, so there
// is nothing to reset or backfill. The trial runs in 24-hour slices from the
// signup moment; a slice that starts on a Friday, Saturday or EGX bank holiday
// (isTradingDay) doesn't count and just pushes the end out by a day, so
// signing up before a weekend doesn't burn trial days on a closed market.
const TRIAL_DAYS = 4;
const DAY_MS = 24 * 60 * 60 * 1000;
function trialInfo(user) {
  const now = Date.now();
  let sliceStart = new Date(user.createdAt ?? user.created_at).getTime();
  let counted = 0;
  let daysLeft = 0;
  while (counted < TRIAL_DAYS) {
    if (isTradingDay(cairoDateOf(sliceStart))) {
      counted += 1;
      if (sliceStart + DAY_MS > now) daysLeft += 1;
    }
    sliceStart += DAY_MS;
  }
  return {
    trialDaysTotal: TRIAL_DAYS,
    trialDaysLeft: daysLeft,
    trialActive: sliceStart > now,
    trialEndsAt: new Date(sliceStart),
  };
}

/**
 * Everything the client needs to know about what this account may do, and the
 * one place `hasAccess` is decided: an unexpired trial, a live paid period,
 * or a staff/CLI account. Admins and the built-in 'local' CLI user bypass
 * billing entirely — the CLI has no way to pay and locking it out would break
 * local development.
 */
async function accessInfo(user) {
  const trial = trialInfo(user);
  const subscription = await getSubscription(user.id);
  const periodEnd = subscription ? new Date(subscription.current_period_end) : null;
  const subscriptionActive = Boolean(periodEnd && periodEnd.getTime() > Date.now());
  const exempt = Boolean(user.isAdmin) || user.id === 'local';
  return {
    trialDaysTotal: trial.trialDaysTotal,
    trialDaysLeft: trial.trialDaysLeft,
    trialActive: trial.trialActive,
    trialEndsAt: trial.trialEndsAt.toISOString(),
    plan: subscriptionActive ? subscription.plan : null,
    subscriptionActive,
    currentPeriodEnd: periodEnd ? periodEnd.toISOString() : null,
    hasAccess: exempt || trial.trialActive || subscriptionActive,
  };
}

/**
 * Where a newly granted period should start counting from: whichever is
 * furthest out of now, the end of an unused free trial, and an already-running
 * paid period. So activating a user who is still inside their trial credits
 * the remaining trial days onto the end of the subscription instead of
 * burning them, and renewing early stacks rather than truncating.
 */
async function periodStartFor(userId) {
  const user = await getUserById(userId);
  const existing = await getSubscription(userId);
  const candidates = [Date.now()];
  if (user) candidates.push(trialInfo({ createdAt: user.created_at }).trialEndsAt.getTime());
  if (existing) candidates.push(new Date(existing.current_period_end).getTime());
  return new Date(Math.max(...candidates));
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const app = express();
// Behind nginx (see the systemd deploy), the real client IP arrives in
// X-Forwarded-For — without this, every request looks like it came from
// nginx itself (127.0.0.1), which would make the rate limiters below share
// one bucket across every visitor instead of limiting per-IP.
app.set('trust proxy', 1);
app.use(express.json());

// Brute-force / abuse guards on the endpoints an attacker would actually
// want to hammer: password guessing, mass account creation, and using the
// app's own outgoing email as a spam relay. Keyed by IP (see 'trust proxy'
// above); a shared 429 body avoids leaking which limiter tripped.
// The E2E suite drives this exact HTTP surface with many rapid registrations
// and logins from a single browser origin, so it opts out via env — the
// limiters themselves stay covered by the API tests, which pin a fixed
// X-Forwarded-For and assert the 429.
const skipLimits = process.env.E2E_SKIP_RATE_LIMITS === '1';
const rateLimited = (max, windowMinutes) => (skipLimits
  ? (_req, _res, next) => next()
  : rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'محاولات كتير في وقت قصير — استنى شوية وجرّب تاني' },
  }));
const loginLimiter = rateLimited(10, 15);
const registerLimiter = rateLimited(8, 60);
const emailActionLimiter = rateLimited(6, 60); // forgot-password, resend-verification, contact

// The vanilla-JS UI (formerly public/index.html) is retired in favor of the
// EGXpert frontend in frontend/ (TanStack Start, its own dev/build process).
// This process stays API-only for the browser: send a human landing on it
// straight to the real app instead of serving stale markup.
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:8080';
app.get('/', (_req, res) => res.redirect(FRONTEND_URL));

app.use(express.static(path.join(ROOT, 'public')));

/** Wrap an async handler so a rejection becomes a 500 instead of an unhandled rejection. */
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

// Never logs the caller in directly (unlike login/google) and always
// answers the same way regardless of whether the email was already taken
// — see auth.js's register() for why: revealing that here would be exactly
// the email-enumeration hole rate limiting alone can't close.
app.post('/api/auth/register', registerLimiter, wrap(async (req, res) => {
  await register(req.body ?? {});
  res.status(201).json({ ok: true });
}));

app.post('/api/auth/login', loginLimiter, wrap(async (req, res) => {
  const result = await login(req.body ?? {});
  // "فضّلني مسجّل دخول" — defaults to remembered (today's behavior) unless
  // the checkbox was explicitly unchecked.
  const remember = req.body?.remember !== false;
  res.setHeader('Set-Cookie', sessionCookie(result.token, remember));
  res.json({ user: result.user });
}));

app.post('/api/auth/google', loginLimiter, wrap(async (req, res) => {
  const result = await googleSignIn(req.body ?? {});
  res.setHeader('Set-Cookie', sessionCookie(result.token));
  res.json({ user: result.user });
}));

app.post('/api/auth/verify', wrap(async (req, res) => {
  const result = await verifyEmail(req.body ?? {});
  res.json(result);
}));

app.post('/api/auth/resend-verification', emailActionLimiter, wrap(async (req, res) => {
  await resendVerification(req.body ?? {});
  res.json({ ok: true });
}));

app.post('/api/auth/forgot-password', emailActionLimiter, wrap(async (req, res) => {
  await forgotPassword(req.body ?? {});
  res.json({ ok: true });
}));

app.post('/api/auth/reset-password', loginLimiter, wrap(async (req, res) => {
  await resetPassword(req.body ?? {});
  res.json({ ok: true });
}));

app.post('/api/auth/logout', (_req, res) => {
  res.setHeader('Set-Cookie', clearSessionCookie());
  res.json({ ok: true });
});

// Carries the whole entitlement picture (trial countdown, live plan,
// hasAccess) so the frontend can render the header badge and the paywall
// without a second round trip. See accessInfo above.
app.get('/api/auth/me', wrap(async (req, res) => {
  const user = await userFromRequest(req);
  if (!user) return res.json({ user: null });
  res.json({ user: { ...user, ...(await accessInfo(user)) } });
}));

// Public "تواصل معنا" form — no login required, and never blocked by a
// missing OPENROUTER_API_KEY the way the AI endpoints are; it only needs
// RESEND_API_KEY, and sendEmail() degrades to a console log without one
// rather than failing the request.
app.post('/api/contact', emailActionLimiter, wrap(async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const message = String(req.body?.message ?? '').trim();
  if (!name || name.length > 100) return res.status(400).json({ error: 'اكتب اسمك' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'اكتب بريد إلكتروني صحيح' });
  if (!message || message.length > 4000) return res.status(400).json({ error: 'اكتب رسالتك (حد أقصى 4000 حرف)' });

  await sendEmail({
    to: CONTACT_EMAIL,
    subject: `رسالة تواصل من ${name}`,
    html: contactEmailHtml({ name, email, message }),
  });
  res.json({ ok: true });
}));

// Published blog posts — public, no login required. See src/agent/blogGenerator.js
// for how drafts are written and src/db.js for the storage helpers.
app.get('/api/blog', wrap(async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const posts = await listPublishedBlogPosts({ limit });
  res.json({
    posts: posts.map((p) => ({ slug: p.slug, title: p.title, dek: p.dek, tags: p.tags, imageUrl: p.image_thumb_url, publishedAt: p.published_at })),
  });
}));

app.get('/api/blog/:slug', wrap(async (req, res) => {
  const post = await getPublishedBlogPostBySlug(req.params.slug);
  if (!post) return res.status(404).json({ error: 'المقالة غير موجودة' });
  res.json({
    post: {
      slug: post.slug,
      title: post.title,
      metaDescription: post.meta_description,
      dek: post.dek,
      content: post.content_json,
      tags: post.tags,
      image: post.image_url
        ? {
            url: post.image_url,
            sourceUrl: post.image_source_url,
            creditName: post.image_credit_name,
            creditUrl: post.image_credit_url,
          }
        : null,
      publishedAt: post.published_at,
    },
  });
}));

// Every published slug, no pagination — backs frontend/src/routes/sitemap[.]xml.ts,
// which fetches this on every request rather than a cron-written static file (a
// deploy rebuilds frontend/.output from scratch on every push, see
// .github/workflows/deploy.yml, which would just wipe a file written at runtime).
app.get('/api/sitemap-urls', wrap(async (req, res) => {
  const posts = await listAllPublishedBlogSlugs();
  res.json({ posts: posts.map((p) => ({ slug: p.slug, publishedAt: p.published_at })) });
}));

// Triggered every 2 hours by .github/workflows/blog-cron.yml over the VPS's
// loopback interface (never exposed publicly) — see that workflow for why a
// shared secret rather than a session cookie gates this instead of
// /api/admin. Each trigger generates exactly one article (the next missing
// slot in today's 10-article plan) so the day's batch lands spread out
// rather than all at once; once 10 exist for the day this is a fast no-op.
const BLOG_CRON_SECRET = process.env.BLOG_CRON_SECRET;
app.post('/api/cron/blog-generate', wrap(async (req, res) => {
  if (!BLOG_CRON_SECRET || req.get('X-Cron-Secret') !== BLOG_CRON_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  if (!aiAvailable()) return res.status(503).json({ error: 'مفيش مفتاح API', aiAvailable: false });
  const postDate = typeof req.body?.postDate === 'string' ? req.body.postDate : undefined;
  // The cron fires all 7 days a week (blog-cron.yml has no day-of-week filter
  // of its own), but there is no EGX news to research on a day the exchange
  // never opened — Friday/Saturday. Skip rather than spend a discovery +
  // article generation pass researching nothing. `force: true` bypasses this
  // for deliberate backfill/testing against a specific past postDate.
  if (!req.body?.force && !isTradingDay(postDate ?? cairoToday())) {
    return res.json({ ok: true, skipped: 'not_a_trading_day', postDate: postDate ?? cairoToday() });
  }
  const { getOrGenerateNextBlogArticle } = await import('../agent/blogGenerator.js');
  // Awaited on purpose: the GitHub Actions workflow that calls this should
  // only go green once this run's article (if any) is actually stored, not
  // the moment generation starts.
  const result = await getOrGenerateNextBlogArticle({ postDate });
  res.json({
    ok: true,
    postDate: result.postDate,
    totalToday: result.totalToday,
    generated: result.generated ? { id: result.generated.id, slug: result.generated.slug, status: result.generated.status } : null,
  });
}));

// The prices the "اشترك" screen quotes. Payment details are deliberately not
// here: users ask on the support chat and an admin sends them privately, so
// no account number is published to anyone who can curl this.
app.get('/api/billing/plans', (_req, res) => {
  res.json({ plans: Object.values(PLANS) });
});

app.use('/api', async (req, res, next) => {
  if (
    req.path.startsWith('/auth/') ||
    req.path === '/health' ||
    req.path === '/universe' ||
    req.path === '/indices' ||
    req.path === '/market-status' ||
    req.path === '/contact' ||
    req.path === '/blog' ||
    req.path.startsWith('/blog/') ||
    req.path === '/sitemap-urls' ||
    req.path === '/billing/plans' ||
    req.path === '/cron/blog-generate'
  ) return next();
  const user = await userFromRequest(req);
  if (!user) return res.status(401).json({ error: 'سجّل الدخول الأول' });
  req.user = user;
  next();
});

// What the trial and the subscription actually buy: the endpoints that carry
// the product's value or spend money per call. Everything else a signed-in
// user can reach — their portfolio, trade log, settings — stays open after the
// trial lapses, so an unpaid account can still read and export its own data
// instead of having it held hostage.
const PAID_PATHS = [
  '/scan',
  '/quotes',
  '/review',
  '/market-analysis',
  '/analyze/',
  '/fundamentals/',
  '/portfolio/import-screenshot',
];
// The status is 402 so the client can recognise this case without string
// matching, but the message is written to be shown to the user as-is: it says
// which of the two things ran out and what to do next, never a bare code.
// The try/catch matters: an unhandled rejection in middleware reaches
// Express's default handler, which answers with an HTML body the frontend
// can't read a message out of — the user would see a bare "فشل الطلب (500)"
// where their portfolio should be. A failed entitlement check is reported as
// such instead, and never silently grants access.
app.use('/api', async (req, res, next) => {
  if (!req.user || !PAID_PATHS.some((prefix) => req.path.startsWith(prefix))) return next();
  let access;
  try {
    access = await accessInfo(req.user);
  } catch (err) {
    console.error('entitlement check failed:', err);
    return res.status(503).json({ error: 'تعذر التحقق من اشتراكك دلوقتي — جرّب تاني بعد شوية.' });
  }
  // Stashed for handlers downstream (e.g. /api/scan's cash-scan trial cap)
  // that need to know subscription status without a second accessInfo/DB call.
  req.access = access;
  if (access.hasAccess) return next();
  const expired = Boolean(access.currentPeriodEnd);
  res.status(402).json({
    error: expired
      ? 'اشتراكك انتهى. حوّل قيمة التجديد على InstaPay وهنفعّل حسابك تاني.'
      : 'انتهت تجربتك المجانية. حوّل قيمة الاشتراك على InstaPay وهنفعّل حسابك.',
    reason: expired ? 'subscription_expired' : 'trial_ended',
    requiresSubscription: true,
  });
});

// ---- Support chat ----------------------------------------------------------
// Deliberately outside PAID_PATHS: this is how a user asks to subscribe and
// how a lapsed account asks to renew, so locking it behind the paywall would
// wall off the only route back to paying.

const MAX_MESSAGE_LENGTH = 2000;
const chatLimiter = rateLimited(40, 15);

const publicMessage = (row) => ({
  id: row.id,
  sender: row.sender,
  body: row.body,
  createdAt: row.created_at,
  readAt: row.read_at,
});

// Turns each row's private image_path into a short-lived signed URL — one
// batched storage call rather than one per message — and drops the raw path,
// which is meaningless (and inaccessible) to the client anyway.
async function withImageUrls(rows) {
  const urls = await signedUrlsFor(rows.map((r) => r.image_path));
  return rows.map((row) => ({
    ...publicMessage(row),
    imageUrl: row.image_path ? (urls.get(row.image_path) ?? null) : null,
  }));
}

async function withImageUrl(row) {
  const [message] = await withImageUrls([row]);
  return message;
}

// One notification email per burst of activity, shared by the text and image
// send routes — see the call site below for why a burst is defined the way
// it is.
async function notifySupportBurst({ user, existing, preview, wantsHuman }) {
  const previous = existing[existing.length - 1];
  const withinBurst =
    previous?.sender === 'user' && Date.now() - new Date(previous.created_at).getTime() < 10 * 60 * 1000;
  if (withinBurst) return;
  await sendEmail({
    to: CONTACT_EMAIL,
    subject: wantsHuman ? `طلب مساعدة من ${user?.email}` : `رسالة شات جديدة من ${user?.email}`,
    html: supportMessageEmailHtml({
      name: user?.name,
      email: user?.email,
      message: preview,
      appUrl: process.env.APP_URL ?? FRONTEND_URL,
    }),
  }).catch((err) => console.error('support notification email failed:', err));
}

// What the bot answers "عايز أشترك" with. Behind the session on purpose:
// this is the one place the InstaPay account is disclosed, so it only ever
// reaches a signed-in account whose transfer we can later match.
app.get('/api/support/subscribe-info', wrap(async (_req, res) => {
  res.json({ plans: Object.values(PLANS), instapay: INSTAPAY });
}));

// Only marks the admin's messages read when the caller says the panel is
// actually open (?read=1). The widget polls in the background to keep its
// unread badge current, and marking on every poll would clear that badge
// before the user ever saw it.
app.get('/api/support/messages', wrap(async (req, res) => {
  const messages = await listSupportMessages(req.user.id);
  if (req.query.read === '1' && messages.some((m) => m.sender === 'admin' && !m.read_at)) {
    await markSupportMessagesRead(req.user.id, 'admin');
  }
  res.json({ messages: await withImageUrls(messages) });
}));

app.post('/api/support/messages', chatLimiter, wrap(async (req, res) => {
  const body = String(req.body?.body ?? '').trim();
  if (!body) return res.status(400).json({ error: 'اكتب رسالتك الأول' });
  if (body.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `الرسالة طويلة أوي (الحد ${MAX_MESSAGE_LENGTH} حرف)` });
  }

  const existing = await listSupportMessages(req.user.id);
  const message = await insertSupportMessage({ userId: req.user.id, sender: 'user', body });

  // The bot answers the common questions itself, so a message that arrives
  // with intent=help means the user chose "كلّمني مع حد" — worth saying in the
  // subject line so it stands out from a general chat message.
  await notifySupportBurst({
    user: req.user,
    existing,
    preview: body,
    wantsHuman: req.body?.intent === 'help',
  });

  res.status(201).json({ message: await withImageUrl(message) });
}));

// Same as above but for a screenshot (usually an InstaPay receipt) instead of
// text — a raw image body, mirroring /api/portfolio/import-screenshot, rather
// than multipart form data, since it's always exactly one file with no other
// fields.
app.post('/api/support/messages/image', chatLimiter, express.raw({ type: SUPPORT_IMAGE_TYPES, limit: '8mb' }), wrap(async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'ارفع صورة الأول' });

  const existing = await listSupportMessages(req.user.id);
  const imagePath = await uploadSupportImage({
    userId: req.user.id,
    mediaType: req.headers['content-type'],
    buffer: req.body,
  });
  const message = await insertSupportMessage({ userId: req.user.id, sender: 'user', body: '', imagePath });

  await notifySupportBurst({
    user: req.user,
    existing,
    preview: 'صورة مرفقة',
    wantsHuman: req.query.intent === 'help',
  });

  res.status(201).json({ message: await withImageUrl(message) });
}));

// Google sign-in never collects a phone number, but registration requires
// one — this is how a Google account fills that in afterward. Placed after
// the auth middleware above (path doesn't start with /auth/) so it's already
// gated behind a session.
app.post('/api/account/phone', wrap(async (req, res) => {
  const result = await updatePhone({ userId: req.user.id, phone: req.body?.phone });
  res.json({ user: result.user });
}));

const capitalOf = (p) =>
  Object.values(p.positions).reduce((a, pos) => a + pos.shares * pos.avgCost, 0) + p.cash;

// ---- Reference data --------------------------------------------------------

app.get('/api/universe', (_req, res) => {
  res.json({ stocks: UNIVERSE, rules: RULES, aiAvailable: aiAvailable() });
});

// EGX trades 10:00-14:30 Cairo time, Sunday-Thursday, minus bank holidays —
// isTradingDay already carries that (see src/config/holidays.js), so this
// just adds the intraday clock check on top of it.
app.get('/api/market-status', (_req, res) => {
  const today = cairoToday();
  const [hour, minute] = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date()).split(':').map(Number);
  const minutesNow = hour * 60 + minute;
  const open = isTradingDay(today) && minutesNow >= 10 * 60 && minutesNow < 14 * 60 + 30;
  res.json({ open, asOf: today });
});

// Membership lists for EGX's four headline indices, so the market scan can be
// filtered to one instead of always scanning the whole tracked universe. See
// src/config/indices.js for sourcing and its accuracy caveats.
app.get('/api/indices', wrap(async (_req, res) => {
  res.json({ indices: await effectiveIndices(), asOf: INDICES_AS_OF });
}));

// TradingView carries a real live feed for each headline index itself (not
// just its constituents) under these EGX symbols — found via their symbol
// search, confirmed to return live price/change/changePct the same way a
// stock quote does. Using these instead of averaging constituents' changePct
// gives the actual official index level and point change rather than an
// approximation, and covers EGX70/EGX33/EGX100 (previously index-level data
// only existed for EGX30, via Yahoo's ^CASE30).
const INDEX_SYMBOLS = { EGX30: 'EGX30', EGX70: 'EGX70EWI', EGX33: 'SHARIAH', EGX100: 'EGX100EWI' };

/**
 * Today's behavior for each of EGX's four headline indices, plus the best
 * and worst constituent of the day — for the desk's "Indices" tab.
 */
app.get('/api/indices/performance', wrap(async (_req, res) => {
  const membership = await effectiveIndices();
  const names = Object.keys(membership);
  const allCodes = [...new Set(names.flatMap((name) => membership[name] ?? []))];
  const quotes = await fetchLatestQuotes([...allCodes, ...Object.values(INDEX_SYMBOLS)]);

  const indices = names.map((name) => {
    const rows = (membership[name] ?? [])
      .map((code) => {
        const quote = quotes.get(code);
        if (!quote || !Number.isFinite(quote.changePct)) return null;
        return { code, name: lookup(code)?.ar || lookup(code)?.en || code, price: quote.price, changePct: quote.changePct };
      })
      .filter(Boolean);
    const avgChangePct = rows.length
      ? +(rows.reduce((sum, r) => sum + r.changePct, 0) / rows.length).toFixed(2)
      : null;
    const best = rows.length ? rows.reduce((a, b) => (b.changePct > a.changePct ? b : a)) : null;
    const worst = rows.length ? rows.reduce((a, b) => (b.changePct < a.changePct ? b : a)) : null;
    const index = quotes.get(INDEX_SYMBOLS[name]);
    return {
      name,
      changePct: index?.changePct ?? avgChangePct,
      changePoints: index?.change ?? null,
      avgChangePct,
      spotValue: index?.price ?? null,
      constituentCount: (membership[name] ?? []).length,
      quotedCount: rows.length,
      best,
      worst,
    };
  });

  res.json({ asOf: new Date().toISOString(), indices });
}));

// ---- Admin ------------------------------------------------------------------

app.use('/api/admin', (req, res, next) => {
  if (!req.user?.isAdmin) return res.status(403).json({ error: 'للمشرفين فقط' });
  next();
});

const TICKER_HEADERS = ['TICKER', 'CODE', 'SYMBOL', 'REUTERS CODE', 'RIC'];
const NAME_HEADERS = ['COMPANY NAME', 'NAME', 'COMPANY'];

/** "REUTERS_CODE" / "SYMB_NAME_ENG" -> "REUTERS CODE" / "SYMB NAME ENG" — exports vary between spaces and underscores for the same header. */
const normalizeHeader = (cell) => cell.replace(/[_.]+/g, ' ').replace(/\s+/g, ' ').trim();

/** True if `buffer` starts with an Excel file's magic bytes — ZIP (.xlsx/.xlsm) or OLE compound (.xls). */
function looksLikeSpreadsheet(buffer) {
  if (buffer.length < 4) return false;
  const zip = buffer[0] === 0x50 && buffer[1] === 0x4b; // "PK"
  const ole = buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
  return zip || ole;
}

/**
 * True if a ".xls" is actually an HTML table wearing an Excel extension — a
 * common trick for server-rendered exports (EGX's own "current index
 * constituents" download is exactly this: an ASP.NET GridView dumped to
 * <table> markup). SheetJS mis-sniffs these as old-style Excel XML and
 * throws, so they need their own path.
 */
function looksLikeHtmlTable(buffer) {
  return /<html|<table/i.test(buffer.subarray(0, 1024).toString('utf8'));
}

const HTML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", apos: "'", nbsp: ' ' };
const decodeEntities = (s) => s.replace(/&(#39|amp|lt|gt|quot|apos|nbsp);/g, (_, name) => HTML_ENTITIES[name]);
const stripTags = (s) => decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

/** Pulls every <tr> in the document into an array of cell strings, from its <th>/<td> children. */
function htmlTableToRows(html) {
  const rows = [];
  for (const rowMatch of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((m) => stripTags(m[1]));
    if (cells.length) rows.push(cells);
  }
  return rows;
}

/** Splits an admin-uploaded file into rows of cell strings — CSV by comma, .xls/.xlsx via SheetJS, HTML-table exports via a plain regex scan. */
function fileToRows(buffer) {
  if (looksLikeSpreadsheet(buffer)) {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' })
      .map((cells) => cells.map((cell) => String(cell ?? '').trim()));
  }
  if (looksLikeHtmlTable(buffer)) return htmlTableToRows(buffer.toString('utf8'));
  return buffer.toString('utf8')
    .split(/\r?\n/)
    .map((line) => line.split(',').map((cell) => cell.trim().replace(/^["']|["']$/g, '')));
}

/**
 * Extracts {code, name} pairs from an admin-uploaded ticker list — CSV,
 * Excel (.xls/.xlsx), or an HTML-table export saved with a ".xls" extension,
 * sniffed from the file's own bytes rather than trusted headers. If the
 * header row names a ticker column (Ticker/Code/Symbol/
 * "Reuters Code"/RIC), only that column is read as the code — some exports
 * (e.g. EGX's own Reuters-code lists) put an ISIN first and the actual
 * ticker in a later column. With no recognizable header, falls back to the
 * first column (plain one-ticker-per-line files), and the code doubles as
 * the name. Strips the ".CA" Reuters Instrument Code suffix EGX tickers are
 * commonly exported with (e.g. "COMI.CA" -> "COMI"), and drops anything
 * that doesn't look like a plausible ticker.
 */
function parseTickerFile(buffer) {
  const rows = fileToRows(buffer).filter((cells) => cells.some((cell) => cell));
  if (!rows.length) return [];

  const headerRow = rows[0].map((cell) => normalizeHeader(cell.toUpperCase()));
  const codeColumn = headerRow.findIndex((cell) => TICKER_HEADERS.includes(cell));
  // A plain NAME_HEADERS match, or — for exports like "SYMB_NAME_ENG"/"SYMB_NAME_ARB"
  // that qualify the column rather than just naming it — any header with "NAME" as
  // one of its words. Safe as a broader check here (unlike the ticker column) since
  // nothing but an actual name column has that word.
  const nameColumn = headerRow.findIndex((cell) => NAME_HEADERS.includes(cell) || cell.split(' ').includes('NAME'));
  const dataRows = codeColumn >= 0 ? rows.slice(1) : rows;
  const index = codeColumn >= 0 ? codeColumn : 0;

  const seen = new Map(); // code -> name
  for (const cells of dataRows) {
    const token = cells[index]?.toUpperCase().replace(/\.CA$/, '');
    if (!token || TICKER_HEADERS.includes(token) || !/^[A-Z0-9]{2,10}$/.test(token)) continue;
    if (!seen.has(token)) seen.set(token, (nameColumn >= 0 ? cells[nameColumn] : null) || token);
  }
  return [...seen.entries()].map(([code, name]) => ({ code, name }));
}

app.get('/api/admin/indices', wrap(async (req, res) => {
  const overrides = await getAllIndexOverrides();
  const indices = await Promise.all(UPLOADABLE_INDICES.map(async (name) => {
    const override = overrides[name];
    const codes = await codesForIndex(name);
    // The company name so the admin UI can show more than a bare code, and
    // so a search can match on it too — pulled from the live universe
    // (verified entries and admin-registered custom stocks alike), not from
    // whatever an upload's own name column happened to say.
    const tickers = codes.map((code) => ({ code, name: lookup(code)?.ar || lookup(code)?.en || code }));
    return {
      name,
      tickers,
      count: tickers.length,
      source: override ? 'upload' : 'default',
      updatedAt: override?.updatedAt ?? null,
      updatedBy: override?.updatedBy ?? null,
    };
  }));
  res.json({ indices });
}));

app.post('/api/admin/indices/:name', express.raw({ type: '*/*', limit: '256kb' }), wrap(async (req, res) => {
  const name = String(req.params.name).toUpperCase();
  if (!UPLOADABLE_INDICES.includes(name)) return res.status(400).json({ error: `مؤشر غير قابل للرفع: ${name}` });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'ارفع ملف CSV أو Excel أولاً' });

  let entries;
  try {
    entries = parseTickerFile(req.body);
  } catch {
    return res.status(400).json({ error: 'تعذرت قراءة الملف — تأكد إنه CSV أو Excel صالح' });
  }
  if (!entries.length) return res.status(400).json({ error: 'الملف فاضي أو مفيهوش أكواد صحيحة' });

  // A ticker the CSV names that isn't already tracked becomes a real,
  // analyzable stock rather than being dropped — the uploaded file is the
  // source of truth for this index, not a subset of what config/universe.js
  // happened to ship with. See registerCustomStocks() for what such a stock
  // is missing relative to a generated one (sector, shariah screening, a
  // verified price feed).
  const known = new Set(ALL_CODES);
  const newEntries = entries.filter((e) => !known.has(e.code));
  if (newEntries.length) {
    await addCustomStocks(newEntries, req.user.id);
    registerCustomStocks(newEntries);
  }

  const tickers = entries.map((e) => e.code);
  await setIndexOverride(name, tickers, req.user.id);
  res.json({ ok: true, name, saved: tickers.length, added: newEntries.map((e) => e.code) });
}));

app.post('/api/admin/indices/:name/reset', wrap(async (req, res) => {
  const name = String(req.params.name).toUpperCase();
  if (!UPLOADABLE_INDICES.includes(name)) return res.status(400).json({ error: `مؤشر غير قابل للرفع: ${name}` });
  await clearIndexOverride(name);
  res.json({ ok: true, name, tickers: await codesForIndex(name) });
}));

// Every registered user plus a summary of their portfolio (cash, positions,
// watchlist, trades) for the admin users list. Trades are trimmed to the
// fields frontend/src/lib/invest-style.ts's inferInvestStyle() needs, rather
// than duplicating that FIFO-matching logic on the server.
app.get('/api/admin/users', wrap(async (req, res) => {
  const [users, portfolios, subscriptions] = await Promise.all([
    getAllUsers(),
    getAllPortfolios(),
    getAllSubscriptions(),
  ]);
  const portfolioByUser = new Map(portfolios.map((row) => [row.user_id, row.state_json]));
  const subscriptionByUser = new Map(subscriptions.map((row) => [row.user_id, row]));

  const rows = users.map((u) => {
    const pf = portfolioByUser.get(u.id);
    const positions = pf ? Object.values(pf.positions ?? {}) : [];
    const subscription = subscriptionByUser.get(u.id);
    const trial = trialInfo({ createdAt: u.created_at });
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      phone: u.phone,
      isAdmin: u.is_admin,
      emailVerified: u.email_verified,
      googleLinked: Boolean(u.google_id),
      createdAt: u.created_at,
      lastLoginAt: u.last_login_at,
      trialActive: trial.trialActive,
      trialEndsAt: trial.trialEndsAt.toISOString(),
      subscription: subscription && {
        plan: subscription.plan,
        currentPeriodEnd: subscription.current_period_end,
        active: new Date(subscription.current_period_end).getTime() > Date.now(),
        note: subscription.note,
        updatedAt: subscription.updated_at,
      },
      portfolio: pf && {
        cash: pf.cash ?? 0,
        positionsCount: positions.length,
        positionsValue: positions.reduce((sum, p) => sum + (p.shares ?? 0) * (p.avgCost ?? 0), 0),
        watchlistCount: Object.keys(pf.watchlist ?? {}).length,
        tradesCount: (pf.trades ?? []).length,
        realizedPnl: pf.realizedPnl ?? 0,
        updatedAt: pf.updatedAt ?? null,
        trades: (pf.trades ?? []).map((t) => ({ date: t.date, code: t.code, side: t.side, shares: t.shares })),
      },
    };
  });
  res.json({ users: rows });
}));

// Turns a user premium after their InstaPay transfer lands. This is the only
// thing in the app that grants paid access — there is no gateway and no
// self-serve checkout, so an admin doing this by hand is the whole billing
// flow. `plan` is monthly/yearly for a standard period, or 'custom' with an
// explicit endsAt for anything else (a gift period, a goodwill extension, or
// correcting a mistake). Standard periods are measured from periodStartFor(),
// so activating someone mid-trial doesn't cost them their remaining trial days.
app.post('/api/admin/users/:id/subscription', wrap(async (req, res) => {
  const target = await getUserById(req.params.id);
  if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });

  const requested = String(req.body?.plan ?? '');
  const plan = planFor(requested);
  let currentPeriodEnd;
  if (plan) {
    currentPeriodEnd = addMonths(await periodStartFor(target.id), plan.months);
  } else if (requested === 'custom') {
    currentPeriodEnd = new Date(String(req.body?.endsAt ?? ''));
    if (Number.isNaN(currentPeriodEnd.getTime())) return res.status(400).json({ error: 'اكتب تاريخ انتهاء صحيح' });
    if (currentPeriodEnd.getTime() <= Date.now()) return res.status(400).json({ error: 'تاريخ الانتهاء لازم يكون في المستقبل' });
  } else {
    return res.status(400).json({ error: 'اختر باقة صحيحة' });
  }

  const amountEgp = req.body?.amountEgp == null ? (plan?.priceEgp ?? null) : Number(req.body.amountEgp);
  if (amountEgp != null && !Number.isFinite(amountEgp)) return res.status(400).json({ error: 'المبلغ غير صحيح' });
  const reference = String(req.body?.reference ?? '').trim().slice(0, 200) || null;
  const note = String(req.body?.note ?? '').trim().slice(0, 500) || null;

  await putSubscription({
    userId: target.id,
    plan: plan?.key ?? 'custom',
    currentPeriodEnd: currentPeriodEnd.toISOString(),
    grantedBy: req.user.id,
    note,
  });
  await recordSubscriptionGrant({
    userId: target.id,
    plan: plan?.key ?? 'custom',
    periodEnd: currentPeriodEnd.toISOString(),
    amountEgp,
    reference,
    note,
    action: 'grant',
    grantedBy: req.user.id,
  });
  res.json({ ok: true, subscription: { plan: plan?.key ?? 'custom', currentPeriodEnd: currentPeriodEnd.toISOString(), active: true } });
}));

// Ends paid access now — a refund, a chargeback, or an activation entered
// against the wrong account. The grant history survives (see the
// subscription_grants comment in supabase/schema.sql).
app.delete('/api/admin/users/:id/subscription', wrap(async (req, res) => {
  const existing = await getSubscription(req.params.id);
  if (!existing) return res.status(404).json({ error: 'مفيش اشتراك للمستخدم ده' });
  await deleteSubscription(req.params.id);
  await recordSubscriptionGrant({
    userId: req.params.id,
    plan: existing.plan,
    periodEnd: existing.current_period_end,
    note: String(req.body?.note ?? '').trim().slice(0, 500) || null,
    action: 'revoke',
    grantedBy: req.user.id,
  });
  res.json({ ok: true });
}));

// Permanently deletes an account and everything hanging off it (see
// deleteUser in db.js). Admin accounts can't be deleted from here — admin
// status is granted via ADMIN_EMAILS, so removing one should be deliberate,
// and it also rules out an admin deleting themselves mid-session.
app.delete('/api/admin/users/:id', wrap(async (req, res) => {
  const target = await getUserById(req.params.id);
  if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
  if (target.is_admin || target.id === req.user.id || target.id === 'local') {
    return res.status(400).json({ error: 'مينفعش تحذف حساب مشرف' });
  }
  await removeSupportImagesFor(target.id);
  await deleteUser(target.id);
  res.json({ ok: true });
}));

/** Activation history for one user — what to check when a payment is disputed or entered twice. */
app.get('/api/admin/users/:id/subscription', wrap(async (req, res) => {
  const grants = await listSubscriptionGrants(req.params.id);
  res.json({
    grants: grants.map((g) => ({
      id: g.id,
      plan: g.plan,
      action: g.action,
      periodEnd: g.period_end,
      amountEgp: g.amount_egp,
      reference: g.reference,
      note: g.note,
      createdAt: g.created_at,
    })),
  });
}));

// The admin inbox: one entry per user who has ever written in, newest
// activity first, with the unread count that drives the tab's badge.
app.get('/api/admin/support', wrap(async (req, res) => {
  const [messages, users] = await Promise.all([listRecentSupportMessages(), getAllUsers()]);
  const userById = new Map(users.map((u) => [u.id, u]));

  const threads = new Map();
  // listRecentSupportMessages is newest-first, so the first row seen for a
  // user is that thread's latest message.
  for (const message of messages) {
    let thread = threads.get(message.user_id);
    if (!thread) {
      const user = userById.get(message.user_id);
      thread = {
        userId: message.user_id,
        email: user?.email ?? message.user_id,
        name: user?.name ?? '',
        lastMessage: message.body || (message.image_path ? '📷 صورة' : ''),
        lastSender: message.sender,
        lastAt: message.created_at,
        unread: 0,
      };
      threads.set(message.user_id, thread);
    }
    if (message.sender === 'user' && !message.read_at) thread.unread += 1;
  }

  res.json({ threads: [...threads.values()] });
}));

app.get('/api/admin/support/:userId', wrap(async (req, res) => {
  const messages = await listSupportMessages(req.params.userId);
  if (messages.some((m) => m.sender === 'user' && !m.read_at)) {
    await markSupportMessagesRead(req.params.userId, 'user');
  }
  res.json({ messages: await withImageUrls(messages) });
}));

app.post('/api/admin/support/:userId', wrap(async (req, res) => {
  const body = String(req.body?.body ?? '').trim();
  if (!body) return res.status(400).json({ error: 'اكتب الرد الأول' });
  if (body.length > MAX_MESSAGE_LENGTH) {
    return res.status(400).json({ error: `الرسالة طويلة أوي (الحد ${MAX_MESSAGE_LENGTH} حرف)` });
  }
  const target = await getUserById(req.params.userId);
  if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });

  const message = await insertSupportMessage({
    userId: target.id,
    sender: 'admin',
    body,
    sentBy: req.user.id,
  });
  res.status(201).json({ message: publicMessage(message) });
}));

// Drafts (and everything else generated) waiting on human review before they
// can reach /api/blog — see src/agent/blogGenerator.js for how they're
// written and reviewBlogPost's notes for what the review model flagged.
app.get('/api/admin/blog-drafts', wrap(async (req, res) => {
  const status = ['draft', 'approved', 'rejected', 'published'].includes(req.query.status) ? req.query.status : 'draft';
  const posts = await listBlogPosts({ status, limit: 50 });
  res.json({
    posts: posts.map((p) => ({
      id: p.id,
      batchIndex: p.batch_index,
      postDate: p.post_date,
      slug: p.slug,
      primaryKeyword: p.primary_keyword,
      secondaryKeywords: p.secondary_keywords,
      title: p.title,
      metaDescription: p.meta_description,
      dek: p.dek,
      content: p.content_json,
      tags: p.tags,
      sources: p.sources_json,
      image: p.image_json,
      imageUrl: p.image_url,
      imageSourceUrl: p.image_source_url,
      imageCreditName: p.image_credit_name,
      imageCreditUrl: p.image_credit_url,
      status: p.status,
      generationModel: p.generation_model,
      reviewModel: p.review_model,
      review: p.review_json,
      generatedAt: p.generated_at,
      publishedAt: p.published_at,
    })),
  });
}));

app.post('/api/admin/blog-drafts/:id/approve', wrap(async (req, res) => {
  const post = await setBlogPostStatus(req.params.id, 'published', req.user.id);
  if (!post) return res.status(404).json({ error: 'المسودة غير موجودة' });
  res.json({ ok: true, post: { id: post.id, slug: post.slug, status: post.status } });
}));

app.post('/api/admin/blog-drafts/:id/reject', wrap(async (req, res) => {
  const post = await setBlogPostStatus(req.params.id, 'rejected');
  if (!post) return res.status(404).json({ error: 'المسودة غير موجودة' });
  res.json({ ok: true, post: { id: post.id, slug: post.slug, status: post.status } });
}));

// Pulls a published post back off /api/blog without deleting it — it re-enters the review queue as a draft.
app.post('/api/admin/blog-drafts/:id/unpublish', wrap(async (req, res) => {
  const post = await setBlogPostStatus(req.params.id, 'draft');
  if (!post) return res.status(404).json({ error: 'المقالة غير موجودة' });
  res.json({ ok: true, post: { id: post.id, slug: post.slug, status: post.status } });
}));

app.patch('/api/admin/blog-drafts/:id', wrap(async (req, res) => {
  const { title, dek, metaDescription, content, tags } = req.body ?? {};
  if (title !== undefined && typeof title !== 'string') return res.status(400).json({ error: 'العنوان لازم يكون نص' });
  if (dek !== undefined && dek !== null && typeof dek !== 'string') return res.status(400).json({ error: 'المقدمة لازم تكون نص' });
  if (metaDescription !== undefined && typeof metaDescription !== 'string') return res.status(400).json({ error: 'الوصف التعريفي لازم يكون نص' });
  if (content !== undefined && !Array.isArray(content)) return res.status(400).json({ error: 'المحتوى لازم يكون قائمة فقرات' });
  if (tags !== undefined && !Array.isArray(tags)) return res.status(400).json({ error: 'الوسوم لازم تكون قائمة' });
  const post = await updateBlogPost(req.params.id, { title, dek, metaDescription, content, tags });
  if (!post) return res.status(404).json({ error: 'المقالة غير موجودة' });
  res.json({ ok: true, post: { id: post.id, slug: post.slug, status: post.status } });
}));

app.delete('/api/admin/blog-drafts/:id', wrap(async (req, res) => {
  const deleted = await deleteBlogPost(req.params.id);
  if (!deleted) return res.status(404).json({ error: 'المقالة غير موجودة' });
  res.json({ ok: true });
}));

// ---- Analysis --------------------------------------------------------------

app.get('/api/analyze/:code', wrap(async (req, res) => {
  const portfolio = await loadPortfolio(req.user.id);
  const code = req.params.code.toUpperCase();
  const analysis = await analyzeTicker(code, {
    position: portfolio.positions[code] ?? null,
    capital: capitalOf(portfolio) || 1_000_000,
    force: req.query.force === '1',
  });
  const live = (await fetchLatestQuotes([code])).get(code);
  if (live && analysis.snapshot?.price) {
    analysis.snapshot.price = {
      ...analysis.snapshot.price,
      dailyClose: analysis.snapshot.price.close,
      close: live.price,
      changePct: live.changePct ?? analysis.snapshot.price.changePct,
      lastTradePrice: live.price,
      lastTradeTime: live.time,
    };
  }
  res.status(analysis.usable ? 200 : 422).json(analysis);
}));

app.get('/api/quotes', wrap(async (req, res) => {
  const portfolio = await loadPortfolio(req.user.id);
  const requested = req.query.codes
    ? String(req.query.codes).split(',').map((code) => code.trim().toUpperCase()).filter(Boolean)
    : Object.keys(portfolio.positions);
  const quotes = await fetchLatestQuotes(requested);
  res.json({ asOf: new Date().toISOString(), quotes: Object.fromEntries(quotes) });
}));

// "تحليل الكاش" (focus=cash, see market-dialog.tsx) is capped to this many
// uses for the life of the free trial — once a subscription is active (or
// for admin/local accounts) it's unlimited, same as every other /api/scan
// use. The cap counts how many times the feature is opened, never which
// index or how many stocks a given scan covers, so every use still analyzes
// the full universe like any other scan: the market-dialog UI re-issues this
// same request as the user flips between index tabs or invest styles while
// the dialog stays open, and all of those belong to the one "time" that
// opened it. A request within CASH_SCAN_SESSION_WINDOW_MS of the account's
// last recorded use is treated as such a continuation and never charged —
// only a request arriving after that gap spends a new use. Recorded as one
// ISO timestamp per charged use in portfolio.cashScans rather than a DB
// table, so the check-then-write race is closed by withPortfolio's existing
// per-user write lock — the same pattern the screenshot-import cap (below)
// uses.
const CASH_SCAN_TRIAL_LIMIT = Math.max(0, Math.floor(Number(process.env.CASH_SCAN_TRIAL_LIMIT ?? 2)) || 0);
const CASH_SCAN_SESSION_WINDOW_MS = 10 * 60 * 1000;
const CASH_SCAN_LIMIT_MESSAGE = `خلصت محاولات تحليل الكاش المتاحة في فترة التجربة (${CASH_SCAN_TRIAL_LIMIT}) — بيبقى بلا حدود بعد الاشتراك.`;
function cashScansLeft(portfolio) {
  return Math.max(0, CASH_SCAN_TRIAL_LIMIT - (portfolio.cashScans ?? []).length);
}
function withinCashScanSession(portfolio) {
  const last = (portfolio.cashScans ?? []).at(-1);
  return Boolean(last) && Date.now() - Date.parse(last) < CASH_SCAN_SESSION_WINDOW_MS;
}

app.get('/api/scan', wrap(async (req, res) => {
  const portfolio = await loadPortfolio(req.user.id);

  let cashScansLeftNow = null;
  if (req.query.focus === 'cash') {
    const exempt = Boolean(req.user.isAdmin) || req.user.id === 'local' || Boolean(req.access?.subscriptionActive);
    if (!exempt) {
      if (withinCashScanSession(portfolio)) {
        cashScansLeftNow = cashScansLeft(portfolio);
      } else {
        // Checked before the (still non-trivial, whole-universe) analysis
        // runs, so an exhausted allowance costs nothing.
        if (cashScansLeft(portfolio) <= 0) {
          return res.status(429).json({ error: CASH_SCAN_LIMIT_MESSAGE, reason: 'cash_scan_limit', cashScansLeft: 0 });
        }
        // Re-checked under the lock: parallel requests can all pass the read
        // above before any of them has recorded a use, and a request that
        // lands a moment after another one just opened a new session must
        // join it rather than spend a second one.
        const updated = await withPortfolio(req.user.id, (p) => {
          if (withinCashScanSession(p)) return p;
          if (cashScansLeft(p) <= 0) throw new Error(CASH_SCAN_LIMIT_MESSAGE);
          return { ...p, cashScans: [...(p.cashScans ?? []), new Date().toISOString()] };
        });
        cashScansLeftNow = cashScansLeft(updated);
      }
    }
  }

  const indexCodes = req.query.index ? await codesForIndex(req.query.index) : null;
  if (req.query.index && !indexCodes) return res.status(400).json({ error: `مؤشر غير معروف: ${req.query.index}` });
  const codes = req.query.codes
    ? String(req.query.codes).split(',').map((s) => s.trim().toUpperCase())
    : indexCodes ?? ALL_CODES;
  const style = req.query.style;
  if (style && !STYLE_KEYS.includes(style)) return res.status(400).json({ error: `أسلوب غير معروف: ${style}` });

  // A style changes which rule numbers the engine sizes and gates setups
  // with — same deterministic engine, different risk/reward and sizing
  // inputs, exactly like every other `rules` param it already accepts.
  const rules = style ? rulesForStyle(RULES, style) : RULES;
  const capital = capitalOf(portfolio) || 1_000_000;
  const { results, errors } = await analyzeMany(codes, {
    capital,
    positions: portfolio.positions,
    concurrency: 5,
    force: req.query.force === '1',
    rules,
  });
  const latestQuotes = await fetchLatestQuotes(results.map((result) => result.code));

  // analyzeTicker sizes each stock in isolation — it has no visibility into
  // sibling results, so it always sizes as if the sector were untouched. Once
  // the whole book is known, correct sizing for every candidate against the
  // sector exposure the held positions actually carry, so a sector already at
  // or near its limit stops producing cash-plan recommendations (sizing to
  // zero, which the existing worthIt/shares>0 filters below already exclude).
  const sectorExposureEgp = {};
  for (const r of results) {
    if (!r.position || !r.sectorAr) continue;
    sectorExposureEgp[r.sectorAr] = (sectorExposureEgp[r.sectorAr] ?? 0) + (r.position.marketValue ?? 0);
  }
  for (const r of results) {
    if (r.position || !r.plan.stop.stop || !r.plan.suggestedEntry) continue;
    r.plan.sizing = positionSize(
      {
        capital,
        entry: r.plan.suggestedEntry,
        stop: r.plan.stop.stop,
        avgTurnoverEgp: r.snapshot.volume.avgTurnoverEgp,
        sectorExposureEgp: sectorExposureEgp[r.sectorAr] ?? 0,
      },
      rules,
    );
  }

  const actionable = results.filter((r) => r.plan.actionable && r.plan.buyingNow.worthIt && r.technical.score >= 58);
  const cashReserve = Math.max(0, portfolio.cash * (rules.sizing.minCashBufferPct / 100));
  const investableCash = Math.max(0, portfolio.cash - cashReserve);
  // How many names the cash plan should spread across is a function of how
  // much there actually is to deploy, not a fixed count: too few stocks for
  // a large balance leaves most of it idle behind the per-position cap, and
  // too many for a small balance slices each ticket down to nothing.
  const MAX_RECOMMENDATIONS = 6;
  const MIN_TICKET_EGP = 5000;
  const maxPositionEgp = capital * (rules.sizing.maxPositionPct / 100);
  const maxRecommendations = investableCash <= 0
    // Nothing to deploy — still surface a few honest "no cash" reasons below
    // instead of an empty screen.
    ? 3
    : Math.max(1, Math.min(
      MAX_RECOMMENDATIONS,
      maxPositionEgp > 0 ? Math.ceil(investableCash / maxPositionEgp) : MAX_RECOMMENDATIONS,
      Math.max(1, Math.floor(investableCash / MIN_TICKET_EGP)),
    ));
  const candidates = results
    .filter((r) => !r.position && r.plan.actionable && r.plan.buyingNow.worthIt && r.plan.targets.mid?.price && (r.plan.sizing?.shares ?? 0) > 0)
    .map((r) => ({
      code: r.code,
      sector: r.sectorAr,
      rankScore: r.technical.score + Math.min(r.plan.buyingNow.riskReward ?? 0, 5) * 4 - r.plan.stop.riskPct * 1.5,
    }))
    .sort((a, b) => b.rankScore - a.rankScore);
  const selected = [];
  const sectors = new Set();
  for (const candidate of candidates) {
    if (selected.length >= maxRecommendations) break;
    if (candidate.sector && sectors.has(candidate.sector)) continue;
    selected.push(candidate);
    if (candidate.sector) sectors.add(candidate.sector);
  }
  for (const candidate of candidates) {
    if (selected.length >= maxRecommendations || selected.some((item) => item.code === candidate.code)) continue;
    selected.push(candidate);
  }
  const allocationPerStock = selected.length ? investableCash / selected.length : 0;
  const selectedCodes = new Set(selected.map((candidate) => candidate.code));

  // Split the investable cash across the selected names by conviction and
  // price, not evenly: a stronger setup (rankScore — the same technical
  // score, risk/reward and stop-risk blend used to rank and pick candidates)
  // gets proportionally more of the pool, and a name whose own price would
  // turn its share into less than one share is dropped from this round
  // rather than funded into a position too small to exist. Both checks
  // water-fill: cash freed either way goes to the names still standing,
  // weighted by their own score among what's left, instead of sitting
  // unallocated.
  const resultByCode = new Map(results.map((r) => [r.code, r]));
  const allocationByCode = new Map();
  {
    let remainingCash = investableCash;
    let pool = selected.map((candidate) => {
      const r = resultByCode.get(candidate.code);
      const entry = r?.plan.suggestedEntry ?? 0;
      return {
        code: candidate.code,
        weight: Math.max(1, candidate.rankScore),
        entry,
        riskCapEgp: entry > 0 ? (r.plan.sizing?.shares ?? 0) * entry : Infinity,
      };
    });
    while (pool.length) {
      const totalWeight = pool.reduce((sum, c) => sum + c.weight, 0);
      const withShares = pool.map((c) => ({ ...c, idealShare: totalWeight > 0 ? (remainingCash * c.weight) / totalWeight : 0 }));
      const capped = withShares.filter((c) => c.riskCapEgp < c.idealShare);
      const tooSmall = withShares.filter((c) => c.riskCapEgp >= c.idealShare && c.entry > 0 && c.idealShare < c.entry);
      if (!capped.length && !tooSmall.length) {
        for (const c of withShares) allocationByCode.set(c.code, c.idealShare);
        break;
      }
      for (const c of capped) {
        allocationByCode.set(c.code, c.riskCapEgp);
        remainingCash -= c.riskCapEgp;
      }
      for (const c of tooSmall) allocationByCode.set(c.code, 0);
      const settled = new Set([...capped, ...tooSmall].map((c) => c.code));
      pool = pool.filter((c) => !settled.has(c.code));
    }
  }
  let investedTotal = 0;
  res.json({
    asOf: results[0]?.asOf ?? null,
    count: results.length,
    cash: portfolio.cash,
    // Only set for focus=cash on a non-exempt account — null means either
    // this wasn't a cash scan, or the account has unlimited use.
    cashScansLeft: cashScansLeftNow,
    cashScanTrialLimit: CASH_SCAN_TRIAL_LIMIT,
    // A compact row per stock — the full analysis is one request away and far
    // too large to send 43 of.
    results: results.map((r) => {
      const live = latestQuotes.get(r.code);
      const livePrice = live?.price ?? r.snapshot.price.close;
      const entry = r.plan.suggestedEntry;
      const riskShares = r.plan.sizing?.shares ?? 0;
      const cashShares = entry > 0 ? Math.floor(Math.max(0, portfolio.cash) / entry) : 0;
      const cashPlanSelected = selectedCodes.has(r.code);
      const stockAllocation = allocationByCode.get(r.code) ?? 0;
      const allocationShares = entry > 0 ? Math.floor(stockAllocation / entry) : 0;
      const recommendedShares = cashPlanSelected ? Math.min(riskShares, allocationShares, cashShares) : 0;
      if (cashPlanSelected) investedTotal += recommendedShares * entry;
      const buyPlan = entry > 0 ? {
        entry,
        stop: r.plan.stop.stop,
        target: r.plan.targets.mid?.price ?? null,
        shares: recommendedShares,
        cost: +(recommendedShares * entry).toFixed(2),
        allocation: cashPlanSelected ? +stockAllocation.toFixed(2) : 0,
        cashAfter: +(portfolio.cash - recommendedShares * entry).toFixed(2),
        risk: +(recommendedShares * Math.max(0, entry - r.plan.stop.stop)).toFixed(2),
        riskLimitShares: riskShares,
        cashLimitShares: cashShares,
        reason: recommendedShares === 0
          ? (portfolio.cash <= 0 ? 'لا يوجد كاش متاح' : r.plan.sizing?.reason ?? 'لا يوجد حجم مناسب حسب قواعد المخاطرة')
          : `شراء ${recommendedShares} سهم عند ${entry} بأمر محدد؛ توزيع مرجّح حسب قوة الفرصة بين أفضل ${selected.length} أسهم مع احتياطي كاش ${rules.sizing.minCashBufferPct}%`,
      } : null;
      const position = r.position && live
        ? { ...r.position, marketValue: +(r.position.shares * livePrice).toFixed(2), unrealizedEgp: +(r.position.shares * (livePrice - r.position.avgCost)).toFixed(2) }
        : r.position;
      return ({
      code: r.code,
      name: r.name,
      sector: r.sectorAr,
      shariah: r.shariah,
      price: livePrice,
      lastTradePrice: live?.price ?? null,
      lastTradeTime: live?.time ?? null,
      changePct: live?.changePct ?? r.snapshot.price.changePct,
      score: r.technical.score,
      signal: r.technical.signal,
      trend: r.snapshot.trend,
      rsi: r.snapshot.momentum.rsi14,
      entryStatus: r.plan.entryStatus,
      suggestedEntry: r.plan.suggestedEntry,
      entryNote: r.plan.entryNote,
      stop: r.plan.stop.stop,
      riskPct: r.plan.stop.riskPct,
      midTarget: r.plan.targets.mid,
      longTarget: r.plan.targets.long,
      riskRewardNow: r.plan.buyingNow.riskReward,
      worthBuyingNow: r.plan.buyingNow.worthIt,
      buyPlan,
      cashPlanSelected,
      // Compact form — the full breakdown and reasons are one /api/analyze/:code
      // request away (see the DetailDialog), same tradeoff as the rest of this row.
      classification: r.classification && {
        type: r.classification.type,
        investmentScore: r.classification.investmentScore,
        speculationScore: r.classification.speculationScore,
        confidence: r.classification.confidence,
      },
      position,
    });
    }),
    actionableCodes: actionable.map((r) => r.code),
    focus: req.query.focus ?? 'market',
    style: style ?? 'medium',
    cashPlan: {
      selectedCodes: [...selectedCodes],
      investableCash: +investableCash.toFixed(2),
      reserveCash: +cashReserve.toFixed(2),
      allocationPerStock: +allocationPerStock.toFixed(2),
      unallocatedCash: +(investableCash - investedTotal).toFixed(2),
    },
    errors,
  });
}));

// ---- Portfolio -------------------------------------------------------------

app.get('/api/portfolio', wrap(async (req, res) => {
  const p = await loadPortfolio(req.user.id);
  res.json({
    ...p,
    capital: capitalOf(p),
    tracked: trackedCodes(p),
    screenshotImportsLeft: screenshotImportsLeft(p),
    screenshotImportsPerDay: SCREENSHOT_IMPORTS_PER_DAY,
    // Raw count against the trial cap — ignores subscription status (the
    // frontend already has user.subscriptionActive from /api/auth/me and
    // hides this once that's true, since a subscribed account is never
    // actually blocked by it).
    cashScansLeft: cashScansLeft(p),
    cashScanTrialLimit: CASH_SCAN_TRIAL_LIMIT,
  });
}));

app.post('/api/portfolio/trade', wrap(async (req, res) => {
  const { code, side, shares, price, date, note } = req.body ?? {};
  if (!code || !side || !shares || !price) {
    return res.status(400).json({ error: 'محتاج code و side و shares و price' });
  }
  const updated = await withPortfolio(req.user.id, (portfolio) =>
    recordTrade(portfolio, { code, side, shares: Number(shares), price: Number(price), date, note }),
  );
  res.json({ ...updated, capital: capitalOf(updated) });
}));

app.post('/api/portfolio/cash', wrap(async (req, res) => {
  const amount = Number(req.body?.cash);
  if (!Number.isFinite(amount) || amount < 0) return res.status(400).json({ error: 'مبلغ غير صالح' });
  const updated = await withPortfolio(req.user.id, (portfolio) => ({ ...portfolio, cash: amount }));
  res.json(updated);
}));

app.post('/api/portfolio/levels', wrap(async (req, res) => {
  const { code, stop, target } = req.body ?? {};
  const updated = await withPortfolio(req.user.id, (portfolio) =>
    setLevels(portfolio, code, { stop: stop == null ? null : Number(stop), target: target == null ? null : Number(target) }),
  );
  res.json(updated);
}));

/**
 * Correct a holding's share count / average cost by hand.
 *
 * Needed because a screenshot import can only ever infer a share count when the
 * quantity isn't legible on screen, and an inferred count silently replaced
 * explicitly recorded trades (a real 800-share VLMRA position was overwritten
 * with a derived 1223). This is the way back to the true numbers. Setting
 * either value clears the "estimated" flag — the user has now told us directly.
 */
app.post('/api/portfolio/holding', wrap(async (req, res) => {
  const { code, shares, avgCost } = req.body ?? {};
  if (!code) return res.status(400).json({ error: 'محتاج code' });
  const c = String(code).toUpperCase();

  const nextShares = shares == null || shares === '' ? null : Number(shares);
  const nextAvgCost = avgCost == null || avgCost === '' ? null : Number(avgCost);
  if (nextShares != null && (!Number.isFinite(nextShares) || nextShares < 0)) {
    return res.status(400).json({ error: 'عدد الأسهم لازم يكون رقم موجب' });
  }
  if (nextAvgCost != null && (!Number.isFinite(nextAvgCost) || nextAvgCost <= 0)) {
    return res.status(400).json({ error: 'متوسط الشراء لازم يكون أكبر من صفر' });
  }

  const updated = await withPortfolio(req.user.id, (portfolio) => {
    const existing = portfolio.positions[c];
    if (!existing) throw new Error(`مفيش مركز مفتوح في ${c}`);
    const positions = { ...portfolio.positions };

    // Zero shares means the position is closed out entirely.
    if (nextShares === 0) {
      delete positions[c];
      return { ...portfolio, positions };
    }

    const { derivedFromScreenshot, reportedValue, reportedPnl, ...rest } = existing;
    positions[c] = {
      ...rest,
      shares: nextShares ?? existing.shares,
      avgCost: nextAvgCost ?? existing.avgCost,
    };
    return { ...portfolio, positions };
  });
  res.json(updated);
}));

/** The user's favorite stocks — just codes to keep an eye on, no order plan attached. */
app.post('/api/portfolio/watchlist', wrap(async (req, res) => {
  const { code, note, remove } = req.body ?? {};
  if (!code) return res.status(400).json({ error: 'محتاج code' });
  const c = String(code).toUpperCase();
  const updated = await withPortfolio(req.user.id, (portfolio) => {
    const watchlist = { ...portfolio.watchlist };
    if (remove) delete watchlist[c];
    else watchlist[c] = { addedAt: watchlist[c]?.addedAt ?? new Date().toISOString(), note: note ?? null };
    return { ...portfolio, watchlist };
  });
  res.json(updated);
}));

/**
 * Snapshot one user's open positions into today's (or `date`'s) log entry.
 * Shared by the manual /api/snapshot endpoint and the daily-close cron below.
 */
async function snapshotForUser(userId, date = null) {
  return withPortfolio(userId, async (portfolio) => {
    const codes = Object.keys(portfolio.positions);
    const { results } = await analyzeMany(codes, { capital: capitalOf(portfolio), positions: portfolio.positions, concurrency: 5 });
    // analyzeMany's price comes from the last data *sync*, not from now — a
    // run mid-session (before that day's sync has run) would otherwise save
    // yesterday's cached close mislabeled as today's, disagreeing with the
    // live price the desk is showing at that exact moment. Patch in live
    // quotes the same way /api/scan and /api/analyze already do.
    const live = await fetchLatestQuotes(codes).catch(() => new Map());
    const withLivePrices = results.map((r) => {
      const quote = live.get(r.code);
      if (!quote?.price || !r.position) return r;
      const price = quote.price;
      return {
        ...r,
        snapshot: {
          ...r.snapshot,
          price: { ...r.snapshot.price, close: price, changePct: quote.changePct ?? r.snapshot.price.changePct },
        },
        position: {
          ...r.position,
          marketValue: +(r.position.shares * price).toFixed(2),
          unrealizedEgp: +(r.position.shares * (price - r.position.avgCost)).toFixed(2),
        },
      };
    });
    return recordSnapshot(portfolio, withLivePrices, date);
  });
}

/** Save today's close into the daily log — the calendar and charts read this. */
app.post('/api/snapshot', wrap(async (req, res) => {
  // Fast, unlocked check for the common "nothing to snapshot" case, so it
  // still returns 400 immediately rather than paying for a lock acquisition.
  const precheck = await loadPortfolio(req.user.id);
  if (!Object.keys(precheck.positions).length) return res.status(400).json({ error: 'مفيش مراكز مفتوحة تتسجّل' });

  const updated = await snapshotForUser(req.user.id, req.body?.date ?? null);
  const day = Object.keys(updated.log).sort().pop();
  res.json({ saved: day, entry: updated.log[day], days: Object.keys(updated.log).length });
}));

/**
 * Triggered daily by .github/workflows/daily-close-cron.yml over the VPS's
 * loopback interface — same pattern as /api/cron/blog-generate. GitHub
 * Actions cron is UTC-only and Cairo alternates between EET (UTC+2) and
 * EEST (UTC+3) across the year, so the workflow fires at both possible UTC
 * times for 14:30 Cairo and this endpoint no-ops unless it's actually close
 * to 14:30 in Cairo right now — that keeps the trigger correct across DST
 * without the workflow's cron schedule needing manual updates twice a year.
 * Snapshots every user with open positions, the same as each of them
 * clicking "سجّل إغلاق اليوم" used to. Skipped on Fridays, Saturdays and
 * EGX bank holidays — there's no session, so no close to record.
 */
const DAILY_CLOSE_CRON_SECRET = process.env.DAILY_CLOSE_CRON_SECRET;
app.post('/api/cron/daily-close', wrap(async (req, res) => {
  if (!DAILY_CLOSE_CRON_SECRET || req.get('X-Cron-Secret') !== DAILY_CLOSE_CRON_SECRET) {
    return res.status(403).json({ error: 'forbidden' });
  }
  const today = cairoToday();
  if (!isTradingDay(today)) {
    return res.json({ ok: true, skipped: 'not_a_trading_day', date: today });
  }
  const cairoNow = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Cairo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date());
  if (cairoNow < '14:20' || cairoNow > '14:40') {
    return res.json({ ok: true, skipped: true, cairoNow });
  }

  const portfolios = await getAllPortfolios();
  const userIds = portfolios
    .filter((row) => Object.keys(row.state_json?.positions ?? {}).length > 0)
    .map((row) => row.user_id);

  let saved = 0;
  let failed = 0;
  for (const userId of userIds) {
    try {
      await snapshotForUser(userId);
      saved += 1;
    } catch {
      failed += 1;
    }
  }
  res.json({ ok: true, cairoNow, total: userIds.length, saved, failed });
}));

/**
 * Backfill the daily log from real historical closes.
 *
 * A fresh install has no history, so the calendar and the equity curve have
 * nothing to draw. This reconstructs them from actual EGX closes valued against
 * the shares you hold TODAY — so it answers "what would this book have been
 * worth", not "what was my book worth". Entries are marked `reconstructed` and
 * never overwrite a real saved close.
 */
app.post('/api/log/backfill', wrap(async (req, res) => {
  const precheck = await loadPortfolio(req.user.id);
  const precheckCodes = Object.keys(precheck.positions);
  if (!precheckCodes.length) return res.status(400).json({ error: 'مفيش مراكز مفتوحة' });

  const days = Math.min(Math.max(Number(req.body?.days) || 60, 5), 250);

  // Historical bars are per-symbol disk reads, independent of portfolio state,
  // and reading them for every held code is the slow part of this endpoint —
  // done once here, outside the lock, so it never blocks other writes.
  const series = new Map();
  for (const code of precheckCodes) {
    const bars = (await readBars(code))?.bars ?? [];
    series.set(code, new Map(bars.slice(-days - 5).map((b) => [b.date, b.c])));
  }
  const dates = [...new Set([...series.values()].flatMap((m) => [...m.keys()]))].sort().slice(-days);

  let added = 0;
  let from = null;
  let to = null;

  const updated = await withPortfolio(req.user.id, (portfolio) => {
    const codes = Object.keys(portfolio.positions);
    const log = { ...(portfolio.log ?? {}) };
    let priorTotal = null;

    for (const date of dates) {
      let value = 0;
      const prices = {};
      let complete = true;
      for (const code of codes) {
        const px = series.get(code)?.get(date);
        // Skip days where any holding didn't trade — a partial valuation would
        // show as a phantom drop in the equity curve. Also skip a code that
        // was added to the portfolio after the bars above were read (opened
        // its own history was never fetched here).
        if (px == null) { complete = false; break; }
        prices[code] = px;
        value += portfolio.positions[code].shares * px;
      }
      if (!complete) continue;

      const total = value + portfolio.cash;
      if (!log[date]?.reconstructed && log[date]) { priorTotal = log[date].total; continue; }

      const cost = codes.reduce((a, c) => a + portfolio.positions[c].shares * portfolio.positions[c].avgCost, 0);
      log[date] = {
        date,
        total: +total.toFixed(2),
        positionsValue: +value.toFixed(2),
        cash: portfolio.cash,
        pl: +(value - cost).toFixed(2),
        dayChange: priorTotal == null ? 0 : +(total - priorTotal).toFixed(2),
        dayChangePct: priorTotal ? +(((total - priorTotal) / priorTotal) * 100).toFixed(2) : 0,
        prices,
        stops: {},
        recs: {},
        changes: [],
        note: log[date]?.note ?? null,
        reconstructed: true,
      };
      priorTotal = total;
      added++;
      from ??= date;
      to = date;
    }

    return { ...portfolio, log };
  });

  res.json({ added, days: Object.keys(updated.log).length, from, to });
}));

app.get('/api/log', wrap(async (req, res) => {
  const p = await loadPortfolio(req.user.id);
  res.json({ log: p.log ?? {}, days: Object.keys(p.log ?? {}).sort() });
}));

app.post('/api/log/note', wrap(async (req, res) => {
  const { date, note } = req.body ?? {};
  if (!date) return res.status(400).json({ error: 'محتاج date' });
  const updated = await withPortfolio(req.user.id, (portfolio) => setNote(portfolio, date, note ?? ''));
  res.json({ ok: true, entry: updated.log[date] });
}));

app.get('/api/settings', wrap(async (req, res) => {
  const p = await loadPortfolio(req.user.id);
  res.json({ settings: { ...RULES, ...(p.settings ?? {}) }, rules: RULES });
}));

app.post('/api/settings', wrap(async (req, res) => {
  const commissionPct = Number(req.body?.commissionPct);
  if (!Number.isFinite(commissionPct) || commissionPct < 0 || commissionPct > 5) {
    return res.status(400).json({ error: 'نسبة عمولة غير منطقية' });
  }
  const updated = await withPortfolio(req.user.id, (portfolio) => ({
    ...portfolio,
    settings: { ...(portfolio.settings ?? {}), commissionPct },
  }));
  res.json({ ok: true, settings: updated.settings });
}));

/** Wipe the log and trades, keeping positions. Destructive and irreversible. */
app.post('/api/reset', wrap(async (req, res) => {
  const scope = req.body?.scope ?? 'log';
  await withPortfolio(req.user.id, (portfolio) =>
    scope === 'all'
      // imports and cashScans survive the wipe: they're what the daily
      // screenshot cap and the trial cash-scan cap count, so dropping either
      // would hand out a fresh allowance on every reset.
      ? { cash: 0, positions: {}, watchlist: {}, trades: [], log: {}, settings: portfolio.settings, realizedPnl: 0, imports: portfolio.imports, cashScans: portfolio.cashScans }
      : { ...portfolio, log: {}, trades: [], realizedPnl: 0 },
  );
  res.json({ ok: true, scope });
}));

// ---- Portfolio screenshot import -----------------------------------------

const screenshotAliases = new Map([
  ['CIB', 'COMI'], ['COMMERCIAL INTERNATIONAL BANK', 'COMI'],
  ['TMG', 'TMGH'], ['TAQA ARABIA', 'TAQA'], ['CREDIT AGRICOLE', 'CIEB'],
  ['EFG HERMES', 'HRHO'], ['EFG-HERMES', 'HRHO'], ['MOBILENIL', 'ETEL'],
]);
const screenshotUniverseReference = UNIVERSE.map((stock) => `${stock.code}: ${stock.en}${stock.ar ? ` / ${stock.ar}` : ''}`).join('; ');

const normalizeScreenshotText = (value) => String(value ?? '')
  .normalize('NFKD')
  .replace(/[\u064B-\u065F\u0670]/g, '')
  .replace(/[‐‑‒–—]/g, '-')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim()
  .toUpperCase();

const numberFromScreenshot = (value) => {
  if (typeof value === 'number') return value;
  const arabicDigits = String(value ?? '').replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)));
  const cleaned = arabicDigits.replace(/[,،\s]/g, '').replace(/[^\d.-]/g, '');
  return cleaned ? Number(cleaned) : NaN;
};

function resolveScreenshotCode(item) {
  const raw = normalizeScreenshotText(item.code ?? item.symbol ?? item.ticker);
  const compact = raw.replace(/\s+/g, '').replace(/\.(CA|EGX)$/i, '').replace(/^EGX[:\-]/i, '');
  if (lookup(compact)) return compact;
  if (screenshotAliases.has(raw)) return screenshotAliases.get(raw);
  if (screenshotAliases.has(compact)) return screenshotAliases.get(compact);

  const nameText = normalizeScreenshotText(item.name ?? item.company ?? item.companyName);
  if (!nameText) return null;
  if (screenshotAliases.has(nameText)) return screenshotAliases.get(nameText);
  const match = UNIVERSE.find((stock) => [stock.en, stock.ar].some((name) => {
    const normalized = normalizeScreenshotText(name);
    return normalized && (normalized === nameText || normalized.includes(nameText) || nameText.includes(normalized));
  }));
  return match?.code ?? null;
}

// Every image is a vision-model call, so each account gets a daily allowance
// of successful imports, counted per Cairo day off portfolio.imports. That log
// keeps only its last 20 entries, which is why the cap can't exceed 20.
const SCREENSHOT_IMPORTS_PER_DAY = Math.min(20, Math.max(0, Math.floor(Number(process.env.SCREENSHOT_IMPORTS_PER_DAY ?? 5)) || 0));
const SCREENSHOT_LIMIT_MESSAGE = 'خلصت عدد صور المحفظة المسموح بيه النهارده — تقدر ترفع تاني بكرة، أو عدّل من «إدخال يدوي».';

function screenshotImportsLeft(portfolio) {
  const today = cairoToday();
  const used = (portfolio.imports ?? []).filter((entry) => {
    const at = Date.parse(entry?.importedAt);
    return entry?.source === 'screenshot' && Number.isFinite(at) && cairoDateOf(at) === today;
  }).length;
  return Math.max(0, SCREENSHOT_IMPORTS_PER_DAY - used);
}

app.post('/api/portfolio/import-screenshot', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '8mb' }), wrap(async (req, res) => {
  if (!aiAvailable()) return res.status(503).json({ error: 'استيراد الصورة محتاج OPENROUTER_API_KEY في .env' });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'ارفع صورة لمحفظتك أولاً' });
  // Checked before the model call so an exhausted allowance costs nothing.
  if (screenshotImportsLeft(await loadPortfolio(req.user.id)) <= 0) {
    return res.status(429).json({ error: SCREENSHOT_LIMIT_MESSAGE, reason: 'screenshot_limit', screenshotImportsLeft: 0 });
  }

  const mediaType = req.headers['content-type'];
  const response = await callWithRetry(() => getOpenRouterClient().chat.completions.create({
    model: SCREENSHOT_VISION_MODEL,
    max_tokens: 4000,
    messages: [
      { role: 'system', content: `You extract stock portfolio data from an image. Never guess a number that is not visible. Return JSON only, without markdown, using this shape: {"cash":number|null,"positions":[{"code":"EGX ticker or null","name":"company name as shown","shares":number|null,"marketValue":number|null,"profit":number|null,"returnPct":number|null,"avgCost":number|null,"lastPrice":number|null,"stop":number|null,"target":number|null}]}. If the ticker is not visible, write the company name as shown.

The single most valuable field is "shares" — the number of shares held (الكمية / عدد الأسهم / كمية). Look for it carefully, including in small print, a secondary line under the company name, or a detail row. A whole number sitting beside a company with no currency symbol is usually the quantity, not a price. Only use null for it if you genuinely cannot see it.

Nearly as valuable is a per-share price: "avgCost" (متوسط التكلفة / متوسط الشراء) and "lastPrice" (السعر الحالي / آخر سعر). These let the share count be recovered exactly from the same screen when quantity is missing, so extract them whenever visible.

Distinguish carefully: "marketValue" (القيمة السوقية) is the TOTAL value of the whole position, while avgCost/lastPrice are PER SHARE. Do not confuse the two. Use only these verified Alytic ticker/name references when identifying a stock: ${screenshotUniverseReference}. Use null when a number is not visible. Ignore numbers unrelated to holdings or cash.` },
      { role: 'user', content: [
        { type: 'image_url', image_url: { url: `data:${mediaType};base64,${req.body.toString('base64')}` } },
        { type: 'text', text: 'Extract the current holdings, share counts, average cost and cash from this image.' },
      ] },
    ],
  }));

  const text = (response.choices?.[0]?.message?.content ?? '').trim();
  let extracted;
  try {
    const cleaned = text.replace(/^```json\s*|\s*```$/g, '').trim();
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    const jsonText = start >= 0 && end > start ? cleaned.slice(start, end + 1) : cleaned;
    extracted = JSON.parse(jsonText);
  } catch {
    throw new Error('الصورة لم تعطِ بيانات محفظة قابلة للقراءة');
  }

  const extractedPositions = extracted.positions ?? extracted.holdings ?? extracted.stocks ?? [];
  const rows = Array.isArray(extractedPositions)
    ? extractedPositions
    : Object.entries(extractedPositions).map(([code, value]) => ({ ...(value && typeof value === 'object' ? value : { shares: value }), code }));
  // Resolve every row first so the live quotes below can be fetched in one
  // batch rather than a websocket round-trip per stock.
  const parsed = rows.map((item) => ({
    item,
    code: resolveScreenshotCode(item),
    marketValue: numberFromScreenshot(item.marketValue ?? item.value ?? item.currentValue ?? item.totalValue),
    profit: numberFromScreenshot(item.profit ?? item.pnl ?? item.gain ?? item.unrealizedPnl),
    rawAverageCost: numberFromScreenshot(item.avgCost ?? item.averageCost ?? item.cost),
    lastPrice: numberFromScreenshot(item.lastPrice ?? item.price ?? item.currentPrice),
    shares: numberFromScreenshot(item.shares ?? item.quantity ?? item.qty),
  }));

  // A broker screenshot values a holding at the LIVE price, not at yesterday's
  // close — so when a share count has to be back-solved from market value, the
  // live quote is the only divisor that reproduces the broker's own number.
  // Dividing by the cached daily close is what made every imported count wrong:
  // VLMRA showed 39,645 EGP against a real 1205 shares (a live 32.90), but the
  // cached 32.42 close turned that into 1223. A 1.5% price gap is a 1.5% share
  // error, and it compounds per stock with however far each one has moved.
  const needsLiveQuote = parsed
    .filter((p) => p.code && (!Number.isFinite(p.shares) || p.shares <= 0) && Number.isFinite(p.marketValue) && p.marketValue > 0)
    .map((p) => p.code);
  const liveQuotes = needsLiveQuote.length ? await fetchLatestQuotes(needsLiveQuote).catch(() => new Map()) : new Map();

  const positions = {};
  let derivedPositions = 0;
  for (const { item, code, marketValue, profit, rawAverageCost, lastPrice, shares: extractedShares } of parsed) {
    let shares = extractedShares;
    let derived = false;

    // Deriving a share count is a last resort, and *what it divides by* decides
    // whether the answer is arithmetic or a guess. Prices from the screenshot
    // itself are internally consistent with its own market value; a stale close
    // is not.
    if ((!Number.isFinite(shares) || shares <= 0) && code && Number.isFinite(marketValue) && marketValue > 0) {
      const costBasis = Number.isFinite(profit) ? marketValue - profit : NaN;
      const livePrice = liveQuotes.get(code)?.price;

      if (Number.isFinite(costBasis) && costBasis > 0 && Number.isFinite(rawAverageCost) && rawAverageCost > 0) {
        // Exact: all three inputs came off the same screen.
        shares = Math.max(1, Math.round(costBasis / rawAverageCost));
      } else if (Number.isFinite(lastPrice) && lastPrice > 0) {
        // Also screenshot-internal: market value against the price beside it.
        shares = Math.max(1, Math.round(marketValue / lastPrice));
      } else if (Number.isFinite(livePrice) && livePrice > 0) {
        // Live quote — matches what the broker was valuing the position at.
        // Still an inference, so it stays flagged for the user to confirm.
        shares = Math.max(1, Math.round(marketValue / livePrice));
        derived = true;
        derivedPositions++;
      } else {
        const cached = await readBars(code);
        const currentPrice = cached?.bars?.at(-1)?.c;
        if (Number.isFinite(currentPrice) && currentPrice > 0) {
          shares = Math.max(1, Math.round(marketValue / currentPrice));
          derived = true;
          derivedPositions++;
        }
      }
    }
    if (!code || !ALL_CODES.includes(code) || !Number.isFinite(shares) || shares <= 0) continue;
    const avgCost = Number.isFinite(rawAverageCost)
      ? rawAverageCost
      : Number.isFinite(profit) && Number.isFinite(marketValue) ? Math.max(0, (marketValue - profit) / shares) : 0;
    positions[code] = {
      shares,
      avgCost: +avgCost.toFixed(4),
      stop: Number.isFinite(numberFromScreenshot(item.stop)) ? numberFromScreenshot(item.stop) : null,
      target: Number.isFinite(numberFromScreenshot(item.target)) ? numberFromScreenshot(item.target) : null,
      openedAt: new Date().toISOString().slice(0, 10),
      ...(Number.isFinite(marketValue) ? { reportedValue: marketValue } : {}),
      ...(Number.isFinite(profit) ? { reportedPnl: profit } : {}),
      ...(derived ? { derivedFromScreenshot: true } : {}),
    };
  }
  if (!Object.keys(positions).length) throw new Error('اتقرت أكواد الأسهم، لكن الصورة لا تحتوي كمية أو قيمة مركز قابلة للحساب');

  const merge = req.query.merge === '1';
  const importedAt = new Date().toISOString();
  const cashFromScreenshot = numberFromScreenshot(extracted.cash);
  // Only the merge-and-save is locked. The AI extraction above can take
  // several seconds; holding the per-user write lock for that whole span
  // would block ordinary trades/cash edits for no reason, since none of it
  // touches portfolio state until this point.
  const updated = await withPortfolio(req.user.id, (portfolio) => {
    // Re-checked under the lock: parallel requests all pass the early check
    // while none of them has been recorded yet.
    if (screenshotImportsLeft(portfolio) <= 0) throw new Error(SCREENSHOT_LIMIT_MESSAGE);
    return {
      ...portfolio,
      positions: merge ? { ...portfolio.positions, ...positions } : positions,
      ...(Number.isFinite(cashFromScreenshot) && cashFromScreenshot >= 0 ? { cash: cashFromScreenshot } : {}),
      imports: [...(portfolio.imports ?? []), { importedAt, positions: Object.keys(positions), source: 'screenshot' }].slice(-20),
    };
  });
  res.json({
    ok: true,
    importedAt,
    positions: Object.keys(positions).length,
    derivedPositions,
    screenshotImportsLeft: screenshotImportsLeft(updated),
    portfolio: { ...updated, capital: capitalOf(updated) },
  });
}));

// ---- AI endpoints ----------------------------------------------------------

app.post('/api/review', wrap(async (req, res) => {
  if (!aiAvailable()) {
    return res.status(503).json({
      error: 'مفيش مفتاح API. حط OPENROUTER_API_KEY في .env — التحليل الفني شغال من غيره.',
      aiAvailable: false,
    });
  }
  const style = req.body?.style ?? req.query.style;
  if (style && !STYLE_KEYS.includes(style)) return res.status(400).json({ error: `أسلوب غير معروف: ${style}` });
  // The style sets both halves: the rule numbers the engine sizes with and
  // the horizon the analyst reasons in. Both must come from the same choice,
  // or the prose will argue against the numbers underneath it.
  const rules = style ? rulesForStyle(RULES, style) : RULES;
  const effectiveStyle = style ?? 'medium';

  const portfolio = await loadPortfolio(req.user.id);
  const capital = capitalOf(portfolio);

  // An empty book has no personal fit to judge — the honest answer to "what
  // do I do with my cash" is identical for every such user on a given day.
  // Serve today's cached, shared market report instead of paying for a
  // personalized AI call that would just re-derive the same market view.
  if (!Object.keys(portfolio.positions).length) {
    const { getOrGenerateMarketAnalysis, reviewFromMarketReport } = await import('../agent/marketAnalysis.js');
    const report = await getOrGenerateMarketAnalysis({ rules, style: effectiveStyle });
    const review = reviewFromMarketReport(report, { cash: portfolio.cash }, trackedCodes(portfolio));
    return res.json({ review, analyses: [], errors: [], style: effectiveStyle, source: 'daily_market_report', marketAnalysisAsOf: report.asOf });
  }

  const codes = trackedCodes(portfolio);
  const { results, errors } = await analyzeMany(codes, {
    capital,
    positions: portfolio.positions,
    concurrency: 5,
    rules,
  });

  // Regenerating skips the per-day cache and pays for a fresh model call, so
  // only admins may force it — everyone else gets today's cached review.
  const force = Boolean(req.user.isAdmin) && (req.body?.force === true || req.query.force === '1');
  const { getOrGenerateReview } = await import('../agent/analyst.js');
  const { review, source } = await getOrGenerateReview(
    portfolio,
    results,
    { cash: portfolio.cash, capital },
    { userId: req.user.id, rules, style: effectiveStyle, force },
  );
  res.json({ review, analyses: results, errors, style: effectiveStyle, source });
}));

app.get('/api/market-analysis', wrap(async (req, res) => {
  if (!aiAvailable()) {
    return res.status(503).json({
      error: 'مفيش مفتاح API. حط OPENROUTER_API_KEY في .env — التحليل الفني شغال من غيره.',
      aiAvailable: false,
    });
  }
  const style = req.query.style;
  if (style && !STYLE_KEYS.includes(style)) return res.status(400).json({ error: `أسلوب غير معروف: ${style}` });
  const rules = style ? rulesForStyle(RULES, style) : RULES;
  const { getOrGenerateMarketAnalysis } = await import('../agent/marketAnalysis.js');
  const report = await getOrGenerateMarketAnalysis({ rules, style: style ?? 'medium' });
  res.json({ report });
}));

app.get('/api/fundamentals/:code', wrap(async (req, res) => {
  if (!aiAvailable()) return res.status(503).json({ error: 'مفيش مفتاح API', aiAvailable: false });
  const { getFundamentals } = await import('../agent/fundamentals.js');
  const data = await getFundamentals(req.params.code, { force: req.query.force === '1' });
  if (!data) return res.status(404).json({ error: 'ما لقيتش بيانات أساسية موثوقة' });
  res.json(data);
}));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, aiAvailable: aiAvailable(), universeSize: ALL_CODES.length });
});

// Admin-added stocks (see registerCustomStocks) live only in memory once
// merged in — reload them from Supabase before anything can serve a request,
// or a restart would silently forget every one until the next CSV upload.
try {
  registerCustomStocks(await getAllCustomStocks());
} catch (err) {
  console.error('[universe] فشل تحميل الأسهم المضافة يدويًا:', err.message);
}

// Only bind a port when executed directly (`npm run serve`, systemd, CLI).
// When imported — by the test suites, which listen on an ephemeral port and
// point the bar-cache path at a throwaway directory — the module must not
// grab port 3000.
const isDirectRun = Boolean(process.argv[1])
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isDirectRun) {
  const PORT = process.env.PORT ?? 3000;
  app.listen(PORT, () => {
    console.log(`Alytic على http://localhost:${PORT}`);
    console.log(aiAvailable() ? '  الذكاء الاصطناعي: مفعّل' : '  الذكاء الاصطناعي: متوقف (مفيش OPENROUTER_API_KEY)');
  });
}

export default app;
