import { Calculator } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { StockPicker } from "@/components/desk/stock-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { averagingLadder, parseAmount, planAveraging } from "@/lib/averaging";
import { api } from "@/lib/api";
import { fmt, int } from "@/lib/format";
import { type Stock, useDesk } from "@/lib/store";

/**
 * "حاسبة المتوسط": pick a stock, enter the shares held and their average, the
 * average you want to reach and the price you'd buy at — and see how many
 * shares that takes. /api/universe is public, so visitors get the stock list
 * too; a signed-in User's own Position and live price fill in by themselves.
 */
export function AveragingCalculator() {
  const { universe: deskUniverse, rows } = useDesk();
  const [publicUniverse, setPublicUniverse] = useState<Stock[]>([]);
  const universe = deskUniverse.length ? deskUniverse : publicUniverse;

  const [code, setCode] = useState("");
  const [shares, setShares] = useState("");
  const [avgCost, setAvgCost] = useState("");
  const [target, setTarget] = useState("");
  const [price, setPrice] = useState("");

  // A failed load used to leave an empty list with no hint why; now the
  // picker says so, and opening it again retries.
  const [listStatus, setListStatus] = useState<"loading" | "ready" | "failed">("loading");
  const loadingList = useRef(false);
  const loadPublicUniverse = useCallback(async () => {
    if (loadingList.current) return;
    loadingList.current = true;
    setListStatus("loading");
    try {
      const { stocks } = await api<{ stocks: Stock[] }>("/api/universe");
      setPublicUniverse([...(stocks ?? [])].sort((a, b) => a.code.localeCompare(b.code)));
      setListStatus("ready");
    } catch (error) {
      console.error("averaging calculator: loading the stock list failed", error);
      setListStatus("failed");
    } finally {
      loadingList.current = false;
    }
  }, []);

  useEffect(() => {
    if (!deskUniverse.length) void loadPublicUniverse();
  }, [deskUniverse.length, loadPublicUniverse]);

  const emptyText = universe.length
    ? "مفيش نتائج."
    : listStatus === "failed"
      ? "تعذر تحميل قائمة الأسهم — اقفل القائمة وافتحها تاني. تقدر تكمّل الحسبة من غير ما تختار سهم."
      : "بنحمّل قائمة الأسهم…";

  const pickStock = (next: string) => {
    setCode(next);
    const row = rows.find((candidate) => candidate.code === next);
    if (!row) return;
    if (row.position?.shares) setShares(String(row.position.shares));
    if (row.position?.avgCost) setAvgCost(String(row.position.avgCost));
    if (row.price) setPrice(String(row.price));
  };

  const input = {
    shares: parseAmount(shares),
    avgCost: parseAmount(avgCost),
    target: parseAmount(target),
    price: parseAmount(price),
  };
  const touched = [shares, avgCost, target, price].every((value) => value.trim() !== "");
  const result = planAveraging(input);
  const ladder = useMemo(
    () => averagingLadder({ shares: input.shares, avgCost: input.avgCost, target: input.target }),
    [input.shares, input.avgCost, input.target],
  );

  return (
    <section id="averaging-calculator" className="mx-auto w-full max-w-6xl px-4 py-14 sm:py-16">
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 place-items-center rounded-lg bg-secondary text-foreground">
          <Calculator className="size-4.5" />
        </span>
        <h2 className="text-2xl font-bold tracking-tight">حاسبة المتوسط</h2>
      </div>
      <p className="mt-2 max-w-2xl text-[14px] leading-relaxed text-muted-foreground">
        معاك سهم وعايز تنزّل متوسطك (أو ترفعه)؟ اكتب عدد أسهمك ومتوسطك الحالي والمتوسط اللي عايز
        توصله، وسعر الشراء — ونقولك تشتري كام سهم.
      </p>

      <div className="mt-8 grid gap-4 lg:grid-cols-[1fr_1.1fr]">
        <div className="grid content-start gap-4 rounded-xl border bg-card p-5 shadow-sm sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label>السهم</Label>
            <StockPicker
              value={code}
              onChange={pickStock}
              stocks={universe}
              emptyText={emptyText}
              onOpen={() => {
                if (!universe.length) void loadPublicUniverse();
              }}
              className="sm:w-full"
            />
          </div>
          <AmountField
            id="avg-shares"
            label="عدد الأسهم اللي معاك"
            value={shares}
            onChange={setShares}
          />
          <AmountField
            id="avg-cost"
            label="متوسط الشراء الحالي"
            value={avgCost}
            onChange={setAvgCost}
          />
          <AmountField
            id="avg-target"
            label="المتوسط اللي عايز توصله"
            value={target}
            onChange={setTarget}
          />
          <AmountField id="avg-price" label="هتشتري بسعر كام؟" value={price} onChange={setPrice} />
        </div>

        <div className="rounded-xl border bg-card p-5 shadow-sm" aria-live="polite">
          {!touched ? (
            <p className="text-[13.5px] leading-relaxed text-muted-foreground">
              املا الخانات الأربعة وهتظهر النتيجة هنا.
            </p>
          ) : !result.ok ? (
            <p className="text-[13.5px] leading-relaxed text-down">{result.reason}</p>
          ) : (
            <>
              <p className="text-[13px] text-muted-foreground">
                {code ? `${code} — ` : ""}محتاج تشتري
              </p>
              <p className="mt-1 text-[22px] font-bold">
                <span className="num">{int(result.buyShares)}</span> سهم على سعر{" "}
                <span className="num">{fmt(input.price)}</span>
              </p>
              <dl className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="تكلفة الشراء" value={fmt(result.buyCost)} />
                <Stat label="إجمالي الأسهم" value={int(result.totalShares)} />
                <Stat label="إجمالي التكلفة" value={fmt(result.totalCost)} />
                <Stat label="المتوسط الجديد" value={fmt(result.newAvg)} />
              </dl>
            </>
          )}

          {touched && ladder.length > 0 && (
            <div className="mt-5">
              <p className="text-[12.5px] font-medium text-muted-foreground">
                لو اشتريت بسعر تاني:
              </p>
              <table className="mt-2 w-full text-[13px]">
                <thead className="text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-1.5 text-start font-normal">السعر</th>
                    <th className="py-1.5 text-start font-normal">عدد الأسهم</th>
                    <th className="py-1.5 text-start font-normal">التكلفة</th>
                  </tr>
                </thead>
                <tbody>
                  {ladder.map(({ price: rowPrice, plan }) => (
                    <tr key={rowPrice} className="border-b last:border-0">
                      <td className="py-1.5">
                        <span className="num">{fmt(rowPrice)}</span>
                      </td>
                      <td className="py-1.5">
                        <span className="num">{int(plan.buyShares)}</span>
                      </td>
                      <td className="py-1.5">
                        <span className="num">{fmt(plan.buyCost)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-4 text-[11.5px] leading-relaxed text-muted-foreground">
            الأرقام من غير مصاريف السمسرة، وعدد الأسهم مقرّب لأعلى عشان توصل للمتوسط أو أحسن منه
            شوية.
          </p>
        </div>
      </div>
    </section>
  );
}

function AmountField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {/* 16px on phones: iOS zooms the page into any smaller input. */}
      <Input
        id={id}
        inputMode="decimal"
        dir="ltr"
        className="num text-base sm:text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-surface px-3 py-2 text-end">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="num mt-0.5 text-[14px] font-semibold">{value}</dd>
    </div>
  );
}
