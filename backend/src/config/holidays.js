/**
 * EGX bank/public holidays that fall on a Sunday-Thursday — days the exchange
 * is closed even though they aren't the Friday/Saturday weekend. Read by
 * isTradingDay() in src/data/cache.js, so it drives the free-trial countdown,
 * the daily-close cron, the blog cron and data-staleness checks alike.
 *
 * Fixed-date holidays are firm, but the cabinet often shifts them to the
 * nearest Thursday/Sunday, and the Islamic ones (marked ~) depend on moon
 * sighting. Adjust this list whenever EGX publishes its official closures.
 */
export const EGX_HOLIDAYS = new Set([
  // 2026
  '2026-01-07', // Coptic Christmas
  '2026-01-25', // Revolution / Police Day
  '2026-03-19', '2026-03-22', '2026-03-23', // ~ Eid al-Fitr
  '2026-04-13', // Sham El-Nessim
  '2026-05-26', '2026-05-27', '2026-05-28', '2026-05-31', // ~ Arafat + Eid al-Adha
  '2026-06-16', // ~ Islamic New Year
  '2026-06-30', // June 30 Revolution
  '2026-07-23', // Revolution Day
  '2026-08-26', // ~ Prophet's Birthday
  '2026-10-06', // Armed Forces Day

  // 2027
  '2027-01-07', // Coptic Christmas
  '2027-01-25', // Revolution / Police Day
  '2027-03-09', '2027-03-10', '2027-03-11', // ~ Eid al-Fitr
  '2027-04-25', // Sinai Liberation Day
  '2027-05-03', // Sham El-Nessim
  '2027-05-16', '2027-05-17', '2027-05-18', // ~ Eid al-Adha
  '2027-06-06', // ~ Islamic New Year
  '2027-06-30', // June 30 Revolution
  '2027-08-15', // ~ Prophet's Birthday
  '2027-10-06', // Armed Forces Day
]);
