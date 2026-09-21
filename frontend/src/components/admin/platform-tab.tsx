import { useCallback, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import {
  EmptyState,
  ErrorState,
  LoadingBlock,
  Notice,
  Spinner,
} from "@/components/desk/state-blocks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api, patch, post } from "@/lib/api";

type TenantRow = {
  id: string;
  name: string;
  status: "active" | "suspended";
  loaded: boolean;
  isDefault: boolean;
  domains: string[];
  appUrl: string | null;
  supabaseUrl: string | null;
  hasDatabaseKey: boolean;
  brand: Record<string, unknown>;
  config: Record<string, unknown>;
  notes: string | null;
};

type Stats = {
  days: number;
  users: number;
  activeSubscriptions: number;
  aiCalls: number;
  aiCostUsd: number;
};

// What a new client's brand/config start as in the form: every field the
// backend reads, so filling one in is editing a value rather than guessing a
// key. See sanitizeBrand / sanitizeConfig in backend/src/api/platform.js.
const BRAND_TEMPLATE = {
  name: "",
  tagline: "",
  description: "",
  logoUrl: "",
  faviconUrl: "",
  emailColor: "#3b82f6",
  colors: { primary: "oklch(0.44 0.11 258)", info: "oklch(0.53 0.16 265)" },
  darkColors: { primary: "oklch(0.72 0.11 240)", info: "oklch(0.72 0.13 262)" },
  analytics: { gaId: "", adsClient: "" },
  social: { instagram: "", facebook: "" },
};
const CONFIG_TEMPLATE = {
  emailFrom: "",
  contactEmail: "",
  supportNotifyEmail: "",
  adminEmails: [],
  instapay: { address: "", accountName: "" },
  googleClientId: "",
  prices: { long_monthly: 299, long_yearly: 2990, trader_monthly: 499, trader_yearly: 4990 },
  features: { blog: false },
};

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

function parseJson(label: string, text: string): Record<string, unknown> {
  try {
    const value = JSON.parse(text || "{}");
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch {
    // Reported below.
  }
  throw new Error(`${label}: JSON مش صحيح`);
}

const splitDomains = (text: string) =>
  text
    .split(/[\s,]+/)
    .map((d) => d.trim())
    .filter(Boolean);

/** The platform owner's view of every white-label site: add one, rebrand it, suspend it, see what it costs. */
export function PlatformTab() {
  const [tenants, setTenants] = useState<TenantRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<TenantRow | "new" | null>(null);

  const load = useCallback(() => {
    api<{ tenants: TenantRow[] }>("/api/platform/tenants")
      .then((result) => {
        setTenants(result.tenants);
        setError(null);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "تعذر تحميل العملاء"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

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
  if (!tenants) return <LoadingBlock rows={3} />;

  return (
    <div className="space-y-4">
      <Notice tone="info">
        كل عميل له موقع بدومينه وشكله، وقاعدة بيانات Supabase خاصة بيه (شغّل فيها
        backend/supabase/schema.sql الأول). بيانات السوق والتقارير مشتركة بين الكل. أدمنز العميل
        بيديروا مستخدمينه واشتراكاته من لوحة الإدارة على دومينه، ومبيشوفوش التبويب ده.
      </Notice>
      <div className="flex justify-end">
        <Button onClick={() => setEditing("new")}>عميل جديد</Button>
      </div>

      {tenants.length === 0 ? (
        <EmptyState title="مفيش عملاء لسه" />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>العميل</TableHead>
                <TableHead>الدومينات</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>آخر 30 يوم</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.map((tenant) => (
                <TenantTableRow key={tenant.id} tenant={tenant} onEdit={() => setEditing(tenant)} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          {editing && (
            <TenantForm
              tenant={editing === "new" ? null : editing}
              onSaved={() => {
                setEditing(null);
                load();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TenantTableRow({ tenant, onEdit }: { tenant: TenantRow; onEdit: () => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(false);

  const loadStats = () => {
    setLoading(true);
    api<Stats>(`/api/platform/tenants/${encodeURIComponent(tenant.id)}/stats?days=30`)
      .then(setStats)
      .catch((caught) =>
        toast.error(caught instanceof Error ? caught.message : "تعذر تحميل الأرقام"),
      )
      .finally(() => setLoading(false));
  };

  return (
    <TableRow>
      <TableCell>
        <div className="font-semibold">{tenant.name}</div>
        <div className="text-[12px] text-muted-foreground" dir="ltr">
          {tenant.id}
          {tenant.isDefault ? " · الموقع الأساسي" : ""}
        </div>
      </TableCell>
      <TableCell dir="ltr" className="text-[12.5px]">
        {tenant.domains.join(", ") || "—"}
      </TableCell>
      <TableCell>
        {!tenant.loaded ? (
          <Badge variant="destructive">مش شغال</Badge>
        ) : tenant.status === "active" ? (
          <Badge variant="outline" className="border-up/50 text-up">
            شغال
          </Badge>
        ) : (
          <Badge variant="outline" className="border-warn/50 text-warn">
            موقوف
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-[12.5px]">
        {stats ? (
          <span className="num">
            {stats.users} مستخدم · {stats.activeSubscriptions} مشترك · ${stats.aiCostUsd} AI
          </span>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={loadStats}
            disabled={loading || !tenant.loaded}
          >
            {loading ? <Spinner /> : "اعرض"}
          </Button>
        )}
      </TableCell>
      <TableCell>
        <Button variant="outline" size="sm" onClick={onEdit}>
          تعديل
        </Button>
      </TableCell>
    </TableRow>
  );
}

function TenantForm({ tenant, onSaved }: { tenant: TenantRow | null; onSaved: () => void }) {
  const isNew = tenant === null;
  const [id, setId] = useState("");
  const [name, setName] = useState(tenant?.name ?? "");
  const [domains, setDomains] = useState((tenant?.domains ?? []).join(", "));
  const [supabaseUrl, setSupabaseUrl] = useState(tenant?.supabaseUrl ?? "");
  const [supabaseKey, setSupabaseKey] = useState("");
  const [brand, setBrand] = useState(pretty(isNew ? BRAND_TEMPLATE : tenant.brand));
  const [config, setConfig] = useState(pretty(isNew ? CONFIG_TEMPLATE : tenant.config));
  const [notes, setNotes] = useState(tenant?.notes ?? "");
  const [saving, setSaving] = useState(false);

  // Empty strings in the templates mean "not set": drop them so the backend
  // falls back to its defaults instead of rejecting a blank URL or email.
  const clean = (value: unknown): unknown => {
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, v]) => v !== "" && v !== null)
          .map(([k, v]) => [k, clean(v)]),
      );
    }
    return value;
  };

  const save = async (extra: Record<string, unknown> = {}) => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name,
        brand: clean(parseJson("brand", brand)),
        config: clean(parseJson("config", config)),
        notes,
        ...extra,
      };
      if (!tenant?.isDefault) body.domains = splitDomains(domains);
      if (supabaseKey) {
        body.supabaseUrl = supabaseUrl;
        body.supabaseServiceKey = supabaseKey;
      }
      if (isNew) await post("/api/platform/tenants", { id, ...body });
      else await patch(`/api/platform/tenants/${encodeURIComponent(tenant.id)}`, body);
      toast.success("اتحفظ");
      onSaved();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر الحفظ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{isNew ? "عميل جديد" : `تعديل ${tenant.name}`}</DialogTitle>
        <DialogDescription>
          الألوان متغيرات CSS زي primary و info (بصيغة oklch أو hex). الأسعار بالجنيه ومفاتيحها نفس
          مفاتيح الباقات. أي حقل فاضي بياخد القيمة الافتراضية.
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-3">
        {isNew && (
          <Field label="المعرّف (إنجليزي صغير، مش بيتغير)">
            <Input
              dir="ltr"
              value={id}
              onChange={(e) => setId(e.target.value)}
              placeholder="clientx"
            />
          </Field>
        )}
        <Field label="الاسم">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {!tenant?.isDefault && (
          <>
            <Field label="الدومينات (أول واحد هو الأساسي)">
              <Input
                dir="ltr"
                value={domains}
                onChange={(e) => setDomains(e.target.value)}
                placeholder="app.clientx.com"
              />
            </Field>
            <Field label="Supabase URL">
              <Input
                dir="ltr"
                value={supabaseUrl}
                onChange={(e) => setSupabaseUrl(e.target.value)}
                placeholder="https://xxxx.supabase.co"
              />
            </Field>
            <Field
              label={
                isNew
                  ? "Supabase service_role key"
                  : "Supabase service_role key (سيبه فاضي لو مش هتغيّره)"
              }
            >
              <Input
                dir="ltr"
                type="password"
                autoComplete="off"
                value={supabaseKey}
                onChange={(e) => setSupabaseKey(e.target.value)}
              />
            </Field>
          </>
        )}
        <Field label="الشكل (brand)">
          <Textarea
            dir="ltr"
            className="min-h-48 font-mono text-[12px]"
            value={brand}
            onChange={(e) => setBrand(e.target.value)}
          />
        </Field>
        <Field label="الإعدادات (config)">
          <Textarea
            dir="ltr"
            className="min-h-48 font-mono text-[12px]"
            value={config}
            onChange={(e) => setConfig(e.target.value)}
          />
        </Field>
        <Field label="ملاحظات">
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <div className="flex flex-wrap justify-between gap-2 pt-2">
          <Button onClick={() => save()} disabled={saving}>
            {saving ? <Spinner /> : "حفظ"}
          </Button>
          {!isNew && !tenant.isDefault && (
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => save({ status: tenant.status === "active" ? "suspended" : "active" })}
            >
              {tenant.status === "active" ? "إيقاف الموقع" : "تشغيل الموقع"}
            </Button>
          )}
        </div>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
