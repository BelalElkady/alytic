# ADR 0001 — Live prices for subscribers via oanor

- **Status:** Proposed. Wiring, fallback (including rollback when the quota runs out), batching and rollout are decided here. The paid tier stays open until the rollout measures real volume (see *Budget and tier*).
- **Date:** 2026-09-25
- **Resolves:** issue #48, a ticket on the #41 map ("Live EGX prices for subscribers: oanor vs. TradingView").
- **Builds on:** #44, which confirmed that our free TradingView scrape runs about 15 min behind during the session and that oanor does not mirror that delayed feed.

## Context

Every live price in the app comes from `fetchLatestQuotes` in `backend/src/data/tv-history.js`. It is an unsupported TradingView WebSocket scrape that runs about 15 minutes late. oanor is a paid, keyed feed that is closer to live. Map #41 already settled these points:

- oanor goes to Users whose Subscription is active (`subscriptionActive`). Trial Users stay on TradingView.
- It covers two call sites, and a given User must get the same source at both:
  - `/api/quotes`, the desk's 20 s price ticker.
  - The pricing of held Positions inside `/api/scan`, through `analyzeMany`.
- The poll cadence stays at 20 s for everyone.
- When oanor fails, the app falls back to TradingView silently.

This ADR settles what #41 left unspecified.

## Decision

### 1. Request-path wiring

Add a single module, `backend/src/data/live-quotes.js`, with this signature:

```js
fetchLiveQuotes(codes, { subscribed }) // → Map<code, { price, change, changePct, time, source }>
```

The callers decide whether a User is subscribed. The module and `analyzeMany` never look up Users themselves.

- **The subscription check is already done.** `/quotes` and `/scan` are both in `PAID_PATHS`, so the paywall middleware has already run `accessInfo()` and stored the result on `req.access`. Both handlers pass `subscribed: req.access.subscriptionActive`. This costs no extra database read.
- **`/api/quotes`** calls `fetchLiveQuotes(requested, { subscribed })` where it calls `fetchLatestQuotes(requested)` today.
- **`/api/scan`** fetches the quotes for held codes in the handler, then passes them into `analyzeMany` as `opts.liveQuotes`. `analyzeMany` already accepts that option and skips its own fetch when given one. This keeps `analyzeMany` free of any per-User pricing rule, and the admin rebuild and `snapshotForUser` keep calling it unchanged.
- **The second quote fetch in `/api/scan` must use the same map.** After `analyzeMany`, the handler fetches `latestQuotes` for every scanned code to display prices. For held codes it must reuse the map passed to `analyzeMany`. Otherwise a subscriber sees the oanor price in the P&L and the TradingView price beside it. Codes the User doesn't hold stay on TradingView: #41 rules out live repricing of the whole universe.
- **Only subscribers, and only during the session.** oanor is called only when both hold: the User's Subscription is active (`subscriptionActive`), and EGX is in session, 10:00–14:30 Cairo time on a trading day (`egxSessionOpen`). Everyone else, and everyone outside the session, gets TradingView. Any stock TradingView doesn't quote keeps its last daily close from the synced bars (Yahoo or TradingView history). Yahoo has no reliable live EGX quote to add.
- **Admins stay on TradingView.** `subscriptionActive` is false for exempt accounts (admin, marketer, local), and #41 counts only `subscriptionActive` as subscribed. The allowlist doesn't change that (see *Rollout*): to try oanor, the owner's account needs an active Subscription, which an Admin can grant from the admin panel.
- **These call sites stay on TradingView:**
  - `/api/indices/performance`, which prices indices, not Positions.
  - `currentPrices`, which values the cash-flow record.
  - The daily-close snapshot, which is written after the close anyway.
  - The screenshot import's back-solve.
  - `recommendations.js`.

  None of them is a subscriber's live view.
- **Open question for the map:** `/api/analyze/:code` powers the stock-detail dialog, and it prices an open Position live (`fetchLatestQuotes([code])`). It is not one of #41's two call sites. But a subscriber who opens the dialog next to the desk row would see a 15-minute-older price there. The recommended answer is to add it as a third call site, since it is one line with the same `subscribed` flag. It is recorded here instead of decided silently, because it widens #41's settled scope.

### 2. Fallback

Fallback happens per code, not per call. For a subscriber, `fetchLiveQuotes` does the following:

1. It asks oanor for the codes. The call has a hard **4 s timeout**, so a slow oanor never stalls a 20 s poll.
2. Any code that oanor didn't return goes to `fetchLatestQuotes` in the same cycle. This covers an error, a 402 or 429, a timeout, or a code missing from a successful response. The two maps are then merged.
3. Quotes keep the exact shape `fetchLatestQuotes` returns, so nothing in the API response shows which feed answered (the fallback is silent to the User). The pool counts instead: quotes served by oanor, quotes that fell back, cache hits and calls. Those counters are what the rollout measures.

**Circuit breaker for short failures.** A per-minute rate limit (429), a 5xx or a timeout from oanor opens a process-wide breaker for **60 s**. While it is open, subscribers go straight to TradingView, so a struggling oanor isn't hit again by every poll. The first failure that opens it is recorded for the admin panel (see *Where the admin sees it*). Nothing is logged.

**Rollback to TradingView when the quota runs out.** When oanor's call quota for the billing period is used up, every subscriber goes back to TradingView **until the quota resets**, not for 60 s. Re-trying every minute would only collect more refusals for the rest of the period. The rollback is triggered two ways:

- **oanor says so.** oanor answers that the quota is exhausted, or answers 402. #42 showed that 402 also means the plan itself isn't active, which a retry won't fix either. The exact quota status and body must be taken from oanor's docs when the client is written, so that a quota refusal is never mistaken for a per-minute 429.
- **Our own count says so.** The pool counts every oanor call against `OANOR_MONTHLY_QUOTA`, the plan's allowance, set in `.env`. At **95 %** it stops calling oanor and rolls back. This leaves headroom and avoids running into overage charges, even if oanor's own signal changes or never arrives.

The rollback:

- **Is silent to Users.** Subscribers keep getting prices, 15 minutes delayed, exactly as when oanor fails for a single poll.
- **Shows only in the admin panel.** No server log line and no email: the admin learns of it from the live-prices tab, which leads with the rollback, its reason, calls used against the quota and the reset date, and puts a red dot on the tab's name. The quota is the one oanor failure that needs a human, to upgrade the tier or wait.
- **Ends on its own.** On the plan's reset date the pool starts a fresh counter and tries oanor again. The reset date comes from `OANOR_BILLING_DAY`, the day of the month the plan renews (default 1). A successful call clears the rollback. Raising `OANOR_MONTHLY_QUOTA` after an upgrade also clears it without waiting.
- **Survives a restart.** The call count and the rollback state are stored, not kept only in memory, so a redeploy mid-month doesn't wipe the count and overspend the quota again.

**Timestamps.** oanor exposes no per-quote timestamp (a caveat from #44), but the quote's `time` matters: `tradingHalted` reads it to spot a suspended or halted stock, and a halted stock gets no stop breach and no recommendation. So for subscribers TradingView is fetched alongside oanor, in the same call a non-subscriber makes anyway. The quote is oanor's price with TradingView's last-trade `time`, and suspension detection works the same on both tiers. When TradingView has no time for a code, `time` stays null. Never invent one from the time the request was made.

### Where the admin sees it

Falling back is silent twice over: Users never see it, and nothing about it goes to the server log or out by email. The only place it shows is a **"الأسعار اللحظية" tab in the admin panel**, for platform admins only, since one oanor key and one bill serve every site. The tab shows:

- **The current state:** oanor off (and why), healthy, paused after an error (until when), or rolled back for the quota (why, since when, until the reset).
- **The period's calls** against `OANOR_MONTHLY_QUOTA` and the 95 % stop.
- **Counters** since the server started.
- **The last 50 events.**
- **The price-gap table** while `OANOR_COMPARE=1`.

A red dot on the tab's name marks a pause or a rollback, so the admin notices without opening it. The rollback itself is stored, so the tab still shows it after a restart. The events and counters are kept in memory and start over after a restart.

### 3. Batching

**Batch.** oanor quotes go through one process-wide pool, not one call per User per poll:

- **Cache.** Each code is cached with a **15 s TTL**, just under the 20 s poll interval. Every subscriber who holds that code within the window is served from the same entry.
- **Coalescing.** Codes that miss the cache are collected over a short window (about 250 ms). They are fetched in chunks of **20 tickers per call**, which is oanor's limit. A code that is already being fetched is awaited, not requested again.
- **One process is enough.** The backend runs as a single Express process (`app.listen`, no cluster), so an in-memory cache is shared by everyone. If the backend ever scales out, that is when the cache would move to a shared store.

This changes what the bill scales with. Without batching, cost grows with the number of subscribers. With it, cost grows with **D, the number of distinct codes held by subscribers who have the desk open**. D is capped at 235, the size of the universe, and popular large caps overlap across portfolios.

**No oanor calls outside the EGX session.** The desk polls from 09:30 to 15:00. The server only calls oanor between 10:00 and 14:30 Cairo time on trading days, using the same `isTradingDay` and clock check as `/api/market-status`. Outside that window the price is frozen, and TradingView returns the correct close. This cuts about a fifth of the poll window.

### 4. Budget and tier

Pick the tier after measuring, not before. This ADR doesn't choose one.

- **Monthly calls:**
  - Formula: calls per month ≈ trading days × session minutes × polls per minute × ⌈D / 20⌉
  - With this app's values: 21 × 270 × 3 × ⌈D / 20⌉ ≈ **17,000 × ⌈D / 20⌉**
- **Peak rate:** ⌈D / 20⌉ calls per 15 s. Check this against each tier's per-minute limit as well as its monthly quota.

| Distinct held codes (D) | Calls per 15 s | Calls per month |
|---|---|---|
| 20 | 1 | ~17,000 |
| 60 | 3 | ~51,000 |
| 100 | 5 | ~85,000 |
| 235 (whole universe, worst case) | 12 | ~204,000 |

For comparison, without batching a subscriber with *n* Positions costs ⌈n / 20⌉ calls per poll. Fifty subscribers would cost ≈ 17,000 × 50 ≈ 850,000 calls a month. That gap is why batching is decided above.

**Rule:** commit to the smallest tier whose monthly quota is at least **1.5 ×** the measured volume, and whose per-minute limit covers the measured peak. The margin covers growth and the days when every subscriber is on the desk. Scans add close to nothing, because they read the same 15 s cache.

**oanor's plans** (from its API docs):

| Plan | Price | Calls per month | Requests per second |
|---|---|---|---|
| Free | free | 12,200 | 2 |
| Basic | $24/mo | 263,000 | 10 |
| Pro | $66/mo | 1,420,000 | 20 |
| Scale | $145/mo | 7,520,000 | 50 |

**What that means:**
- **Free runs out.** It covers well under a month at even the smallest D: ⌈D/20⌉ = 1 already needs about 17,000 calls. It suits the allowlist week, and expect it to roll back partway through, which also exercises the rollback.
- **Basic covers every case.** Even the whole-universe worst case (D = 235, about 204,000 calls) fits, and D ≤ 200 fits with the 1.5 × margin. Its 10 req/s covers the peak of 12 calls per 15 s.
- **So the recommendation is Basic**, confirmed by the D measured in the allowlist week. Pro only makes sense if the poll ever gets faster than 20 s.

The pool spaces call starts to `OANOR_RATE_PER_SEC` (2 by default, matching Free), so a batch of several chunks never trips the per-second limit.

### 5. Rollout

Start on the Free tier, behind a flag:

1. **Build it off by default.**
   - `OANOR_ENABLED` is unset, so everyone gets TradingView and nothing changes.
   - `OANOR_API_KEY`, `OANOR_MONTHLY_QUOTA`, `OANOR_BILLING_DAY`, `OANOR_USER_IDS` and `OANOR_COMPARE` join `.env.example` next to `OPENROUTER_API_KEY` and `RESEND_API_KEY`.
2. **Allowlist stage, one trading week on the Free tier.**
   - Set `OANOR_ENABLED=1` and `OANOR_USER_IDS=<owner's test account>`.
   - The allowlist only narrows the subscribers who get oanor; it never lets a non-subscriber in. The owner's test account therefore needs an active Subscription (grant one from the admin panel).
   - Read the live-prices tab: oanor calls, the cache hit rate, the fallback count, and, per code, the gap between oanor's price and TradingView's. The gap needs a TradingView fetch alongside each oanor batch, so it only runs with `OANOR_COMPARE=1`: on for this week, off afterwards.
3. **Decide.** Use the week's D, peak rate and fallback rate to pick the tier with the rule above. A fallback rate high enough that subscribers mostly see TradingView prices anyway is a reason to stop.
4. **Open to all subscribers.** Drop the allowlist so every User with an active Subscription is eligible.
5. **Kill switch.** Unset `OANOR_ENABLED` to put everyone back on TradingView without a deploy.

Set `OANOR_MONTHLY_QUOTA` from the first stage onward, to the Free tier's allowance at first. The quota rollback is then exercised on the Free tier before real money is involved. If the allowlist week hits it, that alone says the Free tier is too small.

## Consequences

- Subscribers see prices about 15 minutes fresher at the desk and in their scans. A 20 s poll can't show sub-20 s freshness, but the gain over the delayed feed is the point.
- Cost scales with distinct held codes, which is capped, instead of with subscribers, which isn't. The trade-off is up to 15 s of staleness from the shared cache, well inside the 20 s poll.
- One new moving part: the pool, the circuit breaker and the quota counter in `live-quotes.js`. Every other caller stays on the existing scrape and keeps working if oanor disappears.
- An exhausted quota costs subscribers freshness for the rest of the billing period, but never their prices, and never an overage bill. The admin panel's live-prices tab is how someone finds out and decides whether to upgrade.
- oanor's lack of timestamps means its freshness can't be proven quote by quote. The rollout's price-gap table is the ongoing evidence #44 asked for.
