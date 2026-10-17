import { RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { ErrorState, LoadingBlock, Panel, Spinner } from "@/components/desk/state-blocks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api, put } from "@/lib/api";
import {
  CAP_KINDS,
  TIER_KEYS,
  applyEdit,
  capWarnings,
  clearOverride,
  getOverride,
  resolve,
  same,
  tidyLayer,
  valueAt,
  type CapKind,
  type FieldPath,
  type TierKey,
  type TierLayer,
  type TierSettings,
} from "./tiers-utils";

type LockableItem = { key: string; label: string };
type TiersResponse = {
  defaults: Record<TierKey, TierSettings>;
  global: TierLayer;
  sites: { id: string; name: string; isDefault: boolean; overrides: TierLayer }[];
  lockable: { pages: LockableItem[]; panels: LockableItem[] };
  limits: {
    cap: { min: number; max: number };
    portfolios: { min: number; max: number };
    name: number;
    note: number;
    bullets: number;
    bullet: number;
  };
};

const GLOBAL = "__global__";

const CAP_LABEL: Record<CapKind, string> = {
  screenshots: "رفع سكرين شوت / شهر",
  recommendations: "توصيات الأسهم / شهر",
  cashScans: "تحليل الكاش / شهر",
  marketAnalysis: "تحليل السوق / شهر",
};

/** An integer field that keeps what is being typed, and only passes a value up once it is a valid one. */
function NumberField({
  value,
  min,
  max,
  onCommit,
  label,
}: {
  value: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
  label: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const parsed = Number(text);
  const valid = text.trim() !== "" && Number.isInteger(parsed) && parsed >= min && parsed <= max;
  return (
    <Input
      aria-label={label}
      inputMode="numeric"
      dir="ltr"
      className="num h-8 w-24 text-right"
      value={text}
      aria-invalid={!valid}
      onChange={(event) => {
        setText(event.target.value);
        const next = Number(event.target.value);
        if (event.target.value.trim() !== "" && Number.isInteger(next) && next >= min && next <= max) {
          onCommit(next);
        }
      }}
    />
  );
}

export function TiersTab() {
  const [data, setData] = useState<TiersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState(GLOBAL);
  const [draft, setDraft] = useState<TierLayer>({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setError(null);
    api("/api/platform/tiers")
      .then((result: TiersResponse) => setData(result))
      .catch((caught) => setError(caught?.message ?? "تعذر تحميل إعدادات الباقات"));
  }, []);
  useEffect(load, [load]);

  const site = data?.sites.find((s) => s.id === scope) ?? null;
  const isGlobal = scope === GLOBAL || !site;
  // What is stored for this scope right now — the draft is compared against it.
  const saved: TierLayer = useMemo(
    () => (data ? (isGlobal ? data.global : (site?.overrides ?? {})) : {}),
    [data, isGlobal, site],
  );
  // The editor starts from what is stored whenever the scope or the data changes.
  useEffect(() => setDraft(saved), [saved]);

  if (error) {
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
  }
  if (!data) return <LoadingBlock rows={6} />;

  // What each field would be without this scope's own edits: the built-in
  // defaults for the platform-wide settings, those plus them for a site.
  const baseline = resolve(data.defaults, isGlobal ? null : data.global);
  const effective = resolve(data.defaults, isGlobal ? null : data.global, draft);
  const dirty = !same(tidyLayer(draft), saved);
  const warnings = capWarnings(effective);

  const edit = (tier: TierKey, path: FieldPath, value: unknown) =>
    setDraft((current) => applyEdit(current, tier, path, value, valueAt(baseline[tier], path)));
  const reset = (tier: TierKey, path: FieldPath) =>
    setDraft((current) => clearOverride(current, tier, path));

  const save = async () => {
    setSaving(true);
    try {
      const body = { tiers: tidyLayer(draft) };
      if (isGlobal) await put("/api/platform/tiers", body);
      else await put(`/api/platform/tenants/${scope}/tiers`, body);
      toast.success(isGlobal ? "اتحفظت الإعدادات العامة" : `اتحفظت إعدادات ${site?.name}`);
      load();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر الحفظ");
    } finally {
      setSaving(false);
    }
  };

  /** The row's label, a "معدّل" badge while this scope overrides it, and the way back to inherited. */
  const FieldHead = ({ tier, path, label }: { tier: TierKey; path: FieldPath; label: string }) => {
    const overridden = getOverride(draft, tier, path) !== undefined;
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="text-[12.5px] text-muted-foreground">{label}</span>
        {overridden && (
          <button
            type="button"
            onClick={() => reset(tier, path)}
            className="flex items-center gap-1 text-[11.5px] text-primary hover:underline"
          >
            <RotateCcw className="size-3" />
            {isGlobal ? "رجوع للأصلي" : "رجوع للافتراضي"}
          </button>
        )}
      </div>
    );
  };

  const toggleLock = (tier: TierKey, group: "pages" | "panels", key: string, locked: boolean) => {
    const current = effective[tier].locked[group];
    const next = locked ? [...new Set([...current, key])] : current.filter((k) => k !== key);
    edit(tier, ["locked", group], next);
  };

  return (
    <div className="space-y-4">
      <Panel
        title="الباقات"
        description="الحدود الشهرية وعدد المحافظ وإقفال الصفحات واللوحات ونص كارت الأسعار لكل باقة. الإعدادات العامة بتنطبق على كل المواقع، وأي موقع ممكن يعدّل فوقها."
        action={
          <Button onClick={save} disabled={!dirty || saving} size="sm">
            {saving ? <Spinner /> : "حفظ"}
          </Button>
        }
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[13px] font-medium">تعديل:</span>
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={GLOBAL}>الإعدادات العامة (كل المواقع)</SelectItem>
              {data.sites.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name}
                  {s.isDefault ? " (الموقع الأساسي)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!isGlobal && (
            <Badge variant="secondary">
              الحقول الباهتة موروثة من الإعدادات العامة — عدّل أي حقل عشان يبقى خاص بالموقع ده
            </Badge>
          )}
        </div>
        {dirty && <p className="mt-3 text-[12.5px] text-amber-600">فيه تعديلات لسه متحفظتش.</p>}
        {warnings.length > 0 && (
          <ul className="mt-3 space-y-0.5 text-[12.5px] text-amber-600">
            {warnings.map((line) => (
              <li key={line}>⚠ {line}</li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-3">
        {TIER_KEYS.map((tier) => {
          const t = effective[tier];
          return (
            <Panel key={tier} title={t.card.name} description={tier}>
              <div className="space-y-5">
                <section className="space-y-2.5">
                  <h4 className="text-[13px] font-semibold">الحدود</h4>
                  {CAP_KINDS.map((kind) => (
                    <div key={kind} className="space-y-1">
                      <FieldHead tier={tier} path={["caps", kind]} label={CAP_LABEL[kind]} />
                      <NumberField
                        label={`${t.card.name} — ${CAP_LABEL[kind]}`}
                        value={t.caps[kind]}
                        min={data.limits.cap.min}
                        max={data.limits.cap.max}
                        onCommit={(value) => edit(tier, ["caps", kind], value)}
                      />
                    </div>
                  ))}
                  <div className="space-y-1">
                    <FieldHead tier={tier} path={["portfolios"]} label="عدد المحافظ" />
                    <NumberField
                      label={`${t.card.name} — عدد المحافظ`}
                      value={t.portfolios}
                      min={data.limits.portfolios.min}
                      max={data.limits.portfolios.max}
                      onCommit={(value) => edit(tier, ["portfolios"], value)}
                    />
                  </div>
                  <p className="text-[11.5px] text-muted-foreground">
                    صفر في أي حد = الميزة مقفولة على الباقة دي (الرصيد الإضافي المشترى لسه شغال).
                  </p>
                </section>

                {(["pages", "panels"] as const).map((group) => (
                  <section key={group} className="space-y-2">
                    <FieldHead
                      tier={tier}
                      path={["locked", group]}
                      label={group === "pages" ? "صفحات مقفولة" : "لوحات مقفولة"}
                    />
                    <div className="space-y-1.5">
                      {data.lockable[group].map((item) => {
                        const id = `${tier}-${group}-${item.key}`;
                        return (
                          <label key={id} htmlFor={id} className="flex items-center gap-2 text-[13px]">
                            <Checkbox
                              id={id}
                              checked={t.locked[group].includes(item.key)}
                              onCheckedChange={(checked) =>
                                toggleLock(tier, group, item.key, checked === true)
                              }
                            />
                            {item.label}
                          </label>
                        );
                      })}
                    </div>
                  </section>
                ))}

                <section className="space-y-2.5">
                  <h4 className="text-[13px] font-semibold">كارت الأسعار</h4>
                  <div className="space-y-1">
                    <FieldHead tier={tier} path={["card", "name"]} label="اسم الباقة" />
                    <Input
                      aria-label={`${t.card.name} — اسم الباقة`}
                      maxLength={data.limits.name}
                      value={t.card.name}
                      onChange={(event) => edit(tier, ["card", "name"], event.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <FieldHead tier={tier} path={["card", "note"]} label="الجملة تحت السعر" />
                    <Textarea
                      aria-label={`${t.card.name} — الجملة تحت السعر`}
                      rows={2}
                      maxLength={data.limits.note}
                      value={t.card.note}
                      onChange={(event) => edit(tier, ["card", "note"], event.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <FieldHead
                      tier={tier}
                      path={["card", "bullets"]}
                      label={`سطور إضافية (سطر لكل مزية، حتى ${data.limits.bullets})`}
                    />
                    <Textarea
                      aria-label={`${t.card.name} — سطور إضافية`}
                      rows={4}
                      value={t.card.bullets.join("\n")}
                      onChange={(event) =>
                        edit(tier, ["card", "bullets"], event.target.value.split("\n"))
                      }
                    />
                  </div>
                </section>
              </div>
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
