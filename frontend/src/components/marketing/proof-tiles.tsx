import { BarChart3, Gift, LineChart, Users, Wallet } from "lucide-react";
import type { ComponentType } from "react";
import { useEffect, useState } from "react";

import { api } from "@/lib/api";

type Tile = {
  Icon: ComponentType<{ className?: string }>;
  title: string;
  value: string;
  note?: string;
};

/**
 * Headline figures for the landing page. The hit rate and the user count
 * and the total analysis count are the real ones from the API; until there are enough closed calls to quote
 * (or if the request fails) their tiles are simply left out rather than
 * showing a placeholder, and the fixed facts about the product remain.
 */
/** 12,400,000 → "12.4 مليون", 850,000 → "850 ألف": a headline reads better short. */
function compactEgp(value: number) {
  const trim = (n: number) => n.toFixed(1).replace(/\.0$/, "");
  if (value >= 1_000_000) return `${trim(value / 1_000_000)} مليون`;
  if (value >= 1_000) return `${Math.round(value / 1_000).toLocaleString("en-US")} ألف`;
  return Math.round(value).toLocaleString("en-US");
}

export function ProofTiles() {
  const [hit, setHit] = useState<{ hitRate: number; closed: number } | null>(null);
  const [users, setUsers] = useState<number | null>(null);
  const [analyses, setAnalyses] = useState<number | null>(null);
  const [capital, setCapital] = useState<number | null>(null);

  useEffect(() => {
    api("/api/track-record/summary")
      .then((result) => {
        if (typeof result?.analyses === "number" && result.analyses > 0) setAnalyses(result.analyses);
        if (typeof result?.users === "number" && result.users > 0) setUsers(result.users);
        if (typeof result?.capital === "number" && result.capital > 0) setCapital(result.capital);
        if (typeof result?.hitRate === "number") {
          setHit({ hitRate: result.hitRate, closed: Number(result.closed) || 0 });
        }
      })
      .catch(() => {});
  }, []);

  const tiles: Tile[] = [
    ...(hit
      ? [
          {
            Icon: BarChart3,
            title: "نسبة نجاح التوصيات",
            value: `${Math.round(hit.hitRate)}%`,
            note: `من ${hit.closed.toLocaleString("en-US")} توصية مغلقة فعليًا`,
          },
        ]
      : []),
    ...(users !== null
      ? [
          {
            Icon: Users,
            title: "المشتركون",
            value: users.toLocaleString("en-US"),
            note: "مسجّلون على المنصة",
          },
        ]
      : []),
    ...(analyses !== null
      ? [
          {
            Icon: LineChart,
            title: "تحليل تم تقديمه",
            value: analyses.toLocaleString("en-US"),
            note: "تحليل اتسجل على المنصة",
          },
        ]
      : []),
    ...(capital !== null
      ? [
          {
            Icon: Wallet,
            title: "إجمالي رأس المال",
            value: compactEgp(capital),
            note: "جنيه في محافظ المشتركين",
          },
        ]
      : []),
    { Icon: Gift, title: "تجربة مجانية", value: "5", note: "أيام تداول، بدون بطاقة" },
  ];

  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:py-16">
      <div className="flex flex-wrap justify-center gap-4">
        {tiles.map(({ Icon, title, value, note }) => (
          <div
            key={title}
            className="w-full rounded-xl border bg-card p-6 text-center sm:w-[calc(50%-0.5rem)] lg:w-[calc(25%-0.75rem)] shadow-sm transition-colors hover:border-primary/40"
          >
            <span className="mx-auto grid size-11 place-items-center rounded-lg bg-secondary text-foreground">
              <Icon className="size-5" />
            </span>
            <p className="mt-3 text-[15px] font-semibold">{title}</p>
            <p className="num mt-4 text-4xl font-bold tracking-tight text-primary">{value}</p>
            {note && <p className="mt-4 text-[12.5px] text-muted-foreground">{note}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}
