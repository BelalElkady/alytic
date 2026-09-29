import { Link } from "@tanstack/react-router";
import { Check, Copy, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { WhatsAppIcon, whatsappLink } from "@/components/support/whatsapp";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useDesk } from "@/lib/store";
import { cn } from "@/lib/utils";

type Tier = "long" | "trader";
type PlanKey = "long_monthly" | "long_yearly" | "trader_monthly" | "trader_yearly";
type Plan = { key: PlanKey; tier: Tier; label: string; priceEgp: number; months: number };
type TierLimits = { screenshots: number; recommendations: number; cashScans: number; marketAnalysis: number };

const TIER_LABEL: Record<Tier, string> = { long: "النفس الطويل", trader: "الحريفة" };
const FEATURE_ROWS: { key: keyof TierLimits; label: string; unit: string }[] = [
  { key: "screenshots", label: "رفع سكرين شوت للمحفظة", unit: "صورة/شهر" },
  { key: "recommendations", label: "توصيات الأسهم", unit: "توصية/شهر" },
  { key: "cashScans", label: "تحليل استخدام الكاش", unit: "مرة/شهر" },
  { key: "marketAnalysis", label: "تحليل السوق", unit: "مرة/شهر" },
];
const EG_NUMBER = new Intl.NumberFormat("ar-EG", { numberingSystem: "latn" });

/**
 * How someone subscribes: pay via the InstaPay QR (or the copy-address button),
 * then tell us on the support chat so an admin can match the transfer and
 * activate the account. The InstaPay address itself is never shown as text:
 * the copy button fetches the same address the chat bot sends, from the
 * signed-in-only subscribe-info endpoint, so it never ships in the bundle.
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
      })
      .catch(() => {
        setPlans([]);
        setTiers(null);
      });
  }, []);

  const selected = plans.find((p) => p.tier === tier && p.months === months) ?? null;
  const limits = tiers?.[tier] ?? null;

  const copyInstapay = async () => {
    if (!user) {
      toast.info("سجّل دخولك الأول عشان تنسخ عنوان إنستاباي");
      return;
    }
    try {
      const info: { instapay?: { address: string | null } } = await api(
        "/api/support/subscribe-info",
      );
      const address = info.instapay?.address;
      if (!address) {
        toast.info("ابعتلنا في الشات وهنبعتلك بيانات الدفع");
        return;
      }
      await navigator.clipboard.writeText(address);
      toast.success("تم نسخ عنوان إنستاباي");
    } catch {
      toast.error("تعذر النسخ — امسح الكود بدلًا من كده");
    }
  };

  // Typed into the WhatsApp chat for them: which plan the transfer was for and
  // which account to activate, so the screenshot can be matched straight away.
  const paymentMessage = [
    `أهلًا، حوّلت اشتراك باقة ${TIER_LABEL[tier]}${selected ? ` (${selected.months === 12 ? "سنوي" : "شهري"})` : ""}، ودي صورة الدفع.`,
    user?.email ? `إيميل الحساب: ${user.email}` : null,
  ]
    .filter(Boolean)
    .join("\n");

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
          <WhatsAppIcon className="size-4 text-[#25D366]" />
          ابعتلنا سكرين من الدفع على الواتساب
        </h3>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          أول ما نراجع التحويل بنفعّل حسابك على طول.
        </p>
        <Button asChild className="mt-3 bg-[#25D366] text-white hover:bg-[#1ebe5b]">
          <a href={whatsappLink(paymentMessage)} target="_blank" rel="noopener noreferrer">
            <WhatsAppIcon className="size-4" />
            ابعت سكرين الدفع على واتساب
          </a>
        </Button>
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
