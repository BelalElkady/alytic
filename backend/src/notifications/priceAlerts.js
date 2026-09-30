/**
 * Target / stop-loss alerts from the levels a user has set on a position.
 *
 * A position's `target` and `stop` (saved through POST /api/portfolio/levels)
 * are compared with the latest live price. Each (user, code, kind, level) fires
 * once: the dedupe key is stored on the notification itself, so raising the
 * target afterwards produces a fresh alert and a restart never repeats one.
 */
export function evaluatePositionAlerts(positions, prices) {
  const alerts = [];
  for (const [code, position] of Object.entries(positions ?? {})) {
    const price = prices.get(code);
    if (!(price > 0)) continue;
    const { target, stop } = position;
    if (typeof target === 'number' && target > 0 && price >= target) {
      alerts.push({
        type: 'stock_target_reached',
        code,
        level: target,
        title: `${code} وصل للهدف`,
        body: `${code} وصل ${price.toFixed(2)} جنيه — هدفك كان ${target}.`,
      });
    } else if (typeof stop === 'number' && stop > 0 && price <= stop) {
      alerts.push({
        type: 'stop_loss_triggered',
        code,
        level: stop,
        title: `${code} كسر الوقف`,
        body: `${code} نزل لـ ${price.toFixed(2)} جنيه — وقفك كان ${stop}.`,
      });
    }
  }
  return alerts;
}

/**
 * @param {object} deps
 * @param {() => Promise<Array<{user_id: string, state_json: object}>>} deps.getPortfolios
 * @param {(codes: string[]) => Promise<Map<string, number>>} deps.fetchPrices
 * @param {(userId: string) => Promise<boolean>} deps.hasDevices only users who can receive a push are evaluated
 * @param {(userId: string, key: string) => Promise<boolean>} deps.alreadySent
 * @param {(userId: string, n: object) => Promise<unknown>} deps.notify
 */
export async function runPriceAlerts({ getPortfolios, fetchPrices, hasDevices, alreadySent, notify }) {
  const portfolios = await getPortfolios();
  const candidates = [];
  for (const row of portfolios) {
    const positions = row.state_json?.positions ?? {};
    const watched = Object.values(positions).some((p) => p.target || p.stop);
    if (watched && (await hasDevices(row.user_id))) candidates.push({ userId: row.user_id, positions });
  }
  if (!candidates.length) return { users: 0, sent: 0 };

  const codes = [...new Set(candidates.flatMap((c) => Object.keys(c.positions)))];
  const prices = await fetchPrices(codes);

  let sent = 0;
  for (const { userId, positions } of candidates) {
    for (const alert of evaluatePositionAlerts(positions, prices)) {
      const dedupeKey = `${alert.type}:${alert.code}:${alert.level}`;
      if (await alreadySent(userId, dedupeKey)) continue;
      await notify(userId, {
        type: alert.type,
        title: alert.title,
        body: alert.body,
        data: { code: alert.code, level: alert.level, dedupeKey },
      });
      sent += 1;
    }
  }
  return { users: candidates.length, sent };
}
