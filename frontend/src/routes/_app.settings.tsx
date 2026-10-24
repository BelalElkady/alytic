import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Notice, Panel, Spinner } from "@/components/desk/state-blocks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { post } from "@/lib/api";
import {
  INVEST_STYLES,
  setInvestStyle,
  useActiveInvestStyle,
  type StyleKey,
} from "@/lib/invest-style";
import { siteUrl, siteName } from "@/lib/seo";
import { useDesk } from "@/lib/store";

export const Route = createFileRoute("/_app/settings")({
  head: ({ match }) => ({
    meta: [
      { title: `الملف الشخصي والإعدادات — ${siteName(match)}` },
      {
        name: "description",
        content: "بياناتك، رصيدك من كل ميزة، وسلوكك الاستثماري.",
      },
      { property: "og:title", content: `الملف الشخصي والإعدادات — ${siteName(match)}` },
      {
        property: "og:description",
        content: "بياناتك، رصيدك من كل ميزة، وسلوكك الاستثماري.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:url", content: `${siteUrl(match)}/settings` },
    ],
  }),
  component: SettingsPage,
});

const TIER_LABEL: Record<string, string> = {
  free: "الباقة المجانية",
  long: "باقة النفس الطويل",
  trader: "باقة الحريفة",
};

/** Editable "بياناتك" row: shows the current value, only exposes an input + save once "تعديل" is pressed. */
function ProfileField({
  label,
  value,
  placeholder,
  ltr,
  onSave,
}: {
  label: string;
  value: string;
  placeholder?: string;
  /** Left-to-right value (a phone number): in an RTL page its leading "+" would otherwise jump to the far end. */
  ltr?: boolean;
  onSave: (next: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const save = async () => {
    setBusy(true);
    try {
      await onSave(draft.trim());
      setEditing(false);
      toast.success(`تم تحديث ${label}`);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر الحفظ");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {editing ? (
        <div className="flex flex-wrap gap-2">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={placeholder}
            dir={ltr ? "ltr" : undefined}
            className="max-w-xs"
            autoFocus
          />
          <Button size="sm" onClick={() => void save()} disabled={busy || !draft.trim()}>
            {busy && <Spinner />}
            حفظ
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setDraft(value);
              setEditing(false);
            }}
            disabled={busy}
          >
            إلغاء
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="text-[14px]" dir={ltr && value ? "ltr" : undefined}>
            {value || "—"}
          </span>
          <Button size="sm" variant="outline" className="h-7 px-2 text-[12px]" onClick={() => setEditing(true)}>
            تعديل
          </Button>
        </div>
      )}
    </div>
  );
}

/** One row of "رصيدك": this month's allowance left/total for one metered feature, plus any admin-granted extra credits. */
function CreditRow({
  label,
  left,
  perMonth,
  credit,
}: {
  label: string;
  left: number | null;
  perMonth: number | null;
  credit: number;
}) {
  if (left === null) return null;
  return (
    <div className="flex items-center justify-between border-b py-2 text-[13px] last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="num font-semibold">
        باقي {left}
        {perMonth ? ` من ${perMonth}` : ""}
        {credit > 0 ? ` (+${credit} رصيد إضافي)` : ""}
      </span>
    </div>
  );
}

function SettingsPage() {
  const { reload, pf, user, updateName, updatePhone, setWhatsappEnabled } = useDesk();
  const [savingWhatsapp, setSavingWhatsapp] = useState(false);

  const chooseWhatsapp = async (next: boolean) => {
    setSavingWhatsapp(true);
    try {
      await setWhatsappEnabled(next);
      toast.success(next ? "هنبعتلك رسايل واتساب تاني" : "مش هنبعتلك رسايل واتساب");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر الحفظ");
    } finally {
      setSavingWhatsapp(false);
    }
  };
  const [armed, setArmed] = useState(false);
  const [resetting, setResetting] = useState(false);
  const { style, inferred } = useActiveInvestStyle(pf?.trades);

  const chooseStyle = (next: StyleKey) => {
    setInvestStyle(next);
    void post("/api/settings/style", { style: next }).catch(() => {});
    toast.success(`تم تفعيل قواعد ${INVEST_STYLES.find((item) => item.key === next)!.label}`);
  };

  // Unset means Shariah-only: that is how the app has always recommended.
  const shariahOnly = pf?.settings?.shariahOnly !== false;
  const [savingShariah, setSavingShariah] = useState(false);

  const chooseShariah = async (next: boolean) => {
    if (next === shariahOnly) return;
    setSavingShariah(true);
    try {
      await post("/api/settings/shariah", { shariahOnly: next });
      await reload();
      toast.success(next ? "التوصيات هتبقى للأسهم المتوافقة مع الشريعة بس" : "التوصيات هتشمل كل الأسهم");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر الحفظ");
    } finally {
      setSavingShariah(false);
    }
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

  const tier = typeof pf?.tier === "string" ? pf.tier : null;
  const credits = pf?.credits ?? {};

  return (
    <div className="space-y-4">
      <Panel title="بياناتك" description="بيانات حسابك — عدّل اللي محتاج يتغيّر منها.">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>البريد الإلكتروني</Label>
            <p className="text-[14px] text-muted-foreground">{user?.email}</p>
          </div>
          <ProfileField label="الاسم" value={user?.name ?? ""} onSave={updateName} />
          <ProfileField
            label="رقم الموبايل"
            value={user?.phone ?? ""}
            placeholder="+20 10 1234 5678"
            ltr
            onSave={updatePhone}
          />
        </div>
      </Panel>

      <Panel title="رسايل واتساب" description="نصايح وتنبيهات عن حسابك وتجربتك والعروض. بتوصلك على الرقم المسجّل.">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="whatsapp-messages">ابعتولي رسايل واتساب</Label>
          <Switch
            id="whatsapp-messages"
            checked={user?.whatsappEnabled !== false}
            disabled={savingWhatsapp}
            onCheckedChange={(next) => void chooseWhatsapp(next)}
          />
        </div>
      </Panel>

      <Panel
        title="رصيدك"
        description="رصيد كل ميزة — بيتجدد أول كل شهر ميلادي، وأي رصيد إضافي اشتريته بيتضاف فوقه."
      >
        {tier && (
          <Badge variant="outline" className="mb-3">
            {TIER_LABEL[tier] ?? tier}
          </Badge>
        )}
        <div>
          <CreditRow
            label="رفع سكرين شوت للمحفظة"
            left={pf?.screenshotImportsLeft ?? null}
            perMonth={pf?.screenshotsPerMonth ?? null}
            credit={credits.screenshots ?? 0}
          />
          <CreditRow
            label="توصيات الأسهم"
            left={pf?.recommendationsLeft ?? null}
            perMonth={pf?.recommendationsPerMonth ?? null}
            credit={credits.recommendations ?? 0}
          />
          <CreditRow
            label="تحليل استخدام الكاش"
            left={pf?.cashScansLeft ?? null}
            perMonth={pf?.cashScansPerMonth ?? null}
            credit={credits.cashScans ?? 0}
          />
          <CreditRow
            label="تحليل السوق"
            left={pf?.marketAnalysisLeft ?? null}
            perMonth={pf?.marketAnalysisPerMonth ?? null}
            credit={credits.marketAnalysis ?? 0}
          />
        </div>
      </Panel>

      <Panel
        title="اختار سلوكك الاستثماري لتحديد قواعد التوصيات"
        description="الاختيار بيغيّر قواعد التوصيات وتوصية كل سهم في صفحة المراكز فورًا."
      >
        {/* The choice itself is mandatory (see RequireInvestStyleDialog), so there is no "back to auto" —
            the trade-history reading is only offered as a hint next to the pick. */}
        {inferred && inferred !== style && (
          <Notice tone="info" className="mb-3">
            صفقاتك السابقة بتشير لأسلوب {INVEST_STYLES.find((item) => item.key === inferred)!.label}،
            بس اختيارك أنت هو اللي بيحدد القواعد.
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
        title="التوافق مع الشريعة"
        description="اختار الأسهم اللي تحب توصيات الشراء الجديدة (خطة الكاش وتحليل السوق) تشملها."
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {[
            { value: true, label: "متوافقة مع الشريعة بس", hint: "الأسهم غير المتوافقة مش بتتقترح للشراء" },
            { value: false, label: "كل الأسهم", hint: "بتشمل غير المتوافقة، وشارة الشريعة بتفضل ظاهرة" },
          ].map((item) => {
            const active = item.value === shariahOnly;
            return (
              <button
                key={String(item.value)}
                type="button"
                disabled={savingShariah}
                onClick={() => void chooseShariah(item.value)}
                aria-pressed={active}
                className={`rounded-lg border px-4 py-3 text-center transition-colors ${
                  active
                    ? "border-primary bg-primary/10 ring-1 ring-primary"
                    : "border-border bg-surface hover:bg-muted"
                }`}
              >
                <div className="text-[14px] font-semibold">{item.label}</div>
                <div className="mt-0.5 text-[12px] text-muted-foreground">{item.hint}</div>
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">
          أسهمك الحالية بتفضل متابَعة بالكامل في الحالتين. تحليل السوق اليومي المشترك بيتحدد بشكل
          عام، فممكن يظهر فيه سهم غير متوافق حتى لو اخترت المتوافقة بس.
        </p>
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
