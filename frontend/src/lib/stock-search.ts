import type { Stock } from "@/lib/store";

// Case, Arabic diacritics and letter variants (أ/إ/آ, ى/ي, ة/ه) shouldn't
// decide whether a name matches.
export const normalizeSearch = (text: string) =>
  text
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .trim();

/**
 * Lower is better; null means no match. A ticker typed in full comes first,
 * then codes starting with it, then names with a word starting with it, then
 * anything that merely contains it. Only contiguous matches count — cmdk's
 * default fuzzy scoring matched scattered letters and flooded the list.
 */
function matchRank(stock: Stock, query: string): number | null {
  const code = stock.code.toLowerCase();
  if (code === query) return 0;
  if (code.startsWith(query)) return 1;
  const names = [stock.ar, stock.en].filter(Boolean).map((name) => normalizeSearch(name!));
  if (names.some((name) => name.startsWith(query))) return 2;
  if (names.some((name) => name.split(/\s+/).some((word) => word.startsWith(query)))) return 3;
  if (code.includes(query)) return 4;
  // A letter or two turns up inside half the names — too loose to be useful.
  if (query.length >= 3 && names.some((name) => name.includes(query))) return 5;
  return null;
}

/**
 * The stocks matching `search` (by code, Arabic or English name), best match
 * first. An empty search returns the whole list unchanged.
 */
export function searchStocks(universe: Stock[], search: string): Stock[] {
  const query = normalizeSearch(search);
  if (!query) return universe;
  const hits = universe
    .map((stock) => ({ stock, rank: matchRank(stock, query) }))
    .filter((hit): hit is { stock: Stock; rank: number } => hit.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.stock.code.localeCompare(b.stock.code));
  // A full ticker was typed: show it and the codes that extend it, not
  // every name that happens to share those letters.
  const exactTicker = hits[0]?.rank === 0;
  return hits.filter((hit) => !exactTicker || hit.rank <= 1).map((hit) => hit.stock);
}
