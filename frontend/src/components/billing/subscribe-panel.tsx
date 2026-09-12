import { Check, Copy, Loader2, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useDesk } from "@/lib/store";
import { cn } from "@/lib/utils";

type Plan = { key: "monthly" | "yearly"; label: string; priceEgp: number; months: number };
type BillingInfo = {
  plans: Plan[];
  instapay: { address: string | null; accountName: string | null };
};

const EG_NUMBER = new Intl.NumberFormat("ar-EG");

/**
 * How someone actually subscribes: transfer over InstaPay, then an admin
 * activates the account by hand. There is no gateway, so this screen's job is
 * to make the transfer unambiguous (exact amount, exact address, what to send
 * back) and to let the user re-check without signing out — the unlock happens
 * server-side the moment the admin grants the period.
 */
export function SubscribePanel({ compact = false }: { compact?: boolean }) {
  const { user, refreshUser } = useDesk();
  const [info, setInfo] = useState<BillingInfo | null>(null);
  const [selected, setSelected] = useState<"monthly" | "yearly">("yearly");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    api("/api/billing/plans")
      .then(setInfo)
      .catch(() => setInfo(null));
  }, []);

  const plan = info?.plans.find((p) => p.key === selected);
  const address = info?.instapay.address ?? null;

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("اتنسخ");
    } catch {
      toast.error("تعذر النسخ — انسخه يدويًا");
    }
  };

  const recheck = async () => {
    setChecking(true);
    try {
      const me = await refreshUser();
      if (me?.hasAccess) toast.success("تم تفعيل اشتراكك — أهلًا بيك!");
      else toast.info("الاشتراك لسه ما اتفعلش. بنراجع التحويلات يدويًا، استنى شوية وجرّب تاني.");
    } catch {
      toast.error("تعذر التحقق دلوقتي — جرّب تاني بعد شوية");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className={cn("space-y-4", compact && "space-y-3")}>
      <div className="grid gap-3 sm:grid-cols-2">
        {(info?.plans ?? []).map((option) => {
          const active = option.key === selected;
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => setSelected(option.key)}
              className={cn(
                "rounded-xl border bg-card p-4 text-start transition-colors",
                active ? "border-primary/60 ring-1 ring-primary/20" : "hover:bg-accent",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-[14px] font-semibold">{option.label}</span>
                {option.key === "yearly" && <Badge variant="outline">وفّر ١٠٪</Badge>}
              </div>
              <p className="mt-2 flex items-end gap-1.5">
                <span className="num text-2xl font-bold">{EG_NUMBER.format(option.priceEgp)}</span>
                <span className="pb-0.5 text-[12px] text-muted-foreground">
                  جنيه / {option.months === 12 ? "سنة" : "شهر"}
                </span>
              </p>
            </button>
          );
        })}
      </div>

      <ol className="space-y-3 rounded-xl border bg-surface p-4 text-[13px] leading-relaxed">
        <li className="flex gap-3">
          <StepNumber>١</StepNumber>
          <div className="min-w-0 space-y-2">
            <p>
              حوّل{" "}
              <span className="num font-semibold">{EG_NUMBER.format(plan?.priceEgp ?? 0)}</span>{" "}
              جنيه على InstaPay للحساب ده:
            </p>
            {address ? (
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded-md border bg-card px-2.5 py-1.5 text-[13px]" dir="ltr">
                  {address}
                </code>
                <Button size="sm" variant="outline" onClick={() => void copy(address)}>
                  <Copy className="size-3.5" />
                  نسخ
                </Button>
                {info?.instapay.accountName && (
                  <span className="text-[12px] text-muted-foreground">
                    ({info.instapay.accountName})
                  </span>
                )}
              </div>
            ) : (
              <p className="text-muted-foreground">
                تواصل معانا من صفحة «تواصل معنا» وهنبعتلك بيانات التحويل.
              </p>
            )}
          </div>
        </li>
        <li className="flex gap-3">
          <StepNumber>٢</StepNumber>
          <p>
            ابعتلنا صورة إيصال التحويل على «تواصل معنا» ومعاها بريدك المسجّل
            {user?.email ? (
              <>
                {" "}
                (<span dir="ltr">{user.email}</span>)
              </>
            ) : null}
            .
          </p>
        </li>
        <li className="flex gap-3">
          <StepNumber>٣</StepNumber>
          <p>
            بنفعّل الاشتراك يدويًا بعد ما نراجع التحويل، وهيشتغل على طول من غير ما تعمل حاجة —
            هتلاقي تاريخ انتهاء الاشتراك ظاهر في الأعلى.
          </p>
        </li>
      </ol>

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

function StepNumber({ children }: { children: string }) {
  return (
    <span className="num flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-[12px] font-semibold">
      {children}
    </span>
  );
}
