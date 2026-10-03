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
import { normalizeBlogContent } from '../blogHtml.js';
import express from 'express';
import rateLimit from 'express-rate-limit';
import * as XLSX from 'xlsx';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { analyzeTicker, analyzeMany } from '../analyze.js';
import { positionSize } from '../scoring/risk.js';
import { ALL_CODES, UNIVERSE, lookup, toYahoo, registerCustomStocks } from '../config/universe.js';
import { INDICES_AS_OF, UPLOADABLE_INDICES, codesForIndex, effectiveIndices } from '../config/indices.js';
import { getAllIndexOverrides, setIndexOverride, clearIndexOverride, getAllCustomStocks, addCustomStocks, getAllUsers, getAllPortfolios, listPublishedBlogPosts, listAllPublishedBlogSlugs, getPublishedBlogPostBySlug, listBlogPosts, countBlogPosts, insertManualBlogPost, setBlogPostStatus, updateBlogPost, deleteBlogPost, getUserById, deleteUser, setUserRole, roleOf, USER_ROLES, getSubscription, getAllSubscriptions, getAllFollowUps, setUserFollowUp, FOLLOW_UP_CHANNELS, putSubscription, deleteSubscription, recordSubscriptionGrant, listSubscriptionGrants, recordCreditsGrant, listCreditsGrants, listSupportMessages, insertSupportMessage, markSupportMessagesRead, listRecentSupportMessages, touchUserSeen, countUsersSeenSince, getUserUsage, getUserUsageBatch, primaryPortfolioIdFor } from '../db.js';
import { TIERS, addMonths, plansFor, addonsFor, planForTenant, instapayFor } from '../billing/plans.js';
import { STYLE_KEYS, DEFAULT_STYLE, rulesForStyle } from '../config/styles.js';
import RULES from '../config/rules.js';
import { behaviorProfile } from '../scoring/behavior.js';
import { sharedIpAccounts } from '../sharedIp.js';
import { loadPortfolio, withPortfolio, withUserUsage, withPortfolioAndUsage, recordTrade, editTrade, setLevels, trackedCodes, recordSnapshot, setNote, recordCashFlow, positionsFlow, rememberVerdict, stopContextOf } from '../portfolio.js';
import { aiAvailable, callWithRetry, getOpenRouterClient, requestStructuredOR } from '../agent/clientOpenRouter.js';

// Pinned independently of the shared MODEL export so a future ALYTIC_MODEL
// change for the text-analysis path can never silently redirect vision too.
// Configurable via ALYTIC_VISION_MODEL in .env — must be a vision-capable
// OpenRouter model. A stale model override once sent this route to a
// text-only "thinking" model with zero vision-capable endpoints, producing
// an opaque 404 — verified live.
const SCREENSHOT_VISION_MODEL = process.env.ALYTIC_VISION_MODEL ?? 'qwen/qwen2.5-vl-72b-instruct:free';
import { readBars, getBars, cairoToday, cairoDateOf, isTradingDay, tradingHalted, egxSessionOpen } from '../data/cache.js';
import { fetchDailyAuto } from '../data/yahoo.js';
import { detectCorporateActions, applyCorporateActions, resolveCorporateAction, researchCorporateAction } from '../corporateActions.js';
import { latestEventFor, recordEvent } from '../data/corporateEvents.js';
import { getPriceHistory, HISTORY_RANGES } from '../data/priceHistory.js';
import { fetchLatestQuotes } from '../data/tv-history.js';
import { fetchFundamentals, cachedScreener } from '../data/tradingview.js';
import { buildHeatmap } from '../marketHeatmap.js';
import { fetchLiveQuotes, liveQuoteStatus } from '../data/live-quotes.js';
import { login, register, userFromRequest, sessionCookie, clearSessionCookie, googleSignIn, verifyEmail, resendVerification, updatePhone, updateName, forgotPassword, resetPassword } from '../auth.js';
import { sendEmail } from '../email.js';
import { contactEmailHtml, supportMessageEmailHtml } from '../emailTemplates.js';
import { uploadSupportImage, signedUrlsFor, removeSupportImagesFor, SUPPORT_IMAGE_TYPES } from '../supportAttachments.js';
import { uploadBlogImage, BLOG_IMAGE_TYPES } from '../blogImages.js';
import { securityHeaders, originGuard, safeEqual, sniffImageType, mediaTypeOf, safeHttpsUrl, publicError, isIsoDate } from '../security.js';
import { currentTenant, runWithTenant } from '../tenancy/context.js';
import { activeTenants, canEditIndices, defaultTenant, isPlatformAdmin, isPlatformAdminEmail, normalizeHost, publicTenant, startTenantRegistry, tenantForHost } from '../tenancy/registry.js';
import { mountPlatformRoutes } from './platform.js';
import { logRecommendations, levelsFromAnalysis, levelsFromOpportunity, levelsFromScanRow, recordRecommendationPrices, trackRecord, HORIZON_BUCKETS, COMPARISONS } from '../recommendations.js';

// Where the public contact form's messages and support-chat alerts land is
// per site: config.contactEmail / config.supportNotifyEmail on the tenant
// (see tenancy/registry.js). For the original site those come from
// CONTACT_EMAIL and SUPPORT_NOTIFY_EMAIL in .env, as before.

// Every account is on a 5-trading-day free trial from the moment it's created
// — the window is derived from users.created_at rather than stored, so there
// is nothing to reset or backfill. The trial runs in 24-hour slices from the
// signup moment; a slice that starts on a Friday, Saturday or EGX bank holiday
// (isTradingDay) doesn't count and just pushes the end out by a day, so
// signing up before a weekend doesn't burn trial days on a closed market.
const TRIAL_DAYS = 5;
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
 * or a staff/CLI account. Admins, marketers and the built-in 'local' CLI user
 * bypass billing entirely — the CLI has no way to pay and locking it out would
 * break local development, and a marketer is staff whose whole job is the
 * admin page, which the subscription wall would otherwise replace.
 */
async function accessInfo(user) {
  const trial = trialInfo(user);
  const subscription = await getSubscription(user.id);
  const periodEnd = subscription ? new Date(subscription.current_period_end) : null;
  const subscriptionActive = Boolean(periodEnd && periodEnd.getTime() > Date.now());
  const exempt = Boolean(user.isAdmin) || Boolean(user.isMarketer) || user.id === 'local';
  // The free trial only counts once the email is confirmed: an unconfirmed
  // address costs nothing to invent, so honoring the trial before then would
  // let anyone mint a fresh one with a throwaway. The clock still runs from
  // signup (see trialInfo) — this only withholds access until verification.
  // A paid plan or staff account doesn't depend on it.
  const trialUsable = trial.trialActive && Boolean(user.emailVerified);
  // Which set of feature caps (see TIERS in src/billing/plans.js) this
  // account's usage should be checked against. Staff/CLI get the top tier
  // rather than a bypass, so the per-feature counters below still mean
  // something for them; a lapsed, non-trial account gets null, which is
  // moot since PAID_PATHS already blocks it before any cap is checked.
  const tier = exempt ? 'trader' : subscriptionActive ? subscription.tier : trialUsable ? 'free' : null;
  return {
    trialDaysTotal: trial.trialDaysTotal,
    trialDaysLeft: trial.trialDaysLeft,
    trialActive: trial.trialActive,
    trialEndsAt: trial.trialEndsAt.toISOString(),
    plan: subscriptionActive ? subscription.plan : null,
    tier,
    subscriptionActive,
    currentPeriodEnd: periodEnd ? periodEnd.toISOString() : null,
    // True while a still-running trial is being held back by an unconfirmed
    // email — lets the wall say "confirm your email" instead of "trial ended".
    awaitingEmailVerification: !exempt && !subscriptionActive && trial.trialActive && !trialUsable,
    hasAccess: exempt || trialUsable || subscriptionActive,
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

const app = express();
// Behind nginx (see the systemd deploy), the real client IP arrives in
// X-Forwarded-For — without this, every request looks like it came from
// nginx itself (127.0.0.1), which would make the rate limiters below share
// one bucket across every visitor instead of limiting per-IP.
app.set('trust proxy', 1);
// Express matches routes case-insensitively by default, but every gate below
// (the login wall, the paywall's PAID_PATHS, the admin check) compares
// req.path case-sensitively. With the default, GET /api/SCAN skipped the
// paywall check and still reached the /api/scan handler. Case-sensitive
// routing makes "which handler runs" and "which gate applies" the same question.
app.set('case sensitive routing', true);
app.disable('x-powered-by');
app.use(securityHeaders);
// Refuses browser writes that come from a page that isn't ours — defense in
// depth behind the SameSite=Lax cookie. ALLOWED_ORIGINS is an optional
// comma-separated extra list (see security.js for what is always allowed).
app.use(originGuard({
  allowedOrigins: [process.env.FRONTEND_URL, process.env.APP_URL, ...(process.env.ALLOWED_ORIGINS ?? '').split(',')],
  // A white-label site may write only to itself: the Origin has to be one of
  // the domains of the same tenant the request's host belongs to.
  isAllowed: (req, origin) => {
    const target = tenantForHost(requestHost(req));
    return Boolean(target && !target.isDefault && target.domains.includes(normalizeHost(origin)));
  },
}));
app.use(express.json({ limit: '100kb' }));

/**
 * The host the browser asked for. The frontend's /api/public proxy sets
 * X-Forwarded-Host from the Host nginx passed it, overwriting anything the
 * client sent (see frontend/src/routes/api/public/$.ts). Direct calls on
 * loopback (cron jobs, tests) carry only Host.
 */
function requestHost(req) {
  return req.get('x-forwarded-host') ?? req.get('host') ?? '';
}

// Which white-label site this request is for. Placed after express.json on
// purpose: the JSON body is read from a stream, and a tenant context entered
// before that would be lost by the time the parser hands over. Everything
// below runs inside the context, and every database call follows it (see
// tenancy/context.js).
app.use((req, res, next) => {
  const tenant = tenantForHost(requestHost(req));
  if (!tenant) return res.status(404).json({ error: 'الموقع ده مش معروف' });
  if (tenant.status !== 'active' && req.path !== '/api/health') {
    return res.status(503).json({ error: 'الخدمة متوقفة مؤقتًا على الموقع ده — تواصل مع الإدارة.' });
  }
  req.tenant = tenant;
  runWithTenant(tenant, next);
});

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
const cronLimiter = rateLimited(20, 15);
// A flood guard over the whole API, per IP. Generous on purpose: mobile
// carriers put many real users behind one address, and a desk page load fans
// out into a dozen calls. It stops a script, not a crowd.
const apiFloodLimiter = rateLimited(1200, 1);

// The vanilla-JS UI (formerly public/index.html) is retired in favor of the
// EGXpert frontend in frontend/ (TanStack Start, its own dev/build process).
// This process stays API-only for the browser: send a human landing on it
// straight to the real app instead of serving stale markup.
const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:8080';
app.get('/', (req, res) => res.redirect(req.tenant?.appUrl ?? FRONTEND_URL));

// No static files are served from this process: the repo has no backend/public
// directory and the release bundle never ships one, so a file dropped there by
// accident (a backup, an .env copy) would otherwise become world-readable.
app.use('/api', apiFloodLimiter);

/** Wrap an async handler so a rejection becomes a 500 instead of an unhandled rejection. */
// Only messages this app wrote for users (Arabic) reach the client; database,
// network and programming errors are logged in full and answered generically —
// see publicError in security.js.
// Re-enters the request's tenant context before the handler: a route-level
// body parser (express.raw for uploads) resumes on a stream event outside it.
const wrap = (fn) => (req, res) => runWithTenant(req.tenant ?? currentTenant() ?? defaultTenant(), () => fn(req, res)).catch((err) => {
  console.error(err);
  if (res.headersSent) return;
  const { status, message } = publicError(err);
  res.status(status).json({ error: message });
});

/**
 * The caller's address as recorded on the users table (signup_ip /
 * last_login_ip). With 'trust proxy' set above this is the real client behind
 * nginx, not 127.0.0.1. An IPv4 address that arrived over a dual-stack socket
 * comes prefixed `::ffff:` — stripped so the same visitor always has the same
 * string.
 */
const clientIp = (req) => (req.ip ?? '').replace(/^::ffff:/, '') || undefined;

// Never logs the caller in directly (unlike login/google) and always
// answers the same way regardless of whether the email was already taken
// — see auth.js's register() for why: revealing that here would be exactly
// the email-enumeration hole rate limiting alone can't close.
// `ip` goes last in each spread so a client can't supply its own in the body.
app.post('/api/auth/register', registerLimiter, wrap(async (req, res) => {
  await register({ ...req.body, ip: clientIp(req) });
  res.status(201).json({ ok: true });
}));

app.post('/api/auth/login', loginLimiter, wrap(async (req, res) => {
  const result = await login({ ...req.body, ip: clientIp(req) });
  // "فضّلني مسجّل دخول" — defaults to remembered (today's behavior) unless
  // the checkbox was explicitly unchecked.
  const remember = req.body?.remember !== false;
  res.setHeader('Set-Cookie', sessionCookie(result.token, remember));
  res.json({ user: result.user });
}));

app.post('/api/auth/google', loginLimiter, wrap(async (req, res) => {
  const result = await googleSignIn({ ...req.body, ip: clientIp(req) });
  res.setHeader('Set-Cookie', sessionCookie(result.token));
  res.json({ user: result.user });
}));

app.post('/api/auth/verify', loginLimiter, wrap(async (req, res) => {
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
  res.json({ user: { ...user, ...(await accessInfo(user)), isPlatformAdmin: isPlatformAdmin(user, req.tenant), canEditIndices: canEditIndices(user, req.tenant) } });
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
    to: req.tenant.config.contactEmail,
    subject: `رسالة تواصل من ${name}`,
    html: contactEmailHtml({ name, email, message }),
  });
  res.json({ ok: true });
}));

// Published blog posts — public, no login required. See src/agent/blogGenerator.js
// for how drafts are written and src/db.js for the storage helpers.
app.get('/api/blog', wrap(async (req, res) => {
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  // 1-based page of `limit` posts; callers that send no page (the landing strip,
  // the ticker) keep getting the newest `limit`.
  const page = Math.max(1, Math.floor(Number(req.query.page)) || 1);
  const { posts, total } = await listPublishedBlogPosts({ limit, offset: (page - 1) * limit });
  res.json({
    total,
    page,
    pageSize: limit,
    // `dek` is the card's excerpt. Articles written by hand from the admin
    // "مقالة جديدة" form have no dek (it's optional there) but always have a
    // meta description, so fall back to that instead of showing a bare card.
    posts: posts.map((p) => ({ slug: p.slug, title: p.title, dek: p.dek || p.meta_description || null, tags: p.tags, imageUrl: safeHttpsUrl(p.image_thumb_url), publishedAt: p.published_at })),
  });
}));

app.get('/api/blog/:slug', wrap(async (req, res) => {
  const post = await getPublishedBlogPostBySlug(req.params.slug);
  if (!post) return res.status(404).json({ error: 'المقالة غير موجودة' });
  res.json({
    post: {
      slug: post.slug,
      title: post.title,
      metaTitle: post.meta_title,
      metaDescription: post.meta_description,
      dek: post.dek,
      content: post.content_json,
      tags: post.tags,
      // Rendered as <img src> and <a href> on the public site, so only https
      // URLs are passed on — never a javascript: or data: value from the row.
      image: safeHttpsUrl(post.image_url)
        ? {
            url: safeHttpsUrl(post.image_url),
            sourceUrl: safeHttpsUrl(post.image_source_url),
            creditName: post.image_credit_name,
            creditUrl: safeHttpsUrl(post.image_credit_url),
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

// Triggered twice a day by .github/workflows/blog-cron.yml over the VPS's
// loopback interface (never exposed publicly) — see that workflow for why a
// shared secret rather than a session cookie gates this instead of
// /api/admin. Each trigger generates exactly one article (the next missing
// slot in today's 2-article plan) so the day's batch lands spread out
// rather than all at once; once 2 exist for the day this is a fast no-op.
const BLOG_CRON_SECRET = process.env.BLOG_CRON_SECRET;
app.post('/api/cron/blog-generate', cronLimiter, wrap(async (req, res) => {
  if (!safeEqual(req.get('X-Cron-Secret'), BLOG_CRON_SECRET)) {
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
  // One article per blog-enabled site per trigger, each written into that
  // site's own database. Blog is off by default for client sites
  // (config.features.blog): every article is a paid AI run.
  // Awaited on purpose: the GitHub Actions workflow that calls this should
  // only go green once this run's article (if any) is actually stored, not
  // the moment generation starts.
  const sites = [];
  for (const tenant of activeTenants().filter((t) => t.config.features.blog)) {
    try {
      const result = await runWithTenant(tenant, () => getOrGenerateNextBlogArticle({ postDate }));
      sites.push({
        tenant: tenant.id,
        postDate: result.postDate,
        totalToday: result.totalToday,
        generated: result.generated ? { id: result.generated.id, slug: result.generated.slug, status: result.generated.status } : null,
      });
    } catch (err) {
      console.error(`[blog-cron] ${tenant.id} failed:`, err.message);
      sites.push({ tenant: tenant.id, error: true });
    }
  }
  // The top-level fields keep describing the original site, as the workflow
  // that calls this has always read them.
  const main = sites.find((site) => site.tenant === defaultTenant().id) ?? {};
  res.json({ ok: true, postDate: main.postDate, totalToday: main.totalToday, generated: main.generated ?? null, sites });
}));

// Manual/ops trigger for warmNextStopPlans (see agent/stopPlanWarmer.js) —
// the recurring job itself runs in-process via startStopPlanScheduler()
// below, not from this endpoint. Kept secret-gated the same way
// /api/cron/blog-generate is, for occasional manual backfill or debugging
// (e.g. `force: true` against a specific day).
const STOP_PLAN_CRON_SECRET = process.env.STOP_PLAN_CRON_SECRET;
app.post('/api/cron/stop-plan-generate', cronLimiter, wrap(async (req, res) => {
  if (!safeEqual(req.get('X-Cron-Secret'), STOP_PLAN_CRON_SECRET)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  if (!aiAvailable()) return res.status(503).json({ error: 'مفيش مفتاح API', aiAvailable: false });
  const { warmNextStopPlans } = await import('../agent/stopPlanWarmer.js');
  const requestedBatchSize = Number(req.body?.batchSize);
  const result = await warmNextStopPlans({
    ...(Number.isFinite(requestedBatchSize) && requestedBatchSize > 0 ? { batchSize: requestedBatchSize } : {}),
    force: req.body?.force === true,
  });
  res.json({ ok: true, ...result });
}));

// The prices the "اشترك" screen quotes. Payment details are deliberately not
// here: users ask on the support chat and an admin sends them privately, so
// no account number is published to anyone who can curl this.
app.get('/api/billing/plans', (req, res) => {
  // tiers is included so the subscribe screen can show each plan's feature
  // caps without hardcoding a second copy of TIERS. addons are the one-time
  // top-ups (see ADDONS) shown alongside the plans, one list per credit kind.
  // Prices are this site's own (see plansFor). payLink is the site's InstaPay
  // payment link (config.instapay.address / INSTAPAY_ADDRESS) when it is a URL —
  // the same one the subscribe page's QR encodes, so it is public by design.
  const address = instapayFor(req.tenant)?.address;
  const payLink = typeof address === 'string' && /^https?:\/\//i.test(address) ? address : null;
  res.json({ plans: Object.values(plansFor(req.tenant)), tiers: TIERS, addons: addonsFor(req.tenant), payLink });
});

// What the frontend needs to render this site as itself: name, logo, colors,
// analytics IDs. Public; publicTenant() leaves out everything private.
app.get('/api/tenant', (req, res) => {
  res.set('Cache-Control', 'public, max-age=60');
  res.json(publicTenant(req.tenant));
});

// ---- Live presence ----------------------------------------------------------
// The site pings POST /api/presence about once a minute from every visible
// tab (see PresenceBeacon in the frontend). Signed-in accounts are stamped on
// users.last_seen_at, so "online" survives a restart and doubles as a "last
// seen" column. Visitors with no session have no row to stamp, so they live
// in memory only, keyed by a random id the browser keeps in localStorage —
// which counts browsers, not people, and starts from zero after a restart.
const PRESENCE_WINDOW_MS = 3 * 60 * 1000;
const PRESENCE_DB_WRITE_MS = 60 * 1000;
const PRESENCE_MAX_VISITORS = 50_000;
const VISITOR_ID = /^[A-Za-z0-9-]{8,64}$/;
const anonSeen = new Map(); // `${tenant id}:${visitor id}` -> ms of last ping
const userSeenWritten = new Map(); // user id -> ms of last last_seen_at write
let anonPrunedAt = 0;

const pruneAnonSeen = (now) => {
  if (now - anonPrunedAt < 60 * 1000) return;
  anonPrunedAt = now;
  for (const [vid, at] of anonSeen) if (now - at >= PRESENCE_WINDOW_MS) anonSeen.delete(vid);
};

const presenceLimiter = rateLimited(120, 1);

app.post('/api/presence', presenceLimiter, wrap(async (req, res) => {
  const now = Date.now();
  const vid = typeof req.body?.vid === 'string' && VISITOR_ID.test(req.body.vid) ? `${req.tenant.id}:${req.body.vid}` : null;
  const user = await userFromRequest(req);
  if (user) {
    // A visitor who signs in mid-visit must not also count as an anonymous one.
    if (vid) anonSeen.delete(vid);
    const seenKey = `${req.tenant.id}:${user.id}`;
    if (now - (userSeenWritten.get(seenKey) ?? 0) >= PRESENCE_DB_WRITE_MS) {
      userSeenWritten.set(seenKey, now);
      await touchUserSeen(user.id, new Date(now).toISOString());
    }
  } else if (vid) {
    pruneAnonSeen(now);
    if (anonSeen.has(vid) || anonSeen.size < PRESENCE_MAX_VISITORS) anonSeen.set(vid, now);
  }
  res.json({ ok: true });
}));

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
    req.path === '/tenant' ||
    req.path === '/cron/blog-generate' ||
    req.path === '/cron/daily-close' ||
    req.path === '/cron/stop-plan-generate'
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
  '/history/',
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
  if (access.awaitingEmailVerification) {
    return res.status(402).json({
      error: 'فعّل بريدك الإلكتروني عشان تبدأ التجربة المجانية — افتح رابط التفعيل اللي اتبعتلك.',
      reason: 'email_unverified',
      requiresSubscription: false,
    });
  }
  const expired = Boolean(access.currentPeriodEnd);
  res.status(402).json({
    error: expired
      ? 'اشتراكك انتهى. حوّل قيمة التجديد على InstaPay وهنفعّل حسابك تاني.'
      : 'انتهت تجربتك المجانية. حوّل قيمة الاشتراك على InstaPay وهنفعّل حسابك.',
    reason: expired ? 'subscription_expired' : 'trial_ended',
    requiresSubscription: true,
  });
});

// Per-account throttles on the endpoints that cost real money or CPU per call
// (model calls, whole-universe scans, upstream price-feed sockets). The tier
// allowances cap how many *charged* uses an account gets a month; these cap
// how fast any one account can hammer the same endpoints, including the
// uncharged ones (force=1 re-analysis, cached reads that still hit the feed).
// Keyed by user id, not IP, so a shared mobile-carrier address doesn't make
// unrelated users throttle each other. The status endpoints are long-polls and
// are deliberately left out.
const perUserLimiter = (max, windowMinutes) => (skipLimits
  ? (_req, _res, next) => next()
  : rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => `user:${req.user?.id ?? 'anon'}`,
    message: { error: 'محاولات كتير في وقت قصير — استنى شوية وجرّب تاني' },
  }));
const analysisLimiter = perUserLimiter(240, 1);
const aiLimiter = perUserLimiter(15, 1);
app.use(['/api/scan', '/api/analyze', '/api/history', '/api/quotes'], analysisLimiter);
app.post(['/api/review', '/api/review/stock', '/api/review/cash', '/api/portfolio/import-screenshot'], aiLimiter);
app.get(['/api/fundamentals/:code', '/api/market-analysis'], aiLimiter);

// ---- Support chat ----------------------------------------------------------
// Deliberately outside PAID_PATHS: this is how a user asks to subscribe and
// how a lapsed account asks to renew, so locking it behind the paywall would
// wall off the only route back to paying.

const MAX_MESSAGE_LENGTH = 2000;
const chatLimiter = rateLimited(40, 15);

// An upload is accepted only when its bytes really are the image type the
// client declared — the Content-Type header alone is attacker-controlled.
// Returns the verified type, or null.
const NOT_AN_IMAGE_MESSAGE = 'الملف ده مش صورة صالحة — ارفع JPEG أو PNG أو WebP.';
function checkedImageType(req) {
  const actual = sniffImageType(req.body);
  return actual && actual === mediaTypeOf(req.headers['content-type']) ? actual : null;
}

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
    to: currentTenant()?.config.supportNotifyEmail ?? process.env.SUPPORT_NOTIFY_EMAIL ?? 'belal.elkady4@gmail.com',
    subject: wantsHuman ? `طلب مساعدة من ${user?.email}` : `رسالة شات جديدة من ${user?.email}`,
    html: supportMessageEmailHtml({
      name: user?.name,
      email: user?.email,
      message: preview,
      appUrl: currentTenant()?.appUrl ?? process.env.APP_URL ?? FRONTEND_URL,
    }),
  }).catch((err) => console.error('support notification email failed:', err));
}

// What the bot answers "عايز أشترك" with. Behind the session on purpose:
// this is the one place the InstaPay account is disclosed, so it only ever
// reaches a signed-in account whose transfer we can later match.
app.get('/api/support/subscribe-info', wrap(async (req, res) => {
  res.json({ plans: Object.values(plansFor(req.tenant)), instapay: instapayFor(req.tenant) });
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
  const imageType = checkedImageType(req);
  if (!imageType) return res.status(415).json({ error: NOT_AN_IMAGE_MESSAGE });

  const existing = await listSupportMessages(req.user.id);
  const imagePath = await uploadSupportImage({
    userId: req.user.id,
    mediaType: imageType,
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

// Self-service name correction from the profile page — the counterpart to
// the admin panel's read-only view of the same field.
app.post('/api/account/name', wrap(async (req, res) => {
  const result = await updateName({ userId: req.user.id, name: req.body?.name });
  res.json({ user: result.user });
}));

const capitalOf = (p) =>
  Object.values(p.positions).reduce((a, pos) => a + pos.shares * pos.avgCost, 0) + p.cash;

// Extra uses an admin grants from the users table, one balance per capped
// feature, on top of that account's tier allowance (see TIERS). Kept on the
// User-usage record (see getUserUsage/putUserUsage in db.js) so spending one
// rides the same withUserUsage/withPortfolioAndUsage lock as the usage it
// pays for. A credit is only spent once the base allowance is gone.
const CREDIT_KINDS = ['cashScans', 'recommendations', 'screenshots', 'marketAnalysis'];
function creditsOf(usage) {
  const stored = usage?.credits ?? {};
  return Object.fromEntries(CREDIT_KINDS.map((kind) => [kind, Math.max(0, Math.floor(Number(stored[kind])) || 0)]));
}
function addCredits(usage, deltas) {
  const credits = creditsOf(usage);
  for (const kind of CREDIT_KINDS) credits[kind] = Math.max(0, credits[kind] + (deltas[kind] ?? 0));
  return { ...usage, credits };
}

// One counter per capped feature. This is the tier system's usage side;
// TIERS in src/billing/plans.js is the limit side, and req.access.tier (see
// accessInfo()) says which tier's limits apply to a given account right now.
// The month-rollover reset itself now happens inside getUserUsage (db.js) —
// `usage` here is always already current-month-correct by the time it
// reaches these helpers.
function bumpUsage(usage, kind) {
  return { ...usage, [kind]: usage[kind] + 1 };
}
// This month's remaining tier allowance alone, with no credits mixed in —
// callers use this to decide whether a charged use should still count
// against the base allowance or has to draw from credits instead.
function baseLeftFor(kind, usage, tier) {
  const limit = (TIERS[tier] ?? TIERS.free)[kind];
  const used = usage[kind];
  return Math.max(0, limit - used);
}
// What's left of a capped feature right now: this month's remaining tier
// allowance, plus any admin-granted credits on top. tier is req.access.tier
// — a signed-in, paid/trial account always has one by the time this runs,
// since every metered endpoint sits behind the PAID_PATHS gate.
function leftFor(kind, usage, tier) {
  return baseLeftFor(kind, usage, tier) + creditsOf(usage)[kind];
}

// ---- Reference data --------------------------------------------------------

app.get('/api/universe', (_req, res) => {
  res.json({ stocks: UNIVERSE, rules: RULES, aiAvailable: aiAvailable() });
});

// EGX trades 10:00-14:30 Cairo time, Sunday-Thursday, minus bank holidays —
// see egxSessionOpen in src/data/cache.js.
app.get('/api/market-status', (_req, res) => {
  res.json({ open: egxSessionOpen(), asOf: cairoToday() });
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

// The whole-market heatmap on the same page: every analysable stock's change
// today, sized by market cap or traded value and grouped by sector. Free for
// any signed-in user, on the same delayed TradingView feed as the cards above
// (live prices stay a subscriber feature). One fetch serves everyone for a
// minute — the in-flight promise is what gets cached, so a burst of visitors
// opens one feed connection, and a failed fetch is never cached.
const HEATMAP_TTL_MS = 60_000;
let heatmapCache = null; // { promise, at }

async function loadHeatmap() {
  const [membership, quotes, screener] = await Promise.all([
    effectiveIndices(),
    fetchLatestQuotes(ALL_CODES),
    // Live market caps and traded value; without them the universe snapshot's figures stand in.
    cachedScreener().catch((err) => {
      console.warn('[heatmap] screener failed, using snapshot sizes:', err.message);
      return [];
    }),
  ]);
  return { asOf: new Date().toISOString(), delayedMinutes: 15, indices: membership, ...buildHeatmap({ stocks: UNIVERSE, quotes, screener, membership }) };
}

app.get('/api/indices/heatmap', analysisLimiter, wrap(async (_req, res) => {
  if (!heatmapCache || Date.now() - heatmapCache.at >= HEATMAP_TTL_MS) {
    const entry = { at: Date.now(), promise: loadHeatmap() };
    entry.promise.catch(() => {
      if (heatmapCache === entry) heatmapCache = null;
    });
    heatmapCache = entry;
  }
  res.json(await heatmapCache.promise);
}));

// ---- Admin ------------------------------------------------------------------

// isAdmin is granted at signup to any address listed in ADMIN_EMAILS, before
// that address has proved it owns the mailbox — so an unconfirmed account
// registered with an admin's email must not get admin powers until the
// confirmation link (which only the real owner receives) has been used.
//
// A marketer is not an admin: they get exactly the two reads behind the users
// table (the list, and the online-now counter above it) and nothing else — no
// writes, no support inbox, no blog, no indices. It is an allowlist on purpose,
// so a new /api/admin route is closed to marketers until someone adds it here.
const MARKETER_READS = new Set(['GET /users', 'GET /online']);
app.use('/api/admin', (req, res, next) => {
  if (req.user?.isMarketer && req.user.emailVerified && MARKETER_READS.has(`${req.method} ${req.path}`)) return next();
  if (!req.user?.isAdmin || !req.user.emailVerified) return res.status(403).json({ error: 'للمشرفين فقط' });
  next();
});

// Index membership lists and admin-added stocks are market data every site
// shares (they live in the platform database), so only the main site's admins
// edit them. A client's admins manage their own users, not the market.
app.use('/api/admin/indices', (req, res, next) => {
  if (!canEditIndices(req.user, req.tenant)) return res.status(403).json({ error: 'القوائم دي بتتعدل من الموقع الأساسي بس' });
  next();
});

// ---- Platform (white-label) --------------------------------------------------
// Managing the client sites themselves. See api/platform.js.
app.use('/api/platform', (req, res, next) => {
  if (!isPlatformAdmin(req.user, req.tenant)) return res.status(403).json({ error: 'للمشرفين فقط' });
  next();
});
mountPlatformRoutes(app, { wrap });

// How subscribers' live prices are doing: oanor on or off, quota used this
// period, whether they've silently fallen back to TradingView and why. The
// fallback never reaches Users or the server log; this is the only place it
// shows. Platform admins only, like the rest of /api/platform: one oanor key
// and one bill for every site.
app.get('/api/platform/live-prices', wrap(async (_req, res) => {
  res.json(await liveQuoteStatus());
}));

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
  // The company name so the admin UI can show more than a bare code, and
  // so a search can match on it too — pulled from the live universe
  // (verified entries and admin-registered custom stocks alike), not from
  // whatever an upload's own name column happened to say.
  const toTickers = (codes) => codes.map((code) => ({ code, name: lookup(code)?.ar || lookup(code)?.en || code }));
  const indices = await Promise.all(UPLOADABLE_INDICES.map(async (name) => {
    const override = overrides[name];
    const tickers = toTickers(await codesForIndex(name));
    return {
      name,
      tickers,
      count: tickers.length,
      source: override ? 'upload' : 'default',
      updatedAt: override?.updatedAt ?? null,
      updatedBy: override?.updatedBy ?? null,
    };
  }));
  // Every tracked stock, index member or not (TALM after the 2026-09 review,
  // say), so a search always finds it somewhere instead of reading as
  // untracked. Derived, not uploadable; outsideCount is how many of these sit
  // in none of the four lists above.
  const inAnIndex = new Set(indices.flatMap((row) => row.tickers.map((t) => t.code)));
  const all = toTickers([...ALL_CODES].sort());
  indices.push({
    name: 'ALL',
    tickers: all,
    count: all.length,
    outsideCount: ALL_CODES.filter((code) => !inAnIndex.has(code)).length,
    source: 'derived',
    updatedAt: null,
    updatedBy: null,
  });
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
// watchlist, trades) for the admin users list. `behavior` is the same
// behaviorProfile() the AI cash review reads, cut down to what the table
// shows, next to the style the user picked in settings (if any).
// Who is on the site right now: accounts that pinged within the window, plus
// anonymous browsers counted in memory (see the presence block above).
app.get('/api/admin/online', wrap(async (req, res) => {
  const now = Date.now();
  const signedIn = await countUsersSeenSince(new Date(now - PRESENCE_WINDOW_MS).toISOString());
  let visitors = 0;
  const prefix = `${req.tenant.id}:`;
  for (const [vid, at] of anonSeen) if (vid.startsWith(prefix) && now - at < PRESENCE_WINDOW_MS) visitors += 1;
  res.json({ signedIn, visitors, windowSeconds: PRESENCE_WINDOW_MS / 1000, asOf: new Date(now).toISOString() });
}));

/** A user_follow_ups row as the admin users table reads it: when each channel was ticked, null if not yet. */
const followUpOf = (row) => ({ whatsappAt: row?.whatsapp_at ?? null, emailAt: row?.email_at ?? null });

app.get('/api/admin/users', wrap(async (req, res) => {
  const [users, portfolios, subscriptions, followUps] = await Promise.all([
    getAllUsers(),
    getAllPortfolios(),
    getAllSubscriptions(),
    getAllFollowUps(),
  ]);
  // The usage/credits figures below now live on the User, not the Portfolio
  // blob — read separately, in one batched query (see getUserUsageBatch in
  // db.js) rather than off `portfolios`. One getUserUsage call per account
  // would mean one query per row on a users table with hundreds of rows.
  const usageByUser = await getUserUsageBatch();
  const portfolioByUser = new Map(portfolios.map((row) => [row.user_id, row.state_json]));
  const subscriptionByUser = new Map(subscriptions.map((row) => [row.user_id, row]));
  const followUpByUser = new Map(followUps.map((row) => [row.user_id, row]));
  // 'local' is the CLI/dev account (SYSTEM_USER_ID in the admin screen), not a customer.
  const sameNetwork = sharedIpAccounts(users, { excludeIds: ['local'] });

  const rows = users.map((u) => {
    const pf = portfolioByUser.get(u.id);
    const positions = pf ? Object.values(pf.positions ?? {}) : [];
    const positionsValue = positions.reduce((sum, p) => sum + (p.shares ?? 0) * (p.avgCost ?? 0), 0);
    const profile = pf ? behaviorProfile(pf, { capital: (pf.cash ?? 0) + positionsValue }) : null;
    const chosenStyle = STYLE_KEYS.includes(pf?.settings?.investStyle) ? pf.settings.investStyle : null;
    const subscription = subscriptionByUser.get(u.id);
    const trial = trialInfo({ createdAt: u.created_at });
    const subscriptionActive = Boolean(subscription) && new Date(subscription.current_period_end).getTime() > Date.now();
    // Same resolution as accessInfo() for this user's own request — see its
    // comment on why staff/CLI get the top tier rather than a bypass.
    const tier = u.is_admin || u.is_marketer || u.id === 'local' ? 'trader' : subscriptionActive ? subscription.tier : trial.trialActive && u.email_verified ? 'free' : null;
    // Both queries read the same unfiltered `users` table; a missing entry
    // here would only mean the account was deleted between the two reads.
    const usage = usageByUser.get(u.id) ?? { cashScans: 0, recommendations: 0, screenshots: 0, marketAnalysis: 0, credits: {} };
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      phone: u.phone,
      isAdmin: u.is_admin,
      isMarketer: Boolean(u.is_marketer),
      emailVerified: u.email_verified,
      googleLinked: Boolean(u.google_id),
      createdAt: u.created_at,
      lastLoginAt: u.last_login_at,
      lastSeenAt: u.last_seen_at,
      signupIp: u.signup_ip,
      lastLoginIp: u.last_login_ip,
      sameNetworkAccounts: sameNetwork.get(u.id) ?? [],
      trialActive: trial.trialActive,
      trialEndsAt: trial.trialEndsAt.toISOString(),
      tier,
      followUp: followUpOf(followUpByUser.get(u.id)),
      subscription: subscription && {
        plan: subscription.plan,
        tier: subscription.tier,
        currentPeriodEnd: subscription.current_period_end,
        active: subscriptionActive,
        note: subscription.note,
        updatedAt: subscription.updated_at,
      },
      portfolio: pf && {
        cash: pf.cash ?? 0,
        positionsCount: positions.length,
        positionsValue,
        watchlistCount: Object.keys(pf.watchlist ?? {}).length,
        tradesCount: (pf.trades ?? []).filter((t) => t.side !== 'dividend').length,
        realizedPnl: pf.realizedPnl ?? 0,
        updatedAt: pf.updatedAt ?? null,
      },
      behavior: profile && {
        chosenStyle,
        inferredStyle: profile.inferredStyle,
        buys: profile.buys,
        sells: profile.sells,
        avgHoldDays: profile.avgHoldDays,
        winRatePct: profile.winRatePct,
        tradesLast30d: profile.tradesLast30d,
        lastTradeDate: profile.lastTradeDate,
        averagingDownBuys: profile.averagingDownBuys,
        avgOpenPositionDays: profile.avgOpenPositionDays,
        importedPositions: profile.importedPositions,
      },
      // What's left of each capped allowance right now (base + credits), and
      // the granted credits within it — see TIERS in src/billing/plans.js.
      usage: {
        cashScansLeft: cashScansLeft(usage, tier),
        screenshotsLeftThisMonth: screenshotImportsLeft(usage, tier),
        recommendationsLeft: leftFor('recommendations', usage, tier),
        marketAnalysisLeft: leftFor('marketAnalysis', usage, tier),
        credits: creditsOf(usage),
      },
    };
  });
  res.json({ users: rows });
}));

// Adds (or, with a negative number, takes back) credits on top of a user's
// capped allowances — see creditsOf(). Body: { cashScans, recommendations,
// screenshots, marketAnalysis }, each a whole-number change; a balance never
// drops below 0.
app.post('/api/admin/users/:id/credits', wrap(async (req, res) => {
  if (!(await getUserById(req.params.id))) return res.status(404).json({ error: 'المستخدم مش موجود' });
  const deltas = {};
  for (const kind of CREDIT_KINDS) {
    const value = Number(req.body?.[kind] ?? 0);
    if (!Number.isInteger(value) || Math.abs(value) > 1000) {
      return res.status(400).json({ error: 'الرصيد لازم يكون رقم صحيح بين -1000 و 1000' });
    }
    deltas[kind] = value;
  }
  // A negative delta can't take a balance below 0 (addCredits clamps), so the
  // requested deltas aren't necessarily what happened — record the actual,
  // clamped change, not the request, or a "-20" against a balance of 5 would
  // log a grant that never occurred.
  let actualDeltas = null;
  const updated = await withUserUsage(req.params.id, (usage) => {
    const before = creditsOf(usage);
    const next = addCredits(usage, deltas);
    const after = creditsOf(next);
    actualDeltas = Object.fromEntries(CREDIT_KINDS.map((kind) => [kind, after[kind] - before[kind]]));
    return next;
  });
  const reference = String(req.body?.reference ?? '').trim().slice(0, 200) || null;
  if (Object.values(actualDeltas).some((value) => value !== 0)) {
    await recordCreditsGrant({ userId: req.params.id, deltas: actualDeltas, reference, grantedBy: req.user.id });
  }
  res.json({ ok: true, credits: creditsOf(updated) });
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
  const plan = planForTenant(req.tenant, requested);
  let currentPeriodEnd;
  let tier;
  if (plan) {
    currentPeriodEnd = addMonths(await periodStartFor(target.id), plan.months);
    tier = plan.tier;
  } else if (requested === 'custom') {
    currentPeriodEnd = new Date(String(req.body?.endsAt ?? ''));
    if (Number.isNaN(currentPeriodEnd.getTime())) return res.status(400).json({ error: 'اكتب تاريخ انتهاء صحيح' });
    if (currentPeriodEnd.getTime() <= Date.now()) return res.status(400).json({ error: 'تاريخ الانتهاء لازم يكون في المستقبل' });
    // No SKU to infer a tier from, so a custom grant (a gift period, a
    // goodwill extension, a correction) must say explicitly which tier's
    // feature caps the account should get.
    tier = String(req.body?.tier ?? '');
    if (!TIERS[tier] || tier === 'free') return res.status(400).json({ error: 'اختر باقة (نفس طويل أو حريفة) للاشتراك المخصص' });
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
    tier,
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
  res.json({ ok: true, subscription: { plan: plan?.key ?? 'custom', tier, currentPeriodEnd: currentPeriodEnd.toISOString(), active: true } });
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
  // The built-in CLI/dev account: not a person, exempt from billing, and the
  // owner of the CLI's portfolio. schema.sql re-creates it on every run anyway.
  if (target.id === 'local') {
    return res.status(400).json({ error: 'ده حساب النظام الداخلي (للـ CLI) — مش مستخدم حقيقي ومينفعش يتحذف' });
  }
  if (target.is_admin || target.id === req.user.id) {
    return res.status(400).json({ error: 'مينفعش تحذف حساب مشرف' });
  }
  await removeSupportImagesFor(target.id);
  await deleteUser(target.id);
  res.json({ ok: true });
}));

// Ticks or clears one box of the admin's follow-up checklist in the users
// table — "reached on WhatsApp" / "reached by email". Body: { channel:
// 'whatsapp' | 'email', done: boolean }. Admins only: it isn't in
// MARKETER_READS, so a marketer sees the boxes but can't change them.
app.post('/api/admin/users/:id/follow-up', wrap(async (req, res) => {
  const channel = String(req.body?.channel ?? '');
  if (!FOLLOW_UP_CHANNELS.includes(channel)) return res.status(400).json({ error: 'القناة لازم تكون واتساب أو إيميل' });
  if (typeof req.body?.done !== 'boolean') return res.status(400).json({ error: 'done لازم يكون true أو false' });
  if (!(await getUserById(req.params.id))) return res.status(404).json({ error: 'المستخدم غير موجود' });
  const row = await setUserFollowUp(req.params.id, channel, req.body.done, req.user.id);
  res.json({ ok: true, followUp: followUpOf(row) });
}));

// Sets a user's role from the users table: 'admin' (everything in this panel),
// 'marketer' (read-only view of the users table) or 'user' (a regular
// account). Only an admin gets here, and it only ever touches this site's own
// users. Three accounts can't be changed from the panel, so the panel can
// never be left without someone able to use it:
//  - your own (ask another admin), so the last admin can't demote themselves;
//  - the internal CLI account;
//  - on the main site, the platform owner's (PLATFORM_ADMIN_EMAILS) — another
//    admin there must not be able to lock the owner out. That one is changed
//    with scripts/make-admin.mjs on the server.
app.post('/api/admin/users/:id/role', wrap(async (req, res) => {
  const role = String(req.body?.role ?? '');
  if (!USER_ROLES.includes(role)) return res.status(400).json({ error: 'الدور لازم يكون مشرف أو مسوّق أو مستخدم' });
  const target = await getUserById(req.params.id);
  if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
  if (target.id === 'local') return res.status(400).json({ error: 'ده حساب النظام الداخلي (للـ CLI) — مينفعش يتغير دوره' });
  if (target.id === req.user.id) return res.status(400).json({ error: 'مينفعش تغيّر دور حسابك — اطلب من مشرف تاني يعمل ده' });
  if (req.tenant.isDefault && isPlatformAdminEmail(target.email)) {
    return res.status(400).json({ error: 'ده حساب مالك المنصة — دوره بيتغير من السيرفر بس (scripts/make-admin.mjs)' });
  }
  const before = roleOf(target);
  if (before !== role) {
    await setUserRole(target.id, role);
    console.log(`[audit] role ${before} -> ${role}: ${target.email} (by ${req.user.email}, site ${req.tenant.id})`);
  }
  res.json({ ok: true, role });
}));

/** Activation history for one user — what to check when a payment is disputed or entered twice. Capped at 5: this is a quick sanity check for the admin panel's history disclosure, not a ledger. */
app.get('/api/admin/users/:id/subscription', wrap(async (req, res) => {
  const grants = await listSubscriptionGrants(req.params.id, { limit: 5 });
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

/** Credits change history for one user — same audit-check purpose as the Subscription history above. */
app.get('/api/admin/users/:id/credits', wrap(async (req, res) => {
  const grants = await listCreditsGrants(req.params.id, { limit: 5 });
  res.json({
    grants: grants.map((g) => ({
      id: g.id,
      deltas: g.deltas,
      reference: g.reference,
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
  const [posts, total] = await Promise.all([listBlogPosts({ status, limit: 50 }), countBlogPosts(status)]);
  res.json({
    total,
    posts: posts.map((p) => ({
      id: p.id,
      batchIndex: p.batch_index,
      postDate: p.post_date,
      slug: p.slug,
      primaryKeyword: p.primary_keyword,
      secondaryKeywords: p.secondary_keywords,
      title: p.title,
      metaTitle: p.meta_title,
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

// A manually written article's feature image — a raw image body (mirroring
// /api/support/messages/image) uploaded ahead of the article itself, so the
// admin form can preview it and send its public URL along with the post.
app.post('/api/admin/blog-drafts/image', express.raw({ type: BLOG_IMAGE_TYPES, limit: '8mb' }), wrap(async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'ارفع صورة الأول' });
  const imageType = checkedImageType(req);
  if (!imageType) return res.status(415).json({ error: NOT_AN_IMAGE_MESSAGE });
  const url = await uploadBlogImage({ mediaType: imageType, buffer: req.body });
  res.status(201).json({ url });
}));

// English URL slug for a manual article's title — translated by a model, since
// a phonetic Arabic→Latin map reads as gibberish ("alborsa" instead of "stock
// exchange"). The admin form fills the slug field from this and leaves it for
// the admin to type by hand if it fails.
app.post('/api/admin/blog-slug', wrap(async (req, res) => {
  const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
  if (!title) return res.status(400).json({ error: 'العنوان مطلوب' });
  if (!aiAvailable()) return res.status(503).json({ error: 'الذكاء الاصطناعي غير متاح دلوقتي' });
  const { generateEnglishSlug } = await import('../agent/blogGenerator.js');
  try {
    // Free models can sit in rate-limit backoff for a long time — bound the
    // wait so the form gets an answer (or a clear failure) instead of hanging.
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timed out')), 25_000);
    });
    const { slug } = await Promise.race([generateEnglishSlug(title.slice(0, 300)), timeout]).finally(() => clearTimeout(timer));
    res.json({ slug });
  } catch (err) {
    console.error('[blog-slug] generation failed:', err.message);
    res.status(502).json({ error: 'تعذر توليد الرابط تلقائيًا — اكتبه بنفسك' });
  }
}));

// Lets an admin write and publish an article by hand, alongside the
// auto-generated pipeline above — see insertManualBlogPost for how it avoids
// colliding with the cron job's (post_date, batch_index) numbering.
app.post('/api/admin/blog-drafts', wrap(async (req, res) => {
  const { title, slug, metaTitle, metaDescription, dek, content, tags, imageUrl, publish } = req.body ?? {};
  if (typeof title !== 'string' || !title.trim()) return res.status(400).json({ error: 'العنوان مطلوب' });
  if (typeof slug !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) {
    return res.status(400).json({ error: 'الرابط لازم يكون حروف إنجليزية صغيرة وأرقام وشرطات بس' });
  }
  if (typeof metaTitle !== 'string' || !metaTitle.trim()) {
    return res.status(400).json({ error: 'عنوان الميتا مطلوب' });
  }
  if (typeof metaDescription !== 'string' || !metaDescription.trim()) {
    return res.status(400).json({ error: 'الوصف التعريفي مطلوب' });
  }
  if (dek !== undefined && dek !== null && typeof dek !== 'string') return res.status(400).json({ error: 'المقدمة لازم تكون نص' });
  if (!Array.isArray(content) || content.length === 0) return res.status(400).json({ error: 'المقالة لازم تحتوي على محتوى' });
  const cleanContent = normalizeBlogContent(content);
  if (!cleanContent || cleanContent.length === 0) return res.status(400).json({ error: 'المقالة لازم تحتوي على محتوى' });
  if (tags !== undefined && !Array.isArray(tags)) return res.status(400).json({ error: 'الوسوم لازم تكون قائمة' });
  if (imageUrl !== undefined && imageUrl !== null && imageUrl !== '' && !safeHttpsUrl(imageUrl)) {
    return res.status(400).json({ error: 'رابط الصورة غير صالح' });
  }

  try {
    const post = await insertManualBlogPost({
      title: title.trim(),
      slug,
      metaTitle: metaTitle.trim(),
      metaDescription: metaDescription.trim(),
      dek: (dek ?? '').trim() || null,
      content: cleanContent,
      tags: tags ?? [],
      imageUrl: imageUrl || null,
      publish: Boolean(publish),
    });
    res.status(201).json({ ok: true, post: { id: post.id, slug: post.slug, status: post.status } });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'في مقالة تانية باستخدام نفس الرابط' });
    throw err;
  }
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
  const cleanContent = content === undefined ? undefined : normalizeBlogContent(content);
  if (cleanContent === null) return res.status(400).json({ error: 'المحتوى لازم يكون قائمة فقرات' });
  const post = await updateBlogPost(req.params.id, { title, dek, metaDescription, content: cleanContent, tags });
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
  const code = req.params.code.toUpperCase();
  // An unknown ticker used to flow on into price-feed lookups, a cache file
  // named after it, and an AI stop-loss call — all attacker-chosen. Only
  // tickers in the universe are analyzable.
  if (!lookup(code)) return res.status(404).json({ error: 'السهم مش موجود' });
  const portfolio = await loadPortfolio(req.user.id);
  const portfolioId = await primaryPortfolioIdFor(req.user.id);
  const style = req.query.style;
  if (style && !STYLE_KEYS.includes(style)) return res.status(400).json({ error: `أسلوب غير معروف: ${style}` });
  // Without this, the detail dialog silently analyzed every stock with the
  // default/medium ruleset regardless of the account's chosen style, so its
  // stop/targets could disagree with the same stock's row elsewhere (scan,
  // alerts, position cards) which already passes ?style= — see /api/scan.
  const rules = style ? rulesForStyle(RULES, style) : RULES;
  // Fetched first so an open position's P&L, stop distance and rule triggers
  // are priced at it (see analyzeTicker), not just the price shown beside them.
  // Same source as the desk ticker (oanor for subscribers during the session),
  // so the dialog never shows an older price than the card it was opened from.
  const live = (
    await fetchLiveQuotes([code], { subscribed: req.access?.subscriptionActive, userId: req.user.id }).catch(() => new Map())
  ).get(code);
  const analysis = await analyzeTicker(code, {
    position: portfolio.positions[code] ?? null,
    capital: capitalOf(portfolio) || 1_000_000,
    force: req.query.force === '1',
    rules,
    style,
    portfolioId,
    live,
  });
  if (live && analysis.snapshot?.price) {
    analysis.snapshot.price = {
      ...analysis.snapshot.price,
      // Already set when the analysis itself was priced live (an open position).
      dailyClose: analysis.snapshot.price.dailyClose ?? analysis.snapshot.price.close,
      close: live.price,
      changePct: live.changePct ?? analysis.snapshot.price.changePct,
      lastTradePrice: live.price,
      lastTradeTime: live.time,
    };
  }
  res.status(analysis.usable ? 200 : 422).json(analysis);
}));

// The price chart in the stock detail dialog: ?range= 1d, 1w, 1m, 6m, 1y or 5y
// (default 5y). Known tickers only, which also bounds the in-memory caches to
// the universe.
app.get('/api/history/:code', wrap(async (req, res) => {
  const code = req.params.code.toUpperCase();
  const range = req.query.range ?? '5y';
  if (!lookup(code)) return res.status(404).json({ error: 'السهم مش موجود' });
  if (!HISTORY_RANGES.includes(range)) return res.status(400).json({ error: `فترة غير معروفة: ${range}` });
  try {
    res.json(await getPriceHistory(code, range));
  } catch (err) {
    console.error('[history] fetch failed:', err.message);
    res.status(502).json({ error: 'تعذر جلب تاريخ الأسعار دلوقتي — جرّب تاني بعد شوية.' });
  }
}));

// A ?codes= list from the client, cut down to tickers the universe knows and
// capped at its size. Every code fans out into a price-feed request, a cache
// file and possibly a model call, so an arbitrary or huge list is a way to
// spend the server's money and get its address banned upstream.
const MAX_CODES_PER_REQUEST = 300;
function knownCodesFrom(raw) {
  const codes = String(raw).split(',').map((code) => code.trim().toUpperCase()).filter((code) => code && lookup(code));
  return [...new Set(codes)].slice(0, MAX_CODES_PER_REQUEST);
}

app.get('/api/quotes', wrap(async (req, res) => {
  const portfolio = await loadPortfolio(req.user.id);
  const requested = req.query.codes
    ? knownCodesFrom(req.query.codes)
    : Object.keys(portfolio.positions);
  // oanor for subscribers, TradingView for everyone else — see data/live-quotes.js.
  const quotes = await fetchLiveQuotes(requested, { subscribed: req.access?.subscriptionActive, userId: req.user.id });
  // On a bonus issue / split / merger day the feed's change can be measured
  // against the old-basis close: a -63% "day" that is only the share ratio.
  for (const [code, quote] of quotes) {
    if (!(Math.abs(quote.changePct ?? 0) >= 30)) continue;
    const event = await latestEventFor(code).catch(() => null);
    if (!event || Date.now() - Date.parse(`${event.lastBefore}T00:00:00Z`) > 7 * 86_400_000) continue;
    const changePct = +(((1 + quote.changePct / 100) * event.factor - 1) * 100).toFixed(2);
    quotes.set(code, { ...quote, changePct, change: quote.price * (changePct / (100 + changePct)) });
  }
  for (const [code, quote] of quotes) quotes.set(code, { ...quote, halted: tradingHalted(quote.time) });
  res.json({ asOf: new Date().toISOString(), quotes: Object.fromEntries(quotes) });
}));

// "تحليل استخدام الكاش" (focus=cash) and "تحليل السوق" (focus=market) — see
// market-dialog.tsx, which opens the same dialog for both — are each capped
// to that account's tier allowance (see TIERS in src/billing/plans.js) each
// calendar month, same as every other capped feature. A request with neither
// focus value (e.g. the desk's own portfolio-refresh scan, or the cash
// page's watchlist scan) is never metered — only a deliberate open of one of
// these two dialogs is. The cap counts how many times a dialog is opened,
// never which index or how many stocks a given scan covers, so every use
// still analyzes the full universe like any other scan: the dialog UI
// re-issues this same request as the user flips between index tabs or invest
// styles while it stays open, and all of those belong to the one "time" that
// opened it. A request within SCAN_SESSION_WINDOW_MS of the account's last
// recorded use of that same kind is treated as such a continuation and never
// charged — only a request arriving after that gap spends a new use.
// usage.lastCashScanAt/lastMarketScanAt (see getUserUsage in db.js) track
// that moment separately from the monthly usage count so a use late in one
// month can still be recognised as a continuation just after the month
// rolls over. The check-then-write race on the count itself is closed by
// withUserUsage's existing per-user write lock — the same pattern the
// screenshot-import cap (below) uses.
const SCAN_SESSION_WINDOW_MS = 10 * 60 * 1000;
const SCAN_FOCUS_KIND = { cash: 'cashScans', market: 'marketAnalysis' };
const SCAN_LAST_AT_FIELD = { cashScans: 'lastCashScanAt', marketAnalysis: 'lastMarketScanAt' };
const SCAN_LIMIT_MESSAGE = {
  cashScans: 'خلصت محاولات تحليل الكاش المتاحة الشهر ده — تقدر تكمّل الشهر الجاي، أو كلّمنا في الشات لو محتاج رصيد إضافي.',
  marketAnalysis: 'خلصت محاولات تحليل السوق المتاحة الشهر ده — تقدر تكمّل الشهر الجاي، أو كلّمنا في الشات لو محتاج رصيد إضافي.',
};
const CASH_SCAN_LIMIT_MESSAGE = SCAN_LIMIT_MESSAGE.cashScans;
function cashScansLeft(usage, tier) {
  return leftFor('cashScans', usage, tier);
}
function withinScanSession(usage, kind) {
  const last = usage[SCAN_LAST_AT_FIELD[kind]];
  return Boolean(last) && Date.now() - Date.parse(last) < SCAN_SESSION_WINDOW_MS;
}
function withinCashScanSession(usage) {
  return withinScanSession(usage, 'cashScans');
}
// Spends one use of `kind` for this scan session, or joins an already-open
// one for free — see the block comment above. Returns the usage record to
// read the resulting *Left value from, or throws (429-worthy) if the
// allowance is gone. Only called for focus values in SCAN_FOCUS_KIND. Touches
// only the User's usage row, never the Portfolio book.
async function chargeScanSession(userId, kind, tier) {
  const usage = await getUserUsage(userId);
  if (withinScanSession(usage, kind)) return usage;
  if (leftFor(kind, usage, tier) <= 0) throw Object.assign(new Error(SCAN_LIMIT_MESSAGE[kind]), { scanLimitKind: kind });
  // Re-checked under the lock: parallel requests can all pass the read above
  // before any of them has recorded a use, and a request that lands a moment
  // after another one just opened a new session must join it rather than
  // spend a second one.
  return withUserUsage(userId, (u) => {
    if (withinScanSession(u, kind)) return u;
    if (leftFor(kind, u, tier) <= 0) throw Object.assign(new Error(SCAN_LIMIT_MESSAGE[kind]), { scanLimitKind: kind });
    const next = { ...bumpUsage(u, kind), [SCAN_LAST_AT_FIELD[kind]]: new Date().toISOString() };
    return baseLeftFor(kind, u, tier) > 0 ? next : addCredits(next, { [kind]: -1 });
  });
}

app.get('/api/scan', wrap(async (req, res) => {
  const portfolio = await loadPortfolio(req.user.id);
  const portfolioId = await primaryPortfolioIdFor(req.user.id);

  let cashScansLeftNow = null;
  let marketAnalysisLeftNow = null;
  const focusKind = SCAN_FOCUS_KIND[req.query.focus];
  if (focusKind) {
    const tier = req.access?.tier;
    let updated;
    try {
      // Checked/charged before the (still non-trivial, whole-universe)
      // analysis runs, so an exhausted allowance costs nothing.
      updated = await chargeScanSession(req.user.id, focusKind, tier);
    } catch (err) {
      if (err.scanLimitKind) {
        return res.status(429).json({
          error: err.message,
          reason: focusKind === 'cashScans' ? 'cash_scan_limit' : 'market_analysis_limit',
          [`${focusKind}Left`]: 0,
        });
      }
      throw err;
    }
    if (focusKind === 'cashScans') cashScansLeftNow = leftFor('cashScans', updated, tier);
    else marketAnalysisLeftNow = leftFor('marketAnalysis', updated, tier);
  }

  const indexCodes = req.query.index ? await codesForIndex(req.query.index) : null;
  if (req.query.index && !indexCodes) return res.status(400).json({ error: `مؤشر غير معروف: ${req.query.index}` });
  const codes = req.query.codes
    ? knownCodesFrom(req.query.codes)
    : indexCodes ?? ALL_CODES;
  const style = req.query.style;
  if (style && !STYLE_KEYS.includes(style)) return res.status(400).json({ error: `أسلوب غير معروف: ${style}` });

  const { payload } = await runScan(portfolio, {
    codes,
    style,
    userId: req.user.id,
    portfolioId,
    subscribed: req.access?.subscriptionActive,
    force: req.query.force === '1',
    focus: req.query.focus,
    cashScansLeftNow,
    marketAnalysisLeftNow,
    tier: req.access?.tier,
  });
  res.json(payload);
}));

/**
 * The scan itself — engine analysis, sector-aware sizing and the cash plan —
 * without the HTTP layer, so the AI cash review (/api/review/cash) judges
 * exactly the plan the dialog shows. Returns the response payload plus the
 * full analyses its compact rows were cut from.
 */
async function runScan(portfolio, { codes, style, userId, portfolioId = null, subscribed = false, force = false, focus = null, cashScansLeftNow = null, marketAnalysisLeftNow = null, tier = null }) {
  // A cash plan has to see the whole book, even holdings outside the index
  // being browsed: the sector limits it sizes against and the AI cash review
  // both depend on every position, not just the ones in that index.
  if (focus === 'cash') codes = [...new Set([...codes, ...Object.keys(portfolio.positions)])];
  // A style changes which rule numbers the engine sizes and gates setups
  // with — same deterministic engine, different risk/reward and sizing
  // inputs, exactly like every other `rules` param it already accepts.
  const rules = style ? rulesForStyle(RULES, style) : RULES;
  const capital = capitalOf(portfolio) || 1_000_000;
  // Held positions are priced from the same source as this user's desk ticker
  // (oanor when subscribed), fetched here rather than inside analyzeMany so
  // the engine stays unaware of who's asking. Background runs pass no
  // `subscribed` and stay on TradingView, spending none of oanor's quota.
  // Fetched alongside the fundamentals, as analyzeMany itself did before.
  const heldCodes = codes.filter((code) => portfolio.positions[code.toUpperCase()]);
  const [heldQuotes, fundamentals] = await Promise.all([
    heldCodes.length ? fetchLiveQuotes(heldCodes, { subscribed, userId }).catch(() => new Map()) : new Map(),
    fetchFundamentals(),
  ]);
  const { results, errors } = await analyzeMany(codes, {
    capital,
    positions: portfolio.positions,
    liveQuotes: heldQuotes,
    fundamentals,
    // AI-backed now (see agent/stopPlanner.js) — lowered from the old
    // pure-math default (was 5) to match REVIEW_CONCURRENCY elsewhere, so a
    // whole-universe scan on a cold cache doesn't fire dozens of simultaneous
    // OpenRouter requests at once.
    concurrency: 3,
    force,
    rules,
    style,
    portfolioId,
  });
  // A held stock that just jumped by a share ratio: settle the holding now
  // rather than on the next half-hourly check.
  if (userId && results.some((r) => r.position && r.corporateAction?.status === 'suspected')) {
    checkCorporateActionsSoon(userId, portfolio, { now: true });
  }
  // Held codes reuse heldQuotes, so a position's P&L and the price shown
  // beside it never come from two different feeds.
  const otherCodes = results.map((result) => result.code).filter((code) => !heldQuotes.has(code));
  const latestQuotes = new Map([...(await fetchLatestQuotes(otherCodes)), ...heldQuotes]);

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
  // A cash plan never puts everything on one stock, even when the whole
  // balance would fit under a single position's cap.
  const MIN_RECOMMENDATIONS = 2;
  const MIN_TICKET_EGP = 5000;
  const maxPositionEgp = capital * (rules.sizing.maxPositionPct / 100);
  const maxRecommendations = investableCash <= 0
    // Nothing to deploy — still surface a few honest "no cash" reasons below
    // instead of an empty screen.
    ? 3
    : Math.max(MIN_RECOMMENDATIONS, Math.min(
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
  const payload = {
    asOf: results[0]?.asOf ?? null,
    count: results.length,
    cash: portfolio.cash,
    // Only set for focus=cash — null means this wasn't a cash scan.
    cashScansLeft: cashScansLeftNow,
    cashScansPerMonth: tier ? (TIERS[tier] ?? TIERS.free).cashScans : null,
    marketAnalysisLeft: marketAnalysisLeftNow,
    marketAnalysisPerMonth: tier ? (TIERS[tier] ?? TIERS.free).marketAnalysis : null,
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
      asOf: r.asOf,
      price: livePrice,
      lastTradePrice: live?.price ?? null,
      lastTradeTime: live?.time ?? null,
      // Priced after the analysis ran, so judged again on this quote.
      halted: live ? tradingHalted(live.time) : r.halted ?? null,
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
    focus: focus ?? 'market',
    style: style ?? 'medium',
    cashPlan: {
      selectedCodes: [...selectedCodes],
      investableCash: +investableCash.toFixed(2),
      reserveCash: +cashReserve.toFixed(2),
      allocationPerStock: +allocationPerStock.toFixed(2),
      unallocatedCash: +(investableCash - investedTotal).toFixed(2),
    },
    errors,
  };
  return { payload, results, rules, capital };
}

// ---- Portfolio -------------------------------------------------------------

app.get('/api/portfolio', wrap(async (req, res) => {
  const p = await loadPortfolio(req.user.id);
  const usage = await getUserUsage(req.user.id);
  checkCorporateActionsSoon(req.user.id, p);
  // /api/portfolio isn't a PAID_PATHS entry (a lapsed account can still read
  // its own data), so req.access isn't guaranteed to be set the way it is on
  // /api/scan — compute it directly rather than assume.
  const tier = req.access?.tier ?? (await accessInfo(req.user)).tier;
  const limits = TIERS[tier] ?? TIERS.free;
  res.json({
    ...p,
    capital: capitalOf(p),
    tracked: trackedCodes(p),
    tier,
    screenshotImportsLeft: screenshotImportsLeft(usage, tier),
    screenshotsPerMonth: limits.screenshots,
    cashScansLeft: cashScansLeft(usage, tier),
    cashScansPerMonth: limits.cashScans,
    recommendationsLeft: leftFor('recommendations', usage, tier),
    recommendationsPerMonth: limits.recommendations,
    marketAnalysisLeft: leftFor('marketAnalysis', usage, tier),
    marketAnalysisPerMonth: limits.marketAnalysis,
    credits: creditsOf(usage),
  });
}));

// Bounds on numbers and text a user types into the book. Generous for any real
// EGX portfolio, tight enough that nothing can overflow the arithmetic or bloat
// the portfolio row that every request for that user has to load.
const MAX_SHARES = 1e10;
const MAX_PRICE = 1e6;
const MAX_MONEY = 1e13;
const MAX_TRADE_NOTE = 500;
const MAX_DAY_NOTE = 2000;
const MAX_WATCH_NOTE = 300;
const isDayString = (value) => typeof value === 'string' && value.length <= 40 && isIsoDate(value.slice(0, 10));

function tradeInputError({ code, side, shares, price, fees, date, note }) {
  if (typeof code !== 'string') return 'الكود لازم يكون نص';
  if (!['buy', 'sell', 'dividend'].includes(side)) return 'نوع الصفقة لازم يكون buy أو sell أو dividend';
  const s = Number(shares);
  const p = Number(price);
  if (!Number.isFinite(s) || s <= 0 || s > MAX_SHARES) return 'عدد الأسهم غير صالح';
  if (!Number.isFinite(p) || p <= 0 || p > MAX_PRICE) return 'السعر غير صالح';
  if (fees != null && fees !== '') {
    const f = Number(fees);
    if (!Number.isFinite(f) || f < 0 || f > s * p) return 'العمولة غير صالحة';
  }
  if (date != null && date !== '' && !isDayString(date)) return 'التاريخ لازم يكون بصيغة YYYY-MM-DD';
  if (note != null && (typeof note !== 'string' || note.length > MAX_TRADE_NOTE)) return `الملاحظة لازم تكون نص (حد أقصى ${MAX_TRADE_NOTE} حرف)`;
  return null;
}

app.post('/api/portfolio/trade', wrap(async (req, res) => {
  const { code, side, shares, price, fees, date, note } = req.body ?? {};
  if (!code || !side || !shares || !price) {
    return res.status(400).json({ error: 'محتاج code و side و shares و price' });
  }
  const invalid = tradeInputError({ code, side, shares, price, fees, date, note });
  if (invalid) return res.status(400).json({ error: invalid });
  const updated = await withPortfolio(req.user.id, (portfolio) =>
    recordTrade(portfolio, { code, side, shares: Number(shares), price: Number(price), fees: fees === '' ? 0 : fees, date, note }),
  );
  res.json({ ...updated, capital: capitalOf(updated) });
}));

// Correct or delete a logged trade (see editTrade). Trades have no ids, so
// the client names one by its index in the log and echoes the row it saw as
// `original`; if the log has moved under it (another tab, a new trade), the
// row at that index won't match and nothing is changed.
function tradeAt(portfolio, req) {
  const index = Number(req.params.index);
  const trade = Number.isInteger(index) ? portfolio.trades?.[index] : null;
  const seen = req.body?.original ?? {};
  const same = trade && ['date', 'code', 'side'].every((key) => trade[key] === seen[key])
    && ['shares', 'price'].every((key) => Number(trade[key]) === Number(seen[key]));
  if (!same) throw new Error('سجل الصفقات اتغير — حدّث الصفحة وجرب تاني.');
  return index;
}

app.post('/api/portfolio/trades/:index', wrap(async (req, res) => {
  const { code, side, shares, price, fees, date, note } = req.body ?? {};
  if (!code || !side || !shares || !price) {
    return res.status(400).json({ error: 'محتاج code و side و shares و price' });
  }
  const invalid = tradeInputError({ code, side, shares, price, fees, date, note });
  if (invalid) return res.status(400).json({ error: invalid });
  const updated = await withPortfolio(req.user.id, (portfolio) =>
    editTrade(portfolio, tradeAt(portfolio, req), { code, side, shares, price, fees: fees === '' ? 0 : fees, date, note }),
  );
  res.json({ ...updated, capital: capitalOf(updated) });
}));

app.post('/api/portfolio/trades/:index/delete', wrap(async (req, res) => {
  const updated = await withPortfolio(req.user.id, (portfolio) =>
    editTrade(portfolio, tradeAt(portfolio, req), null),
  );
  res.json({ ...updated, capital: capitalOf(updated) });
}));

app.post('/api/portfolio/cash', wrap(async (req, res) => {
  const amount = Number(req.body?.cash);
  if (!Number.isFinite(amount) || amount < 0 || amount > MAX_MONEY) return res.status(400).json({ error: 'مبلغ غير صالح' });
  const updated = await withPortfolio(req.user.id, (portfolio) =>
    recordCashFlow({ ...portfolio, cash: amount }, amount - (portfolio.cash ?? 0), 'cash'),
  );
  res.json(updated);
}));

/**
 * Live price per code, falling back to the last synced close — what shares
 * added or removed by hand are worth, for the cash-flow record.
 */
async function currentPrices(codes) {
  const prices = new Map();
  if (!codes.length) return prices;
  const live = await fetchLatestQuotes(codes).catch(() => new Map());
  for (const code of codes) {
    const price = live.get(code)?.price ?? (await readBars(code).catch(() => null))?.bars?.at(-1)?.c;
    if (price > 0) prices.set(code, price);
  }
  return prices;
}

/**
 * Bonus shares, splits and mergers on held stocks. Found in the background
 * (checkCorporateActionsSoon) and at the daily close; see corporateActions.js.
 * The shares move with the feed's own adjustment, and the announced ratio
 * when a search finds one that agrees with it.
 */
const corporateActionResearch = new Map(); // one search per event, shared across users
async function reconcileCorporateActions(userId) {
  const portfolio = await loadPortfolio(userId);
  const codes = Object.keys(portfolio.positions);
  if (!codes.length) return [];
  const quotes = await fetchLatestQuotes(codes).catch(() => new Map());
  const livePrices = new Map([...quotes].map(([code, q]) => [code, q.price]));
  const proposals = await detectCorporateActions(portfolio, {
    today: cairoToday(),
    livePrices,
    barsFor: async (code) => (await readBars(code).catch(() => null))?.bars ?? null,
    freshBarsFor: async (code) => (await getBars(
      code,
      toYahoo(code),
      (yahooSymbol, o) => fetchDailyAuto(code, { ...o, yahooSymbol, source: lookup(code)?.source }),
      { force: true },
    )).bars,
    research: aiAvailable()
      ? (code, candidate) => {
          const key = `${code}:${candidate.lastBefore}:${candidate.factor.toFixed(2)}`;
          if (!corporateActionResearch.has(key)) {
            corporateActionResearch.set(key, researchCorporateAction(code, candidate, { name: lookup(code)?.ar, request: requestStructuredOR }));
          }
          return corporateActionResearch.get(key);
        }
      : null,
    eventFor: (code) => latestEventFor(code).catch(() => null),
  });
  // What was confirmed is the stock's, not just this User's: the analysis
  // rebases everyone's bars with the exact ratio from here on.
  for (const p of proposals) {
    // Only a ratio that was applied: a pending one is still a guess, and
    // recorded as confirmed it would rebase every User's bars with it.
    if (p.status !== 'applied' || !p.confirmedBy || !(p.rawBefore > 0)) continue;
    await recordEvent({ code: p.code, lastBefore: p.lastBefore, rawBefore: p.rawBefore, factor: p.factor, status: 'confirmed', kind: p.kind, summary: p.summary })
      .catch((err) => console.warn('[corporate-actions] event save failed:', err.message));
  }
  if (!proposals.length) return [];
  await withPortfolio(userId, (p) => applyCorporateActions(p, proposals));
  console.log(`[corporate-actions] ${userId}:`, JSON.stringify(proposals.map(({ code, factor, status, confirmedBy }) => ({ code, factor, status, confirmedBy }))));
  return proposals;
}

// Opening the desk looks again at most every half hour per user, in the
// background: the answer lands on the next reload, never holding this one up.
const CORPORATE_ACTION_RECHECK_MS = 30 * 60 * 1000;
// A scan that sees a fresh jump asks sooner, but not on every scan while a
// search is still coming up empty.
const CORPORATE_ACTION_URGENT_RECHECK_MS = 2 * 60 * 1000;
const corporateActionCheckedAt = new Map();
const corporateActionRunning = new Set();
function checkCorporateActionsSoon(userId, portfolio, { now = false } = {}) {
  if (!Object.keys(portfolio.positions ?? {}).length) return;
  const key = `${currentTenant()?.id ?? ''}:${userId}`;
  const last = corporateActionCheckedAt.get(key);
  if (corporateActionRunning.has(key)) return;
  if (last && Date.now() - last < (now ? CORPORATE_ACTION_URGENT_RECHECK_MS : CORPORATE_ACTION_RECHECK_MS)) return;
  corporateActionCheckedAt.set(key, Date.now());
  corporateActionRunning.add(key);
  reconcileCorporateActions(userId)
    .catch((err) => console.warn('[corporate-actions] check failed:', err.message))
    .finally(() => corporateActionRunning.delete(key));
}

app.post('/api/portfolio/corporate-action', wrap(async (req, res) => {
  const { code, lastBefore, action } = req.body ?? {};
  if (typeof code !== 'string' || !isDayString(lastBefore) || !['undo', 'apply', 'dismiss'].includes(action)) {
    return res.status(400).json({ error: 'محتاج code و lastBefore و action (undo/apply/dismiss)' });
  }
  const updated = await withPortfolio(req.user.id, (portfolio) =>
    resolveCorporateAction(portfolio, { code: code.toUpperCase(), lastBefore, action }),
  );
  res.json(updated);
}));

app.post('/api/portfolio/levels', wrap(async (req, res) => {
  const { code, stop, target } = req.body ?? {};
  if (typeof code !== 'string' || !code) return res.status(400).json({ error: 'محتاج code' });
  for (const level of [stop, target]) {
    if (level != null && (!Number.isFinite(Number(level)) || Number(level) < 0 || Number(level) > MAX_PRICE)) {
      return res.status(400).json({ error: 'مستوى الوقف أو الهدف غير صالح' });
    }
  }
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
  if (nextShares != null && (!Number.isFinite(nextShares) || nextShares < 0 || nextShares > MAX_SHARES)) {
    return res.status(400).json({ error: 'عدد الأسهم لازم يكون رقم موجب' });
  }
  if (nextAvgCost != null && (!Number.isFinite(nextAvgCost) || nextAvgCost <= 0 || nextAvgCost > MAX_PRICE)) {
    return res.status(400).json({ error: 'متوسط الشراء لازم يكون أكبر من صفر' });
  }

  // Fetched outside the lock; only a share-count change moves the book's value.
  const prices = nextShares != null ? await currentPrices([c]) : new Map();
  const updated = await withPortfolio(req.user.id, (portfolio) => {
    const existing = portfolio.positions[c];
    if (!existing) throw new Error(`مفيش مركز مفتوح في ${c}`);
    const positions = { ...portfolio.positions };

    // Zero shares means the position is closed out entirely.
    if (nextShares === 0) {
      delete positions[c];
    } else {
      const { derivedFromScreenshot, reportedValue, reportedPnl, ...rest } = existing;
      positions[c] = {
        ...rest,
        shares: nextShares ?? existing.shares,
        avgCost: nextAvgCost ?? existing.avgCost,
      };
    }
    return recordCashFlow({ ...portfolio, positions }, positionsFlow(portfolio.positions, positions, prices), 'holding');
  });
  res.json(updated);
}));

/** The user's favorite stocks — just codes to keep an eye on, no order plan attached. */
app.post('/api/portfolio/watchlist', wrap(async (req, res) => {
  const { code, note, remove } = req.body ?? {};
  if (!code) return res.status(400).json({ error: 'محتاج code' });
  const c = String(code).toUpperCase();
  // Removing is always allowed (so a stale entry can be cleared); adding
  // needs a real ticker and a bounded note, or the watchlist becomes a way to
  // store arbitrary data in the portfolio row.
  if (!remove) {
    if (!lookup(c)) return res.status(400).json({ error: 'السهم مش موجود' });
    if (note != null && (typeof note !== 'string' || note.length > MAX_WATCH_NOTE)) {
      return res.status(400).json({ error: `الملاحظة لازم تكون نص (حد أقصى ${MAX_WATCH_NOTE} حرف)` });
    }
  }
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
  const portfolioId = await primaryPortfolioIdFor(userId);
  return withPortfolio(userId, async (portfolio) => {
    const codes = Object.keys(portfolio.positions);
    // Whatever style this account has active — same resolution the admin
    // panel's "chosen style" column uses — so the ratchet the AI applies here
    // (see agent/stopPlanner.js) matches what the desk itself would compute
    // for the same day, rather than defaulting to a style the user never
    // asked for.
    const style = STYLE_KEYS.includes(portfolio.settings?.investStyle) ? portfolio.settings.investStyle : DEFAULT_STYLE;
    const rules = rulesForStyle(RULES, style);
    const { results } = await analyzeMany(codes, {
      capital: capitalOf(portfolio),
      positions: portfolio.positions,
      concurrency: 3,
      rules,
      style,
      portfolioId,
    });
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
    // A holding whose analysis failed (fetch error, quality gate) or has no
    // cost basis would otherwise drop out of the total — a phantom loss that
    // day and a phantom gain the next. Value it at the live quote, else its
    // last saved price; with neither, save nothing rather than a short total.
    const priced = new Set(withLivePrices.filter((r) => r.usable && r.position).map((r) => r.code));
    const days = Object.keys(portfolio.log ?? {}).sort().reverse();
    const fallback = codes.filter((code) => !priced.has(code)).map((code) => {
      const pos = portfolio.positions[code];
      const lastSaved = days.map((d) => portfolio.log[d].prices?.[code]).find((p) => p > 0);
      const price = live.get(code)?.price ?? lastSaved;
      if (!(price > 0)) throw new Error(`مفيش سعر متاح لـ ${code} — إغلاق اليوم متسجلش عشان الإجمالي ميطلعش ناقص.`);
      return {
        code,
        usable: true,
        snapshot: { price: { close: price, changePct: live.get(code)?.changePct ?? null } },
        position: {
          shares: pos.shares,
          avgCost: pos.avgCost,
          stop: pos.stop ?? null,
          marketValue: +(pos.shares * price).toFixed(2),
          unrealizedEgp: +(pos.shares * (price - pos.avgCost)).toFixed(2),
        },
      };
    });
    return recordSnapshot(portfolio, [...withLivePrices, ...fallback], date);
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
 * Run at 14:30 Cairo by startDailyCloseScheduler() below, and as a backup by
 * both .github/workflows/daily-close-cron.yml (over the VPS's loopback
 * interface, same pattern as /api/cron/blog-generate) and an external cron
 * pinger hitting this route's public URL directly — GitHub Actions' own
 * `schedule` trigger has silently skipped whole days (see the comment above
 * that workflow's cron block), so a second, independently-hosted backup
 * covers the case where GitHub drops the run entirely rather than just
 * running it late. The external pinger is gated by the same X-Cron-Secret
 * check below, same as the other two callers.
 * GitHub Actions cron is UTC-only and Cairo alternates between EET (UTC+2)
 * and EEST (UTC+3) across the year, so that workflow fires at both possible
 * UTC times for 14:30 Cairo and this endpoint no-ops if the session hasn't
 * closed yet in Cairo — that keeps the trigger correct across DST without the
 * workflow's cron schedule needing manual updates twice a year. There's no
 * upper bound: GitHub routinely starts scheduled runs 30-60+ minutes late, and
 * a narrow window around 14:30 turned those late runs into silent no-ops.
 * Re-running later the same day just overwrites today's entry with the same
 * closing prices.
 * Snapshots every user with open positions, the same as each of them
 * clicking "سجّل إغلاق اليوم" used to. Skipped on Fridays, Saturdays and
 * EGX bank holidays — there's no session, so no close to record.
 */
const DAILY_CLOSE_CRON_SECRET = process.env.DAILY_CLOSE_CRON_SECRET;
const DAILY_CLOSE_AT = '14:30';
const cairoClock = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Africa/Cairo',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

app.post('/api/cron/daily-close', cronLimiter, wrap(async (req, res) => {
  if (!safeEqual(req.get('X-Cron-Secret'), DAILY_CLOSE_CRON_SECRET)) {
    return res.status(403).json({ error: 'forbidden' });
  }
  res.json(await runDailyCloseForAllSites());
}));

/** runDailyClose once per active site, each against its own database. One site failing doesn't stop the rest. */
async function runDailyCloseForAllSites() {
  const sites = {};
  for (const tenant of activeTenants()) {
    try {
      sites[tenant.id] = await runWithTenant(tenant, runDailyClose);
    } catch (err) {
      console.error(`[daily-close] ${tenant.id} failed:`, err.message);
      sites[tenant.id] = { ok: false };
    }
  }
  // Top level mirrors the original site's result, which is what the backup
  // workflow and the scheduler log have always shown.
  return { ...(sites[defaultTenant().id] ?? {}), sites };
}

async function runDailyClose() {
  const today = cairoToday();
  if (!isTradingDay(today)) {
    return { ok: true, skipped: 'not_a_trading_day', date: today };
  }
  const cairoNow = cairoClock.format(new Date());
  if (cairoNow < DAILY_CLOSE_AT) {
    return { ok: true, skipped: true, cairoNow };
  }

  const portfolios = await getAllPortfolios();
  const userIds = portfolios
    .filter((row) => Object.keys(row.state_json?.positions ?? {}).length > 0)
    .map((row) => row.user_id);

  let saved = 0;
  let failed = 0;
  for (const userId of userIds) {
    // Before the close is saved, so a bonus issue or split landing today
    // doesn't go into the log as a day's loss.
    await reconcileCorporateActions(userId).catch((err) => console.warn(`[daily-close] corporate actions for ${userId}:`, err.message));
    try {
      await snapshotForUser(userId);
      saved += 1;
    } catch {
      failed += 1;
    }
  }
  // Bars for the evaluate-recommendations Edge Function, which pg_cron runs
  // after this (see supabase/recommendations-cron.sql). Its own failure
  // shouldn't hide the snapshot result above.
  let recommendationPrices;
  try {
    recommendationPrices = await recordRecommendationPrices();
  } catch (err) {
    console.error('[daily-close] recommendation prices failed:', err.message);
    recommendationPrices = { ok: false };
  }
  return { ok: true, cairoNow, total: userIds.length, saved, failed, recommendationPrices };
}

/**
 * The primary 14:30 trigger, running inside this long-lived process. GitHub's
 * scheduled runs can't be trusted with the time: on 2026-09-14 both 14:30 runs
 * were dropped and the first backup started at 20:00 Cairo. The workflow stays
 * as a backup — a later run just overwrites today's entry with the same
 * closing prices. Checks the Cairo clock every 30 seconds, so it's DST-proof
 * the same way the endpoint is. Only the in-memory date guards against a
 * second run, so a restart after 14:30 on a trading day records once more;
 * that is the same harmless overwrite as a backup run.
 */
let dailyCloseRanFor = null;
function startDailyCloseScheduler() {
  setInterval(async () => {
    const today = cairoToday();
    if (dailyCloseRanFor === today || cairoClock.format(new Date()) < DAILY_CLOSE_AT) return;
    dailyCloseRanFor = today;
    try {
      console.log('[daily-close]', JSON.stringify(await runDailyCloseForAllSites()));
    } catch (err) {
      dailyCloseRanFor = null; // retry on the next tick
      console.error('[daily-close] failed:', err.message);
    }
  }, 30_000);
}

/**
 * Keeps ai_stop_plans warm for the whole tracked universe (see
 * agent/stopPlanWarmer.js) — the same always-on-process approach as
 * startDailyCloseScheduler, but simpler: this job is naturally idempotent,
 * so it just ticks and generates the next missing batch, becoming a fast
 * no-op once today's set is fully covered. No GitHub Actions backup needed
 * for the same reason — a restart loses nothing, the next tick resumes from
 * whatever's already stored.
 *
 * Runs hourly during the trading session, anchored at 09:30 Cairo (before
 * the 10:00 open) through one last run at 13:30, then stops — nothing after
 * STOP_PLAN_STOP_AT (14:30, the same close-of-session cutoff runDailyClose()
 * uses). A plain setInterval can't anchor to a wall-clock time, so this
 * checks the clock every 30s (same cadence as startDailyCloseScheduler) and
 * fires once per 09:30-anchored hour slot via the in-memory guard below.
 */
const STOP_PLAN_START_AT = '09:30';
const STOP_PLAN_STOP_AT = '14:30';
const minutesOfDay = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
let stopPlanRanForSlot = null;
function startStopPlanScheduler() {
  setInterval(async () => {
    if (!aiAvailable()) return;
    const cairoNow = cairoClock.format(new Date());
    if (cairoNow < STOP_PLAN_START_AT || cairoNow >= STOP_PLAN_STOP_AT) return;
    const hourSlot = Math.floor((minutesOfDay(cairoNow) - minutesOfDay(STOP_PLAN_START_AT)) / 60);
    const slot = `${cairoToday()}:${hourSlot}`;
    if (stopPlanRanForSlot === slot) return;
    stopPlanRanForSlot = slot;
    try {
      const { warmNextStopPlans } = await import('../agent/stopPlanWarmer.js');
      const result = await warmNextStopPlans();
      if (result.generated) console.log('[stop-plan]', JSON.stringify(result));
    } catch (err) {
      stopPlanRanForSlot = null; // retry within this same hour slot on the next check
      console.error('[stop-plan] failed:', err.message);
    }
  }, 30_000);
}

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
        // Valued with today's cash and shares, so every earlier flow is in it.
        savedAt: new Date().toISOString(),
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
  if (!isDayString(date) || (note != null && (typeof note !== 'string' || note.length > MAX_DAY_NOTE))) {
    return res.status(400).json({ error: 'التاريخ أو الملاحظة غير صالحة' });
  }
  const updated = await withPortfolio(req.user.id, (portfolio) => setNote(portfolio, date, note ?? ''));
  res.json({ ok: true, entry: updated.log[date] });
}));

app.get('/api/settings', wrap(async (req, res) => {
  const p = await loadPortfolio(req.user.id);
  // commissionPct was a setting before trades carried their own fees; older books still store it.
  const { commissionPct: _retired, ...settings } = p.settings ?? {};
  res.json({ settings: { ...RULES, ...settings }, rules: RULES });
}));

// The investment style picked in settings. The browser keeps the working copy
// (lib/invest-style.ts); this mirror lets it follow the user across devices and
// lets the admin users list tell a manual pick from an inferred one.
// `null` clears it — back to inferring the style from the trade history.
app.post('/api/settings/style', wrap(async (req, res) => {
  const style = req.body?.style ?? null;
  if (style !== null && !STYLE_KEYS.includes(style)) {
    return res.status(400).json({ error: 'أسلوب غير معروف' });
  }
  const updated = await withPortfolio(req.user.id, (portfolio) => {
    const { investStyle: _previous, ...settings } = portfolio.settings ?? {};
    return { ...portfolio, settings: style ? { ...settings, investStyle: style } : settings };
  });
  res.json({ ok: true, settings: updated.settings });
}));

/** Wipe the log and trades, keeping positions. Destructive and irreversible. */
app.post('/api/reset', wrap(async (req, res) => {
  const scope = req.body?.scope ?? 'log';
  if (scope !== 'log' && scope !== 'all') return res.status(400).json({ error: 'نطاق المسح غير معروف' });
  await withPortfolio(req.user.id, (portfolio) =>
    scope === 'all'
      // imports survives the wipe — behaviorProfile() reads it to know
      // whether the account has ever imported a screenshot, wipe or not.
      // The monthly feature caps (usage/credits/lastCashScanAt/lastMarketScanAt)
      // now live on the User's usage row (see getUserUsage/putUserUsage in
      // db.js), not the Portfolio, so a Portfolio reset — any scope — can
      // never touch them; there is nothing here left to preserve.
      ? { cash: 0, positions: {}, watchlist: {}, trades: [], log: {}, settings: portfolio.settings, realizedPnl: 0, imports: portfolio.imports }
      : { ...portfolio, log: {}, trades: [], realizedPnl: 0 },
  );
  res.json({ ok: true, scope });
}));

// ---- Portfolio screenshot import -----------------------------------------

const screenshotAliases = new Map([
  ['CIB', 'COMI'], ['COMMERCIAL INTERNATIONAL BANK', 'COMI'],
  ['TMG', 'TMGH'], ['TAQA ARABIA', 'TAQA'], ['CREDIT AGRICOLE', 'CIEB'],
  ['EFG HERMES', 'HRHO'], ['EFG HERMES HOLDING', 'HRHO'], ['MOBILENIL', 'ETEL'],
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
  // Brokers abbreviate big amounts ("EGP 111.78K"); left alone that would read as 111.78.
  const scale = { k: 1e3, m: 1e6 }[/\d\s*([KkMm])(?![A-Za-z])/.exec(arabicDigits)?.[1]?.toLowerCase()] ?? 1;
  return cleaned ? Number(cleaned) * scale : NaN;
};

function resolveScreenshotCode(item) {
  const raw = normalizeScreenshotText(item.code ?? item.symbol ?? item.ticker);
  // `raw` is already normalized (punctuation -> space), so "LUTS.CA" and
  // "EGX:COMI" arrive here as "LUTS CA" / "EGX COMI".
  const compact = raw.replace(/ (CA|EGX)$/, '').replace(/^EGX /, '').replace(/\s+/g, '');
  if (lookup(compact)) return compact;
  if (screenshotAliases.has(raw)) return screenshotAliases.get(raw);
  if (screenshotAliases.has(compact)) return screenshotAliases.get(compact);

  const nameText = normalizeScreenshotText(item.name ?? item.company ?? item.companyName);
  if (!nameText) return null;
  if (screenshotAliases.has(nameText)) return screenshotAliases.get(nameText);
  // Some layouts show only the ticker, and the model files it under "name".
  const nameAsCode = nameText.replace(/ (CA|EGX)$/, '').replace(/^EGX /, '').replace(/\s+/g, '');
  if (/^[A-Z0-9]{2,10}$/.test(nameAsCode) && lookup(nameAsCode)) return nameAsCode;
  // Broker lists cut long names off ("EFG Hermes Hold.."), so a long-enough
  // alias may match by prefix in either direction. The length floor keeps a
  // short ticker-like alias (CIB, TMG) from prefix-matching unrelated names.
  for (const [alias, aliasCode] of screenshotAliases) {
    if (alias.length >= 8 && nameText.length >= 8 && (alias.startsWith(nameText) || nameText.startsWith(alias))) return aliasCode;
  }
  const match = UNIVERSE.find((stock) => [stock.en, stock.ar].some((name) => {
    const normalized = normalizeScreenshotText(name);
    return normalized && (normalized === nameText || normalized.includes(nameText) || nameText.includes(normalized));
  }));
  return match?.code ?? null;
}

// Alytic doesn't support ETFs. One in the image must not be imported at all:
// the vision model, told to use the ticker list, will happily map an ETF onto
// whichever stock's name it resembles. The model's own flag is checked
// alongside the raw name/code, since either can be the one that gives it away.
// Deliberately not a bare "fund" match — EGREF (Egyptians Real Estate Fund)
// is a supported listed instrument.
const ETF_UNSUPPORTED_MESSAGE = 'الصورة فيها صندوق مؤشرات (ETF)، والتطبيق مش بيدعمها — مفيش حاجة اتضافت. ارفع صورة فيها أسهم بس، أو ضيفها من «إدخال يدوي».';
function isEtfHolding(item) {
  if (item?.isEtf === true || item?.isEtf === 'true') return true;
  const text = normalizeScreenshotText([item?.code, item?.symbol, item?.ticker, item?.name, item?.company, item?.companyName, item?.assetType, item?.type].filter(Boolean).join(' '));
  return /\b(ETFS?|EXCHANGE TRADED)\b/.test(text) || /(صندوق|صناديق) (ال)?مؤشر/.test(text);
}

// Every image is a vision-model call, so each account gets that tier's
// monthly allowance of successful imports (see TIERS in
// src/billing/plans.js). portfolio.imports is a separate, capped-at-20-entries
// log of the imports themselves (read by behaviorProfile() to know whether
// the account has ever imported a screenshot) — it is no longer what this
// cap counts against.
const SCREENSHOT_LIMIT_MESSAGE = 'خلصت عدد صور المحفظة المسموح بيه الشهر ده — تقدر تكمّل الشهر الجاي، أو كلّمنا في الشات لو محتاج رصيد إضافي.';

function screenshotImportsLeft(usage, tier) {
  return leftFor('screenshots', usage, tier);
}

app.post('/api/portfolio/import-screenshot', express.raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: '8mb' }), wrap(async (req, res) => {
  if (!aiAvailable()) return res.status(503).json({ error: 'استيراد الصورة محتاج OPENROUTER_API_KEY في .env' });
  if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'ارفع صورة لمحفظتك أولاً' });
  // Checked before the model call so an exhausted allowance costs nothing.
  if (screenshotImportsLeft(await getUserUsage(req.user.id), req.access.tier) <= 0) {
    return res.status(429).json({ error: SCREENSHOT_LIMIT_MESSAGE, reason: 'screenshot_limit', screenshotImportsLeft: 0 });
  }

  const mediaType = checkedImageType(req);
  if (!mediaType) return res.status(415).json({ error: NOT_AN_IMAGE_MESSAGE });
  const response = await callWithRetry(() => getOpenRouterClient().chat.completions.create({
    model: SCREENSHOT_VISION_MODEL,
    max_tokens: 4000,
    messages: [
      { role: 'system', content: `You extract stock portfolio data from an image. Never guess a number that is not visible. Return JSON only, without markdown, using this shape: {"cash":number|null,"positions":[{"code":"EGX ticker or null","name":"company name as shown","shares":number|null,"marketValue":number|null,"profit":number|null,"returnPct":number|null,"avgCost":number|null,"lastPrice":number|null,"stop":number|null,"target":number|null,"isEtf":boolean}]}. If the ticker is not visible, write the company name as shown. A ticker may carry a suffix such as ".CA" (LUTS.CA) — copy it as shown.

The image may be a watchlist rather than holdings: rows with only a name, ticker, price and daily change %, and no quantity. List every stock in it anyway, with "shares" null and the price in "lastPrice". The daily change % is not "returnPct".

Set "isEtf" to true for any holding that is an ETF / exchange-traded index fund (صندوق مؤشرات، e.g. a gold ETF or an EGX30 ETF) and false otherwise. For an ETF, keep "name" and "code" exactly as shown and never map it to a ticker from the reference list below. A listed fund that is itself in that reference list (e.g. EGREF, Egyptians Real Estate Fund) is not an ETF.

The single most valuable field is "shares" — the number of shares held (الكمية / عدد الأسهم / كمية). Look for it carefully, including in small print, a secondary line under the company name, or a detail row. A whole number sitting beside a company with no currency symbol is usually the quantity, not a price. Only use null for it if you genuinely cannot see it.

Nearly as valuable is a per-share price: "avgCost" (متوسط التكلفة / متوسط الشراء) and "lastPrice" (السعر الحالي / آخر سعر). These let the share count be recovered exactly from the same screen when quantity is missing, so extract them whenever visible.

"profit" is the position's unrealized gain or loss in EGP (الربح / الخسارة), usually a coloured amount beside a percentage — make it negative when it is red, has a down arrow (▼) or a minus sign. "returnPct" is that same total return as a percentage, not the day's change. Write abbreviated amounts in full (6.79K -> 6790, 1.2M -> 1200000). If the ticker is visible (BWS, AMER, TALM...), put it in "code" and the company name, if there is one, in "name".

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
    console.warn(`[screenshot] model output was not JSON (${SCREENSHOT_VISION_MODEL}):`, text.slice(0, 1500));
    throw new Error('الصورة لم تعطِ بيانات محفظة قابلة للقراءة');
  }

  const extractedPositions = extracted.positions ?? extracted.holdings ?? extracted.stocks ?? [];
  const rows = Array.isArray(extractedPositions)
    ? extractedPositions
    : Object.entries(extractedPositions).map(([code, value]) => ({ ...(value && typeof value === 'object' ? value : { shares: value }), code }));
  // Rejected before anything is saved, so the image adds nothing (not even
  // cash) and doesn't use up the day's import allowance.
  if (rows.some(isEtfHolding)) {
    return res.status(422).json({ error: ETF_UNSUPPORTED_MESSAGE, reason: 'etf_unsupported' });
  }
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
  const importedAt = new Date().toISOString();
  if (!Object.keys(positions).length) {
    // No quantity or value anywhere: a watchlist screenshot (or a holdings one
    // whose numbers weren't readable). The stocks still say what the user cares
    // about, so they go to the watchlist — and only there: positions and cash
    // are left untouched, whichever of merge/replace was asked for.
    const watchCodes = [...new Set(parsed.map((p) => p.code).filter((c) => c && ALL_CODES.includes(c)))];
    if (!watchCodes.length) {
      console.warn(`[screenshot] nothing usable (${SCREENSHOT_VISION_MODEL}):`, JSON.stringify(rows).slice(0, 1500));
      throw new Error('اتقرت أكواد الأسهم، لكن الصورة لا تحتوي كمية أو قيمة مركز قابلة للحساب');
    }
    const { usage: updatedUsage, portfolio: updated } = await withPortfolioAndUsage(req.user.id, ({ usage, portfolio }) => {
      if (leftFor('screenshots', usage, req.access.tier) <= 0) throw new Error(SCREENSHOT_LIMIT_MESSAGE);
      const watchlist = { ...portfolio.watchlist };
      for (const c of watchCodes) watchlist[c] ??= { addedAt: importedAt, note: null };
      const nextUsage = bumpUsage(usage, 'screenshots');
      return {
        usage: baseLeftFor('screenshots', usage, req.access.tier) > 0 ? nextUsage : addCredits(nextUsage, { screenshots: -1 }),
        portfolio: { ...portfolio, watchlist },
      };
    });
    return res.json({
      ok: true,
      importedAt,
      positions: 0,
      watchlisted: watchCodes.length,
      derivedPositions: 0,
      screenshotImportsLeft: screenshotImportsLeft(updatedUsage, req.access.tier),
      portfolio: { ...updated, capital: capitalOf(updated) },
    });
  }

  const merge = req.query.merge === '1';
  const cashFromScreenshot = numberFromScreenshot(extracted.cash);
  // Prices for every code the import can add or remove, to record the value it
  // moves as a cash flow — fetched here, outside the lock.
  const importPrices = await currentPrices([
    ...new Set([...Object.keys(positions), ...Object.keys((await loadPortfolio(req.user.id)).positions)]),
  ]);
  // Only the merge-and-save is locked. The AI extraction above can take
  // several seconds; holding the per-user write lock for that whole span
  // would block ordinary trades/cash edits for no reason, since none of it
  // touches portfolio state until this point.
  const { usage: updatedUsage, portfolio: updated } = await withPortfolioAndUsage(req.user.id, ({ usage, portfolio }) => {
    // Re-checked under the lock: parallel requests all pass the early check
    // while none of them has been recorded yet.
    if (leftFor('screenshots', usage, req.access.tier) <= 0) throw new Error(SCREENSHOT_LIMIT_MESSAGE);
    const next = {
      ...portfolio,
      // A merge keeps each already-held position's place in the Order added;
      // stocks new to the portfolio go after them, in screenshot row order.
      positions: merge ? { ...portfolio.positions, ...keepAddedOrder(portfolio.positions, positions) } : positions,
      ...(Number.isFinite(cashFromScreenshot) && cashFromScreenshot >= 0 ? { cash: cashFromScreenshot } : {}),
      imports: [...(portfolio.imports ?? []), { importedAt, positions: Object.keys(positions), source: 'screenshot' }].slice(-20),
    };
    const flow = (next.cash ?? 0) - (portfolio.cash ?? 0) + positionsFlow(portfolio.positions, next.positions, importPrices);
    const withFlow = recordCashFlow(next, flow, 'screenshot');
    const nextUsage = bumpUsage(usage, 'screenshots');
    return {
      usage: baseLeftFor('screenshots', usage, req.access.tier) > 0 ? nextUsage : addCredits(nextUsage, { screenshots: -1 }),
      portfolio: withFlow,
    };
  });
  res.json({
    ok: true,
    importedAt,
    positions: Object.keys(positions).length,
    derivedPositions,
    screenshotImportsLeft: screenshotImportsLeft(updatedUsage, req.access.tier),
    portfolio: { ...updated, capital: capitalOf(updated) },
  });
}));

function keepAddedOrder(held, incoming) {
  return Object.fromEntries(Object.entries(incoming).map(([code, pos]) => [
    code,
    Number.isFinite(held[code]?.addedOrder) ? { ...pos, addedOrder: held[code].addedOrder } : pos,
  ]));
}

// ---- AI endpoints ----------------------------------------------------------

async function runReview({ userId, style, force }) {
  // The style sets both halves: the rule numbers the engine sizes with and
  // the horizon the analyst reasons in. Both must come from the same choice,
  // or the prose will argue against the numbers underneath it.
  const rules = style ? rulesForStyle(RULES, style) : RULES;
  const effectiveStyle = style ?? 'medium';

  const portfolio = await loadPortfolio(userId);
  const portfolioId = await primaryPortfolioIdFor(userId);
  const capital = capitalOf(portfolio);

  // An empty book has no personal fit to judge — the honest answer to "what
  // do I do with my cash" is identical for every such user on a given day.
  // Serve today's cached, shared market report instead of paying for a
  // personalized AI call that would just re-derive the same market view.
  if (!Object.keys(portfolio.positions).length) {
    const { getOrGenerateMarketAnalysis, reviewFromMarketReport } = await import('../agent/marketAnalysis.js');
    const report = await getOrGenerateMarketAnalysis({ rules, style: effectiveStyle });
    const review = reviewFromMarketReport(report, { cash: portfolio.cash }, trackedCodes(portfolio));
    const opportunities = new Map((report.topOpportunities ?? []).map((op) => [op.code, op]));
    void logRecommendations(
      userId,
      portfolioId,
      review.verdicts
        .filter((v) => opportunities.has(v.code))
        .map((v) => ({ code: v.code, action: v.action, levels: levelsFromOpportunity(opportunities.get(v.code), effectiveStyle) })),
      { source: 'market_report', style: effectiveStyle, model: report._meta?.model },
    );
    return { review, analyses: [], errors: [], style: effectiveStyle, source: 'daily_market_report', marketAnalysisAsOf: report.asOf };
  }

  const codes = trackedCodes(portfolio);
  const { results, errors } = await analyzeMany(codes, {
    capital,
    positions: portfolio.positions,
    concurrency: 3,
    rules,
    style: effectiveStyle,
    portfolioId,
  });

  const { getOrGenerateReview } = await import('../agent/analyst.js');
  const { review, source } = await getOrGenerateReview(
    portfolio,
    results,
    { cash: portfolio.cash, capital },
    { portfolioId, rules, style: effectiveStyle, force },
  );
  // Only a freshly written review is new advice; a cached one was logged when it was written.
  if (source === 'ai') {
    const byCode = new Map(results.map((a) => [a.code, a]));
    void logRecommendations(
      userId,
      portfolioId,
      (review.verdicts ?? [])
        .filter((v) => byCode.has(v.code))
        .map((v) => ({ code: v.code, action: v.action, levels: levelsFromAnalysis(byCode.get(v.code), effectiveStyle) })),
      { source: 'portfolio_review', style: effectiveStyle, model: review._meta?.model },
    );
  }
  return { review, analyses: results, errors, style: effectiveStyle, source };
}

// A full review runs for minutes — well past nginx's 180s proxy_read_timeout
// (deploy/nginx/egxpert.conf) — so it runs as an in-process background job and
// the client polls /api/review/status instead of holding one request open.
// In-memory is enough: a single backend process serves every request, and a
// restart just means the client is told to try again.
const reviewJobs = new Map(); // `${userId}:${style}[:${code}]` -> { status, startedAt, result?, error? }
const REVIEW_INLINE_WAIT_MS = 20_000;
const REVIEW_STATUS_WAIT_MS = 15_000;
const REVIEW_JOB_TTL_MS = 30 * 60_000;

function reviewJobKey(userId, style, code = null) {
  return `${currentTenant()?.id ?? ''}:${userId}:${style ?? 'medium'}${code ? `:${code}` : ''}`;
}

function sendReviewJob(res, job) {
  if (job.status === 'running') return res.json({ status: 'running', startedAt: job.startedAt });
  if (job.status === 'error') return res.status(500).json({ error: job.error });
  return res.json(job.result);
}

/** Starts `run` as a background job (or joins the one already running) and answers inline if it finishes quickly. */
async function startReviewJob(res, key, run) {
  const now = Date.now();
  for (const [k, j] of reviewJobs) {
    if (j.status !== 'running' && now - j.finishedAt > REVIEW_JOB_TTL_MS) reviewJobs.delete(k);
  }

  const existing = reviewJobs.get(key);
  if (existing?.status === 'running') return sendReviewJob(res, existing);

  const job = { status: 'running', startedAt: new Date().toISOString() };
  job.promise = run()
    .then((result) => Object.assign(job, { status: 'done', result, finishedAt: Date.now() }))
    .catch((err) => {
      console.error(`[review] ${key} failed:`, err);
      // A model-provider or database error's text can name endpoints, keys' owners
      // or tables — only this app's own (Arabic) messages are shown to the user.
      Object.assign(job, { status: 'error', error: publicError(err).message || 'تعذر تحليل المحفظة', finishedAt: Date.now() });
    });
  reviewJobs.set(key, job);

  // A cached review finishes in seconds — answer it in this same request.
  await Promise.race([job.promise, new Promise((r) => setTimeout(r, REVIEW_INLINE_WAIT_MS))]);
  sendReviewJob(res, job);
  if (job.status === 'error') reviewJobs.delete(key);
}

function reviewPreflight(req, res) {
  if (!aiAvailable()) {
    res.status(503).json({
      error: 'مفيش مفتاح API. حط OPENROUTER_API_KEY في .env — التحليل الفني شغال من غيره.',
      aiAvailable: false,
    });
    return null;
  }
  const style = req.body?.style ?? req.query.style;
  if (style && !STYLE_KEYS.includes(style)) {
    res.status(400).json({ error: `أسلوب غير معروف: ${style}` });
    return null;
  }
  // Regenerating skips the per-day cache and pays for a fresh model call, so
  // only admins may force it — everyone else gets today's cached review.
  const force = Boolean(req.user.isAdmin) && (req.body?.force === true || req.query.force === '1');
  return { style, force };
}

app.post('/api/review', wrap(async (req, res) => {
  const pre = reviewPreflight(req, res);
  if (!pre) return;
  await startReviewJob(res, reviewJobKey(req.user.id, pre.style), () => runReview({ userId: req.user.id, ...pre }));
}));

app.post('/api/review/stock', wrap(async (req, res) => {
  const pre = reviewPreflight(req, res);
  if (!pre) return;
  const code = String(req.body?.code ?? '').toUpperCase();
  const portfolio = await loadPortfolio(req.user.id);
  if (!portfolio.positions[code]) return res.status(400).json({ error: `مفيش مركز مفتوح في ${code || 'السهم ده'}` });

  const userId = req.user.id;
  const portfolioId = await primaryPortfolioIdFor(userId);
  const tier = req.access.tier;
  const jobKey = reviewJobKey(userId, pre.style, code);
  // The live price on the card when it was asked for — only used to tell the
  // user later how far the price has moved since this recommendation.
  const sentPrice = Number(req.body?.price);
  const requestPrice = Number.isFinite(sentPrice) && sentPrice > 0 && sentPrice <= MAX_PRICE ? sentPrice : null;

  // A recommendation is a pure spend-until-empty credit: every explicit
  // request pays for a fresh model call and draws one use from that
  // account's monthly recommendations balance (see TIERS) — asking again for
  // the same stock the same day is a new use, not a free re-read from a
  // cache. Joining a review that's already running (a duplicate click, not a
  // second ask) is the only free case.
  const joiningRunningJob = reviewJobs.get(jobKey)?.status === 'running';
  // Suspended: no order could be filled, so a recommendation would only
  // spend a credit on advice nobody can act on.
  const halted = tradingHalted((await fetchLatestQuotes([code]).catch(() => new Map())).get(code)?.time);
  if (!joiningRunningJob && halted) {
    return res.status(409).json({ error: `${code} موقوف عن التداول من ${halted.since} — التوصية هتتاح أول ما التداول يرجع.`, reason: 'halted' });
  }
  if (!joiningRunningJob && leftFor('recommendations', await getUserUsage(userId), tier) <= 0) {
    return res.status(429).json({ error: 'خلص رصيد التوصيات المتاح.', reason: 'recommendation_credit_limit' });
  }

  await startReviewJob(res, jobKey, async () => {
    const startedAt = Date.now();
    const rules = pre.style ? rulesForStyle(RULES, pre.style) : RULES;
    const capital = capitalOf(portfolio);
    let analyses = [];
    const { getOrGenerateStockReview } = await import('../agent/analyst.js');
    const { verdict, source } = await getOrGenerateStockReview(
      code,
      { cash: portfolio.cash, capital },
      {
        rules, style: pre.style ?? 'medium',
        // Every holding, not just this one: weights and sector mix need the whole book.
        loadAnalyses: async () => {
          const t = Date.now();
          const { results } = await analyzeMany(Object.keys(portfolio.positions), {
            capital,
            positions: portfolio.positions,
            concurrency: 3,
            rules,
            style: pre.style ?? 'medium',
            portfolioId,
          });
          console.log(`[review] ${code} analyzeMany ${Object.keys(portfolio.positions).length} holdings in ${Date.now() - t}ms`);
          analyses = results;
          return results;
        },
      },
    );
    // A duplicate click joining the same in-flight job spends nothing extra.
    // The verdict itself is kept on the portfolio as the stock's last
    // recommendation: the card shows it on every device until the user asks
    // for a new one (see rememberVerdict).
    await withPortfolioAndUsage(userId, ({ usage, portfolio: p }) => {
      const kept = rememberVerdict(p, code, verdict, {
        style: pre.style ?? 'medium',
        price: requestPrice,
        stop: stopContextOf(analyses.find((a) => a.code === code), verdict),
      });
      if (joiningRunningJob) return { usage, portfolio: kept };
      const next = bumpUsage(usage, 'recommendations');
      return {
        usage: baseLeftFor('recommendations', usage, tier) > 0 ? next : addCredits(next, { recommendations: -1 }),
        portfolio: kept,
      };
    });
    console.log(`[review] ${code} ${source} in ${Date.now() - startedAt}ms`);
    const analysis = analyses.find((a) => a.code === code);
    if (analysis && verdict?.action) {
      void logRecommendations(userId, portfolioId, [{ code, action: verdict.action, levels: levelsFromAnalysis(analysis, pre.style ?? 'medium') }], {
        source: 'stock_review', style: pre.style ?? 'medium', model: verdict._meta?.model,
      });
    }
    return { verdict, source, code };
  });
}));

// The AI read on the cash plan (see agent/cashAnalysis.js) — the market dialog
// asks for it right after its own focus=cash scan loads, for the same index
// and style. Its job key has its own `cash:` namespace so it never collides
// with a stock review's.
function cashReviewJobKey(userId, style, index) {
  return `${userId}:cash:${style ?? 'medium'}:${index}`;
}

app.post('/api/review/cash', wrap(async (req, res) => {
  const pre = reviewPreflight(req, res);
  if (!pre) return;
  const index = String(req.body?.index ?? 'ALL').toUpperCase();
  const indexCodes = index === 'ALL' ? ALL_CODES : await codesForIndex(index);
  if (!indexCodes) return res.status(400).json({ error: `مؤشر غير معروف: ${index}` });

  const userId = req.user.id;
  const portfolioId = await primaryPortfolioIdFor(userId);
  const portfolio = await loadPortfolio(userId);
  if (!(portfolio.cash > 0)) return res.status(400).json({ error: 'مفيش كاش متاح يتحلل.' });

  // This review rides on a cash-scan use that was already spent (or is
  // still free) at /api/scan: it's only answered while that use's session is
  // open, so asking for it directly can never become a separate way around
  // the tier's cashScans allowance.
  const usage = await getUserUsage(userId);
  if (!withinCashScanSession(usage)) {
    return cashScansLeft(usage, req.access.tier) <= 0
      ? res.status(429).json({ error: CASH_SCAN_LIMIT_MESSAGE, reason: 'cash_scan_limit', cashScansLeft: 0 })
      : res.status(409).json({ error: 'افتح تحليل الكاش الأول وبعدين اطلب مراجعة الخطة.' });
  }

  await startReviewJob(res, cashReviewJobKey(userId, pre.style, index), async () => {
    const startedAt = Date.now();
    let scanRows = [];
    const { getOrGenerateCashReview } = await import('../agent/cashAnalysis.js');
    const { review, source } = await getOrGenerateCashReview(portfolio, {
      portfolioId,
      style: pre.style ?? 'medium',
      // Whether that style came from the investor's own trade history or a
      // manual pick (useActiveInvestStyle) — the review flags a mismatch
      // between the picked style and actual behavior.
      styleAuto: req.body?.styleAuto === true,
      index,
      rules: pre.style ? rulesForStyle(RULES, pre.style) : RULES,
      force: pre.force,
      runScan: async () => {
        const scan = await runScan(portfolio, { codes: indexCodes, style: pre.style, userId, portfolioId, focus: 'cash' });
        scanRows = scan.payload.results ?? [];
        return scan;
      },
    });
    console.log(`[review] cash ${index} ${source} in ${Date.now() - startedAt}ms`);
    if (source === 'ai') {
      const byCode = new Map(scanRows.map((row) => [row.code, row]));
      void logRecommendations(
        userId,
        portfolioId,
        (review.picks ?? [])
          .filter((p) => byCode.has(p.code))
          .map((p) => ({ code: p.code, action: p.action, levels: levelsFromScanRow(byCode.get(p.code)) })),
        { source: 'cash_review', style: pre.style ?? 'medium', model: review._meta?.model },
      );
    }
    return { review, source, index };
  });
}));

app.get('/api/review/cash/status', wrap(async (req, res) => {
  const index = String(req.query.index ?? 'ALL').toUpperCase();
  await sendJobStatus(res, cashReviewJobKey(req.user.id, req.query.style, index));
}));

/**
 * Long-poll: hold the request until the job settles (or a short cap), so the
 * client hears about a finished review immediately instead of on its next tick.
 */
async function sendJobStatus(res, key) {
  const job = reviewJobs.get(key);
  if (!job) {
    return res.status(404).json({ error: 'التحليل اتقطع (غالبًا السيرفر اتعمل له ريستارت) — جرّب تاني.' });
  }
  if (job.status === 'running') {
    await Promise.race([job.promise, new Promise((r) => setTimeout(r, REVIEW_STATUS_WAIT_MS))]);
  }
  sendReviewJob(res, job);
  if (job.status === 'error') reviewJobs.delete(key);
}

app.get('/api/review/status', wrap(async (req, res) => {
  const code = req.query.code ? String(req.query.code).toUpperCase() : null;
  await sendJobStatus(res, reviewJobKey(req.user.id, req.query.style, code));
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
  // The same shared report reaches many Users; each one's copy is logged once a day (the table's daily key).
  const portfolioId = await primaryPortfolioIdFor(req.user.id);
  void logRecommendations(
    req.user.id,
    portfolioId,
    (report.topOpportunities ?? []).map((op) => ({ code: op.code, action: op.action, levels: levelsFromOpportunity(op, style ?? 'medium') })),
    { source: 'market_report', style: style ?? 'medium', model: report._meta?.model },
  );
  res.json({ report });
}));

// The recommendation track record (see src/recommendations.js). Admins only
// for now, with the same verified-email rule as /api/admin: calls are still
// logged for every User, only viewing the record is restricted. It shows no
// User's identity, only whether a row is the viewer's own.
const TRACK_RECORD_ACTIONS = ['buy', 'hold', 'sell', 'reduce'];
app.get('/api/track-record', wrap(async (req, res) => {
  if (!req.user?.isAdmin || !req.user.emailVerified) return res.status(403).json({ error: 'للمشرفين فقط' });
  const { scope = 'all', vs = 'own', action, horizon, from, to } = req.query;
  if (!['all', 'mine'].includes(scope)) return res.status(400).json({ error: 'نطاق غير معروف' });
  if (!Object.hasOwn(COMPARISONS, vs)) return res.status(400).json({ error: 'مؤشر مقارنة غير معروف' });
  if (action && !TRACK_RECORD_ACTIONS.includes(action)) return res.status(400).json({ error: 'قرار غير معروف' });
  if (horizon && !HORIZON_BUCKETS[horizon]) return res.status(400).json({ error: 'أفق غير معروف' });
  if ((from && !isIsoDate(from)) || (to && !isIsoDate(to))) return res.status(400).json({ error: 'تاريخ غير صالح' });
  res.json(await trackRecord(req.user.id, {
    scope,
    vs,
    action: action || null,
    horizon: horizon || null,
    from: from || null,
    to: to || null,
  }));
}));

app.get('/api/fundamentals/:code', wrap(async (req, res) => {
  if (!aiAvailable()) return res.status(503).json({ error: 'مفيش مفتاح API', aiAvailable: false });
  // The ticker is interpolated into a web-search prompt and used as a cache
  // key, so it has to be one we know — not free text.
  if (!lookup(req.params.code)) return res.status(404).json({ error: 'السهم مش موجود' });
  const { getFundamentals } = await import('../agent/fundamentals.js');
  const data = await getFundamentals(req.params.code, { force: req.query.force === '1' });
  if (!data) return res.status(404).json({ error: 'ما لقيتش بيانات أساسية موثوقة' });
  res.json(data);
}));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, aiAvailable: aiAvailable(), universeSize: ALL_CODES.length });
});

// Unknown API paths answer in JSON like every other API response.
app.use('/api', (_req, res) => res.status(404).json({ error: 'المسار مش موجود' }));

// Last resort for anything that reaches Express's own error path — malformed
// JSON, an oversized body, an unreadable encoding. Without this those get the
// framework's HTML error page (with a stack trace outside production).
app.use((err, _req, res, next) => {
  if (res.headersSent) return next(err);
  const { status, message } = publicError(err);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: message });
});

/** Production-only nags about weak or default settings. Warn, never refuse to boot: a misjudged check must not take the site down. */
function warnAboutWeakConfig() {
  if (process.env.NODE_ENV !== 'production') return;
  const problems = [];
  for (const name of ['BLOG_CRON_SECRET', 'STOP_PLAN_CRON_SECRET', 'DAILY_CLOSE_CRON_SECRET']) {
    const value = process.env[name];
    if (value && value.length < 24) problems.push(`${name} قصير — استخدم 32 حرف عشوائي على الأقل`);
  }
  if (!process.env.ADMIN_EMAILS) problems.push('ADMIN_EMAILS مش مضبوط — بيستخدم الإيميل الافتراضي المكتوب في الكود');
  if (!process.env.FRONTEND_URL && !process.env.APP_URL) problems.push('FRONTEND_URL / APP_URL مش مضبوطين');
  if (!process.env.RESEND_API_KEY) problems.push('RESEND_API_KEY مش مضبوط — إيميلات التفعيل وإعادة التعيين مش هتتبعت');
  for (const problem of problems) console.warn(`[security] ${problem}`);
}

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
  // Before listening: a request that arrives before the registry is loaded
  // would be answered as "unknown site" for every client domain.
  await startTenantRegistry();
  warnAboutWeakConfig();
  startDailyCloseScheduler();
  startStopPlanScheduler();
  const PORT = process.env.PORT ?? 3000;
  app.listen(PORT, () => {
    console.log(`Alytic على http://localhost:${PORT}`);
    console.log(aiAvailable() ? '  الذكاء الاصطناعي: مفعّل' : '  الذكاء الاصطناعي: متوقف (مفيش OPENROUTER_API_KEY)');
  });
}

export default app;
