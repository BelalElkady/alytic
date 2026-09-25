import { Link } from "@tanstack/react-router";
import { Calculator, Wallet } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { averagingLadder, parseAmount, planAveraging } from "@/lib/averaging";
import { fmt, int } from "@/lib/format";
import { useDesk } from "@/lib/store";
import { cn } from "@/lib/utils";

/**
 * "حاسبة المتوسط": enter the shares held and their average, the average you
 * want to reach and the price you'd buy at — and see how many shares that
 * takes. Pure arithmetic, so it works the same signed in or not.
 */
export function AveragingCalculator() {
  const { user } = useDesk();
  const [shares, setShares] = useState("");
  const [avgCost, setAvgCost] = useState("");
  const [target, setTarget] = useState("");
  const [price, setPrice] = useState("");

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
        <div className="flex flex-col gap-5 rounded-xl border bg-card p-5 shadow-sm">
          <div className="grid gap-4 sm:grid-cols-2">
            <AmountField
              id="avg-shares"
              label="عدد الأسهم اللي معاك"
              hint="كل الأسهم اللي في محفظتك من السهم ده دلوقتي."
              value={shares}
              onChange={setShares}
            />
            <AmountField
              id="avg-cost"
              label="متوسط الشراء الحالي"
              hint={
                <>
                  زي ما هو ظاهر في تطبيق السمسار — تقدر تكتبه <span className="num">74.42</span> أو{" "}
                  <span className="num">74,42</span>.
                </>
              }
              value={avgCost}
              onChange={setAvgCost}
            />
            <AmountField
              id="avg-target"
              label="المتوسط اللي عايز توصله"
              hint="أقل من متوسطك لو عايز تنزّله، أو أعلى منه لو عايز ترفعه."
              value={target}
              onChange={setTarget}
            />
            <AmountField
              id="avg-price"
              label="هتشتري بسعر كام؟"
              hint="غالبًا سعر السهم دلوقتي، أو سعر أمر الشراء اللي ناوي تحطه."
              value={price}
              onChange={setPrice}
            />
          </div>
          {/* Fills the room left beside the taller result card on wide screens.
              Stacked on phones the result comes right after the fields, so
              the CTA moves below it there (see the copy after the grid). */}
          <PortfolioCta signedIn={Boolean(user)} className="mt-auto hidden lg:flex" />
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
              <p className="text-[13px] text-muted-foreground">محتاج تشتري</p>
              <p className="mt-1 text-[22px] font-bold">
                <span className="num">{int(result.buyShares)}</span> سهم على سعر{" "}
                <span className="num">{fmt(input.price)}</span>
              </p>
              <dl className="mt-4 grid grid-cols-3 gap-2">
                <Stat label="تكلفة الشراء" hint="هتدفعه دلوقتي" value={fmt(result.buyCost)} />
                <Stat
                  label="إجمالي الأسهم"
                  hint="القديم + الجديد"
                  value={int(result.totalShares)}
                />
                <Stat label="المتوسط الجديد" hint="بعد الشراء" value={fmt(result.newAvg)} />
              </dl>
            </>
          )}

          {touched && ladder.length > 0 && (
            <div className="mt-5">
              <p className="text-[12.5px] font-medium text-muted-foreground">
                لو اشتريت بسعر تاني:
              </p>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                كل ما سعر الشراء يبعد عن المتوسط اللي عايزه، هتحتاج أسهم أقل.
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

      <PortfolioCta signedIn={Boolean(user)} className="mt-4 flex lg:hidden" />
    </section>
  );
}

function AmountField({
  id,
  label,
  hint,
  value,
  onChange,
}: {
  id: string;
  label: string;
  hint: ReactNode;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {/* 16px on phones: iOS zooms the page into any smaller input. */}
      <Input
        id={id}
        aria-describedby={`${id}-hint`}
        inputMode="decimal"
        dir="ltr"
        className="num text-base sm:text-sm"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      <p id={`${id}-hint`} className="text-[11.5px] leading-relaxed text-muted-foreground">
        {hint}
      </p>
    </div>
  );
}

function Stat({ label, hint, value }: { label: string; hint: string; value: string }) {
  return (
    <div className="rounded-lg border bg-surface px-3 py-2 text-end">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="num mt-0.5 text-[14px] font-semibold">{value}</dd>
      <dd className="mt-0.5 text-[10.5px] text-muted-foreground">{hint}</dd>
    </div>
  );
}

function PortfolioCta({ signedIn, className }: { signedIn: boolean; className?: string }) {
  return (
    <div
      className={cn(
        "flex-col items-start gap-3 rounded-lg border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between lg:flex-col lg:items-start",
        className,
      )}
    >
      <div className="flex items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-secondary text-foreground">
          <Wallet className="size-4.5" />
        </span>
        <div>
          <h3 className="text-[15px] font-semibold">عايز تتابع محفظتك كلها؟</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
            ضيف أسهمك مرة واحدة، وتابع متوسطك وأرباحك ووقف الخسارة والأهداف لكل سهم بأسعار لحظية.
          </p>
        </div>
      </div>
      <Button asChild className="shrink-0">
        {signedIn ? (
          <Link to="/portfolio">افتح محفظتك</Link>
        ) : (
          <Link to="/login" search={{ mode: "login" }}>
            سجّل دخولك وتابع محفظتك
          </Link>
        )}
      </Button>
    </div>
  );
}
