import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { Notice, Panel, Spinner } from "@/components/desk/state-blocks";
import { Button } from "@/components/ui/button";
import { post } from "@/lib/api";
import {
  clearInvestStyle,
  INVEST_STYLES,
  setInvestStyle,
  useActiveInvestStyle,
  type StyleKey,
} from "@/lib/invest-style";
import { SITE_URL } from "@/lib/seo";
import { useDesk } from "@/lib/store";

export const Route = createFileRoute("/_app/settings")({
  head: () => ({
    meta: [
      { title: "الإعدادات — EGXpert" },
      {
        name: "description",
        content: "سلوكك الاستثماري ومسح بيانات المحفظة.",
      },
      { property: "og:title", content: "الإعدادات — EGXpert" },
      {
        property: "og:description",
        content: "سلوكك الاستثماري ومسح بيانات المحفظة.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:url", content: `${SITE_URL}/settings` },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { reload, pf } = useDesk();
  const [armed, setArmed] = useState(false);
  const [resetting, setResetting] = useState(false);
  const { style, auto, inferred } = useActiveInvestStyle(pf?.trades);

  const chooseStyle = (next: StyleKey) => {
    setInvestStyle(next);
    void post("/api/settings/style", { style: next }).catch(() => {});
    toast.success(`تم تفعيل قواعد ${INVEST_STYLES.find((item) => item.key === next)!.label}`);
  };

  const resetToAuto = () => {
    clearInvestStyle();
    void post("/api/settings/style", { style: null }).catch(() => {});
    toast.success("رجّعنا الأسلوب لسلوكك التلقائي في التداول");
  };

  const resetAll = async () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setResetting(true);
    try {
      await post("/api/reset", { scope: "all" });
      await reload();
      setArmed(false);
      toast.success("تم مسح كل البيانات");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر المسح");
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="space-y-4">
      <Panel
        title="اختار سلوكك الاستثماري لتحديد قواعد التوصيات"
        description="الاختيار بيغيّر قواعد التوصيات وتوصية كل سهم في صفحة المراكز فورًا."
      >
        {auto ? (
          <Notice tone="info" className="mb-3">
            {inferred
              ? `الأسلوب دلوقتي مستنتج تلقائيًا من صفقاتك السابقة: ${
                  INVEST_STYLES.find((item) => item.key === inferred)!.label
                }. اختار سلوك من تحت لو عايز تثبّته بدل الاستنتاج التلقائي.`
              : "مفيش صفقات كفاية لسه لاستنتاج أسلوبك تلقائيًا، فمُفعّل حاليًا أسلوب متوسط المدى كافتراضي. اختار سلوك من تحت أو خلّي التطبيق يستنتجه لما تتراكم صفقاتك."}
          </Notice>
        ) : (
          <Notice tone="info" className="mb-3">
            سلوكك الاستثماري مثبّت يدويًا دلوقتي، مش مستنتج من سلوكك في التداول.{" "}
            <button
              type="button"
              onClick={resetToAuto}
              className="font-semibold underline underline-offset-2"
            >
              رجّعه تلقائي
            </button>
          </Notice>
        )}
        <div className="grid gap-2 sm:grid-cols-3">
          {INVEST_STYLES.map((item) => {
            const active = item.key === style;
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => chooseStyle(item.key)}
                aria-pressed={active}
                className={`rounded-lg border px-4 py-3 text-center transition-colors ${
                  active
                    ? "border-primary bg-primary/10 ring-1 ring-primary"
                    : "border-border bg-surface hover:bg-muted"
                }`}
              >
                <div className="text-[14px] font-semibold">{item.label}</div>
                <div className="mt-0.5 text-[12px] text-muted-foreground">({item.horizon})</div>
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel
        title="إعادة تعيين"
        description="يمسح كل بيانات محفظتك: المراكز، والكاش، والصفقات، والسجل اليومي، وقائمة المتابعة. لا يمكن التراجع."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="destructive" onClick={() => void resetAll()} disabled={resetting}>
            {resetting && <Spinner />}
            {armed ? "تأكيد مسح كل البيانات" : "مسح كل البيانات"}
          </Button>
          {armed && (
            <span className="text-[12.5px] text-muted-foreground">
              اضغط تاني للتأكيد — هيتمسح كل حاجة
            </span>
          )}
        </div>
      </Panel>
    </div>
  );
}
