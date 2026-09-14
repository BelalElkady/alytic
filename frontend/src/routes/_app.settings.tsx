import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { ErrorState, LoadingBlock, Notice, Panel, Spinner } from "@/components/desk/state-blocks";
import { Button } from "@/components/ui/button";
import { api, post } from "@/lib/api";
import {
  clearInvestStyle,
  INVEST_STYLES,
  STYLE_RULES,
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
        content: "قواعد التوصيات المفعّلة وإعادة تعيين السجل والصفقات.",
      },
      { property: "og:title", content: "الإعدادات — EGXpert" },
      {
        property: "og:description",
        content: "قواعد التوصيات المفعّلة وإعادة تعيين السجل والصفقات.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:url", content: `${SITE_URL}/settings` },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  const { reload, pf } = useDesk();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors the settings API response shape
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
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

  const load = () => {
    api("/api/settings")
      .then((result) => {
        setData(result);
        setError(null);
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "تعذر تحميل الإعدادات"),
      );
  };

  useEffect(load, []);

  const resetLog = async () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setResetting(true);
    try {
      await post("/api/reset", { scope: "log" });
      await reload();
      load();
      setArmed(false);
      toast.success("تم مسح السجل والصفقات");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر المسح");
    } finally {
      setResetting(false);
    }
  };

  if (error)
    return (
      <ErrorState
        message={error}
        action={
          <Button variant="outline" size="sm" onClick={load}>
            حاول تاني
          </Button>
        }
      />
    );
  if (!data) return <LoadingBlock rows={3} />;

  const base = data.rules;
  const override = STYLE_RULES[style];
  const rules = {
    ...base,
    trailing: { ...base.trailing, ...override.trailing },
    takeProfit: { ...base.takeProfit, ...override.takeProfit },
    entry: { ...base.entry, ...override.entry },
    sizing: { ...base.sizing, ...override.sizing },
  };
  const activeStyle = INVEST_STYLES.find((item) => item.key === style)!;

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

      <Panel title="قواعد التوصيات المفعّلة" description={activeStyle.description}>
        <ul className="space-y-2 text-[13px] leading-relaxed">
          {[
            `وقف متحرك ${rules.trailing.trailPct}% يتفعّل تلقائيًا لما السهم يعلى ${rules.trailing.activateAtProfitPct}% فوق تكلفتك، ولا ينزل أبدًا.`,
            "الوقف يُحترم على إغلاق الجلسة — إغلاق تحته = توصية بيع كلي.",
            `ربح ${rules.takeProfit.partialAtProfitPct}%+ = توصية بيع جزئي ${rules.takeProfit.partialFraction * 100}% بأمر محدد فوق السعر ${rules.takeProfit.limitAbovePricePct}%.`,
            `وصول الهدف = بيع ${Math.round(rules.takeProfit.atTargetFraction * 100)}% ورفع الوقف للباقي ${rules.takeProfit.raiseStopAfterTargetPct}% تحت السعر.`,
            "تحسين المتوسط فقط للأسهم القيادية فوق متوسط 200 يوم — لا تعديل على سهم ضعيف.",
            `أقل عائد/مخاطرة مقبول: ${rules.entry.minRiskReward} · المخاطرة للصفقة ${rules.sizing.riskPerTradePct}% · الحد الأقصى للمركز ${rules.sizing.maxPositionPct}%.`,
          ].map((rule) => (
            <li key={rule} className="flex gap-2.5">
              <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary/60" />
              <span>{rule}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        title="إعادة تعيين"
        description="يمسح السجل اليومي والصفقات. المراكز بتفضل زي ما هي. لا يمكن التراجع."
      >
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="destructive" onClick={() => void resetLog()} disabled={resetting}>
            {resetting && <Spinner />}
            {armed ? "تأكيد المسح" : "مسح السجل والصفقات"}
          </Button>
          {armed && <span className="text-[12.5px] text-muted-foreground">اضغط تاني للتأكيد</span>}
        </div>
      </Panel>
    </div>
  );
}
