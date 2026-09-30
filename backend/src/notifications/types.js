/**
 * Every kind of notification the platform can create. Adding one is a new entry
 * here — the storage, delivery, API and app deep-link handling are generic.
 *
 * `path` builds the in-app route a tap should open (resolved by the app's
 * deep-link allow-list, frontend/src/native/deep-links.ts, so an unknown path
 * simply opens nothing).
 */
export const NOTIFICATION_TYPES = {
  stock_target_reached: { path: (d) => (d.code ? `/stock/${d.code}` : '/targets') },
  stop_loss_triggered: { path: (d) => (d.code ? `/stock/${d.code}` : '/targets') },
  stock_event: { path: (d) => (d.code ? `/stock/${d.code}` : '/calendar') },
  portfolio_alert: { path: () => '/portfolio' },
  new_ai_analysis: { path: (d) => (d.code ? `/stock/${d.code}` : '/portfolio') },
  market_open: { path: () => '/market' },
  market_close: { path: () => '/market' },
  earnings_news: { path: (d) => (d.code ? `/stock/${d.code}` : '/calendar') },
  subscription_expiring: { path: () => '/subscribe' },
  system_announcement: { path: () => '/portfolio' },
};

export const isNotificationType = (type) => Object.hasOwn(NOTIFICATION_TYPES, type);

export const pathFor = (type, data = {}) => NOTIFICATION_TYPES[type]?.path(data) ?? '/portfolio';
