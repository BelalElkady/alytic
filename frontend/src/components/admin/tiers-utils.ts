/**
 * The pure side of the tier-settings editor (see tiers-tab.tsx): merging the
 * layers and adding or removing one override. The backend does the same merge
 * in resolveTiers() (backend/src/billing/plans.js) — this copy only has to
 * agree with it for what the editor shows, the server re-validates every save.
 */
export const TIER_KEYS = ["free", "long", "trader"] as const;
export type TierKey = (typeof TIER_KEYS)[number];

export const CAP_KINDS = ["screenshots", "recommendations", "cashScans", "marketAnalysis"] as const;
export type CapKind = (typeof CAP_KINDS)[number];

export type TierSettings = {
  caps: Record<CapKind, number>;
  portfolios: number;
  locked: { pages: string[]; panels: string[] };
  card: { name: string; note: string; bullets: string[] };
};

/** One layer of settings — the platform-wide one or a site's overrides: only the fields it sets. */
export type TierLayer = {
  [T in TierKey]?: {
    caps?: Partial<Record<CapKind, number>>;
    portfolios?: number;
    locked?: { pages?: string[]; panels?: string[] };
    card?: { name?: string; note?: string; bullets?: string[] };
  };
};

/** Where in a tier's settings a field lives. */
export type FieldPath =
  | readonly ["caps", CapKind]
  | readonly ["portfolios"]
  | readonly ["locked", "pages" | "panels"]
  | readonly ["card", "name" | "note" | "bullets"];

export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

type Bag = Record<string, unknown>;

/** Defaults, then each layer in order. Lock lists and bullets are replaced whole; everything else merges field by field. */
export function resolve(
  defaults: Record<TierKey, TierSettings>,
  ...layers: (TierLayer | null | undefined)[]
): Record<TierKey, TierSettings> {
  const out = structuredClone(defaults);
  for (const layer of layers) {
    for (const tier of TIER_KEYS) {
      const value = layer?.[tier];
      if (!value) continue;
      const target = out[tier];
      Object.assign(target.caps, value.caps);
      if (value.portfolios !== undefined) target.portfolios = value.portfolios;
      if (value.locked?.pages) target.locked.pages = value.locked.pages;
      if (value.locked?.panels) target.locked.panels = value.locked.panels;
      Object.assign(target.card, value.card);
    }
  }
  return out;
}

export function getOverride(layer: TierLayer, tier: TierKey, path: FieldPath): unknown {
  let node: unknown = layer[tier];
  for (const key of path) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as Bag)[key];
  }
  return node;
}

/** A copy of the layer with one field set. */
export function setOverride(layer: TierLayer, tier: TierKey, path: FieldPath, value: unknown): TierLayer {
  const next = structuredClone(layer) as Bag;
  const tierBag = ((next[tier] ??= {}) as Bag);
  if (path.length === 1) {
    tierBag[path[0]] = value;
  } else {
    const group = ((tierBag[path[0]] ??= {}) as Bag);
    group[path[1]] = value;
  }
  return next as TierLayer;
}

/** A copy of the layer with one field removed (back to inherited), and any group or tier it empties removed too. */
export function clearOverride(layer: TierLayer, tier: TierKey, path: FieldPath): TierLayer {
  const next = structuredClone(layer) as Bag;
  const tierBag = next[tier] as Bag | undefined;
  if (!tierBag) return next as TierLayer;
  if (path.length === 1) {
    delete tierBag[path[0]];
  } else {
    const group = tierBag[path[0]] as Bag | undefined;
    if (group) {
      delete group[path[1]];
      if (!Object.keys(group).length) delete tierBag[path[0]];
    }
  }
  if (!Object.keys(tierBag).length) delete next[tier];
  return next as TierLayer;
}

/**
 * Sets a field to what the editor now shows — or, when that equals what the
 * field would inherit anyway, removes the override, so a layer only ever holds
 * real differences.
 */
export function applyEdit(
  layer: TierLayer,
  tier: TierKey,
  path: FieldPath,
  value: unknown,
  inherited: unknown,
): TierLayer {
  return same(value, inherited) ? clearOverride(layer, tier, path) : setOverride(layer, tier, path, value);
}

/** The value of one field in resolved settings. */
export function valueAt(settings: TierSettings, path: FieldPath): unknown {
  let node: unknown = settings;
  for (const key of path) node = (node as Bag)[key];
  return node;
}

/** Drops blank bullet lines and surrounding spaces — what the server would keep. */
export function tidyLayer(layer: TierLayer): TierLayer {
  const next = structuredClone(layer);
  for (const tier of TIER_KEYS) {
    const bullets = next[tier]?.card?.bullets;
    if (bullets) next[tier]!.card!.bullets = bullets.map((line) => line.trim()).filter(Boolean);
  }
  return next;
}

/** Paid tiers that give less of a credit than the free trial — allowed, but usually a slip. */
export function capWarnings(tiers: Record<TierKey, TierSettings>): string[] {
  const labels: Record<CapKind, string> = {
    screenshots: "السكرين شوت",
    recommendations: "التوصيات",
    cashScans: "تحليل الكاش",
    marketAnalysis: "تحليل السوق",
  };
  const warnings: string[] = [];
  for (const tier of ["long", "trader"] as const) {
    for (const kind of CAP_KINDS) {
      if (tiers[tier].caps[kind] < tiers.free.caps[kind]) {
        warnings.push(`${tiers[tier].card.name}: ${labels[kind]} أقل من الباقة المجانية`);
      }
    }
  }
  return warnings;
}
