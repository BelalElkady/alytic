import { Link } from "@tanstack/react-router";
import { Check, Copy, Loader2, MessageCircle, RefreshCw } from "lucide-react";
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
type AddonKind = keyof TierLimits;
type Addon = { key: string; label: string; count: number; priceEgp: number };
type RawAddon = { key: string; label: string; priceEgp: number } & Partial<Record<AddonKind, number>>;

const ADDON_KINDS: AddonKind[] = ["screenshots", "recommendations", "cashScans", "marketAnalysis"];

const TIER_LABEL: Record<Tier, string> = { long: "النفس الطويل", trader: "الحريفة" };
const FEATURE_ROWS: { key: AddonKind; label: string; unit: string }[] = [
  { key: "screenshots", label: "رفع سكرين شوت للمحفظة", unit: "صورة/شهر" },
  { key: "recommendations", label: "توصيات الأسهم", unit: "توصية/شهر" },
  { key: "cashScans", label: "تحليل استخدام الكاش", unit: "مرة/شهر" },
  { key: "marketAnalysis", label: "تحليل السوق", unit: "مرة/شهر" },
];
// Same labels as FEATURE_ROWS but without the "/شهر" — an add-on pack is a
// flat one-time count, not a monthly rate.
const ADDON_UNIT: Record<AddonKind, string> = {
  screenshots: "صورة",
  recommendations: "توصية",
  cashScans: "مرة",
  marketAnalysis: "مرة",
};

/** Flattens the API's { screenshots: [{screenshots: n, ...}], ... } shape into a plain count per pack. */
function normalizeAddons(raw: Partial<Record<AddonKind, RawAddon[]>> | undefined): Record<AddonKind, Addon[]> {
  const result = {} as Record<AddonKind, Addon[]>;
  for (const kind of ADDON_KINDS) {
    result[kind] = (raw?.[kind] ?? []).map((a) => ({ key: a.key, label: a.label, priceEgp: a.priceEgp, count: a[kind] ?? 0 }));
  }
  return result;
}

const EG_NUMBER = new Intl.NumberFormat("ar-EG", { numberingSystem: "latn" });

// Copied to the clipboard only — never rendered, so the handle doesn't sit on the page as text.
const INSTAPAY_ADDRESS = "hassansmm@instapay";

/**
 * How someone subscribes: pay via the InstaPay QR (or the copy-address button),
 * then tell us on the support chat so an admin can match the transfer and
 * activate the account. The InstaPay address itself is never shown as text.
 */
export function SubscribePanel({
  compact = false,
  lockedTier,
  initialMonths,
}: {
  compact?: boolean;
  /** Show only this tier's card and prices — set when the visitor arrives from that plan's button on /pricing. Omit to offer both tiers. */
  lockedTier?: Tier;
  /** Which period starts selected (1 = monthly, 12 = yearly). Defaults to yearly. */
  initialMonths?: 1 | 12;
}) {
  const { user, refreshUser } = useDesk();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [tiers, setTiers] = useState<Record<Tier, TierLimits> | null>(null);
  const [addons, setAddons] = useState<Record<AddonKind, Addon[]>>(() => normalizeAddons(undefined));
  // At most one pack selected per feature — a user can top up several
  // different features at once, but only one size of each.
  const [selectedAddons, setSelectedAddons] = useState<Partial<Record<AddonKind, Addon>>>({});
  const [pickedTier, setPickedTier] = useState<Tier>("long");
  // Derived rather than copied into state, so it follows the URL if it changes while mounted.
  const tier = lockedTier ?? pickedTier;
  const [months, setMonths] = useState<1 | 12>(initialMonths ?? 12);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    api("/api/billing/plans")
      .then((result) => {
        setPlans(result.plans ?? []);
        setTiers(result.tiers ?? null);
        setAddons(normalizeAddons(result.addons));
      })
      .catch(() => {
        setPlans([]);
        setTiers(null);
        setAddons(normalizeAddons(undefined));
      });
  }, []);

  const toggleAddon = (kind: AddonKind, addon: Addon) => {
    setSelectedAddons((prev) => {
      const next = { ...prev };
      if (next[kind]?.key === addon.key) delete next[kind];
      else next[kind] = addon;
      return next;
    });
  };

  const selected = plans.find((p) => p.tier === tier && p.months === months) ?? null;
  const limits = tiers?.[tier] ?? null;

  const copyInstapay = async () => {
    try {
      await navigator.clipboard.writeText(INSTAPAY_ADDRESS);
      toast.success("تم نسخ عنوان إنستاباي");
    } catch {
      toast.error("تعذر النسخ — امسح الكود بدلًا من كده");
    }
  };

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

  const featureList = (option: Tier) =>
    tiers?.[option] && (
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
    );

  return (
    <div className={cn("space-y-4", compact && "space-y-3")}>
      {lockedTier ? (
        <div className="rounded-xl border border-primary/60 bg-card p-4 ring-1 ring-primary/20">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[14px] font-semibold">باقة {TIER_LABEL[lockedTier]}</span>
            <Link to="/subscribe" className="text-[12px] text-primary hover:underline">
              باقة تانية؟ شوف الباقتين
            </Link>
          </div>
          {featureList(lockedTier)}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {(["long", "trader"] as const).map((option) => {
            const active = option === tier;
            return (
              <button
                key={option}
                type="button"
                onClick={() => setPickedTier(option)}
                className={cn(
                  "rounded-xl border bg-card p-4 text-start transition-colors",
                  active ? "border-primary/60 ring-1 ring-primary/20" : "hover:bg-accent",
                )}
              >
                <span className="text-[14px] font-semibold">{TIER_LABEL[option]}</span>
                {featureList(option)}
              </button>
            );
          })}
        </div>
      )}

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

      {/* The locked tier's card above already lists these limits. */}
      {limits && !lockedTier && (
        <p className="text-[12.5px] leading-relaxed text-muted-foreground">
          باقة {TIER_LABEL[tier]}: {FEATURE_ROWS.map((row) => `${limits[row.key]} ${row.unit}`).join(" · ")}
        </p>
      )}

      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[14px] font-semibold">رصيد إضافي (اختياري)</span>
          <Badge variant="outline">دفعة واحدة — مش اشتراك</Badge>
        </div>
        <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
          خلصت رصيد أي ميزة الشهر ده؟ زوّد رصيدك فوق حد باقتك — تقدر تختار أكتر من ميزة.
        </p>
        <div className="mt-3 space-y-3">
          {FEATURE_ROWS.map((row) => (
            <div key={row.key}>
              <p className="text-[12.5px] font-medium text-muted-foreground">{row.label}</p>
              <div className="mt-1.5 grid grid-cols-3 gap-2">
                {addons[row.key].map((addon) => {
                  const active = selectedAddons[row.key]?.key === addon.key;
                  return (
                    <button
                      key={addon.key}
                      type="button"
                      onClick={() => toggleAddon(row.key, addon)}
                      className={cn(
                        "rounded-lg border p-2.5 text-center transition-colors",
                        active ? "border-primary/60 bg-accent ring-1 ring-primary/20" : "hover:bg-accent",
                      )}
                    >
                      <p className="num text-base font-bold">{addon.count}</p>
                      <p className="text-[10.5px] text-muted-foreground">{ADDON_UNIT[row.key]}</p>
                      <p className="num mt-1 text-[12px] font-semibold">
                        {EG_NUMBER.format(addon.priceEgp)} ج
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col items-center gap-3 rounded-xl border bg-card p-4">
        <span className="text-[14px] font-semibold">ادفع بإنستاباي</span>
        <img
          src="/instapay-qr.png"
          alt="كود إنستاباي للدفع"
          width={220}
          height={220}
          className="size-[220px] rounded-lg bg-white p-2"
        />
        <Button variant="outline" onClick={() => void copyInstapay()}>
          <Copy className="size-4" />
          انسخ عنوان إنستاباي
        </Button>
      </div>

      <div className="rounded-xl border bg-surface p-4">
        <h3 className="flex items-center gap-2 text-[14px] font-semibold">
          <MessageCircle className="size-4" />
          كلّمنا في الشات وهنكمّل معاك
        </h3>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          {user
            ? `افتح الشات من زرار المحادثة تحت في الركن، قولّنا إنك عايز ${[
                `باقة ${TIER_LABEL[tier]}${selected ? ` (${selected.months === 12 ? "سنوي" : "شهري"})` : ""}`,
                ...ADDON_KINDS.filter((kind) => selectedAddons[kind]).map(
                  (kind) =>
                    `رصيد ${selectedAddons[kind]!.count} ${ADDON_UNIT[kind]} إضافية (${
                      FEATURE_ROWS.find((row) => row.key === kind)!.label
                    })`,
                ),
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
