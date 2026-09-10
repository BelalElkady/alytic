/**
 * TradingView screener client — universe enumeration and fundamentals.
 *
 * This fills the two holes Yahoo leaves for EGX:
 *   1. Yahoo cannot enumerate a market. The universe had to be typed by hand,
 *      and hand-typing produced nine tickers pointing at the wrong company.
 *      This endpoint returns all 296 EGX listings with their real names.
 *   2. Yahoo has NO fundamentals for EGX — `quoteSummary` answers
 *      "No fundamentals data found" for every Cairo symbol. This returns P/E,
 *      EPS, book value, ROE, debt/equity and dividend yield directly.
 *
 * Caveats, both measured rather than assumed:
 *   - It is an undocumented endpoint powering TradingView's public screener.
 *     There is no contract and no support; treat a failure as expected and
 *     degrade to Yahoo-only rather than erroring out.
 *   - Fundamentals are sparse on small caps. P/E is present for only ~27% of
 *     liquid names, dividend yield for ~81%. Nulls are normal, not a bug.
 *   - It provides no OHLC history, so Yahoo remains the source for every
 *     indicator. Prices here are live; Yahoo's last bar is the prior close.
 */

const ENDPOINT = 'https://scanner.tradingview.com/egypt/scan';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** Columns requested for the full screener pull. Order defines the row shape. */
const COLUMNS = [
  'name', 'description', 'close', 'change', 'volume', 'market_cap_basic',
  'price_earnings_ttm', 'earnings_per_share_basic_ttm', 'price_book_fq',
  'dividends_yield_current', 'debt_to_equity_fq', 'return_on_equity_fq',
  'net_income_ttm', 'total_revenue_ttm', 'current_ratio_fq',
  'sector', 'industry', 'currency', 'type',
];

/** TradingView's sector vocabulary mapped onto this project's Arabic labels. */
export const TV_SECTOR_MAP = {
  'Finance': 'financials',
  'Health Services': 'healthcare',
  'Health Technology': 'healthcare',
  'Consumer Non-Durables': 'consumer',
  'Consumer Durables': 'consumer',
  'Consumer Services': 'consumer',
  'Retail Trade': 'consumer',
  'Distribution Services': 'consumer',
  'Process Industries': 'materials',
  'Non-Energy Minerals': 'industrials',
  'Producer Manufacturing': 'industrials',
  'Industrial Services': 'industrials',
  'Electronic Technology': 'tech',
  'Technology Services': 'tech',
  'Communications': 'telecom',
  'Energy Minerals': 'energy',
  'Utilities': 'energy',
  'Transportation': 'transport',
  'Commercial Services': 'financials',
  'Miscellaneous': 'holding',
};

/**
 * Pull the whole EGX screener.
 * @returns {Promise<Array<object>>} one plain object per listing
 */
export async function fetchScreener({ limit = 600, timeoutMs = 20000 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json' },
      signal: ac.signal,
      body: JSON.stringify({
        columns: COLUMNS,
        ignore_unknown_fields: true,
        options: { lang: 'en' },
        range: [0, limit],
        sort: { sortBy: 'market_cap_basic', sortOrder: 'desc' },
        markets: ['egypt'],
      }),
    });
    if (!res.ok) throw new Error(`TradingView HTTP ${res.status}`);
    const body = await res.json();

    return (body.data ?? []).map((row) => {
      const o = Object.fromEntries(COLUMNS.map((c, i) => [c, row.d[i]]));
      return {
        code: o.name,
        name: o.description,
        price: o.close,
        changePct: o.change,
        volume: o.volume,
        turnoverEgp: (o.close ?? 0) * (o.volume ?? 0),
        marketCapEgp: o.market_cap_basic,
        peRatio: o.price_earnings_ttm,
        epsEgp: o.earnings_per_share_basic_ttm,
        priceToBook: o.price_book_fq,
        dividendYieldPct: o.dividends_yield_current,
        debtToEquity: o.debt_to_equity_fq,
        returnOnEquityPct: o.return_on_equity_fq,
        netIncomeEgp: o.net_income_ttm,
        revenueEgp: o.total_revenue_ttm,
        currentRatio: o.current_ratio_fq,
        tvSector: o.sector,
        industry: o.industry,
        sector: TV_SECTOR_MAP[o.sector] ?? null,
        currency: o.currency,
        type: o.type,
      };
    })
    // Some rows carry an ISIN instead of a ticker (e.g. EGS385S1C012 for
    // Ferchem Misr); those cannot be mapped to a Yahoo symbol.
    .filter((r) => r.type === 'stock' && /^[A-Z][A-Z0-9]{2,5}$/.test(r.code ?? ''));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fundamentals keyed by ticker, for the codes requested.
 * Returns an empty Map if the endpoint is unreachable — callers must treat
 * missing fundamentals as normal, since coverage is partial even on success.
 */
export async function fetchFundamentals(codes = null) {
  let rows;
  try {
    rows = await fetchScreener();
  } catch {
    return new Map();
  }
  const want = codes ? new Set(codes.map((c) => c.toUpperCase())) : null;
  const out = new Map();

  for (const r of rows) {
    if (want && !want.has(r.code)) continue;
    // A row with no numeric fundamentals at all is noise, not data.
    const hasAny = [r.peRatio, r.epsEgp, r.priceToBook, r.dividendYieldPct, r.returnOnEquityPct]
      .some((v) => v != null);
    if (!hasAny) continue;

    out.set(r.code, {
      code: r.code,
      source: 'tradingview',
      asOf: new Date().toISOString().slice(0, 10),
      peRatio: round(r.peRatio, 2),
      epsEgp: round(r.epsEgp, 2),
      priceToBook: round(r.priceToBook, 2),
      dividendYieldPct: round(r.dividendYieldPct, 2),
      debtToEquity: round(r.debtToEquity, 2),
      returnOnEquityPct: round(r.returnOnEquityPct, 1),
      marketCapEgp: r.marketCapEgp,
      netIncomeEgp: r.netIncomeEgp,
      revenueEgp: r.revenueEgp,
      currentRatio: round(r.currentRatio, 2),
      industry: r.industry,
      // A plain-language read of the numbers, so the brief carries a judgment
      // and not just a row of ratios.
      valuation: describeValuation(r),
    });
  }
  return out;
}

const round = (x, d) => (x == null || !Number.isFinite(x) ? null : +x.toFixed(d));

/** Short Arabic characterisation of the valuation, or null when too little is known. */
function describeValuation(r) {
  const bits = [];
  if (r.peRatio != null) {
    bits.push(
      r.peRatio <= 0 ? 'الشركة خسرانة (مكرر ربحية سالب)'
      : r.peRatio < 8 ? `مكرر ربحية ${r.peRatio.toFixed(1)} — رخيص`
      : r.peRatio < 15 ? `مكرر ربحية ${r.peRatio.toFixed(1)} — معقول`
      : `مكرر ربحية ${r.peRatio.toFixed(1)} — غالي`,
    );
  }
  if (r.dividendYieldPct != null && r.dividendYieldPct > 0) {
    bits.push(`توزيعات ${r.dividendYieldPct.toFixed(1)}%`);
  }
  if (r.returnOnEquityPct != null) {
    bits.push(`عائد على حقوق الملكية ${r.returnOnEquityPct.toFixed(0)}%${r.returnOnEquityPct >= 20 ? ' (قوي)' : r.returnOnEquityPct < 8 ? ' (ضعيف)' : ''}`);
  }
  if (r.debtToEquity != null && r.debtToEquity > 2) bits.push(`مديونية عالية (${r.debtToEquity.toFixed(1)}×)`);
  return bits.length ? bits.join(' · ') : null;
}
