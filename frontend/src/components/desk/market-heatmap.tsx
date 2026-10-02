import { useEffect, useMemo, useState } from "react";
import { ResponsiveContainer, Tooltip, Treemap } from "recharts";

import { ErrorState, LoadingBlock, Panel } from "@/components/desk/state-blocks";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { api } from "@/lib/api";
import { fmt, pct } from "@/lib/format";
import { useDesk } from "@/lib/store";

/** One stock as GET /api/indices/heatmap returns it (see backend/src/marketHeatmap.js). */
export type HeatmapStock = {
  code: string;
  name: string;
  sector: string;
  sectorAr: string;
  marketCapEgp: number | null;
  turnoverEgp: number | null;
  price: number;
  changePct: number;
  indices: string[];
};

type HeatmapResponse = {
  asOf: string;
  delayedMinutes: number;
  stocks: HeatmapStock[];
};

export type IndexFilter = "all" | "EGX30" | "EGX70" | "EGX100" | "EGX33";
export type SizeMode = "cap" | "turnover";

const INDEX_OPTIONS: { value: IndexFilter; label: string }[] = [
  { value: "all", label: "الكل" },
  { value: "EGX30", label: "EGX30" },
  { value: "EGX70", label: "EGX70" },
  { value: "EGX100", label: "EGX100" },
  { value: "EGX33", label: "EGX33" },
];

/** A move this big, either way, gets the strongest colour; bigger moves are clamped to it. */
export const CLAMP_PCT = 3;

/**
 * The tile fill for a day's change: a diverging scale from --down through the
 * neutral --muted surface to --up, equal steps on each arm, clamped at
 * ±CLAMP_PCT. Mixed in oklab, not oklch: oklch would swing the hue through
 * teal and purple on the way to the grey. Even a small move gets a visible tint, and no change at all is
 * the neutral grey. Built on the theme's own tokens, so dark mode follows.
 */
export function changeColor(changePct: number): string {
  const strength = Math.min(1, Math.abs(changePct) / CLAMP_PCT);
  if (strength < 0.002) return "var(--muted)";
  const share = Math.round(25 + 75 * strength);
  return `color-mix(in oklab, var(${changePct > 0 ? "--up" : "--down"}) ${share}%, var(--muted))`;
}

/** Strong fills carry the page background as their ink, weak ones the normal text colour. */
export const changeInk = (changePct: number) =>
  Math.abs(changePct) / CLAMP_PCT >= 0.55 ? "var(--background)" : "var(--foreground)";

/** `lead` marks each sector's biggest stock, whose tile carries the sector's name. */
type TileDatum = HeatmapStock & { size: number; lead: boolean; sectorCount: number };
type SectorDatum = { name: string; sectorAr: string; count: number; children: TileDatum[] };

/**
 * The smallest share of the map any one stock's tile gets. Sized strictly by
 * market cap, a handful of giants take most of the area and dozens of small
 * caps shrink to slivers too thin to see, read or hover; with a floor every
 * stock stays a visible tile, as on the usual EGX heatmaps.
 */
export const MIN_TILE_SHARE = 0.0025;

/**
 * The treemap's nested data — sectors, then their stocks — for one index (or
 * the whole market) and one size measure. Stocks with no figure for that
 * measure are left out, and so are sectors left empty. `size` is the tile's
 * area, floored at MIN_TILE_SHARE of the whole; the real figure stays in
 * marketCapEgp / turnoverEgp for the tooltip.
 */
export function toTreemapData(
  stocks: HeatmapStock[],
  index: IndexFilter,
  sizeMode: SizeMode,
): SectorDatum[] {
  const bySector = new Map<string, SectorDatum>();
  for (const stock of stocks) {
    if (index !== "all" && !stock.indices.includes(index)) continue;
    const size = sizeMode === "cap" ? stock.marketCapEgp : stock.turnoverEgp;
    if (!size || size <= 0) continue;
    const sector = bySector.get(stock.sector) ?? {
      name: stock.sector,
      sectorAr: stock.sectorAr,
      count: 0,
      children: [],
    };
    sector.children.push({ ...stock, size, lead: false, sectorCount: 0 });
    sector.count += 1;
    bySector.set(stock.sector, sector);
  }
  const sectors = [...bySector.values()];
  const floor =
    MIN_TILE_SHARE *
    sectors.reduce((sum, s) => sum + s.children.reduce((a, c) => a + c.size, 0), 0);
  for (const sector of sectors) {
    for (const child of sector.children) child.size = Math.max(child.size, floor);
  }
  const total = (s: SectorDatum) => s.children.reduce((sum, c) => sum + c.size, 0);
  return sectors
    .map((s) => ({
      ...s,
      children: s.children
        .sort((a, b) => b.size - a.size)
        .map((c, i) => ({ ...c, lead: i === 0, sectorCount: s.count })),
    }))
    .sort((a, b) => total(b) - total(a));
}

/** Large EGP amounts in Arabic shorthand: مليار / مليون. */
const egpShort = (value: number | null) => {
  if (!value) return "—";
  if (value >= 1e9) return `${fmt(+(value / 1e9).toFixed(1))} مليار ج`;
  if (value >= 1e6) return `${fmt(+(value / 1e6).toFixed(1))} مليون ج`;
  return `${fmt(Math.round(value))} ج`;
};

type TileProps = {
  depth?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  code?: string;
  sectorAr?: string;
  sectorCount?: number;
  lead?: boolean;
  changePct?: number;
  onOpen?: (code: string) => void;
};

/**
 * Draws one stock tile (treemap depth 2): its code and change when it is big
 * enough to read, nothing on a small one. Recharts draws a sector before its
 * tiles, so a label drawn on the sector would be painted over — the sector's
 * name rides on its biggest tile (`lead`) instead.
 */
export function HeatmapTile({
  depth,
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  code,
  sectorAr,
  sectorCount,
  lead,
  changePct = 0,
  onOpen,
}: TileProps) {
  if (depth !== 2 || !code) return null;
  const showSector = Boolean(lead && sectorAr) && width >= 80 && height >= 72;
  // The sector caption sits at the top; nudge the code and change down to clear it.
  const midY = y + height / 2 + (showSector ? 7 : 0);
  const showCode = width >= 38 && height >= 22;
  const showChange = width >= 38 && height >= 36;
  const fontSize = Math.max(10, Math.min(18, Math.min(width / 4.5, height / 3)));
  const ink = changeInk(changePct);
  return (
    <g
      role="button"
      aria-label={`${code} ${pct(changePct)}`}
      className="cursor-pointer"
      onClick={() => onOpen?.(code)}
    >
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={3}
        style={{ fill: changeColor(changePct), stroke: "var(--background)" }}
        strokeWidth={1.5}
      />
      {showSector && (
        <text
          x={x + width - 6}
          y={y + 14}
          textAnchor="start"
          direction="rtl"
          fontSize={10.5}
          style={{ fill: ink, opacity: 0.75 }}
        >
          {sectorAr} · {sectorCount}
        </text>
      )}
      {showCode && (
        <text
          x={x + width / 2}
          y={midY + (showChange ? -fontSize * 0.35 : fontSize * 0.35)}
          textAnchor="middle"
          fontSize={fontSize}
          fontWeight={700}
          style={{ fill: ink }}
        >
          {code}
        </text>
      )}
      {showChange && (
        <text
          x={x + width / 2}
          y={midY + fontSize * 0.85}
          textAnchor="middle"
          fontSize={Math.max(9.5, fontSize * 0.7)}
          direction="ltr"
          style={{ fill: ink }}
        >
          {pct(changePct)}
        </text>
      )}
    </g>
  );
}

type TooltipPayload = { payload?: Partial<TileDatum> & { depth?: number } };

function TileTooltip({
  active,
  payload,
  sizeMode,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  sizeMode: SizeMode;
}) {
  const stock = payload?.[0]?.payload;
  if (!active || !stock?.code) return null;
  return (
    <div className="rounded-lg border bg-card px-3 py-2 text-[12px] shadow-md">
      <p className="font-semibold">
        <span dir="ltr">{stock.code}</span> · {stock.name}
      </p>
      <p className="mt-0.5 text-muted-foreground">{stock.sectorAr}</p>
      <div className="mt-1.5 grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5">
        <span className="text-muted-foreground">السعر</span>
        <span className="num text-end">{fmt(stock.price ?? null)}</span>
        <span className="text-muted-foreground">التغير اليوم</span>
        <span className="num text-end font-semibold">{pct(stock.changePct ?? null)}</span>
        <span className="text-muted-foreground">
          {sizeMode === "cap" ? "القيمة السوقية" : "قيمة التداول"}
        </span>
        <span className="num text-end">
          {egpShort((sizeMode === "cap" ? stock.marketCapEgp : stock.turnoverEgp) ?? null)}
        </span>
      </div>
    </div>
  );
}

/** The −3% … +3% colour key, with the ends labelled. */
function Legend() {
  const steps = [-3, -2, -1, -0.25, 0, 0.25, 1, 2, 3];
  return (
    <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground" dir="ltr">
      <span className="num">−{CLAMP_PCT}%</span>
      <div className="flex h-2.5 w-40 overflow-hidden rounded-full">
        {steps.map((step) => (
          <span key={step} className="flex-1" style={{ background: changeColor(step) }} />
        ))}
      </div>
      <span className="num">+{CLAMP_PCT}%</span>
    </div>
  );
}

/**
 * The whole-market heatmap: one tile per stock, sized by market cap or today's
 * traded value, coloured by today's change, grouped by sector. Clicking a tile
 * opens the stock's detail popup.
 */
export function MarketHeatmap() {
  const { openDetail } = useDesk();
  const [data, setData] = useState<HeatmapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState<IndexFilter>("all");
  const [sizeMode, setSizeMode] = useState<SizeMode>("cap");

  const load = () => {
    setError(null);
    api("/api/indices/heatmap")
      .then((result: HeatmapResponse) => setData(result))
      .catch((caught) => setError(caught?.message ?? "تعذر تحميل خريطة السوق"));
  };

  useEffect(() => {
    load();
  }, []);

  const tree = useMemo(
    () => (data ? toTreemapData(data.stocks, index, sizeMode) : []),
    [data, index, sizeMode],
  );
  const shown = tree.reduce((sum, sector) => sum + sector.count, 0);
  const rising = tree.reduce((sum, s) => sum + s.children.filter((c) => c.changePct > 0).length, 0);
  const falling = tree.reduce(
    (sum, s) => sum + s.children.filter((c) => c.changePct < 0).length,
    0,
  );

  return (
    <Panel
      title="خريطة السوق"
      description="كل سهم مربع: مساحته حسب القيمة السوقية أو قيمة التداول، ولونه حسب تغير النهارده، ومتجمعين حسب القطاع. اضغط على أي سهم تشوف تفاصيله."
    >
      {error ? (
        <ErrorState
          message={error}
          action={
            <Button variant="outline" size="sm" onClick={load}>
              حاول تاني
            </Button>
          }
        />
      ) : !data ? (
        <LoadingBlock rows={4} />
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={index}
              onValueChange={(value) => value && setIndex(value as IndexFilter)}
              className="flex-wrap"
            >
              {INDEX_OPTIONS.map((option) => (
                <ToggleGroupItem
                  key={option.value}
                  value={option.value}
                  className="px-2.5 text-[12px]"
                >
                  {option.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <ToggleGroup
              type="single"
              size="sm"
              variant="outline"
              value={sizeMode}
              onValueChange={(value) => value && setSizeMode(value as SizeMode)}
            >
              <ToggleGroupItem value="cap" className="px-2.5 text-[12px]">
                القيمة السوقية
              </ToggleGroupItem>
              <ToggleGroupItem value="turnover" className="px-2.5 text-[12px]">
                قيمة التداول
              </ToggleGroupItem>
            </ToggleGroup>
          </div>

          <p className="text-[12px] text-muted-foreground">
            <span className="num">{fmt(shown)}</span> سهم ·{" "}
            <span className="num text-up">{fmt(rising)}</span> صاعد ·{" "}
            <span className="num text-down">{fmt(falling)}</span> نازل
          </p>

          {shown === 0 ? (
            <p className="py-10 text-center text-[13px] text-muted-foreground">
              مفيش أسعار للأسهم دي دلوقتي.
            </p>
          ) : (
            <div className="h-[900px] w-full sm:h-[720px]" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <Treemap
                  data={tree}
                  dataKey="size"
                  aspectRatio={4 / 3}
                  isAnimationActive={false}
                  content={<HeatmapTile onOpen={(code) => openDetail(code)} />}
                >
                  <Tooltip
                    content={<TileTooltip sizeMode={sizeMode} />}
                    isAnimationActive={false}
                  />
                </Treemap>
              </ResponsiveContainer>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Legend />
            <span className="text-[11.5px] text-muted-foreground">
              الأسهم الصغيرة ليها حد أدنى للمساحة عشان تبان · الأسعار متأخرة نحو{" "}
              <span className="num">{fmt(data.delayedMinutes)}</span> دقيقة · آخر تحديث{" "}
              {new Date(data.asOf).toLocaleTimeString("ar-EG", {
                hour: "2-digit",
                minute: "2-digit",
                numberingSystem: "latn",
              })}
            </span>
          </div>
        </div>
      )}
    </Panel>
  );
}
