# ADR 0001 — Live prices for subscribers via oanor

- **Status:** Proposed. Wiring, fallback, batching and rollout are decided here. The paid tier stays open until the rollout measures real volume (see *Budget and tier*).
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
- **Admins stay on TradingView.** `subscriptionActive` is false for exempt accounts (admin, marketer, local), and #41 counts only `subscriptionActive` as subscribed. Testing oanor therefore needs the allowlist described under *Rollout*.
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
3. Each quote carries `source: 'oanor' | 'tv'`. The API response doesn't expose it (the fallback is silent to the User). It exists for logging and for measuring the rollout.

**Circuit breaker.** A 402, a 429 or a 5xx from oanor opens a process-wide breaker for **60 s**. While it is open, subscribers go straight to TradingView, so a rate-limited oanor isn't hit again by every poll. The first failure that opens it is logged once at warn level. The User sees nothing, but the operator does.

**Timestamps.** oanor exposes no per-quote timestamp (a caveat from #44), so its quotes return `time: null`. This is safe: `store.tsx` stores it as `lastTradeTime` but never displays or compares it. Don't invent a timestamp from the time the request was made.

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

**Inputs still needed:** oanor's current quota and price for each tier, and D as measured during the free-tier stage below. The active-subscriber count and Positions per subscriber only bound D, so D is the number that matters.

### 5. Rollout

Start on the Free tier, behind a flag:

1. **Build it off by default.**
   - `OANOR_ENABLED` is unset, so everyone gets TradingView and nothing changes.
   - `OANOR_API_KEY` joins `.env.example` next to `OPENROUTER_API_KEY` and `RESEND_API_KEY`.
2. **Allowlist stage, one trading week on the Free tier.**
   - Set `OANOR_ENABLED=1` and `OANOR_USER_IDS=<owner's test account>`.
   - The allowlist also lets an exempt admin account in for testing.
   - Log each oanor call's code count, the cache hit rate, the fallback count, and, per code, the gap between oanor's price and TradingView's.
3. **Decide.** Use the week's D, peak rate and fallback rate to pick the tier with the rule above. A fallback rate high enough that subscribers mostly see TradingView prices anyway is a reason to stop.
4. **Open to all subscribers.** Drop the allowlist so every User with an active Subscription is eligible.
5. **Kill switch.** Unset `OANOR_ENABLED` to put everyone back on TradingView without a deploy.

## Consequences

- Subscribers see prices about 15 minutes fresher at the desk and in their scans. A 20 s poll can't show sub-20 s freshness, but the gain over the delayed feed is the point.
- Cost scales with distinct held codes, which is capped, instead of with subscribers, which isn't. The trade-off is up to 15 s of staleness from the shared cache, well inside the 20 s poll.
- One new moving part: the pool and circuit breaker in `live-quotes.js`. Every other caller stays on the existing scrape and keeps working if oanor disappears.
- oanor's lack of timestamps means its freshness can't be proven quote by quote. The rollout's price-gap log is the ongoing evidence #44 asked for.
