// The "رسايل واتساب" admin tab: the WhatsApp lifecycle steps
// (docs/superpowers/specs/2026-10-23-whatsapp-lifecycle-design.md). Per step:
// on/off, which Meta template it sends, and its offer values. The wording
// itself lives in Meta's WhatsApp Manager — the preview here fills the
// proposed wording from the spec, so it can differ from what Meta approved.
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { ErrorState, LoadingBlock, Panel, Spinner } from "@/components/desk/state-blocks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { api, put } from "@/lib/api";

export type WhatsappStepKey =
  | "trial_welcome"
  | "trial_stoploss"
  | "trial_ending"
  | "trial_ended"
  | "paid_welcome"
  | "survey"
  | "renewal";

type StepParams = { discountPct?: number; validDays?: number; plan?: string; whatsNew?: string };

export type WhatsappStep = {
  key: string;
  enabled: boolean;
  templateName: string;
  templateLang: string;
  params: StepParams;
  counts: { sent: number; delivered: number; read: number; failed: number };
};

export type WhatsappStepsResponse = {
  steps: WhatsappStep[];
  surveyAnswers: { text: string; count: number }[];
  liveSending: boolean;
  plans: Record<string, { label: string; priceEgp: number }>;
};

export const STEP_TITLE: Record<string, string> = {
  trial_welcome: "ترحيب وتفعيل",
  trial_stoploss: "نصيحة وقف الخسارة",
  trial_ending: "قرب نهاية التجربة",
  trial_ended: "نهاية التجربة",
  paid_welcome: "ترحيب بالمشترك",
  survey: "استبيان",
  renewal: "عرض التجديد",
};

export const STATUS_LABEL: Record<string, string> = {
  queued: "مستنية",
  sent: "اتبعتت",
  delivered: "وصلت",
  read: "اتقرت",
  failed: "فشلت",
};

/** The spec's proposed wording, placeholders numbered as the backend fills them (backend/src/whatsapp/render.js). */
const DRAFTS: Record<string, string> = {
  trial_welcome:
    "أهلاً {{1}} 👋 حسابك على EGXpert اتفعّل وتجربتك المجانية ({{2}} أيام تداول) بدأت. أسرع بداية: ارفع سكرين شوت لمحفظتك من تطبيق السمسار وهنقرأها لك في ثواني. ابدأ من هنا: {{3}}",
  trial_stoploss:
    "{{1}}، أهم عادة للمستثمر: وقف خسارة لكل سهم. EGXpert بيحسبلك وقف الخسارة والمستهدف لكل سهم في محفظتك. شوفهم هنا: {{2}}",
  trial_ending:
    "{{1}}، تجربتك المجانية فاضلها يوم واحد. اشترك في {{2}} السنوي بخصم {{3}}٪ (بـ {{4}} جنيه بدل السعر الكامل) — العرض لحد {{5}}. اشترك من هنا: {{6}}",
  trial_ended:
    "{{1}}، تجربتك المجانية خلصت، ومحفظتك وبياناتك محفوظة زي ما هي. عرض الاشتراك بخصم {{2}}٪ لسه شغال لحد {{3}}: {{4}}",
  paid_welcome: "أهلاً بيك في {{2}} يا {{1}} 🎉 اشتراكك اتفعّل لحد {{3}}. كل المزايا مفتوحة دلوقتي — ابدأ من هنا: {{4}}",
  survey: "{{1}}، جربت EGXpert ومكمّلتش، ويهمنا نعرف ليه عشان نحسّن. اختار سبب واحد: السعر · مش محتاجه دلوقتي · فيه حاجة ناقصة",
  renewal: "{{1}}، وحشتنا! من آخر مرة ضفنا: {{2}}. جدّد {{3}} بخصم {{4}}٪ (بـ {{5}} جنيه) لحد {{6}}: {{7}}",
};

const arDate = new Intl.DateTimeFormat("ar-EG", { day: "numeric", month: "long", timeZone: "Africa/Cairo" });
const DAY_MS = 24 * 60 * 60 * 1000;

/** The final text with sample values, in the same order render.js fills them. */
export function previewText(key: string, params: StepParams, plans: WhatsappStepsResponse["plans"], now = new Date()): string {
  const plan = params.plan ? plans[params.plan] : undefined;
  const pct = params.discountPct ?? 0;
  const price = plan ? String(Math.round(plan.priceEgp * (1 - pct / 100))) : "—";
  const until = arDate.format(new Date(now.getTime() + (params.validDays ?? 0) * DAY_MS));
  const app = "egxpert.com";
  const values: Record<string, string[]> = {
    trial_welcome: ["أحمد", "5", `${app}/portfolio`],
    trial_stoploss: ["أحمد", `${app}/portfolio`],
    trial_ending: ["أحمد", plan?.label ?? "—", String(pct), price, until, `${app}/subscribe`],
    trial_ended: ["أحمد", String(pct), until, `${app}/subscribe`],
    paid_welcome: ["أحمد", "النفس الطويل", arDate.format(new Date(now.getTime() + 30 * DAY_MS)), `${app}/portfolio`],
    survey: ["أحمد"],
    renewal: ["أحمد", params.whatsNew || "—", plan?.label ?? "—", String(pct), price, until, `${app}/subscribe`],
  };
  return (DRAFTS[key] ?? "").replace(/\{\{(\d+)\}\}/g, (_, n: string) => values[key]?.[Number(n) - 1] ?? "");
}

export function WhatsappTab() {
  const [data, setData] = useState<WhatsappStepsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await api<WhatsappStepsResponse>("/api/admin/whatsapp/steps"));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "تعذر التحميل");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorState message={error} action={<Button onClick={() => void load()}>جرّب تاني</Button>} />;
  if (!data) return <LoadingBlock rows={4} />;

  return (
    <div className="space-y-4">
      {!data.liveSending && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-[13px]">
          وضع التجربة: الرسايل بتروح للأرقام المسموح بيها بس.
        </p>
      )}
      <p className="text-[13px] text-muted-foreground">
        نص كل رسالة بيتعدل من WhatsApp Manager عند Meta وبيحتاج موافقة تانية. هنا بتشغّل الخطوة، وتختار اسم القالب، وتعدّل قيم العرض. المعاينة بالنص المقترح.
      </p>
      {data.steps.map((step) => (
        <StepCard key={step.key} step={step} plans={data.plans} surveyAnswers={step.key === "survey" ? data.surveyAnswers : null} />
      ))}
    </div>
  );
}

function StepCard({
  step,
  plans,
  surveyAnswers,
}: {
  step: WhatsappStep;
  plans: WhatsappStepsResponse["plans"];
  surveyAnswers: WhatsappStepsResponse["surveyAnswers"] | null;
}) {
  const [enabled, setEnabled] = useState(step.enabled);
  const [templateName, setTemplateName] = useState(step.templateName);
  const [params, setParams] = useState<StepParams>(step.params);
  const [saving, setSaving] = useState(false);
  const title = STEP_TITLE[step.key] ?? step.key;
  const hasOffer = "discountPct" in step.params;
  const id = (field: string) => `wa-${step.key}-${field}`;
  const setNumber = (field: "discountPct" | "validDays") => (value: string) =>
    setParams((previous) => ({ ...previous, [field]: Number(value) }));

  const save = async () => {
    setSaving(true);
    try {
      await put(`/api/admin/whatsapp/steps/${step.key}`, { enabled, templateName, params });
      toast.success(`اتحفظت خطوة «${title}»`);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر الحفظ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section aria-label={title}>
      <Panel
        title={title}
        description={`آخر ٣٠ يوم: ${step.counts.sent} ${STATUS_LABEL["sent"]} · ${step.counts.delivered} ${STATUS_LABEL["delivered"]} · ${step.counts.read} ${STATUS_LABEL["read"]} · ${step.counts.failed} ${STATUS_LABEL["failed"]}`}
        action={
          <div className="flex items-center gap-2">
            <Label htmlFor={id("enabled")}>{enabled ? "شغّالة" : "متوقفة"}</Label>
            <Switch id={id("enabled")} checked={enabled} onCheckedChange={setEnabled} />
          </div>
        }
      >
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={id("template")}>اسم القالب في Meta</Label>
              <Input id={id("template")} dir="ltr" value={templateName} onChange={(e) => setTemplateName(e.target.value)} />
            </div>
            {hasOffer && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor={id("pct")}>نسبة الخصم ٪</Label>
                  <Input id={id("pct")} type="number" min={0} max={90} value={params.discountPct ?? 0} onChange={(e) => setNumber("discountPct")(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={id("days")}>العرض سارِ كام يوم</Label>
                  <Input id={id("days")} type="number" min={1} max={30} value={params.validDays ?? 1} onChange={(e) => setNumber("validDays")(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={id("plan")}>الباقة</Label>
                  <select
                    id={id("plan")}
                    className="h-9 w-full rounded-md border bg-background px-2 text-[14px]"
                    value={params.plan ?? ""}
                    onChange={(e) => setParams((previous) => ({ ...previous, plan: e.target.value }))}
                  >
                    {Object.entries(plans).map(([key, plan]) => (
                      <option key={key} value={key}>
                        {plan.label} ({plan.priceEgp} جنيه)
                      </option>
                    ))}
                  </select>
                </div>
              </>
            )}
            {"whatsNew" in step.params && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor={id("new")}>الجديد من آخر مرة</Label>
                <Input id={id("new")} maxLength={200} value={params.whatsNew ?? ""} onChange={(e) => setParams((previous) => ({ ...previous, whatsNew: e.target.value }))} />
              </div>
            )}
          </div>
          <div className="rounded-lg bg-muted/50 p-3 text-[13px] leading-relaxed" data-testid="whatsapp-preview">
            {previewText(step.key, params, plans)}
          </div>
          {surveyAnswers && (
            <p className="text-[13px] text-muted-foreground">
              الردود: {surveyAnswers.map((answer) => `${answer.text}: ${answer.count}`).join(" · ")}
            </p>
          )}
          <Button onClick={() => void save()} disabled={saving}>
            {saving && <Spinner />}
            حفظ
          </Button>
        </div>
      </Panel>
    </section>
  );
}
