import { Gift, LineChart, Users } from "lucide-react";
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
 * Headline figures for the landing page. The user count and the total
 * analysis count are the real ones from the API; if the request fails their
 * tiles are simply left out rather than showing a placeholder, and the fixed
 * facts about the product remain. The hit rate is deliberately not shown
 * here — it lives on the track-record page with its full context.
 */
export function ProofTiles() {
  const [users, setUsers] = useState<number | null>(null);
  const [analyses, setAnalyses] = useState<number | null>(null);

  useEffect(() => {
    api("/api/track-record/summary")
      .then((result) => {
        if (typeof result?.analyses === "number" && result.analyses > 0)
          setAnalyses(result.analyses);
        if (typeof result?.users === "number" && result.users > 0) setUsers(result.users);
      })
      .catch(() => {});
  }, []);

  const tiles: Tile[] = [
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
    <section className="mx-auto w-full max-w-6xl px-4 py-8 sm:py-16">
      <div className="flex flex-wrap justify-center gap-2.5 sm:gap-4">
        {tiles.map(({ Icon, title, value, note }) => (
          <div
            key={title}
            className="w-[calc(50%-0.3125rem)] rounded-xl border bg-card p-3 text-center sm:w-[calc(50%-0.5rem)] sm:p-6 lg:w-[calc(25%-0.75rem)] shadow-sm transition-colors hover:border-primary/40"
          >
            <span className="mx-auto grid size-8 place-items-center rounded-lg bg-secondary text-foreground sm:size-11">
              <Icon className="size-4 sm:size-5" />
            </span>
            <p className="mt-2 text-[13px] font-semibold sm:mt-3 sm:text-[15px]">{title}</p>
            <p
              dir="ltr"
              className="mt-2 text-2xl font-bold tracking-tight text-primary sm:mt-4 sm:text-4xl"
            >
              <span className="num">{value}</span>
            </p>
            {note && (
              <p className="mt-2 text-[11px] text-muted-foreground sm:mt-4 sm:text-[12.5px]">
                {note}
              </p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
