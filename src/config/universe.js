/**
 * EGX universe.
 *
 * PROVENANCE — read this before trusting anything here.
 *
 * The `en` field is Yahoo's own `meta.longName` for the symbol, checked against
 * the live endpoint, so ticker→company is verified rather than remembered. The
 * first draft of this file was typed from recall and had NINE tickers pointing
 * at the wrong company (KZPC read as Kima rather than Kafr El Zayat Pesticides;
 * MCQE as a chemicals firm rather than Misr Cement Qena; AXPH and PHAR swapped;
 * CPCI labelled a poultry company when it is Kahira Pharmaceuticals). Two of
 * those reached a recommendation list. Re-run `npm run verify:universe` after
 * editing — a mislabelled ticker means buying the wrong company.
 *
 * `ar` and `sector` are translations/classifications derived from the verified
 * English name. They are not from an exchange feed.
 *
 * `shariah` is INDICATIVE ONLY. It reflects the obvious business-activity
 * screen (conventional banking, tobacco, conventional insurance), never the
 * financial-ratio screens, which need each quarter's balance sheet. Treat
 * 'review' as "check this yourself before relying on it".
 *
 * COVERAGE: 46 symbols. EGX lists well over 200 companies, so this is a
 * curated subset weighted toward large, liquid names — a screener over it will
 * not surface opportunities outside it. Add symbols freely; `toYahoo()` falls
 * back to `<CODE>.CA`, and the quality gate rejects anything that doesn't trade.
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

/** @type {Array<{code:string,yahoo:string,ar:string,en:string,sector:keyof SECTORS,shariah:'compliant'|'non_compliant'|'review'}>} */
export const UNIVERSE = [
  // --- Banks ---
  { code: 'COMI', yahoo: 'COMI.CA', ar: 'البنك التجاري الدولي', en: 'Commercial International Bank Egypt (CIB) S.A.E.', sector: 'banks', shariah: 'non_compliant' },
  { code: 'ADIB', yahoo: 'ADIB.CA', ar: 'مصرف أبوظبي الإسلامي — مصر', en: 'Abu Dhabi Islamic Bank - Egypt - S.A.E', sector: 'banks', shariah: 'compliant' },
  { code: 'CIEB', yahoo: 'CIEB.CA', ar: 'كريدي أجريكول مصر', en: 'Credit Agricole - Egypt Bank (S.A.E.)', sector: 'banks', shariah: 'non_compliant' },
  // Corrected: SAUD is alBaraka (an Islamic bank), not "Saudi Egyptian Bank".
  { code: 'SAUD', yahoo: 'SAUD.CA', ar: 'بنك البركة مصر', en: 'alBaraka Bank Egypt S.A.E.', sector: 'banks', shariah: 'compliant' },
  { code: 'CANA', yahoo: 'CANA.CA', ar: 'بنك قناة السويس', en: 'Suez Canal Bank (S.A.E)', sector: 'banks', shariah: 'non_compliant' },

  // --- Financials & holdings ---
  { code: 'HRHO', yahoo: 'HRHO.CA', ar: 'المجموعة المالية هيرميس', en: 'EFG Holding Company S.A.E', sector: 'financials', shariah: 'non_compliant' },
  { code: 'CCAP', yahoo: 'CCAP.CA', ar: 'القلعة للاستثمارات المالية', en: 'QALA For Financial Investments', sector: 'holding', shariah: 'review' },
  { code: 'BINV', yahoo: 'BINV.CA', ar: 'بي إنفستمنتس القابضة', en: 'B Investments Holding S.A.E.', sector: 'financials', shariah: 'review' },
  // Corrected: ATLC is Al Tawfeek Leasing, not Orascom Financial Holding.
  { code: 'ATLC', yahoo: 'ATLC.CA', ar: 'التوفيق للتأجير التمويلي', en: 'Al Tawfeek Leasing Company', sector: 'financials', shariah: 'review' },
  { code: 'AFDI', yahoo: 'AFDI.CA', ar: 'الأهلي للتنمية والاستثمار', en: 'Al Ahly for Development & Investment', sector: 'financials', shariah: 'review' },
  { code: 'BTFH', yahoo: 'BTFH.CA', ar: 'بلتون القابضة', en: 'Beltone Holding S.A.E', sector: 'financials', shariah: 'non_compliant' },
  { code: 'EKHO', yahoo: 'EKHO.CA', ar: 'فالمور القابضة', en: 'Valmore Holding', sector: 'holding', shariah: 'review' },

  // --- Telecom & tech ---
  { code: 'ETEL', yahoo: 'ETEL.CA', ar: 'المصرية للاتصالات', en: 'Telecom Egypt Company', sector: 'telecom', shariah: 'compliant' },
  { code: 'FWRY', yahoo: 'FWRY.CA', ar: 'فوري', en: 'Fawry for Banking Technology and Electronic Payments S.A.E.', sector: 'tech', shariah: 'compliant' },
  { code: 'EFIH', yahoo: 'EFIH.CA', ar: 'إي فاينانس للاستثمارات المالية والرقمية', en: 'e-finance for Digital and Financial Investments S.A.E.', sector: 'tech', shariah: 'review' },
  { code: 'RAYA', yahoo: 'RAYA.CA', ar: 'راية القابضة للاستثمارات المالية', en: 'Raya Holding Company for Financial Investments (S.A.E)', sector: 'tech', shariah: 'review' },

  // --- Fertilizers, chemicals, energy ---
  { code: 'ABUK', yahoo: 'ABUK.CA', ar: 'أبوقير للأسمدة والصناعات الكيماوية', en: 'Abu Qir Fertilizers & Chemical Industries Company (S.A.E)', sector: 'materials', shariah: 'compliant' },
  { code: 'MFPC', yahoo: 'MFPC.CA', ar: 'موبكو — مصر لإنتاج الأسمدة', en: 'Misr Fertilizer Production Company', sector: 'materials', shariah: 'compliant' },
  // Corrected: KZPC is Kafr El Zayat Pesticides, not Kima.
  { code: 'KZPC', yahoo: 'KZPC.CA', ar: 'كفر الزيات للمبيدات والكيماويات', en: 'Kafr El Zayat For Pesticides & Chemicals Co.(S.A.E)', sector: 'materials', shariah: 'compliant' },
  { code: 'SKPC', yahoo: 'SKPC.CA', ar: 'سيدي كرير للبتروكيماويات', en: 'Sidi Kerir Petrochemicals Co.', sector: 'energy', shariah: 'compliant' },
  { code: 'AMOC', yahoo: 'AMOC.CA', ar: 'الإسكندرية للزيوت المعدنية', en: 'Alexandria Mineral Oils Company', sector: 'energy', shariah: 'compliant' },

  // --- Industrials & building materials ---
  { code: 'SWDY', yahoo: 'SWDY.CA', ar: 'السويدي إليكتريك', en: 'El Sewedy Electric Company', sector: 'industrials', shariah: 'compliant' },
  { code: 'ORWE', yahoo: 'ORWE.CA', ar: 'النساجون الشرقيون للسجاد', en: 'Oriental Weavers Carpets Company (S.A.E)', sector: 'industrials', shariah: 'compliant' },
  { code: 'ORAS', yahoo: 'ORAS.CA', ar: 'أوراسكوم كونستراكشون', en: 'Orascom Construction PLC', sector: 'industrials', shariah: 'compliant' },
  { code: 'GBCO', yahoo: 'GBCO.CA', ar: 'جي بي كوربوريشن', en: 'GB Corp', sector: 'industrials', shariah: 'review' },
  { code: 'EGAL', yahoo: 'EGAL.CA', ar: 'مصر للألومنيوم', en: 'Egypt Aluminum', sector: 'industrials', shariah: 'compliant' },
  { code: 'IRON', yahoo: 'IRON.CA', ar: 'الحديد والصلب المصرية', en: 'Egyptian Iron and Steel Company', sector: 'industrials', shariah: 'review' },
  { code: 'ESRS', yahoo: 'ESRS.CA', ar: 'حديد عز', en: 'Ezz Steel', sector: 'industrials', shariah: 'review' },
  { code: 'ARCC', yahoo: 'ARCC.CA', ar: 'العربية للأسمنت', en: 'Arabian Cement Company S.A.E.', sector: 'industrials', shariah: 'compliant' },
  // Corrected: MCQE is Misr Cement (Qena) — a cement producer, not a chemicals firm.
  { code: 'MCQE', yahoo: 'MCQE.CA', ar: 'مصر للأسمنت — قنا', en: 'Misr Cement (Qena) Company (S.A.E)', sector: 'industrials', shariah: 'compliant' },
  // Corrected: SPIN is Alexandria Spinning & Weaving, not Nasr Clothing (Kabo).
  { code: 'SPIN', yahoo: 'SPIN.CA', ar: 'الإسكندرية للغزل والنسيج', en: 'Alexandria Spinning & Weaving Co.', sector: 'industrials', shariah: 'review' },

  // --- Consumer & food ---
  { code: 'JUFO', yahoo: 'JUFO.CA', ar: 'جهينة للصناعات الغذائية', en: 'Juhayna Food Industries S.A.E.', sector: 'consumer', shariah: 'compliant' },
  { code: 'OLFI', yahoo: 'OLFI.CA', ar: 'عبور لاند للصناعات الغذائية', en: 'Obour Land for Food Industries S.A.E.', sector: 'consumer', shariah: 'compliant' },
  { code: 'EFID', yahoo: 'EFID.CA', ar: 'إيديتا للصناعات الغذائية', en: 'Edita Food Industries Company (S.A.E)', sector: 'consumer', shariah: 'compliant' },
  { code: 'DOMT', yahoo: 'DOMT.CA', ar: 'دومتي — العربية للصناعات الغذائية', en: 'Arabian Food Industries Company (DOMTY) - S.A.E', sector: 'consumer', shariah: 'compliant' },
  { code: 'SUGR', yahoo: 'SUGR.CA', ar: 'الدلتا للسكر', en: 'Delta Sugar Company', sector: 'consumer', shariah: 'compliant' },
  // Tobacco — excluded on business activity.
  { code: 'EAST', yahoo: 'EAST.CA', ar: 'الشرقية — إيسترن كومباني', en: 'Eastern Company S.A.E', sector: 'consumer', shariah: 'non_compliant' },

  // --- Healthcare & pharma ---
  { code: 'ISPH', yahoo: 'ISPH.CA', ar: 'ابن سينا فارما', en: 'Ibnsina Pharma', sector: 'healthcare', shariah: 'compliant' },
  // Corrected: CPCI is Kahira Pharmaceuticals — NOT Cairo Poultry, and not a food company.
  { code: 'CPCI', yahoo: 'CPCI.CA', ar: 'القاهرة للأدوية والصناعات الكيماوية', en: 'Kahira Pharmaceuticals & Chemical Industries Company', sector: 'healthcare', shariah: 'compliant' },
  // Corrected: AXPH is Alexandria Pharmaceuticals (previously mislabelled "Axis Pharma").
  { code: 'AXPH', yahoo: 'AXPH.CA', ar: 'الإسكندرية للأدوية والصناعات الكيماوية', en: 'Alexandria Co. For Pharmaceuticals & Chemical Industries', sector: 'healthcare', shariah: 'compliant' },
  // Corrected: PHAR is EIPICO — it had been given Alexandria Pharma's identity.
  { code: 'PHAR', yahoo: 'PHAR.CA', ar: 'المصرية الدولية للصناعات الدوائية — إيبيكو', en: 'Egyptian International Pharmaceutical Industries Company', sector: 'healthcare', shariah: 'compliant' },

  // --- Real estate & tourism ---
  { code: 'TMGH', yahoo: 'TMGH.CA', ar: 'مجموعة طلعت مصطفى القابضة', en: 'Talaat Moustafa Group Holding', sector: 'realestate', shariah: 'review' },
  { code: 'PHDC', yahoo: 'PHDC.CA', ar: 'بالم هيلز للتعمير', en: 'Palm Hills Developments S.A.E.', sector: 'realestate', shariah: 'review' },
  { code: 'HELI', yahoo: 'HELI.CA', ar: 'مصر الجديدة للإسكان والتعمير', en: 'Heliopolis Co. for Housing & Development', sector: 'realestate', shariah: 'review' },
  // Corrected: ZMID is Zahraa El Maadi (real estate) — NOT an edible-oils company.
  { code: 'ZMID', yahoo: 'ZMID.CA', ar: 'زهراء المعادي للاستثمار والتعمير', en: 'Zahraa El Maadi Investment and Development Company SAE', sector: 'realestate', shariah: 'review' },
  { code: 'EGTS', yahoo: 'EGTS.CA', ar: 'المصرية للمنتجعات السياحية', en: 'Egyptian Resorts Company (S.A.E)', sector: 'tourism', shariah: 'review' },

  // Removed: MNHD (Madinet Nasr Housing) — actively traded on EGX but Yahoo
  // serves no data for MNHD.CA, so it cannot be analyzed here. Restore it if a
  // working symbol or another data source is added.
];

const BY_CODE = new Map(UNIVERSE.map((s) => [s.code, s]));

export function lookup(code) {
  return BY_CODE.get(String(code).toUpperCase().trim()) ?? null;
}

/** Yahoo symbol for a ticker, falling back to `<CODE>.CA` for names not in the table. */
export function toYahoo(code) {
  const c = String(code).toUpperCase().trim();
  return BY_CODE.get(c)?.yahoo ?? `${c}.CA`;
}

export function sectorLabel(key) {
  return SECTORS[key] ?? key;
}

export const ALL_CODES = UNIVERSE.map((s) => s.code);
