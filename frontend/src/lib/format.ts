export const fmt = (value: unknown, digits = 2) =>
  value === null || value === undefined || value === "" || Number.isNaN(Number(value))
    ? "—"
    : Number(value).toFixed(digits);

export const int = (value: unknown) =>
  value === null || value === undefined || Number.isNaN(Number(value))
    ? "—"
    : Math.round(Number(value)).toLocaleString("en-US");

export const pct = (value: unknown, digits = 2) =>
  value === null || value === undefined || Number.isNaN(Number(value))
    ? "—"
    : `${Number(value) > 0 ? "+" : ""}${Number(value).toFixed(digits)}%`;

export const signed = (value: unknown, digits = 0) =>
  value === null || value === undefined || Number.isNaN(Number(value))
    ? "—"
    : `${Number(value) > 0 ? "+" : ""}${Number(value).toLocaleString("en-US", {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      })}`;

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

export const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));
