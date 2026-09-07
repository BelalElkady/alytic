/**
 * Support and resistance derivation.
 *
 * Levels come from two independent sources that are then merged:
 *   - swing pivots (fractal highs/lows), clustered by proximity so that a price
 *     touched five times becomes one strong level rather than five weak ones;
 *   - a volume-at-price profile, which finds shelves where real trading
 *     happened rather than where the tape merely turned.
 *
 * A level's `strength` is 0-100 and blends touch count, how recently it was
 * touched, and how much volume transacted there.
 */

/**
 * Fractal swing points: a high with `lookback` lower highs on both sides.
 * Uses strict inequality on the left and non-strict on the right so that flat
 * double-tops register once rather than not at all.
 */
export function findPivots(bars, lookback = 5) {
  const highs = [];
  const lows = [];

  for (let i = lookback; i < bars.length - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = 1; j <= lookback; j++) {
      if (bars[i].h <= bars[i - j].h || bars[i].h < bars[i + j].h) isHigh = false;
      if (bars[i].l >= bars[i - j].l || bars[i].l > bars[i + j].l) isLow = false;
      if (!isHigh && !isLow) break;
    }
    if (isHigh) highs.push({ index: i, price: bars[i].h, date: bars[i].date, volume: bars[i].v });
    if (isLow) lows.push({ index: i, price: bars[i].l, date: bars[i].date, volume: bars[i].v });
  }
  return { highs, lows };
}

/**
 * Merge pivots that sit within `tolerancePct` of each other into single levels.
 * Recency is weighted with a half-life so a level defended last month counts
 * for more than one defended two years ago.
 */
export function clusterLevels(pivots, { tolerancePct = 2.0, totalBars = 1, halfLifeBars = 120 } = {}) {
  if (!pivots.length) return [];

  const sorted = [...pivots].sort((a, b) => a.price - b.price);
  const clusters = [];
  let current = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const ref = current.reduce((a, p) => a + p.price, 0) / current.length;
    if (Math.abs((sorted[i].price - ref) / ref) * 100 <= tolerancePct) current.push(sorted[i]);
    else {
      clusters.push(current);
      current = [sorted[i]];
    }
  }
  clusters.push(current);

  const maxVol = Math.max(1, ...pivots.map((p) => p.volume || 0));

  return clusters.map((group) => {
    const price = group.reduce((a, p) => a + p.price, 0) / group.length;
    const lastIndex = Math.max(...group.map((p) => p.index));
    const age = totalBars - 1 - lastIndex;
    const recency = Math.pow(0.5, age / halfLifeBars); // 0..1
    const touches = group.length;
    const volShare = group.reduce((a, p) => a + (p.volume || 0), 0) / (maxVol * touches);

    const strength = Math.round(
      Math.min(100, (Math.min(touches, 5) / 5) * 55 + recency * 30 + Math.min(volShare, 1) * 15),
    );

    return {
      price: +price.toFixed(2),
      touches,
      lastTouch: group.reduce((a, p) => (p.index > a.index ? p : a)).date,
      strength,
    };
  });
}

/**
 * Volume-at-price profile. Returns the point of control (the price bucket with
 * the most traded volume) and the high-volume nodes around it.
 */
export function volumeProfile(bars, { buckets = 40 } = {}) {
  const lo = Math.min(...bars.map((b) => b.l));
  const hi = Math.max(...bars.map((b) => b.h));
  if (!(hi > lo)) return { poc: null, nodes: [] };

  const width = (hi - lo) / buckets;
  const acc = new Array(buckets).fill(0);

  for (const b of bars) {
    // Spread each bar's volume across the buckets its range covers, which is a
    // fairer attribution than dumping it all at the close.
    const from = Math.min(buckets - 1, Math.max(0, Math.floor((b.l - lo) / width)));
    const to = Math.min(buckets - 1, Math.max(0, Math.floor((b.h - lo) / width)));
    const span = to - from + 1;
    for (let k = from; k <= to; k++) acc[k] += b.v / span;
  }

  const totalVol = acc.reduce((a, b) => a + b, 0) || 1;
  const pocIdx = acc.indexOf(Math.max(...acc));

  const nodes = acc
    .map((v, i) => ({ price: +(lo + width * (i + 0.5)).toFixed(2), share: v / totalVol }))
    .filter((n) => n.share > 1.5 / buckets) // meaningfully above a flat distribution
    .sort((a, b) => b.share - a.share)
    .slice(0, 8);

  return { poc: +(lo + width * (pocIdx + 0.5)).toFixed(2), nodes };
}

/**
 * Full level map for a series, split into supports (below price) and
 * resistances (above), each sorted by distance from the current price.
 */
export function buildLevels(bars, { lookback = 5, tolerancePct = 2.0, profileBars = 120 } = {}) {
  const price = bars[bars.length - 1].c;
  const { highs, lows } = findPivots(bars, lookback);
  const opts = { tolerancePct, totalBars: bars.length };

  const all = [
    ...clusterLevels(lows, opts).map((l) => ({ ...l, origin: 'swing_low' })),
    ...clusterLevels(highs, opts).map((l) => ({ ...l, origin: 'swing_high' })),
  ];

  // Pivots are worth taking from the full history — a level defended two years
  // ago still matters. The volume profile is not: over a long uptrend the point
  // of control lands wherever the stock used to trade, far below anything
  // actionable today. So the profile only sees the recent window.
  const { poc, nodes } = volumeProfile(bars.slice(-profileBars));
  for (const node of nodes) {
    // Only add a volume shelf if no swing level already covers that price.
    const covered = all.some((l) => Math.abs((l.price - node.price) / node.price) * 100 <= tolerancePct);
    if (!covered) {
      all.push({
        price: node.price,
        touches: 1,
        lastTouch: null,
        strength: Math.round(Math.min(60, node.share * 400)),
        origin: 'volume_shelf',
      });
    }
  }

  const supports = all.filter((l) => l.price < price * 0.995).sort((a, b) => b.price - a.price);
  const resistances = all.filter((l) => l.price > price * 1.005).sort((a, b) => a.price - b.price);

  const withDistance = (l) => ({ ...l, distancePct: +(((l.price - price) / price) * 100).toFixed(2) });

  return {
    price,
    poc,
    supports: supports.slice(0, 6).map(withDistance),
    resistances: resistances.slice(0, 6).map(withDistance),
  };
}
