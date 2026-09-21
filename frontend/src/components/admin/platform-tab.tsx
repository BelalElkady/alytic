import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { api, del, patch, post } from "@/lib/api";
import { ColorField, ColorRows, Field, ImageField, Section } from "./tenant-fields";
import {
  colorsFromRows,
  getIn,
  rowsFromColors,
  setIn,
  splitList,
  textAt,
  type Json,
} from "./tenant-form-utils";

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

/** The plan keys a client can price (see PLANS in backend/src/billing/plans.js). */
const PRICE_FIELDS = [
  { key: "long_monthly", label: "النفس الطويل — شهري" },
  { key: "long_yearly", label: "النفس الطويل — سنوي" },
  { key: "trader_monthly", label: "الحريفة — شهري" },
  { key: "trader_yearly", label: "الحريفة — سنوي" },
] as const;

/** features.blog: "default" leaves the key out, so the site keeps whatever its base setting is. */
type BlogSetting = "default" | "on" | "off";

const listText = (value: unknown) => (Array.isArray(value) ? value.join("\n") : "");

const isEmptyObject = (value: unknown) =>
  value !== null &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.keys(value).length === 0;

/**
 * Blank fields mean "not set": they are dropped, and so are objects left empty
 * by that, so the backend falls back to its defaults (for the main site, its
 * .env) instead of rejecting a blank URL or overriding a default with nothing.
 */
const clean = (value: unknown): unknown => {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== "" && v !== null && v !== undefined)
        .map(([k, v]) => [k, clean(v)] as const)
        .filter(([, v]) => !isEmptyObject(v)),
    );
  }
  return value;
};

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
                <TenantTableRow
                  key={tenant.id}
                  tenant={tenant}
                  onEdit={() => setEditing(tenant)}
                  onDeleted={load}
                />
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

function TenantTableRow({
  tenant,
  onEdit,
  onDeleted,
}: {
  tenant: TenantRow;
  onEdit: () => void;
  onDeleted: () => void;
}) {
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
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={onEdit}>
            تعديل
          </Button>
          {!tenant.isDefault && <DeleteTenantButton tenant={tenant} onDeleted={onDeleted} />}
        </div>
      </TableCell>
    </TableRow>
  );
}

/**
 * Removes a client from the platform after an explicit "are you sure". The
 * message says what goes and what stays, because the one thing that can't be
 * undone from here is the stored database key.
 */
function DeleteTenantButton({ tenant, onDeleted }: { tenant: TenantRow; onDeleted: () => void }) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await del(
        `/api/platform/tenants/${encodeURIComponent(tenant.id)}?confirm=${encodeURIComponent(tenant.id)}`,
      );
      toast.success(`تم حذف ${tenant.name}`);
      setOpen(false);
      onDeleted();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر حذف العميل");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={(next) => !deleting && setOpen(next)}>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-down"
          aria-label={`حذف ${tenant.name}`}
        >
          <Trash2 className="size-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader className="text-start">
          <AlertDialogTitle>متأكد إنك عايز تحذف «{tenant.name}»؟</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 leading-relaxed">
              <p>
                الموقع {tenant.domains.length ? `(${tenant.domains.join("، ")}) ` : ""}هيقف فورًا،
                ومستخدمينه مش هيعرفوا يدخلوا.
              </p>
              <p>
                بيانات العميل (مستخدمين، محافظ، اشتراكات) هتفضل زي ما هي في مشروع Supabase بتاعه —
                مش هتتمسح. لكن مفتاح قاعدة البيانات المحفوظ هنا هيتمسح، فلو رجّعت العميل بعدين
                هتضيفه من جديد بنفس رابط المشروع والمفتاح.
              </p>
              <p className="font-medium text-down">مش هينفع التراجع بعد الحذف.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:justify-start">
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              void handleDelete();
            }}
            disabled={deleting}
            className="bg-down text-white hover:bg-down/90"
          >
            {deleting ? <Spinner /> : <Trash2 className="size-4" />}
            نعم، احذف
          </AlertDialogAction>
          <AlertDialogCancel disabled={deleting}>إلغاء</AlertDialogCancel>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function TenantForm({ tenant, onSaved }: { tenant: TenantRow | null; onSaved: () => void }) {
  const isNew = tenant === null;
  const [id, setId] = useState("");
  const [name, setName] = useState(tenant?.name ?? "");
  const [domains, setDomains] = useState((tenant?.domains ?? []).join(", "));
  const [supabaseUrl, setSupabaseUrl] = useState(tenant?.supabaseUrl ?? "");
  const [supabaseKey, setSupabaseKey] = useState("");
  // What the site has stored (or the template, for a new one). Fields the form
  // has no input for — a color name it doesn't know, an extra price key —
  // ride along untouched in these objects instead of being lost on save.
  const [initialBrand] = useState<Json>(() => structuredClone(tenant?.brand ?? BRAND_TEMPLATE));
  const [initialConfig] = useState<Json>(() => structuredClone(tenant?.config ?? CONFIG_TEMPLATE));
  const [brand, setBrand] = useState<Json>(initialBrand);
  const [config, setConfig] = useState<Json>(initialConfig);
  const [lightColors, setLightColors] = useState(() => rowsFromColors(initialBrand.colors));
  const [darkColors, setDarkColors] = useState(() => rowsFromColors(initialBrand.darkColors));
  const [adminEmails, setAdminEmails] = useState(() => listText(initialConfig.adminEmails));
  const [marketerEmails, setMarketerEmails] = useState(() =>
    listText(initialConfig.marketerEmails),
  );
  const [prices, setPrices] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      PRICE_FIELDS.map(({ key }) => [key, textAt(initialConfig, ["prices", key])]),
    ),
  );
  const [blog, setBlog] = useState<BlogSetting>(() => {
    const value = getIn(initialConfig, ["features", "blog"]);
    return value === true ? "on" : value === false ? "off" : "default";
  });
  const [notes, setNotes] = useState(tenant?.notes ?? "");
  const [saving, setSaving] = useState(false);

  const b = (...path: string[]) => textAt(brand, path);
  const c = (...path: string[]) => textAt(config, path);
  const setB = (path: string[], value: string) => setBrand((prev) => setIn(prev, path, value));
  const setC = (path: string[], value: string) => setConfig((prev) => setIn(prev, path, value));

  /** Puts the form's own state back into the two objects the backend expects. */
  const buildBody = () => {
    const brandOut: Json = {
      ...brand,
      colors: colorsFromRows(lightColors),
      darkColors: colorsFromRows(darkColors),
    };

    const configOut: Json = { ...config };
    // A list goes out when it has entries, or when the site already stored one
    // (an explicit "nobody"). Otherwise it stays unset so the site's default
    // applies — for the main site that is ADMIN_EMAILS / MARKETER_EMAILS in .env.
    for (const [key, text] of [
      ["adminEmails", adminEmails],
      ["marketerEmails", marketerEmails],
    ] as const) {
      const list = splitList(text);
      if (list.length || key in initialConfig) configOut[key] = list;
      else delete configOut[key];
    }

    const priceOut: Json = { ...(getIn(initialConfig, ["prices"]) as Json | undefined) };
    for (const { key, label } of PRICE_FIELDS) {
      const text = prices[key].trim();
      if (!text) {
        delete priceOut[key];
        continue;
      }
      const price = Number(text);
      if (!Number.isFinite(price) || price < 0) throw new Error(`سعر ${label} لازم يكون رقم`);
      priceOut[key] = price;
    }
    configOut.prices = priceOut;

    const features: Json = { ...(getIn(initialConfig, ["features"]) as Json | undefined) };
    if (blog === "default") delete features.blog;
    else features.blog = blog === "on";
    configOut.features = features;

    return { brand: clean(brandOut), config: clean(configOut) };
  };

  const save = async (extra: Record<string, unknown> = {}) => {
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        name,
        ...buildBody(),
        notes,
        ...extra,
      };
      if (!tenant?.isDefault) body.domains = splitList(domains);
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
          الأسعار بالجنيه. الألوان بتتختار من اللوحة أو بتتكتب (oklch أو hex). أي حقل فاضي بياخد
          القيمة الافتراضية.
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

        <Section title="الهوية">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="اسم العلامة (بيظهر في الموقع)">
              <Input value={b("name")} onChange={(e) => setB(["name"], e.target.value)} />
            </Field>
            <Field label="الشعار اللفظي (tagline)">
              <Input value={b("tagline")} onChange={(e) => setB(["tagline"], e.target.value)} />
            </Field>
          </div>
          <Field label="وصف الموقع (للبحث والمشاركة)">
            <Textarea
              rows={2}
              value={b("description")}
              onChange={(e) => setB(["description"], e.target.value)}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <ImageField
              label="الشعار"
              hint="ارفع صورة (PNG أو JPEG أو WebP أو SVG لحد 2 ميجا) أو اكتب رابط https أو مسار يبدأ بـ /"
              kind="logo"
              value={b("logoUrl")}
              onChange={(next) => setB(["logoUrl"], next)}
              placeholder="https://…/logo.svg"
            />
            <ImageField
              label="الأيقونة (favicon)"
              hint="مربعة يفضّل — PNG أو SVG. أو اكتب رابط https أو مسار يبدأ بـ /"
              kind="favicon"
              value={b("faviconUrl")}
              onChange={(next) => setB(["faviconUrl"], next)}
              placeholder="https://…/favicon.svg"
            />
          </div>
        </Section>

        <Section title="الألوان">
          <Field
            label="لون الإيميلات"
            hint="hex بس (زي #1d4ed8) — لون الأزرار والعنوان في الإيميلات."
          >
            <ColorField
              label="لون الإيميلات"
              value={b("emailColor")}
              onChange={(next) => setB(["emailColor"], next)}
              placeholder="#1d4ed8"
            />
          </Field>
          <ColorRows
            title="ألوان الموقع — الوضع الفاتح"
            rows={lightColors}
            onChange={setLightColors}
            datalistId="tenant-color-names-light"
          />
          <ColorRows
            title="ألوان الموقع — الوضع الداكن"
            rows={darkColors}
            onChange={setDarkColors}
            datalistId="tenant-color-names-dark"
          />
        </Section>

        <Section title="التتبع والسوشيال">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Google Analytics ID">
              <Input
                dir="ltr"
                value={b("analytics", "gaId")}
                onChange={(e) => setB(["analytics", "gaId"], e.target.value)}
                placeholder="G-XXXXXXXXXX"
              />
            </Field>
            <Field label="AdSense client">
              <Input
                dir="ltr"
                value={b("analytics", "adsClient")}
                onChange={(e) => setB(["analytics", "adsClient"], e.target.value)}
                placeholder="ca-pub-0000000000000000"
              />
            </Field>
            {(
              [
                ["instagram", "Instagram"],
                ["facebook", "Facebook"],
                ["x", "X (Twitter)"],
                ["youtube", "YouTube"],
                ["tiktok", "TikTok"],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={label}>
                <Input
                  dir="ltr"
                  value={b("social", key)}
                  onChange={(e) => setB(["social", key], e.target.value)}
                  placeholder="https://…"
                />
              </Field>
            ))}
          </div>
        </Section>

        <Section title="الإيميل والتواصل">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="بيبعت الإيميل باسم (emailFrom)" hint="بالشكل: Name <no-reply@domain.com>">
              <Input
                dir="ltr"
                value={c("emailFrom")}
                onChange={(e) => setC(["emailFrom"], e.target.value)}
                placeholder="Client X <no-reply@clientx.com>"
              />
            </Field>
            <Field label="إيميل التواصل (contactEmail)">
              <Input
                dir="ltr"
                type="email"
                value={c("contactEmail")}
                onChange={(e) => setC(["contactEmail"], e.target.value)}
              />
            </Field>
            <Field label="إيميل تنبيهات الدعم (supportNotifyEmail)">
              <Input
                dir="ltr"
                type="email"
                value={c("supportNotifyEmail")}
                onChange={(e) => setC(["supportNotifyEmail"], e.target.value)}
              />
            </Field>
            <Field label="Google Client ID (اختياري)">
              <Input
                dir="ltr"
                value={c("googleClientId")}
                onChange={(e) => setC(["googleClientId"], e.target.value)}
                placeholder="…apps.googleusercontent.com"
              />
            </Field>
          </div>
        </Section>

        <Section title="الصلاحيات">
          <Field
            label="إيميلات المشرفين (adminEmails)"
            hint="بيتحولوا لمشرفين أول ما يسجلوا. افصل بينهم بفاصلة أو سطر جديد."
          >
            <Textarea
              dir="ltr"
              rows={2}
              value={adminEmails}
              onChange={(e) => setAdminEmails(e.target.value)}
              placeholder="owner@clientx.com"
            />
          </Field>
          <Field
            label="إيميلات المسوّقين (marketerEmails)"
            hint="بيشوفوا جدول المستخدمين بس، للقراءة فقط."
          >
            <Textarea
              dir="ltr"
              rows={2}
              value={marketerEmails}
              onChange={(e) => setMarketerEmails(e.target.value)}
              placeholder="marketing@clientx.com"
            />
          </Field>
        </Section>

        <Section title="الدفع والأسعار">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="حساب InstaPay">
              <Input
                dir="ltr"
                value={c("instapay", "address")}
                onChange={(e) => setC(["instapay", "address"], e.target.value)}
                placeholder="name@instapay"
              />
            </Field>
            <Field label="اسم صاحب الحساب">
              <Input
                value={c("instapay", "accountName")}
                onChange={(e) => setC(["instapay", "accountName"], e.target.value)}
              />
            </Field>
            {PRICE_FIELDS.map(({ key, label }) => (
              <Field key={key} label={`${label} (جنيه)`}>
                <Input
                  dir="ltr"
                  type="number"
                  min={0}
                  inputMode="decimal"
                  value={prices[key]}
                  onChange={(e) => setPrices((prev) => ({ ...prev, [key]: e.target.value }))}
                />
              </Field>
            ))}
          </div>
        </Section>

        <Section title="المزايا">
          <Field label="المدونة" hint="كل مقالة بتتولّد بتتحسب تشغيلة AI مدفوعة.">
            <Select value={blog} onValueChange={(value) => setBlog(value as BlogSetting)}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">الافتراضي</SelectItem>
                <SelectItem value="on">شغّالة</SelectItem>
                <SelectItem value="off">مقفولة</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </Section>

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
