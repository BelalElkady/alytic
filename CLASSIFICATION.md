# Investment vs. speculation classification

Every EGX stock the engine analyzes gets two independent 0-100 scores —
**Investment Score** and **Speculation Score** — and a derived label:
`INVESTMENT`, `SPECULATIVE`, `HYBRID`, or `NEUTRAL`. All of it is computed by
plain application code from data the engine already has; no AI model
calculates or overrides any of it. The AI layer (the portfolio analyst,
`backend/src/agent/analyst.js`) is given the numbers and may explain them —
see "LLM integration" below.

Code: [`backend/src/scoring/classification.js`](backend/src/scoring/classification.js) (the engine),
[`backend/src/scoring/normalize.js`](backend/src/scoring/normalize.js) (the 0-100 normalization primitives),
[`backend/src/config/classification.js`](backend/src/config/classification.js) (every weight and threshold, in one place).
Tests: [`backend/test/unit/classification.test.js`](backend/test/unit/classification.test.js),
[`backend/test/unit/normalize.test.js`](backend/test/unit/normalize.test.js).

## What the two scores mean

**Investment Score (0-100)** — how much this looks like a business worth
owning: valuation, profitability, balance-sheet health, dividend quality, the
durability of its price trend, and how stable (low-volatility) it has been.
High is "cheap-ish, profitable, healthy balance sheet, real uptrend, doesn't
swing wildly." It says nothing about *timing* — a great business can still be
a bad buy this week.

**Speculation Score (0-100)** — how much the stock is *currently trading* on
short-term energy rather than a business thesis: liquidity, a volume surge,
volatility, momentum (in either direction — a violent drop is just as
"speculative" in character as a violent rally), breakout/price-action, and
(when real data exists) a news catalyst. High is "moving a lot, right now,
on volume." A stock can score high on both at once — see HYBRID below.

## Classification thresholds

From [`config/classification.js`](backend/src/config/classification.js)'s `CLASSIFICATION_THRESHOLDS`
— nothing here is hardcoded anywhere else in the codebase:

| Threshold | Default | Meaning |
| --- | --- | --- |
| `INVESTMENT_MIN_SCORE` | 65 | Investment score floor for `INVESTMENT` |
| `INVESTMENT_MAX_SPECULATION` | 55 | Speculation score must stay *below* this for `INVESTMENT` |
| `SPECULATIVE_MIN_SCORE` | 65 | Speculation score floor for `SPECULATIVE` |
| `SPECULATIVE_MAX_INVESTMENT` | 50 | Investment score must stay *below* this for `SPECULATIVE` |
| `HYBRID_INVESTMENT_THRESHOLD` | 60 | Investment score floor for `HYBRID` |
| `HYBRID_SPECULATION_THRESHOLD` | 60 | Speculation score floor for `HYBRID` |

Decision, in order (`classify()` in `scoring/classification.js`):

```
investment >= 65 AND speculation < 55   → INVESTMENT
investment < 50  AND speculation >= 65  → SPECULATIVE
investment >= 60 AND speculation >= 60  → HYBRID
otherwise                                → NEUTRAL
```

Note the gap this leaves on purpose: e.g. investment=80, speculation=57 is
neither `INVESTMENT` (speculation isn't under 55) nor `HYBRID` (speculation
isn't at 60 yet) — it's `NEUTRAL`. That's intentional: the thresholds are
deliberately not adjacent, so a score sitting *between* them reads as "not
confidently either" rather than being forced into the nearer label.

`classify(investmentScore, speculationScore, thresholds?)` is exported on its
own specifically so these boundaries can be unit-tested without building a
full analysis — see the boundary tests in `classification.test.js` (65 vs.
64.99, the HYBRID corner, etc.).

## Data sources — what's real, and what isn't available

Everything the classifier reads was already computed by the existing pipeline
before it runs — nothing new is fetched:

- **Fundamentals**: `data/tradingview.js`'s screener pull, already attached to
  every `analyzeTicker()` result as `.fundamentals`. Mechanical (scraped from
  a live endpoint), not AI-derived. Fields used: `peRatio`, `priceToBook`,
  `dividendYieldPct`, `debtToEquity`, `returnOnEquityPct`, `currentRatio`, and
  `netIncomeEgp`/`revenueEgp` (combined into a net-margin figure).
- **Technical/price data**: `ta/snapshot.js`'s `buildSnapshot()` output,
  already attached as `.snapshot` — trend, moving averages, RSI/MACD,
  volatility (ATR, annualized vol, Bollinger), volume/turnover, returns over
  several horizons, breakout detection, 52-week range.

**Deliberately not used**, and why:

- **The AI-researched fundamentals** (`agent/fundamentals.js` — growth rates,
  ROIC-adjacent figures, EV/EBITDA, FCF yield, dividend history) come from a
  web-search-and-extract LLM call. Feeding that into a score this document
  calls "deterministic" would mean the score's *inputs* aren't reproducible
  even though the arithmetic is — and the whole point of this system is a
  score the model cannot move. So revenue/earnings *growth* and ROIC are not
  scored at all; see "What's not covered" below for how their weight is
  redistributed instead of faked.
- **News/catalysts**: there is no real-time news or corporate-actions feed
  wired into the deterministic pipeline. The `newsCatalyst` metric exists
  structurally (see `SPECULATION_METRICS` in `classification.js`) and accepts
  an optional `opts.newsCatalystScore` (0-100) from a future real, non-AI
  source, but nothing calls it today — the bucket is always excluded and its
  weight redistributed to the others. **A missing feed, not a design gap**:
  the spec this system was built against is explicit that "news should only
  influence the score when actual news data exists" and forbids fabricating
  catalysts, so "always absent for now" is the correct, honest state rather
  than routing it through an LLM guess.

## Investment Score — components and weights

`INVESTMENT_WEIGHTS` in `config/classification.js`. The textbook weighting
(fundamentals / earnings growth / ROE-ROIC / valuation / debt / dividends /
trend / volatility) is adapted to what the data above actually supports —
growth and ROIC have no source, so they're folded into `profitability`
instead of a separate bucket:

| Bucket | Weight | Metrics (see `INVESTMENT_METRICS`) |
| --- | --- | --- |
| `valuation` | 20% | P/E (skipped when earnings are negative), P/B (skipped when book value is negative) |
| `profitability` | 25% | ROE, net margin (`netIncomeEgp / revenueEgp`) |
| `financialHealth` | 20% | Debt/equity, current ratio (both skipped for banks/financials — see "Sector awareness") |
| `dividendQuality` | 10% | Dividend yield (a real 0% yield scores 25/100, not "missing" — see below) |
| `priceTrend` | 15% | Price vs. 200-day average, the engine's own trend-quality score, 1-year return |
| `stability` | 10% | Annualized volatility, inverted (lower vol → higher score) |

## Speculation Score — components and weights

`SPECULATION_WEIGHTS` in `config/classification.js`:

| Bucket | Weight | Metrics (see `SPECULATION_METRICS`) |
| --- | --- | --- |
| `liquidity` | 20% | Average daily traded value (turnover) |
| `volumeSurge` | 15% | Today's volume ÷ 20-day average |
| `volatility` | 20% | ATR% (daily) and annualized historical volatility |
| `momentum` | 25% | 1-month and 1-week return (**absolute value** — a crash is as speculative as a rally), RSI distance from 50 |
| `priceAction` | 10% | A recent Donchian breakout, distance from the nearer 52-week extreme, a Bollinger squeeze |
| `newsCatalyst` | 10% | Always redistributed today — see "Data sources" above |

## Normalization methodology

Four reusable primitives in `scoring/normalize.js`, used throughout instead of
one-off arithmetic per metric:

- **`normalizeHigher(value, min, max)`** — linear 0-100, higher is better
  (e.g. ROE, dividend yield). Clamped at the ends.
- **`normalizeLower(value, min, max)`** — linear 0-100, lower is better (e.g.
  P/E, debt/equity).
- **`normalizeTarget(value, {low, target, high})`** — bell-shaped: 100 exactly
  at `target`, decaying to 0 at either `low` or `high`. Used for current
  ratio, where both too little (liquidity risk) and too much (idle capital)
  are bad.
- **`percentileRank(value, sortedAscendingValues)`** — 0-100 rank of `value`
  within a reference set. Preferred over an absolute threshold wherever a
  cross-sectional comparison is actually available (see next).

**Percentile ranking, where it's cheap — fundamentals.** `data/tradingview.js`'s
screener call already returns every EGX listing (~600 rows) in one request,
before it filters down to whichever codes were asked for. `fetchFundamentals()`
computes each stock's percentile rank (P/E, P/B, ROE, debt/equity, dividend
yield, current ratio) against that *entire pulled universe* right before the
filter, and attaches it as `.percentiles` on the fundamentals object — a true
"ROE percentile among EGX stocks," not a hand-picked threshold. Classification
metrics use this percentile first and only fall back to a fixed min/max range
if it's unavailable (e.g. the screener call failed for this batch).

**Absolute thresholds, where percentile isn't available — technicals.** A true
percentile for liquidity, volatility or momentum would need the *whole EGX
universe's* technical snapshot computed at once, which the pipeline does not
do on every request (a single-ticker `/api/analyze/:code` call never touches
other tickers). Rather than invent arbitrary cutoffs, every anchor in
`NORMALIZATION_ANCHORS` is derived from, or matches, a number this codebase
already makes trading decisions on: the liquidity floor mirrors
`config/rules.js`'s `minAvgTurnoverEgp` (2,000,000 EGP — the amount this app
already requires to hold a position at all), and the ATR% anchor is built
around `scoring/technical.js`'s own "high volatility, cut position size"
threshold (4%). See the comments in `config/classification.js` for each one.

## Missing-data handling — the core rule

**A missing metric is excluded from its average, never scored as 0.** This is
enforced by one function, `weightedAverage()` in `normalize.js`: it drops any
`{value, weight}` entry whose value is `null`/non-finite and renormalizes the
remaining weights to sum to 1. The same function combines raw metrics into a
bucket score *and* buckets into the final 0-100 score, so the rule applies
recursively at every level — a stock with zero fundamentals still gets an
investment score from price-trend and stability data alone, just with lower
confidence and a `dataQuality.missingMetrics` list naming the gap.

Two related, deliberate exceptions:

- **A real zero is not a missing value.** A stock that pays no dividend
  scores 25/100 on dividend quality — a real, if low, score — not "missing".
  Zero trading volume scores at the bottom of the liquidity range, not null.
- **A metric that is inapplicable is treated as missing, not scored.** Both a
  negative P/E (loss-making) and a negative P/B (negative book value) are
  skipped rather than scored as an artificially "cheap" multiple — see
  "Important edge cases" below.

## Sector awareness

A bank's balance sheet (deposits recorded as liabilities) makes "debt/equity"
and "current ratio" apples-to-oranges figures against an industrial or
consumer company's. For `sector === 'banks'` or `'financials'`, both metrics
are excluded from `financialHealth` (its weight redistributes to whatever
other buckets have data) rather than scored against a normal company's
range. This is a targeted exclusion, not a full sector-specific model —
see "Limitations" below for what a fuller version would need.

## Confidence score

0-100, computed by `computeConfidence()` — how much to trust the
classification, independent of what it says. A `weightedAverage()` of four
inputs (`CONFIDENCE_WEIGHTS` in the config):

| Input | Weight | What it measures |
| --- | --- | --- |
| Data completeness | 35% | Share of all metrics that actually had a value |
| Data freshness | 20% | Whether fundamentals exist at all, and whether they're stale (>10 days between the fundamentals' `asOf` and the price snapshot's `asOf` — see `FUNDAMENTALS_STALE_DAYS`) |
| Boundary distance | 30% | How far the two scores sit from the *nearest* classification threshold — a pair sitting right on the HYBRID corner is a low-confidence call even with perfect data |
| Price-data quality | 15% | The existing price-series gate's own verdict (`data/quality.js`'s `severity`: `ok`/`warn`/`fatal`) |

Worked example from the spec this was built against: investment=82,
speculation=20, complete fresh data → confidence is high (all four inputs
score well). investment=62, speculation=58 (both near a threshold), with
earnings data missing → confidence is low (completeness *and* boundary
distance both score poorly).

## data_quality object

Attached to every classification as `dataQuality`:

```json
{
  "score": 0,
  "missingMetrics": ["مكرر الربحية", "..."],
  "staleMetrics": [],
  "hasFundamentals": false,
  "lastMarketUpdate": "2026-09-10",
  "lastFundamentalUpdate": null,
  "prices": { "severity": "ok" }
}
```

`missingMetrics`/`staleMetrics` are human (Arabic) labels, not raw keys — see
`METRIC_LABELS`/`BUCKET_LABELS` in `classification.js`. `prices.severity`
mirrors `data/quality.js`'s own vocabulary so a caller reads one consistent
scale for "how much do I trust the price series" across both systems.

## Explanation engine (reasons)

Every reason returned (`reasons.investment`, `reasons.speculation`,
`reasons.risks`) is generated from the *same declarative metric list* that
produced the scores — nothing can appear as a reason that wasn't an actual
metric computed for that stock, and nothing is left for an LLM to invent. Each
entry in `INVESTMENT_METRICS`/`SPECULATION_METRICS` carries its own
`reason(rawValue, score, analysis)` function; `classifyStock()` collects
whichever reasons actually fired, sorts by how far each metric's score sits
from a neutral 50 (strongest signals first), and caps each list at 6 (5 for
risks) to stay readable. `risks` also includes a name for any bucket that had
*nothing* to score (`"بيانات X غير متاحة"`) and, when the speculation score is
high alongside a genuine uptrend, a specific pullback-risk note — the exact
kind of thing the spec's own worked example asks for.

## Portfolio integration

`scoring/portfolio.js`'s `portfolioClassificationSummary(analyses)` — sits
next to the existing `portfolioStructure()`/concentration logic, using the
same "held positions, weighted by market value" pattern:

- `pctByType` — % of the book's *value* in each of `INVESTMENT` /
  `SPECULATIVE` / `HYBRID` / `NEUTRAL`.
- `avgInvestmentScore` / `avgSpeculationScore` — simple averages across held,
  classified positions.
- `speculativeExposurePct` — `SPECULATIVE` + `HYBRID` combined (a `HYBRID`
  position carries real speculative character by definition, so it counts).
- `speculativePositionsCount` / `largestSpeculativePositionPct` —
  concentration specifically among the speculative/hybrid slice.

Wired into `agent/analyst.js`'s `reviewPortfolio()`: computed once per review,
shown to the model as a labeled, computed section (never re-derived by it),
and returned from the API as `review.portfolioClassification` alongside the
existing `portfolioHealth`/`portfolioStructure` fields.

## LLM integration

Every stock's brief (`briefFor()` in `agent/analyst.js`) carries a
`**Classification:**` line with the type, both scores, confidence, and the
top reasons — exactly the numbers computed above, nothing recalculated. The
system prompt (`agent/prompts/system.js`, "Investment vs. speculative
character") tells the analyst explicitly:

- Quote the classification; never recompute or state a different type.
- A `HYBRID` name has both a real investment case *and* current speculative
  energy — say both, and that they can call for different position sizes.
- **A high speculation score alone is never, by itself, a reason to
  recommend a stock or size it up** — momentum can justify a trade, it
  cannot substitute for the investment case. This is the literal "good
  stock" vs. "good stock for this portfolio" distinction the rest of the
  prompt already draws, applied to this new input.
- Low confidence gets the same "partial read" honesty as any other
  incomplete input.
- A mismatch between the holder's own horizon and a holding's classification
  (a long-term holder sitting on a `SPECULATIVE` position, etc.) gets named.

## API / data model

`analyzeTicker()` (`analyze.js`) attaches `classification` to its result —
every consumer of that pipeline gets it automatically:

- `GET /api/analyze/:code` — the full object (scores, confidence,
  `dataQuality`, `reasons`, and a `breakdown` of every bucket's own score, for
  UI drill-down or debugging).
- `GET /api/scan` — a compact form per row (`type`, `investmentScore`,
  `speculationScore`, `confidence`) to keep the already-large scan payload
  small; open the stock's detail view for the full breakdown.
- `POST /api/review` / the CLI's `review` command — each verdict's brief
  includes the classification line above, and the response carries
  `portfolioClassification` (see "Portfolio integration").

```json
{
  "type": "HYBRID",
  "investmentScore": 72,
  "speculationScore": 81,
  "confidence": 89,
  "dataQuality": { "score": 92, "missingMetrics": [], "staleMetrics": [], "hasFundamentals": true, "lastMarketUpdate": "2026-09-10", "lastFundamentalUpdate": "2026-09-10", "prices": { "severity": "ok" } },
  "reasons": {
    "investment": ["عائد على حقوق الملكية 24%", "مكرر ربحية 8 (أفضل من 80% من سوق EGX)"],
    "speculation": ["حجم التداول 2.4× المتوسط", "اختراق صاعد حديث لمستوى 145.34"],
    "risks": ["تسارع سعري/تقلب قوي حاليًا — يزيد خطر تصحيح حاد"]
  },
  "breakdown": { "investment": { "valuation": 78, "profitability": 82, "...": "..." }, "speculation": { "...": "..." } }
}
```

## UI

`DetailDialog` (`frontend/src/components/desk/detail-dialog.tsx`) renders a
classification card between the fundamentals note and the entry/stop/target
plan: the type as a colored badge (green `INVESTMENT`, amber `HYBRID`, red
`SPECULATIVE`, neutral `NEUTRAL`), the two scores and confidence as stats, and
the top investment/speculation reasons as two short bulleted columns plus a
risks list — reusing the existing `Stat`/`ReasonList`/`Badge` components and
color tokens rather than introducing new ones. `MarketDialog`'s scan rows
carry the compact classification for a future badge there too, kept out of
today's UI to avoid cluttering an already dense row.

## Important edge cases

| Case | Handling |
| --- | --- |
| Negative earnings | P/E is skipped (not scored as "cheap"); named as a risk reason |
| Negative book value | P/B is skipped the same way |
| Negative ROE | Scored normally (a real, low value) — not treated as missing |
| Banks / financial institutions | Debt/equity and current ratio excluded from `financialHealth` |
| Zero / near-zero volume | Liquidity scores at the bottom of its range, not null |
| Newly listed stock (< 200 sessions) | 200-day MA and 1-year-return metrics are naturally `null` (the existing `buildSnapshot()`/`periodReturn()` already return `null` under those windows) and are excluded, not zeroed |
| Newly listed stock (< 60 sessions) | Never reaches classification — `analyzeTicker()`'s own `buildSnapshot()` requires 60 bars and returns `usable: false` first |
| Trading suspension / frozen or stale prices | Caught upstream by `data/quality.js`'s existing gate before `analyzeTicker` ever builds a snapshot; `classifyStock()` returns a `NEUTRAL`, zero-confidence stub for any `usable: false` analysis |
| Extreme one-off values (P/E of 500, D/E of 25, etc.) | Every normalization function clamps to `[0, 100]` — no metric can push a bucket or the final score out of range |

## Limitations

Documented honestly rather than worked around:

- **No revenue/earnings growth or ROIC.** The only mechanical fundamentals
  source (TradingView's screener) has no year-over-year series and no ROIC.
  The AI-researched fundamentals pipeline does have growth figures, but
  mixing an LLM-extracted number into a score this system calls
  deterministic would undermine the whole guarantee — see "Data sources."
- **No dividend-consistency history**, for the same reason — only a current
  yield, not a multi-year payment record.
- **No real news/catalyst feed.** The `newsCatalyst` bucket exists and is
  wired to accept one (`opts.newsCatalystScore`), but nothing supplies it
  today; its weight is always redistributed. Wiring in a real,
  non-AI-mediated corporate-actions/news source is the natural next step.
- **No universe-wide percentile for technicals** (liquidity, volatility,
  momentum) — only fundamentals get a true cross-sectional rank, because only
  the fundamentals fetch already pulls the whole universe in one call. A
  batch technical percentile pass (reusing `/api/scan?index=ALL`'s existing
  whole-universe analysis) would need a scheduled job or a shared cache to
  avoid re-analyzing ~600 stocks on every single request.
- **Sector-awareness is targeted, not a full model.** Only banks/financials
  get a specific exclusion (debt/equity, current ratio). Insurance and real
  estate, called out in the original spec, don't yet have their own
  adjustments — their fundamentals simply run through the general metrics,
  which may under- or over-state them until sector-specific rules are added.
