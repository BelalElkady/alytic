# Investor flows panel on the indices page

- **Date:** 2026-10-13
- **Status:** Design, awaiting review

## Goal

Show Users, on the المؤشرات page, who bought and who sold in the last closed EGX session: Egyptians, Arabs and foreigners, and individuals against institutions.

## Constraints

- None of the app's feeds (TradingView, Yahoo, oanor, Mubasher bars) carries this breakdown, and EGX's own site rejects requests from our servers' side of its firewall.
- The owner chose the source: an AI web search of the daily market-wrap news, run after the close.
- News wraps reliably state each group's **net** buy or sell and its share of trading. Gross buy and sell values are often missing.
- A wrong number is worse than no number. The panel must never show figures that failed a check, and never show an older session as if it were current.

## Terms

**Investor flows**: one closed session's net buying or selling per investor group, as reported by the market-wrap news. Labelled "تعاملات المستثمرين". Add this term to `CONTEXT.md` when implementing.

**Current session**: the session the panel is allowed to show. On a trading day at or after 14:30 Cairo it is today. Otherwise it is the most recent trading day before today.

## What the User sees

A panel titled "تعاملات المستثمرين" on `/indices`, between the index cards and the market heatmap.

- The session date, and a line saying the figures come from market news after the close, with a link to the source article.
- One row per group with its net value in EGP: green and "صافي شراء" for a net buy, red and "صافي بيع" for a net sell.
  - By nationality: مصريين, عرب, أجانب.
  - By type: أفراد, مؤسسات.
  - The six nationality × type cells, only when the source states them.
- Each group's share of trading (%), when the source states it.
- Gross buy and sell values, only when the source states them.

**When the panel is hidden.** The panel renders only when a saved row exists for the Current session. In every other case it is absent from the page, with no placeholder, no error and no older session:

- the Current session's fetch failed or was rejected by a check;
- the session closed but the fetch hasn't succeeded yet (14:30 until the job lands);
- the request for the data fails.

So on a normal trading day the panel shows yesterday's session until 14:30, disappears, and comes back with today's session once the job succeeds.

## Fetching

A new module, `backend/src/investorFlows.js`, owns the research, the checks and the schedule.

- **Schedule.** An in-process scheduler, started beside `startDailyCloseScheduler()`, runs at 15:30 Cairo on trading days (`isTradingDay`). If no row was saved it retries hourly, with the last attempt at 20:30. It is separate from the daily close, so a slow search never delays portfolio snapshots.
- **Once per day, for every site.** The result is stored in the platform database, so one search serves all tenants. Once a row exists for the date, later attempts that day do nothing.
- **Research.** One structured request with web search, the same mechanism as `researchCorporateAction` in `backend/src/corporateActions.js`: a zod schema, `webSearch: { engine: 'auto', max_results: 5, max_uses: 4 }`, and `feature: 'investor_flows'` so its cost shows up under its own label. The prompt names the session date and the Arabic phrasing the wraps use (صافي شراء / صافي بيع, تعاملات المصريين والعرب والأجانب, الأفراد والمؤسسات), and tells the model to return `found: false` when it can't find the figures for that exact date.
- **Manual run.** `POST /api/cron/investor-flows`, gated by an `X-Cron-Secret` header like the other cron routes, for backfill and debugging. `force: true` replaces an existing row for the date.

### Schema the model fills

```
found: boolean
sessionDate: YYYY-MM-DD        // the session the article reports
sourceUrl: string | null
groups: [                      // any subset the source states
  { nationality: 'egyptian' | 'arab' | 'foreign' | 'all',
    type: 'individual' | 'institution' | 'all',
    netEgp: number,            // positive = net buy, negative = net sell
    sharePct: number | null,
    buyEgp: number | null,
    sellEgp: number | null }
]
```

`all` on one axis is that axis's total: `{ egyptian, all }` is all Egyptians, `{ all, institution }` is all institutions.

### Checks before saving

A result is saved only if every check passes. A failed check saves nothing and is logged with its reason.

1. `found` is true and `sourceUrl` is present.
2. `sessionDate` equals the date the job is fetching.
3. The three nationality totals are all present.
4. **Nets sum to zero.** Every buy is someone's sell, so the three nationality nets must sum to about zero: the absolute sum is at most 2 % of the largest absolute net, to allow for rounding in the article. The same check applies to the two type totals when both are present, and to the six cells when all six are present.
5. Where both exist, a total agrees with the sum of its cells within the same tolerance.

Check 4 is the main defence against a misread sign or a swapped group.

## Storage

A new table in the platform database, added to `backend/supabase/schema.sql` and listed with the other platform-only tables in `platform.sql`'s header comment:

```sql
create table if not exists investor_flows (
  session_date date primary key,
  groups_json jsonb not null,
  source_url text not null,
  fetched_at timestamptz not null default now()
);
```

`db.js` gains `getInvestorFlows(sessionDate)` and `saveInvestorFlows(...)`, using `platformDb` like the `index_overrides` helpers. Rows are kept, so a history view can be built later.

## API

`GET /api/indices/investor-flows`, available to any signed-in User like `/api/indices/performance`.

- Computes the Current session and reads its row.
- Responds `{ flows: { sessionDate, groups, sourceUrl, fetchedAt } }`, or `{ flows: null }` when there is no row for the Current session. It never falls back to an older row.

## Frontend

A new component, `frontend/src/components/desk/investor-flows.tsx`, rendered in `frontend/src/routes/_app.indices.tsx` between the cards grid and `<MarketHeatmap />`. It fetches its own data, like the heatmap, and returns `null` while loading, on error, and when `flows` is null. It uses the existing `Panel`, `fmt`, `tone` and the `up` / `down` colour tokens.

## Out of scope

- A history chart or past sessions.
- Intraday figures during the session.
- An admin screen to enter or correct the numbers.

## Testing

- Unit tests for the checks: a clean result passes; a flipped sign, a missing nationality, a wrong session date and a missing source each fail.
- Unit test for the Current session rule: before and after 14:30 on a trading day, on a weekend, and after a holiday.
- API test: the endpoint returns the Current session's row, and `{ flows: null }` when only an older row exists.
- Component test: the panel renders nothing when `flows` is null.
