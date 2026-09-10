/**
 * EGX's four headline indices — EGX30 (most liquid 30), EGX70 EWI (next 70,
 * equal-weighted), EGX33 Shariah (Shariah-screened, drawn from EGX100), and
 * EGX100 (EGX30 ∪ EGX70, by definition — not independently selected).
 *
 * Provenance and a real caveat: EGX's own constituents page
 * (egx.com.eg/en/CurrentIndexConstituntes.aspx) was unreachable from this
 * environment when this file was built, so these were assembled from
 * Investing.com's constituent pages (company names only, no tickers) and
 * matched by hand against this app's own verified `UNIVERSE` — the same
 * ticker set `verify-universe.js` checks against the live feed. Every code
 * below was resolved with reasonable confidence; a handful of scraped names
 * had no confident match (delisted, illiquid, or not covered by this app's
 * data sources) and were left out rather than guessed. See EXCLUDED below.
 *
 * Index membership is reviewed and rebalanced roughly twice a year — this
 * list will drift. Re-run `scripts/match-index-names.mjs` against fresh
 * constituent names periodically and update this file; there is no live feed
 * for this the way there is for prices.
 *
 * Checked 2026-09-10 against EGX's official semi-annual review effective
 * 2026-09-01 (corroborated by EnterpriseAM and a Zawya/Mondovisione
 * republish of the EGX release): EGX30 and EGX70 already matched the review
 * except Kima (EGCH), which had been sitting in EXCLUDED_UNMATCHED and is
 * now a real EGX70 constituent — added. EGX33 was stale: removed OLFI and
 * CIRA, added GOUR and CLHO per the same review.
 */

export const INDICES_AS_OF = '2026-09';

/** Names investing.com listed that had no confident match in UNIVERSE — not
 * a bug, just outside what this app can currently track (delisted, too
 * illiquid to have made the analyzable universe, or a name too generic to
 * resolve safely: "GB Auto", "EDBE", "Atlas Land Reclamation"). */
export const EXCLUDED_UNMATCHED = ['GB Auto', 'EDBE', 'Atlas Land Reclamation'];

export const EGX30 = [
  'CCAP', 'COMI', 'ETEL', 'HRHO', 'PHDC', 'SKPC', 'TMGH', 'HELI', 'RAYA', 'ABUK',
  'MCQE', 'AMOC', 'EAST', 'ALCN', 'BTFH', 'EGAL', 'JUFO', 'ORHD', 'ADIB', 'ORAS',
  'EMFD', 'CLHO', 'EFID', 'MFPC', 'ISPH', 'FWRY', 'RMDA', 'VLMRA', 'EFIH',
];

export const EGX70 = [
  'EGTS', 'ELEC', 'ELKA', 'MPRC', 'OCDI', 'ASPI', 'SVCE', 'SWDY', 'UEGC', 'ASCM',
  'COSG', 'CSAG', 'DAPH', 'EHDR', 'ELSH', 'ENGC', 'ETRS', 'HDBK', 'ISMA', 'KABO',
  'LCSW', 'MASR', 'MPCO', 'NCCW', 'ORWE', 'POUL', 'PRCL', 'UNIP', 'ZEOT', 'ZMID',
  'MBSC', 'CIEB', 'NIPH', 'PHAR', 'SCEM', 'AIH', 'AMER', 'AMIA', 'ATQA', 'DSCW',
  'GPIM', 'IDRE', 'MEPA', 'MPCI', 'OBRI', 'OIH', 'SDTI', 'ARCC', 'IEEC', 'ARAB',
  'SIPC', 'MTIE', 'ICFC', 'MOED', 'ATLC', 'CNFN', 'ISMQ', 'GDWA', 'PRDC', 'MCRO',
  'TAQA', 'ACTF', 'VALU', 'BONY', 'AIDC', 'GOUR', 'EGCH',
];

export const EGX33 = [
  'ACGC', 'ETEL', 'OCDI', 'PHDC', 'SKPC', 'TMGH', 'ETRS', 'IFAP', 'LCSW', 'MASR',
  'MPCO', 'ORWE', 'SAUD', 'MCQE', 'AMOC', 'EGAS', 'FAIT', 'ATQA', 'EGAL',
  'FAITA', 'JUFO', 'ORHD', 'ADIB', 'ARCC', 'ORAS', 'EFID', 'MTIE', 'RACC',
  'ICFC', 'ISPH', 'RMDA', 'EFIH', 'GOUR', 'CLHO',
];

/** EGX100 is EGX30 + EGX70 by definition — no separate source to match. */
export const EGX100 = [...new Set([...EGX30, ...EGX70])];

export const EGX_INDICES = { EGX30, EGX70, EGX33, EGX100 };

/** @returns {string[]|null} codes for a known index name, or null if unknown. */
export function codesForIndex(name) {
  const key = String(name ?? '').toUpperCase().replace(/\s+/g, '');
  return EGX_INDICES[key] ?? null;
}
