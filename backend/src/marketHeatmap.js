/**
 * The market heatmap on the indices page: every analysable stock with today's
 * change, its size (market cap or today's traded value) and its sector, for a
 * treemap. Pure — the route in api/server.js fetches the quotes, the
 * TradingView screener and index membership and hands them in.
 */

import { sectorLabel } from './config/universe.js';

/** Where a stock with no known sector is grouped. */
export const OTHER_SECTOR = 'other';
const OTHER_LABEL = 'أخرى';

const positive = (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : null);

/**
 * @param {object} input
 * @param {Array<object>} input.stocks - universe entries (code, ar, en, sector, marketCapEgp, avgTurnoverEgp)
 * @param {Map<string, {price:number, changePct:number}>} input.quotes - today's quotes by code
 * @param {Array<object>} [input.screener] - TradingView screener rows (code, marketCapEgp, turnoverEgp); empty when it failed
 * @param {Record<string, string[]>} [input.membership] - index name → member codes
 * @returns {{ stocks: object[], sectors: {key:string, label:string, count:number}[] }}
 */
export function buildHeatmap({ stocks, quotes, screener = [], membership = {} }) {
  const live = new Map(screener.map((row) => [String(row.code).toUpperCase(), row]));
  const indicesOf = new Map();
  for (const [index, codes] of Object.entries(membership)) {
    for (const code of codes ?? []) {
      const key = String(code).toUpperCase();
      indicesOf.set(key, [...(indicesOf.get(key) ?? []), index]);
    }
  }

  const rows = [];
  for (const stock of stocks) {
    const quote = quotes.get(stock.code);
    if (!quote || !Number.isFinite(quote.changePct) || !positive(quote.price)) continue;
    const screen = live.get(stock.code);
    // The screener's figures are at most an hour old; the universe's are a
    // snapshot from when it was last built.
    const marketCapEgp = positive(screen?.marketCapEgp) ?? positive(stock.marketCapEgp);
    const turnoverEgp = positive(screen?.turnoverEgp) ?? positive(stock.avgTurnoverEgp);
    if (!marketCapEgp && !turnoverEgp) continue;
    const sector = stock.sector || OTHER_SECTOR;
    rows.push({
      code: stock.code,
      name: stock.ar || stock.en || stock.code,
      sector,
      sectorAr: sector === OTHER_SECTOR ? OTHER_LABEL : sectorLabel(sector),
      marketCapEgp,
      turnoverEgp,
      price: Number(quote.price),
      changePct: Number(quote.changePct),
      indices: indicesOf.get(stock.code) ?? [],
    });
  }

  const counts = new Map();
  for (const row of rows) counts.set(row.sector, { key: row.sector, label: row.sectorAr, count: (counts.get(row.sector)?.count ?? 0) + 1 });
  return { stocks: rows, sectors: [...counts.values()].sort((a, b) => b.count - a.count) };
}
