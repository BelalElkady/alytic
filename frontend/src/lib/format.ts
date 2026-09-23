const missing = (value: unknown) =>
  value === null || value === undefined || value === "" || Number.isNaN(Number(value));

/**
 * A number as it is — no padding, no rounding — thousands-separated. Only a
 * long tail (more than 3 decimals, e.g. 2990 / 12 = 249.1666…) is rounded, to 2
 * decimals; real EGX prices carry at most 3 decimals, so they show exactly.
 * toPrecision(15) first strips binary floating-point noise (0.1 + 0.2 would
 * otherwise print as 0.30000000000000004).
 */
export const exact = (value: number) => {
  let text = String(parseFloat(value.toPrecision(15)));
  if (text.includes("e")) return text;
  if ((text.split(".")[1]?.length ?? 0) > 3) text = String(Math.round((value + Number.EPSILON * Math.sign(value)) * 100) / 100);
  const [whole, fraction] = text.split(".");
  return whole!.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + (fraction ? `.${fraction}` : "");
};

export const fmt = (value: unknown) => (missing(value) ? "—" : exact(Number(value)));

export const int = (value: unknown) =>
  value === null || value === undefined || Number.isNaN(Number(value)) ? "—" : exact(Number(value));

export const pct = (value: unknown) =>
  value === null || value === undefined || Number.isNaN(Number(value))
    ? "—"
    : `${Number(value) > 0 ? "+" : ""}${exact(Number(value))}%`;

export const signed = (value: unknown) =>
  value === null || value === undefined || Number.isNaN(Number(value))
    ? "—"
    : `${Number(value) > 0 ? "+" : ""}${exact(Number(value))}`;

/** Tone class for a signed number: gain, loss or neutral. */
export const tone = (value: unknown) => {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return "text-muted-foreground";
  return n > 0 ? "text-up" : "text-down";
};

// Local calendar date, not toISOString(): that converts to UTC first, so in
// Cairo (UTC+2/+3) local midnight became the previous day and every calendar
// cell was labeled one day early, sliding the whole month a weekday off.
export const isoDay = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export const arDay = (iso?: string | null) => {
  if (!iso) return "—";
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("ar-EG", {
    day: "numeric",
    month: "long",
    year: "numeric",
    numberingSystem: "latn",
  });
};

/**
 * A publish timestamp as "19 سبتمبر 2026", in Cairo time. Spelled-out month on
 * purpose: the numeric `ar-EG` form ("19/9/2026") carries invisible RTL marks
 * between the numbers that scramble into "192026/9/" as soon as the text sits
 * in a left-to-right box (the `.num` class). Cairo time is pinned so the
 * server-rendered page and the browser agree on the day instead of each using
 * its own timezone.
 */
export const arPublishedDate = (iso?: string | null) => {
  const date = iso ? new Date(iso) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("ar-EG", {
    day: "numeric",
    month: "long",
    year: "numeric",
    numberingSystem: "latn",
    timeZone: "Africa/Cairo",
  });
};

export const clamp =(value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));
