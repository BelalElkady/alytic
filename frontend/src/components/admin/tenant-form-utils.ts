// Pure helpers for the client (tenant) form — kept apart from the components so
// React's fast refresh keeps working on tenant-fields.tsx.

// ---- nested JSON ---------------------------------------------------------------

export type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** The value at `path`, or undefined when any step is missing. */
export function getIn(obj: unknown, path: string[]): unknown {
  return path.reduce<unknown>(
    (current, key) => (isObject(current) ? current[key] : undefined),
    obj,
  );
}

/** A copy of `obj` with `value` set at `path`, creating the objects on the way. */
export function setIn(obj: Json, path: string[], value: unknown): Json {
  const [head, ...rest] = path;
  return {
    ...obj,
    [head]: rest.length ? setIn(isObject(obj[head]) ? obj[head] : {}, rest, value) : value,
  };
}

/** The string at `path`, or "" so an input is always controlled. */
export const textAt = (obj: unknown, path: string[]): string => {
  const value = getIn(obj, path);
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
};

/** Splits a pasted list of emails/domains on commas, semicolons and whitespace. */
export const splitList = (text: string): string[] =>
  text
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);

// ---- colors --------------------------------------------------------------------

const hexCache = new Map<string, string | null>();
let canvasContext: CanvasRenderingContext2D | null | undefined;

/**
 * Any CSS color the browser understands (hex, rgb, hsl, oklch…) as #rrggbb, or
 * null when it doesn't parse. <input type="color"> only speaks hex, while the
 * stored brand colors are mostly oklch, so the swatch is derived by painting
 * the color onto one pixel and reading it back.
 */
export function cssColorToHex(value: string): string | null {
  const key = value.trim();
  if (!key || typeof document === "undefined") return null;
  if (hexCache.has(key)) return hexCache.get(key) ?? null;

  if (canvasContext === undefined) {
    canvasContext =
      document.createElement("canvas").getContext("2d", { willReadFrequently: true }) ?? null;
  }
  let hex: string | null = null;
  const ctx = canvasContext;
  if (ctx) {
    // An unparseable value leaves fillStyle untouched, so a sentinel tells "invalid" from "black".
    ctx.fillStyle = "#010203";
    ctx.fillStyle = key;
    if (ctx.fillStyle !== "#010203" || key.toLowerCase() === "#010203") {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      hex = `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
    }
  }
  hexCache.set(key, hex);
  return hex;
}

export type ColorRow = { name: string; value: string };

/** brand.colors / brand.darkColors as editable rows, so a color name the form doesn't know about survives an edit. */
export const rowsFromColors = (colors: unknown): ColorRow[] =>
  isObject(colors)
    ? Object.entries(colors).map(([name, value]) => ({ name, value: String(value ?? "") }))
    : [];

export const colorsFromRows = (rows: ColorRow[]): Record<string, string> =>
  Object.fromEntries(
    rows
      .map((row) => [row.name.trim(), row.value.trim()] as const)
      .filter(([name, value]) => name && value),
  );
