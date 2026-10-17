/**
 * The pages and desk panels a tier can be locked out of, from the platform
 * panel (see tier settings in src/billing/plans.js).
 *
 * The settings store what is LOCKED, never what is open, so a page or panel
 * added later is available to everyone until someone locks it on purpose.
 * Portfolio (الأسهم), settings, how-to-use and admin are deliberately not here:
 * they can never be gated.
 *
 * `rules` are the API calls that exist only to serve the feature. A locked
 * tier gets a 403 from those calls (see the feature-lock middleware in
 * src/api/server.js), so hiding a menu item is never the only protection. A
 * feature with no rules is hidden in the app only, because its data comes from
 * endpoints other features share (e.g. /history/ also feeds the stock page) and
 * blocking them would break those features. A rule with `focus` matches only
 * when the request's ?focus= has that value.
 */
export const LOCKABLE_PAGES = [
  { key: 'market', label: 'السوق', rules: [] },
  { key: 'indices', label: 'المؤشرات', rules: [{ path: '/indices/performance' }] },
  { key: 'targets', label: 'الأهداف', rules: [] },
  { key: 'calendar', label: 'التقويم', rules: [] },
  { key: 'charts', label: 'الرسوم', rules: [] },
  { key: 'cash', label: 'تحليل الكاش', rules: [{ path: '/scan', focus: 'cash' }] },
  { key: 'stock', label: 'صفحة السهم', rules: [] },
];

export const LOCKABLE_PANELS = [
  { key: 'investorFlows', label: 'تعاملات المستثمرين', rules: [{ path: '/indices/investor-flows' }] },
  { key: 'heatmap', label: 'خريطة السوق', rules: [{ path: '/indices/heatmap' }] },
  { key: 'marketAnalysis', label: 'تحليل السوق', rules: [{ path: '/market-analysis' }, { path: '/scan', focus: 'market' }] },
];

export const PAGE_KEYS = LOCKABLE_PAGES.map((p) => p.key);
export const PANEL_KEYS = LOCKABLE_PANELS.map((p) => p.key);

/** What the platform panel needs to draw the lock checkboxes: key and Arabic label only. */
export const lockableForAdmin = () => ({
  pages: LOCKABLE_PAGES.map(({ key, label }) => ({ key, label })),
  panels: LOCKABLE_PANELS.map(({ key, label }) => ({ key, label })),
});

/**
 * The lockable feature an API call belongs to, or null. `path` is relative to
 * /api (as req.path is inside app.use('/api')), `query` is req.query.
 */
export function lockableFeatureFor(path, query = {}) {
  for (const [kind, list] of [['page', LOCKABLE_PAGES], ['panel', LOCKABLE_PANELS]]) {
    for (const feature of list) {
      const hit = feature.rules.some((rule) => path.startsWith(rule.path) && (!rule.focus || query?.focus === rule.focus));
      if (hit) return { kind, key: feature.key, label: feature.label };
    }
  }
  return null;
}
