/**
 * EGX universe — generated, not typed.
 *
 * Identity (ticker → company, sector, industry) comes from
 * `universe.generated.json`, built by `npm run build:universe` from three
 * sources — the EGX listing CSV, TradingView's screener, and the Yahoo /
 * TradingView chart feeds that must prove a usable price series exists.
 *
 * WHY IT IS GENERATED: the first version of this file was typed from memory.
 * Nine tickers pointed at the wrong company — KZPC read as Kima rather than
 * Kafr El Zayat Pesticides, CPCI as a poultry firm when it is Kahira
 * Pharmaceuticals, AXPH and PHAR swapped with each other. Two of them reached a
 * recommendation list. Every price and indicator was correct; only the identity
 * was wrong, so nothing downstream could catch it. Regenerating from a feed
 * removes that whole class of error rather than fixing instances of it.
 *
 * The Arabic overlay below is the one hand-maintained part, and is deliberately
 * partial: it covers names that have been checked against the verified English
 * name. Anything absent falls back to English rather than inventing a
 * translation — a wrong Arabic name is the same failure in a new coat.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** @type {{generatedAt:string,stocks:Array<object>,rejected:Array<object>,candidateTotal:number,bySource:object,sources:object}} */
let generated;
try {
  generated = require('./universe.generated.json');
} catch {
  generated = { generatedAt: null, stocks: [], rejected: [], candidateTotal: 0, bySource: {}, sources: {} };
  console.warn('[universe] universe.generated.json مش موجود — شغّل: npm run build:universe');
}

export const SECTORS = {
  banks: 'بنوك',
  financials: 'خدمات مالية',
  realestate: 'عقارات',
  industrials: 'صناعة',
  materials: 'أسمدة وكيماويات',
  energy: 'طاقة ومرافق',
  consumer: 'سلع استهلاكية',
  healthcare: 'رعاية صحية',
  telecom: 'اتصالات',
  tech: 'تكنولوجيا ومدفوعات',
  tourism: 'سياحة وترفيه',
  transport: 'نقل وشحن',
  holding: 'شركات قابضة',
  education: 'تعليم',
};

/**
 * Arabic names for tickers whose identity has been individually confirmed
 * against the generated English name. Partial by design — see the header.
 */
const AR_NAMES = {
  COMI: 'البنك التجاري الدولي',
  ADIB: 'مصرف أبوظبي الإسلامي — مصر',
  CIEB: 'كريدي أجريكول مصر',
  SAUD: 'بنك البركة مصر',
  CANA: 'بنك قناة السويس',
  HDBK: 'بنك التعمير والإسكان',
  FAIT: 'بنك فيصل الإسلامي المصري',
  EXPA: 'البنك المصري لتنمية الصادرات',
  HRHO: 'المجموعة المالية هيرميس',
  CCAP: 'القلعة للاستثمارات المالية',
  BINV: 'بي إنفستمنتس القابضة',
  ATLC: 'التوفيق للتأجير التمويلي',
  BTFH: 'بلتون القابضة',
  ETEL: 'المصرية للاتصالات',
  FWRY: 'فوري',
  EFIH: 'إي فاينانس للاستثمارات المالية والرقمية',
  RAYA: 'راية القابضة',
  ABUK: 'أبوقير للأسمدة والصناعات الكيماوية',
  MFPC: 'موبكو — مصر لإنتاج الأسمدة',
  KZPC: 'كفر الزيات للمبيدات والكيماويات',
  EGCH: 'كيما — المصرية للصناعات الكيماوية',
  SKPC: 'سيدي كرير للبتروكيماويات',
  AMOC: 'الإسكندرية للزيوت المعدنية',
  SWDY: 'السويدي إليكتريك',
  ORWE: 'النساجون الشرقيون للسجاد',
  GBCO: 'جي بي كوربوريشن',
  EGAL: 'مصر للألومنيوم',
  IRON: 'الحديد والصلب المصرية',
  ARCC: 'العربية للأسمنت',
  MCQE: 'مصر للأسمنت — قنا',
  SCEM: 'أسمنت سيناء',
  MBSC: 'مصر بني سويف للأسمنت',
  SPIN: 'الإسكندرية للغزل والنسيج',
  ALCN: 'الإسكندرية لتداول الحاويات والبضائع',
  JUFO: 'جهينة للصناعات الغذائية',
  OLFI: 'عبور لاند للصناعات الغذائية',
  EFID: 'إيديتا للصناعات الغذائية',
  DOMT: 'دومتي — العربية للصناعات الغذائية',
  SUGR: 'الدلتا للسكر',
  EAST: 'الشرقية — إيسترن كومباني',
  POUL: 'القاهرة للدواجن',
  ISPH: 'ابن سينا فارما',
  CPCI: 'القاهرة للأدوية والصناعات الكيماوية',
  AXPH: 'الإسكندرية للأدوية والصناعات الكيماوية',
  PHAR: 'المصرية الدولية للصناعات الدوائية — إيبيكو',
  NIPH: 'النيل للأدوية والصناعات الكيماوية',
  CLHO: 'مستشفى كليوباترا',
  BIOC: 'جلاكسو سميثكلاين مصر',
  TMGH: 'مجموعة طلعت مصطفى القابضة',
  PHDC: 'بالم هيلز للتعمير',
  HELI: 'مصر الجديدة للإسكان والتعمير',
  MASR: 'مدينة مصر للإسكان والتعمير',
  EMFD: 'إعمار مصر للتنمية',
  OCDI: 'السادس من أكتوبر للتنمية والاستثمار — سوديك',
  ORHD: 'أوراسكوم للتنمية مصر',
  ZMID: 'زهراء المعادي للاستثمار والتعمير',
  EGTS: 'المصرية للمنتجعات السياحية',
  CIRA: 'القاهرة للاستثمار والتنمية العقارية',
  MTIE: 'إم إم جروب للصناعة والتجارة',
};

/** Banks are the one sector TradingView lumps into a generic "Finance" bucket. */
function refineSector(entry) {
  const text = `${entry.en} ${entry.industry ?? ''}`.toLowerCase();
  if (/\bbank|banks\b/.test(text)) return 'banks';
  if (/real estate|housing|development|urban/.test(text) && entry.sector === 'financials') return 'realestate';
  if (/hotel|resort|tourism|touristic/.test(text)) return 'tourism';
  return entry.sector;
}

export const UNIVERSE = generated.stocks.map((s) => ({
  code: s.code,
  yahoo: s.yahoo,
  // Which feed serves this stock's history: 'yahoo' or 'tradingview'.
  source: s.source ?? 'yahoo',
  ar: AR_NAMES[s.code] ?? s.en,
  en: s.en,
  sector: refineSector(s),
  industry: s.industry,
  shariah: s.shariah,
  marketCapEgp: s.marketCapEgp,
  avgTurnoverEgp: s.avgTurnoverEgp,
  // True when the Arabic name has been individually confirmed; the UI can mark
  // the rest as untranslated rather than presenting English as a translation.
  arVerified: Boolean(AR_NAMES[s.code]),
}));

export const UNIVERSE_META = {
  generatedAt: generated.generatedAt,
  sources: generated.sources ?? {},
  candidateTotal: generated.candidateTotal ?? UNIVERSE.length,
  analyzable: UNIVERSE.length,
  bySource: generated.bySource ?? {},
  rejected: generated.rejected ?? [],
};

const BY_CODE = new Map(UNIVERSE.map((s) => [s.code, s]));

export function lookup(code) {
  return BY_CODE.get(String(code).toUpperCase().trim()) ?? null;
}

/**
 * Yahoo symbol for a ticker. Null for stocks served by TradingView instead, so
 * the fetcher skips Yahoo for them; falls back to `<CODE>.CA` for unknown codes.
 */
export function toYahoo(code) {
  const c = String(code).toUpperCase().trim();
  const hit = BY_CODE.get(c);
  if (!hit) return `${c}.CA`;
  return hit.yahoo ?? `${c}.CA`;
}

export function sectorLabel(key) {
  return SECTORS[key] ?? key;
}

export const ALL_CODES = UNIVERSE.map((s) => s.code);

/** The liquid core — scanning every listed name is slow and mostly noise. */
export function liquidCodes(minTurnoverEgp = 5_000_000) {
  return UNIVERSE.filter((s) => (s.avgTurnoverEgp ?? 0) >= minTurnoverEgp).map((s) => s.code);
}
