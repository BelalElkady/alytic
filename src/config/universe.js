/**
 * EGX universe.
 *
 * `code` is the EGX ticker as your broker shows it. `yahoo` is the symbol on
 * Yahoo's chart API — EGX listings carry a `.CA` (Cairo) suffix. Every entry
 * here was resolved against the live chart endpoint; run `npm run sync -- --validate`
 * to re-check after editing, since Yahoo silently drops symbols on delisting.
 *
 * `shariah` is INDICATIVE only — it reflects the obvious business-activity
 * screen (conventional banking, alcohol, conventional insurance), not the
 * financial-ratio screens, which need balance-sheet data each quarter. Treat
 * 'review' as "check before relying on it".
 */

export const SECTORS = {
  banks: 'بنوك',
  financials: 'خدمات مالية',
  realestate: 'عقارات',
  industrials: 'صناعة',
  materials: 'أسمدة وكيماويات',
  energy: 'طاقة وبتروكيماويات',
  consumer: 'أغذية ومشروبات',
  healthcare: 'رعاية صحية',
  telecom: 'اتصالات',
  tech: 'تكنولوجيا ومدفوعات',
  tourism: 'سياحة وترفيه',
  transport: 'نقل وشحن',
  holding: 'شركات قابضة',
  education: 'تعليم',
};

/** @type {Array<{code:string,yahoo:string,ar:string,en:string,sector:keyof SECTORS,shariah:'compliant'|'non_compliant'|'review',egx30?:boolean}>} */
export const UNIVERSE = [
  // --- Banks & financials ---
  { code: 'COMI', yahoo: 'COMI.CA', ar: 'البنك التجاري الدولي', en: 'Commercial International Bank', sector: 'banks', shariah: 'non_compliant', egx30: true },
  { code: 'ADIB', yahoo: 'ADIB.CA', ar: 'مصرف أبوظبي الإسلامي', en: 'Abu Dhabi Islamic Bank Egypt', sector: 'banks', shariah: 'compliant' },
  { code: 'CIEB', yahoo: 'CIEB.CA', ar: 'كريدي أجريكول مصر', en: 'Credit Agricole Egypt', sector: 'banks', shariah: 'non_compliant' },
  { code: 'SAUD', yahoo: 'SAUD.CA', ar: 'البنك السعودي المصري', en: 'Saudi Egyptian Bank', sector: 'banks', shariah: 'non_compliant' },
  { code: 'CANA', yahoo: 'CANA.CA', ar: 'بنك قناة السويس', en: 'Suez Canal Bank', sector: 'banks', shariah: 'non_compliant' },
  { code: 'HRHO', yahoo: 'HRHO.CA', ar: 'المجموعة المالية هيرميس', en: 'EFG Holding', sector: 'financials', shariah: 'non_compliant', egx30: true },
  { code: 'EFIH', yahoo: 'EFIH.CA', ar: 'إي فاينانس', en: 'e-Finance for Digital & Financial Investments', sector: 'tech', shariah: 'review', egx30: true },
  { code: 'CCAP', yahoo: 'CCAP.CA', ar: 'القلعة للاستشارات', en: 'Qalaa Holdings', sector: 'holding', shariah: 'review' },
  { code: 'BINV', yahoo: 'BINV.CA', ar: 'بي إنفستمنتس', en: 'B Investments Holding', sector: 'financials', shariah: 'review' },
  { code: 'ATLC', yahoo: 'ATLC.CA', ar: 'أوراسكوم المالية القابضة', en: 'Orascom Financial Holding', sector: 'financials', shariah: 'review' },
  { code: 'AFDI', yahoo: 'AFDI.CA', ar: 'الأهلي للتنمية والاستثمار', en: 'Al Ahli Development & Investment', sector: 'financials', shariah: 'review' },
  { code: 'BTFH', yahoo: 'BTFH.CA', ar: 'بلتون المالية القابضة', en: 'Beltone Financial Holding', sector: 'financials', shariah: 'non_compliant' },

  // --- Telecom & tech ---
  { code: 'ETEL', yahoo: 'ETEL.CA', ar: 'المصرية للاتصالات', en: 'Telecom Egypt', sector: 'telecom', shariah: 'compliant', egx30: true },
  { code: 'FWRY', yahoo: 'FWRY.CA', ar: 'فوري', en: 'Fawry for Banking Technology', sector: 'tech', shariah: 'compliant', egx30: true },
  { code: 'RAYA', yahoo: 'RAYA.CA', ar: 'راية القابضة', en: 'Raya Holding', sector: 'tech', shariah: 'review' },

  // --- Materials, fertilizers, energy ---
  { code: 'ABUK', yahoo: 'ABUK.CA', ar: 'أبوقير للأسمدة', en: 'Abu Qir Fertilizers', sector: 'materials', shariah: 'compliant', egx30: true },
  { code: 'MFPC', yahoo: 'MFPC.CA', ar: 'موبكو', en: 'Misr Fertilizers Production (MOPCO)', sector: 'materials', shariah: 'compliant', egx30: true },
  { code: 'KZPC', yahoo: 'KZPC.CA', ar: 'كيما', en: 'Kima — Egyptian Chemical Industries', sector: 'materials', shariah: 'compliant' },
  { code: 'SKPC', yahoo: 'SKPC.CA', ar: 'سيدي كرير للبتروكيماويات', en: 'Sidi Kerir Petrochemicals', sector: 'energy', shariah: 'compliant', egx30: true },
  { code: 'AMOC', yahoo: 'AMOC.CA', ar: 'الإسكندرية للزيوت المعدنية', en: 'Alexandria Mineral Oils', sector: 'energy', shariah: 'compliant' },
  { code: 'EGAL', yahoo: 'EGAL.CA', ar: 'مصر للألومنيوم', en: 'Egypt Aluminium', sector: 'industrials', shariah: 'compliant' },
  { code: 'IRON', yahoo: 'IRON.CA', ar: 'الحديد والصلب للمناجم', en: 'Iron & Steel for Mines & Quarries', sector: 'industrials', shariah: 'review' },
  { code: 'ARCC', yahoo: 'ARCC.CA', ar: 'العربية للأسمنت', en: 'Arabian Cement', sector: 'industrials', shariah: 'compliant' },
  { code: 'MCQE', yahoo: 'MCQE.CA', ar: 'مصر لصناعة الكيماويات', en: 'Misr Chemical Industries', sector: 'materials', shariah: 'compliant' },

  // --- Industrials & infrastructure ---
  { code: 'SWDY', yahoo: 'SWDY.CA', ar: 'السويدي إليكتريك', en: 'Elsewedy Electric', sector: 'industrials', shariah: 'compliant', egx30: true },
  { code: 'ORAS', yahoo: 'ORAS.CA', ar: 'أوراسكوم كونستراكشون', en: 'Orascom Construction', sector: 'industrials', shariah: 'compliant', egx30: true },
  { code: 'ORWE', yahoo: 'ORWE.CA', ar: 'النساجون الشرقيون', en: 'Oriental Weavers', sector: 'industrials', shariah: 'compliant', egx30: true },
  { code: 'ESRS', yahoo: 'ESRS.CA', ar: 'حديد عز', en: 'Ezz Steel', sector: 'industrials', shariah: 'review' },
  { code: 'SPIN', yahoo: 'SPIN.CA', ar: 'النصر للملابس والمنسوجات', en: 'Nasr Clothing & Textiles (Kabo)', sector: 'industrials', shariah: 'review' },
  { code: 'GBCO', yahoo: 'GBCO.CA', ar: 'جي بي كوربوريشن', en: 'GB Corp', sector: 'industrials', shariah: 'review', egx30: true },

  // --- Consumer & food ---
  { code: 'JUFO', yahoo: 'JUFO.CA', ar: 'جهينة للصناعات الغذائية', en: 'Juhayna Food Industries', sector: 'consumer', shariah: 'compliant', egx30: true },
  { code: 'OLFI', yahoo: 'OLFI.CA', ar: 'عبور لاند للصناعات الغذائية', en: 'Obour Land for Food Industries', sector: 'consumer', shariah: 'compliant' },
  { code: 'EFID', yahoo: 'EFID.CA', ar: 'إيديتا للصناعات الغذائية', en: 'Edita Food Industries', sector: 'consumer', shariah: 'compliant' },
  { code: 'DOMT', yahoo: 'DOMT.CA', ar: 'دومتي', en: 'Domty (Arabian Food Industries)', sector: 'consumer', shariah: 'compliant' },
  { code: 'SUGR', yahoo: 'SUGR.CA', ar: 'الدلتا للسكر', en: 'Delta Sugar', sector: 'consumer', shariah: 'compliant' },
  { code: 'EAST', yahoo: 'EAST.CA', ar: 'الشرقية إيسترن كومباني', en: 'Eastern Company', sector: 'consumer', shariah: 'non_compliant', egx30: true },
  { code: 'CPCI', yahoo: 'CPCI.CA', ar: 'القاهرة للدواجن', en: 'Cairo Poultry', sector: 'consumer', shariah: 'compliant' },
  { code: 'ZMID', yahoo: 'ZMID.CA', ar: 'الزيوت المستخلصة', en: 'Extracted Oils & Derivatives', sector: 'consumer', shariah: 'compliant' },

  // --- Real estate ---
  { code: 'TMGH', yahoo: 'TMGH.CA', ar: 'مجموعة طلعت مصطفى', en: 'Talaat Moustafa Group', sector: 'realestate', shariah: 'review', egx30: true },
  { code: 'PHDC', yahoo: 'PHDC.CA', ar: 'بالم هيلز للتعمير', en: 'Palm Hills Developments', sector: 'realestate', shariah: 'review', egx30: true },
  { code: 'HELI', yahoo: 'HELI.CA', ar: 'مصر الجديدة للإسكان', en: 'Heliopolis Housing', sector: 'realestate', shariah: 'review', egx30: true },
  { code: 'MNHD', yahoo: 'MNHD.CA', ar: 'مدينة نصر للإسكان', en: 'Madinet Nasr Housing', sector: 'realestate', shariah: 'review' },
  { code: 'EGTS', yahoo: 'EGTS.CA', ar: 'المصرية للمنتجعات السياحية', en: 'Egyptian Resorts Company', sector: 'tourism', shariah: 'review' },

  // --- Healthcare & pharma ---
  { code: 'ISPH', yahoo: 'ISPH.CA', ar: 'ابن سينا فارما', en: 'Ibnsina Pharma', sector: 'healthcare', shariah: 'compliant' },
  { code: 'AXPH', yahoo: 'AXPH.CA', ar: 'أكسا فارما', en: 'Axis Pharma', sector: 'healthcare', shariah: 'review' },
  { code: 'PHAR', yahoo: 'PHAR.CA', ar: 'الإسكندرية للأدوية', en: 'Alexandria Pharmaceuticals', sector: 'healthcare', shariah: 'compliant' },

  // --- Holding ---
  { code: 'EKHO', yahoo: 'EKHO.CA', ar: 'فالمور القابضة', en: 'Valmore Holding (ex Egypt Kuwait Holding)', sector: 'holding', shariah: 'review' },
];

const BY_CODE = new Map(UNIVERSE.map((s) => [s.code, s]));

export function lookup(code) {
  return BY_CODE.get(String(code).toUpperCase().trim()) ?? null;
}

/** Yahoo symbol for a ticker, falling back to `<CODE>.CA` for names not yet in the table. */
export function toYahoo(code) {
  const c = String(code).toUpperCase().trim();
  return BY_CODE.get(c)?.yahoo ?? `${c}.CA`;
}

export function sectorLabel(key) {
  return SECTORS[key] ?? key;
}

export const EGX30 = UNIVERSE.filter((s) => s.egx30).map((s) => s.code);
export const ALL_CODES = UNIVERSE.map((s) => s.code);
