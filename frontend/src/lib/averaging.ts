/**
 * The averaging calculator's math: spend an amount of money on more shares of
 * a Position and see where its average cost lands.
 *
 * Holding `shares` at `avgCost` and spending `amount` at `price` buys
 *   n = floor(amount / price)
 * whole shares (never more than the money covers), giving
 *   newAvg = (shares·avgCost + n·price) / (shares + n).
 * Buying below the current average pulls it down; buying above pushes it up.
 */

export type AveragingInput = {
  shares: number;
  avgCost: number;
  /** The money the user is willing to put in. */
  amount: number;
  price: number;
};

export type AveragingPlan = {
  ok: true;
  /** Whole shares the amount buys — rounded down, so the cost never exceeds it. */
  buyShares: number;
  buyCost: number;
  /** What's left of the amount after buying whole shares. */
  leftover: number;
  totalShares: number;
  totalCost: number;
  newAvg: number;
  /** newAvg − avgCost: negative when the average came down. */
  avgChange: number;
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

export function planAveraging({ shares, avgCost, amount, price }: AveragingInput): AveragingResult {
  if (!isPositive(shares)) return { ok: false, reason: "اكتب عدد الأسهم اللي معاك." };
  if (!isPositive(avgCost)) return { ok: false, reason: "اكتب متوسط الشراء الحالي." };
  if (!isPositive(amount)) return { ok: false, reason: "اكتب المبلغ اللي عايز تدفعه." };
  if (!isPositive(price)) return { ok: false, reason: "اكتب سعر الشراء الجديد." };

  // The epsilon keeps a floating-point 2.9999999 from rounding down to 2.
  const buyShares = Math.floor(amount / price + 1e-9);
  if (buyShares < 1) {
    return { ok: false, reason: "المبلغ ده مايكفيش تشتري بيه ولا سهم على السعر ده." };
  }
  const buyCost = buyShares * price;
  const totalShares = shares + buyShares;
  const totalCost = shares * avgCost + buyCost;
  const newAvg = totalCost / totalShares;
  return {
    ok: true,
    buyShares,
    buyCost,
    leftover: Math.max(0, amount - buyCost),
    totalShares,
    totalCost,
    newAvg,
    avgChange: newAvg - avgCost,
  };
}

/** Steps away from the buy price, as a fraction of it, for the "other prices" table. */
const LADDER_STEPS = [-0.15, -0.1, -0.05, 0.05, 0.1];

/**
 * The same amount spent at a few prices around the entered one, each with the
 * average it would leave — so the user can see how much a cheaper or dearer
 * fill moves the result.
 */
export function averagingLadder(input: AveragingInput): { price: number; plan: AveragingPlan }[] {
  if (!isPositive(input.price)) return [];
  return LADDER_STEPS.map((step) => Math.round(input.price * (1 + step) * 100) / 100)
    .map((price) => ({ price, result: planAveraging({ ...input, price }) }))
    .filter((row): row is { price: number; result: AveragingPlan } => row.result.ok)
    .map(({ price, result }) => ({ price, plan: result }));
}
