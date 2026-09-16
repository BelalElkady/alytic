import { Check, Loader2, MessageCircle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useDesk } from "@/lib/store";
import { cn } from "@/lib/utils";

type Tier = "long" | "trader";
type PlanKey = "long_monthly" | "long_yearly" | "trader_monthly" | "trader_yearly";
type Plan = { key: PlanKey; tier: Tier; label: string; priceEgp: number; months: number };
type TierLimits = { screenshots: number; recommendations: number; cashScans: number; marketAnalysis: number };
type ScreenshotAddon = { key: string; screenshots: number; priceEgp: number };

const TIER_LABEL: Record<Tier, string> = { long: "النفس الطويل", trader: "الحريفة" };
const FEATURE_ROWS: { key: keyof TierLimits; label: string; unit: string }[] = [
  { key: "screenshots", label: "رفع سكرين شوت للمحفظة", unit: "صورة/شهر" },
  { key: "recommendations", label: "توصيات الأسهم", unit: "توصية/شهر" },
  { key: "cashScans", label: "تحليل استخدام الكاش", unit: "مرة/شهر" },
  { key: "marketAnalysis", label: "تحليل السوق", unit: "مرة/شهر" },
];

const EG_NUMBER = new Intl.NumberFormat("ar-EG", { numberingSystem: "latn" });

/**
 * How someone subscribes: ask on the support chat, get the payment details
 * privately, then an admin activates the account. No account number is
 * rendered here — publishing one on a public page invites impersonation, and
 * sending it in the chat means it only ever reaches a signed-in user we can
 * match a transfer to.
 */
export function SubscribePanel({ compact = false }: { compact?: boolean }) {
  const { user, refreshUser } = useDesk();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [tiers, setTiers] = useState<Record<Tier, TierLimits> | null>(null);
  const [screenshotAddons, setScreenshotAddons] = useState<ScreenshotAddon[]>([]);
  const [selectedAddon, setSelectedAddon] = useState<ScreenshotAddon | null>(null);
  const [tier, setTier] = useState<Tier>("long");
  const [months, setMonths] = useState<1 | 12>(12);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    api("/api/billing/plans")
      .then((result) => {
        setPlans(result.plans ?? []);
        setTiers(result.tiers ?? null);
        setScreenshotAddons(result.addons?.screenshots ?? []);
      })
      .catch(() => {
        setPlans([]);
        setTiers(null);
        setScreenshotAddons([]);
      });
  }, []);

  const selected = plans.find((p) => p.tier === tier && p.months === months) ?? null;
  const limits = tiers?.[tier] ?? null;

  const recheck = async () => {
    setChecking(true);
    try {
      const me = await refreshUser();
      if (me?.hasAccess) toast.success("تم تفعيل اشتراكك — أهلًا بيك!");
      else toast.info("الاشتراك لسه ما اتفعلش. لو حوّلت بالفعل، ابعتلنا في الشات ونشوفه فورًا.");
    } catch {
      toast.error("تعذر التحقق دلوقتي — جرّب تاني بعد شوية");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className={cn("space-y-4", compact && "space-y-3")}>
      <div className="grid gap-3 sm:grid-cols-2">
        {(["long", "trader"] as const).map((option) => {
          const active = option === tier;
          return (
            <button
              key={option}
              type="button"
              onClick={() => setTier(option)}
              className={cn(
                "rounded-xl border bg-card p-4 text-start transition-colors",
                active ? "border-primary/60 ring-1 ring-primary/20" : "hover:bg-accent",
              )}
            >
              <span className="text-[14px] font-semibold">{TIER_LABEL[option]}</span>
              {tiers?.[option] && (
                <ul className="mt-2 space-y-1">
                  {FEATURE_ROWS.map((row) => (
                    <li key={row.key} className="flex items-center justify-between text-[12px] text-muted-foreground">
                      <span>{row.label}</span>
                      <span className="num">
                        {tiers[option][row.key]} {row.unit}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </button>
          );
        })}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {([1, 12] as const).map((m) => {
          const plan = plans.find((p) => p.tier === tier && p.months === m);
          const active = m === months;
          return (
            <button
              key={m}
              type="button"
              onClick={() => setMonths(m)}
              disabled={!plan}
              className={cn(
                "rounded-xl border bg-card p-4 text-start transition-colors disabled:opacity-50",
                active ? "border-primary/60 ring-1 ring-primary/20" : "hover:bg-accent",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[13px] text-muted-foreground">{m === 12 ? "سنوي" : "شهري"}</span>
                {m === 12 && <Badge variant="outline">التوفير الأكبر</Badge>}
              </div>
              <p className="mt-2 flex items-end gap-1.5">
                <span className="num text-2xl font-bold">
                  {plan ? EG_NUMBER.format(plan.priceEgp) : "—"}
                </span>
                <span className="pb-0.5 text-[12px] text-muted-foreground">
                  جنيه / {m === 12 ? "سنة" : "شهر"}
                </span>
              </p>
            </button>
          );
        })}
      </div>

      {limits && (
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          باقة {TIER_LABEL[tier]}: {FEATURE_ROWS.map((row) => `${limits[row.key]} ${row.unit}`).join(" · ")}
        </p>
      )}

      {screenshotAddons.length > 0 && (
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[14px] font-semibold">رصيد صور إضافي (اختياري)</span>
            <Badge variant="outline">دفعة واحدة — مش اشتراك</Badge>
          </div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
            خلصت صور المحفظة الشهر ده؟ زوّد رصيدك فوق حد باقتك.
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            {screenshotAddons.map((addon) => {
              const active = selectedAddon?.key === addon.key;
              return (
                <button
                  key={addon.key}
                  type="button"
                  onClick={() => setSelectedAddon(active ? null : addon)}
                  className={cn(
                    "rounded-lg border p-3 text-center transition-colors",
                    active ? "border-primary/60 bg-accent ring-1 ring-primary/20" : "hover:bg-accent",
                  )}
                >
                  <p className="num text-lg font-bold">{addon.screenshots}</p>
                  <p className="text-[11px] text-muted-foreground">صورة</p>
                  <p className="num mt-1 text-[13px] font-semibold">
                    {EG_NUMBER.format(addon.priceEgp)} جنيه
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="rounded-xl border bg-surface p-4">
        <h3 className="flex items-center gap-2 text-[14px] font-semibold">
          <MessageCircle className="size-4" />
          كلّمنا في الشات وهنكمّل معاك
        </h3>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          {user
            ? `افتح الشات من زرار المحادثة تحت في الركن، قولّنا إنك عايز ${[
                `باقة ${TIER_LABEL[tier]}${selected ? ` (${selected.months === 12 ? "سنوي" : "شهري"})` : ""}`,
                selectedAddon ? `رصيد ${selectedAddon.screenshots} صورة إضافية` : null,
              ]
                .filter(Boolean)
                .join(" و")}، وهنبعتلك بيانات الدفع وكل التفاصيل هناك. أول ما نراجع التحويل بنفعّل حسابك على طول.`
            : "سجّل دخولك الأول، وبعدين افتح الشات من زرار المحادثة تحت في الركن وقولّنا الباقة أو الرصيد اللي عايزه — هنبعتلك بيانات الدفع وكل التفاصيل هناك."}
        </p>
      </div>

      {user && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => void recheck()} disabled={checking}>
            {checking ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            حوّلت بالفعل — تحقّق
          </Button>
          {user.hasAccess && (
            <span className="inline-flex items-center gap-1.5 text-[12.5px] text-up">
              <Check className="size-4" />
              اشتراكك شغّال
            </span>
          )}
        </div>
      )}
    </div>
  );
}
