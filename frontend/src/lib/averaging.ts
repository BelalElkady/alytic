/**
 * The averaging calculator's math: how many shares to buy at a given price so
 * a Position's average cost lands on a target average.
 *
 * Holding `shares` at `avgCost`, buying `n` more at `price` gives
 *   newAvg = (shares·avgCost + n·price) / (shares + n)
 * so reaching `target` exactly needs
 *   n = shares·(avgCost − target) / (target − price).
 * That is only positive when the target sits strictly between the buy price
 * and the current average: to pull the average down you must buy below the
 * target, and to push it up you must buy above it.
 */

export type AveragingInput = {
  shares: number;
  avgCost: number;
  target: number;
  price: number;
};

export type AveragingPlan = {
  ok: true;
  /** Whole shares to buy — rounded up, so the average reaches the target or just past it. */
  buyShares: number;
  buyCost: number;
  totalShares: number;
  totalCost: number;
  newAvg: number;
};

export type AveragingError = { ok: false; reason: string };

export type AveragingResult = AveragingPlan | AveragingError;

const isPositive = (value: number) => Number.isFinite(value) && value > 0;

/**
 * Arabic-Indic digits, the Arabic decimal mark (٫) and separators all read as
 * plain numbers. A lone comma is a decimal point ("74,42" is 74.42 — how a
 * price is often typed here, and reading it as 7442 blew every result up a
 * hundredfold) unless exactly three digits follow it ("1,021" is 1021) — but a leading 0
 * always means a decimal ("0,125" is 0.125, a sub-pound EGX price). Once a
 * "." is present, commas are only thousands separators ("1,250.5").
 */
export function parseAmount(text: string): number {
  let normalized = text
    .trim()
    .replace(/[٠-٩]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".")
    .replace(/[٬\s]/g, "");
  const commas = normalized.split(",").length - 1;
  if (
    !normalized.includes(".") &&
    commas === 1 &&
    (/^-?0,/.test(normalized) || !/,\d{3}$/.test(normalized))
  ) {
    normalized = normalized.replace(",", ".");
  }
  normalized = normalized.replace(/,/g, "");
  return normalized ? Number(normalized) : Number.NaN;
}

export function planAveraging({ shares, avgCost, target, price }: AveragingInput): AveragingResult {
  if (!isPositive(shares)) return { ok: false, reason: "اكتب عدد الأسهم اللي معاك." };
  if (!isPositive(avgCost)) return { ok: false, reason: "اكتب متوسط الشراء الحالي." };
  if (!isPositive(target)) return { ok: false, reason: "اكتب المتوسط اللي عايز توصله." };
  if (!isPositive(price)) return { ok: false, reason: "اكتب سعر الشراء الجديد." };
  if (target === avgCost) {
    return { ok: false, reason: "متوسطك الحالي هو نفس المتوسط اللي عايز توصله." };
  }
  if (target < avgCost && price >= target) {
    return {
      ok: false,
      reason: "عشان تنزّل متوسطك لازم تشتري بسعر أقل من المتوسط المستهدف.",
    };
  }
  if (target > avgCost && price <= target) {
    return {
      ok: false,
      reason: "عشان ترفع متوسطك لازم تشتري بسعر أعلى من المتوسط المستهدف.",
    };
  }

  const exact = (shares * (avgCost - target)) / (target - price);
  // The epsilon keeps a floating-point 99.99999999 from rounding up to 101.
  const buyShares = Math.max(1, Math.ceil(exact - 1e-9));
  const buyCost = buyShares * price;
  const totalShares = shares + buyShares;
  const totalCost = shares * avgCost + buyCost;
  return {
    ok: true,
    buyShares,
    buyCost,
    totalShares,
    totalCost,
    newAvg: totalCost / totalShares,
  };
}

/** Steps away from the target, as a fraction of it, for the "other prices" table. */
const LADDER_STEPS = [0.02, 0.05, 0.1, 0.15, 0.2];

/**
 * A few buy prices on the useful side of the target (below it when averaging
 * down, above it when averaging up), each with the shares it would take —
 * so the user can see how much a cheaper or dearer fill changes the order.
 */
export function averagingLadder(
  input: Omit<AveragingInput, "price">,
): { price: number; plan: AveragingPlan }[] {
  const { avgCost, target } = input;
  if (!isPositive(target) || !isPositive(avgCost) || target === avgCost) return [];
  const direction = target < avgCost ? -1 : 1;
  return LADDER_STEPS.map((step) => Math.round(target * (1 + direction * step) * 100) / 100)
    .map((price) => ({ price, result: planAveraging({ ...input, price }) }))
    .filter((row): row is { price: number; result: AveragingPlan } => row.result.ok)
    .map(({ price, result }) => ({ price, plan: result }));
}
