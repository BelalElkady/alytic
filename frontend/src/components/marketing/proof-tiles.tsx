import { BarChart3, Gift, LineChart, Users } from "lucide-react";
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
export function ProofTiles() {
  const [hit, setHit] = useState<{ hitRate: number; closed: number } | null>(null);
  const [users, setUsers] = useState<number | null>(null);
  const [analyses, setAnalyses] = useState<number | null>(null);

  useEffect(() => {
    api("/api/track-record/summary")
      .then((result) => {
        if (typeof result?.analyses === "number" && result.analyses > 0)
          setAnalyses(result.analyses);
        if (typeof result?.users === "number" && result.users > 0) setUsers(result.users);
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
            <p dir="ltr" className="mt-4 text-4xl font-bold tracking-tight text-primary">
              <span className="num">{value}</span>
            </p>
            {note && <p className="mt-4 text-[12.5px] text-muted-foreground">{note}</p>}
          </div>
        ))}
      </div>
    </section>
  );
}
