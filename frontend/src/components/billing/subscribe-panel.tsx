import { Check, Loader2, MessageCircle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { useDesk } from "@/lib/store";
import { cn } from "@/lib/utils";

type Plan = { key: "monthly" | "yearly"; label: string; priceEgp: number; months: number };

const EG_NUMBER = new Intl.NumberFormat("ar-EG");

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
  const [selected, setSelected] = useState<"monthly" | "yearly">("yearly");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    api("/api/billing/plans")
      .then((result) => setPlans(result.plans ?? []))
      .catch(() => setPlans([]));
  }, []);

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
        {plans.map((option) => {
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
                {option.key === "yearly" && <Badge variant="outline">وفّر ١٨٩ جنيه</Badge>}
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

      <div className="rounded-xl border bg-surface p-4">
        <h3 className="flex items-center gap-2 text-[14px] font-semibold">
          <MessageCircle className="size-4" />
          كلّمنا في الشات وهنكمّل معاك
        </h3>
        <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
          {user
            ? "افتح الشات من زرار المحادثة تحت في الركن، قولّنا الباقة اللي عايزها، وهنبعتلك بيانات الدفع وكل التفاصيل هناك. أول ما نراجع التحويل بنفعّل حسابك على طول."
            : "سجّل دخولك الأول، وبعدين افتح الشات من زرار المحادثة تحت في الركن وقولّنا الباقة اللي عايزها — هنبعتلك بيانات الدفع وكل التفاصيل هناك."}
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
