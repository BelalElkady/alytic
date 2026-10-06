import { useRef, useState, useEffect } from "react";
import { ImagePlus, Trash2, X } from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ErrorState, LoadingBlock, Panel, Spinner } from "@/components/desk/state-blocks";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, del, post, postRaw } from "@/lib/api";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Renewal-status segments an announcement can target; none ticked means everyone. Mirrors backend/src/announcementAudience.js. */
export type Audience = "trial" | "trial_ending" | "active" | "expired" | "never";

const AUDIENCE_LABEL: Record<Audience, string> = {
  trial: "في التجربة المجانية",
  trial_ending: "تجربتهم على وشك الانتهاء (يومين أو أقل)",
  active: "مشتركين فعالين",
  expired: "اشتراك منتهي",
  never: "لم يشترك (التجربة انتهت)",
};

const AUDIENCES = Object.keys(AUDIENCE_LABEL) as Audience[];

// Pages inside the app the button can send people to; the field also takes any
// other "/path" or https:// link.
const PAGE_SUGGESTIONS: { url: string; label: string }[] = [
  { url: "/subscribe", label: "الاشتراك" },
  { url: "/pricing", label: "الأسعار" },
  { url: "/portfolio", label: "المحفظة" },
  { url: "/cash", label: "تحليل الكاش" },
  { url: "/market", label: "السوق" },
  { url: "/targets", label: "الأهداف" },
  { url: "/track-record", label: "سجل الأداء" },
  { url: "/charts", label: "الرسوم البيانية" },
  { url: "/settings", label: "الإعدادات" },
];

export type Announcement = {
  id: string;
  title: string;
  body: string;
  imageUrls: string[];
  videoUrl: string | null;
  ctaLabel: string | null;
  ctaUrl: string | null;
  audiences: Audience[];
  startsAt: string;
  endsAt: string;
  createdAt: string;
};

type Status = "upcoming" | "active" | "ended";

const statusOf = (row: Announcement): Status => {
  const now = Date.now();
  if (now < Date.parse(row.startsAt)) return "upcoming";
  if (now > Date.parse(row.endsAt)) return "ended";
  return "active";
};

const STATUS_LABEL: Record<Status, string> = { upcoming: "قادم", active: "نشط", ended: "انتهى" };

const STATUS_BADGE_VARIANT: Record<Status, "outline" | "secondary" | "default"> = {
  upcoming: "outline",
  active: "default",
  ended: "secondary",
};

// Egypt is UTC+2 year-round (no DST since 2014), so a date-only picker value
// like "2026-10-03" is converted to an explicit-offset ISO timestamp at the
// Cairo-local start/end of that day before it's sent to the API — otherwise
// Date.parse would read it as UTC midnight, which both collapses a same-day
// start/end into the same instant and cuts the end date short by two hours.
const startOfCairoDay = (date: string) => `${date}T00:00:00+02:00`;
const endOfCairoDay = (date: string) => `${date}T23:59:59.999+02:00`;

const emptyForm = () => ({
  title: "",
  body: "",
  startsAt: "",
  endsAt: "",
  videoUrl: "",
  imageUrls: [] as string[],
  ctaLabel: "",
  ctaUrl: "",
  audiences: [] as Audience[],
});

type Form = ReturnType<typeof emptyForm>;

/** Admin tab for creating, editing and deleting feature-announcement popups. */
export function AnnouncementsTab() {
  const [rows, setRows] = useState<Announcement[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(emptyForm());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = () => {
    api("/api/admin/announcements")
      .then((result) => {
        setRows(result.announcements);
        setError(null);
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "تعذر تحميل التنبيهات"),
      );
  };

  useEffect(() => {
    load();
  }, []);

  const startEdit = (row: Announcement) => {
    setEditingId(row.id);
    setForm({
      title: row.title,
      body: row.body,
      startsAt: row.startsAt.slice(0, 10),
      endsAt: row.endsAt.slice(0, 10),
      videoUrl: row.videoUrl ?? "",
      imageUrls: row.imageUrls,
      ctaLabel: row.ctaLabel ?? "",
      ctaUrl: row.ctaUrl ?? "",
      audiences: row.audiences ?? [],
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(emptyForm());
  };

  const uploadImage = async (file: File) => {
    if (!IMAGE_TYPES.includes(file.type)) {
      toast.error("لازم تكون صورة JPG أو PNG أو WEBP");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error("الصورة كبيرة أوي (الحد ٨ ميجا)");
      return;
    }
    setUploadingImage(true);
    try {
      const { url } = await postRaw<{ url: string }>("/api/admin/announcements/image", file, file.type);
      setForm((f) => ({ ...f, imageUrls: [...f.imageUrls, url] }));
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر رفع الصورة");
    } finally {
      setUploadingImage(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const toggleAudience = (audience: Audience, on: boolean) => {
    setForm((f) => ({
      ...f,
      audiences: on
        ? [...f.audiences.filter((a) => a !== audience), audience]
        : f.audiences.filter((a) => a !== audience),
    }));
  };

  const removeImage = (url: string) => {
    setForm((f) => ({ ...f, imageUrls: f.imageUrls.filter((u) => u !== url) }));
  };

  const validate = (): string | null => {
    if (!form.title.trim()) return "العنوان مطلوب";
    if (!form.body.trim()) return "النص مطلوب";
    if (!form.startsAt) return "تاريخ البدء مطلوب";
    if (!form.endsAt) return "تاريخ الانتهاء مطلوب";
    const ctaUrl = form.ctaUrl.trim();
    if (form.ctaLabel.trim() && !ctaUrl) return "اكتب رابط الزرار";
    if (ctaUrl && !form.ctaLabel.trim()) return "اكتب نص الزرار";
    if (ctaUrl && !/^(\/(?!\/)|https:\/\/)/.test(ctaUrl))
      return "رابط الزرار لازم يبدأ بـ / (صفحة جوه الموقع) أو https://";
    return null;
  };

  const submit = async () => {
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(true);
    const body = {
      title: form.title.trim(),
      body: form.body.trim(),
      imageUrls: form.imageUrls,
      videoUrl: form.videoUrl.trim() || null,
      ctaLabel: form.ctaLabel.trim() || null,
      ctaUrl: form.ctaUrl.trim() || null,
      audiences: form.audiences,
      startsAt: startOfCairoDay(form.startsAt),
      endsAt: endOfCairoDay(form.endsAt),
    };
    try {
      if (editingId) {
        await api(`/api/admin/announcements/${editingId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        toast.success("تم تعديل التنبيه");
      } else {
        await post("/api/admin/announcements", body);
        toast.success("تم إضافة التنبيه");
      }
      cancelEdit();
      load();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر حفظ التنبيه");
    } finally {
      setBusy(false);
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
  if (!rows) return <LoadingBlock rows={3} />;

  return (
    <div className="space-y-4">
      <Panel
        title={editingId ? "تعديل تنبيه" : "تنبيه جديد"}
        description="هيظهر التنبيه كنافذة منبثقة للمستخدمين خلال المدة المحددة."
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-[12px] text-muted-foreground">العنوان</label>
            <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <div className="space-y-1">
            <label className="text-[12px] text-muted-foreground">النص</label>
            <Textarea
              rows={3}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label className="text-[12px] text-muted-foreground">تاريخ البدء</label>
              <Input
                type="date"
                value={form.startsAt}
                onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[12px] text-muted-foreground">تاريخ الانتهاء</label>
              <Input
                type="date"
                min={form.startsAt}
                value={form.endsAt}
                onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-[12px] text-muted-foreground">رابط فيديو (اختياري)</label>
            <Input
              dir="ltr"
              value={form.videoUrl}
              onChange={(e) => setForm({ ...form, videoUrl: e.target.value })}
              placeholder="https://www.youtube.com/watch?v=..."
            />
          </div>
          <div className="space-y-1">
            <label className="text-[12px] text-muted-foreground">صور (اختياري)</label>
            <input
              ref={fileRef}
              type="file"
              accept={IMAGE_TYPES.join(",")}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadImage(file);
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              {form.imageUrls.map((url) => (
                <div key={url} className="relative w-fit">
                  <img src={url} alt="" className="aspect-[16/9] w-32 rounded-lg border object-cover" />
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="absolute -top-2 -end-2 size-6 rounded-full bg-background"
                    onClick={() => removeImage(url)}
                    aria-label="إزالة الصورة"
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploadingImage}
                onClick={() => fileRef.current?.click()}
              >
                <ImagePlus className="size-4" />
                {uploadingImage ? "بترفع…" : "ارفع صورة"}
              </Button>
            </div>
          </div>
          <div className="space-y-2 rounded-lg border p-3">
            <div className="text-[13px] font-medium">زرار الإجراء (اختياري)</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label htmlFor="cta-label" className="text-[12px] text-muted-foreground">
                  نص الزرار
                </label>
                <Input
                  id="cta-label"
                  maxLength={40}
                  value={form.ctaLabel}
                  onChange={(e) => setForm({ ...form, ctaLabel: e.target.value })}
                  placeholder="اشترك دلوقتي"
                />
              </div>
              <div className="space-y-1">
                <label htmlFor="cta-url" className="text-[12px] text-muted-foreground">
                  رابط الزرار
                </label>
                <Input
                  id="cta-url"
                  dir="ltr"
                  list="cta-page-suggestions"
                  value={form.ctaUrl}
                  onChange={(e) => setForm({ ...form, ctaUrl: e.target.value })}
                  placeholder="/subscribe"
                />
                <datalist id="cta-page-suggestions">
                  {PAGE_SUGGESTIONS.map((page) => (
                    <option key={page.url} value={page.url}>
                      {page.label}
                    </option>
                  ))}
                </datalist>
              </div>
            </div>
            <p className="text-[12px] text-muted-foreground">
              صفحة جوه الموقع (زي /subscribe) أو رابط https://. لو سيبت الاتنين فاضيين مفيش زرار.
            </p>
          </div>
          <div className="space-y-2 rounded-lg border p-3">
            <div className="text-[13px] font-medium">مين يشوف التنبيه؟</div>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {AUDIENCES.map((audience) => (
                <label
                  key={audience}
                  className="flex cursor-pointer items-center gap-2 text-[13px]"
                >
                  <Checkbox
                    checked={form.audiences.includes(audience)}
                    onCheckedChange={(checked) => toggleAudience(audience, checked === true)}
                  />
                  {AUDIENCE_LABEL[audience]}
                </label>
              ))}
            </div>
            <p className="text-[12px] text-muted-foreground">
              لو ما اخترتش حاجة هيظهر لكل المستخدمين.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            <Button disabled={busy || uploadingImage} onClick={() => void submit()}>
              {busy && <Spinner />}
              {editingId ? "حفظ التعديلات" : "إضافة التنبيه"}
            </Button>
            {editingId && (
              <Button variant="outline" disabled={busy} onClick={cancelEdit}>
                إلغاء
              </Button>
            )}
          </div>
        </div>
      </Panel>

      <div className="space-y-3">
        {rows.map((row) => (
          <AnnouncementRow key={row.id} row={row} onEdit={startEdit} onChanged={load} />
        ))}
      </div>
    </div>
  );
}

function AnnouncementRow({
  row,
  onEdit,
  onChanged,
}: {
  row: Announcement;
  onEdit: (row: Announcement) => void;
  onChanged: () => void;
}) {
  const status = statusOf(row);
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await del(`/api/admin/announcements/${row.id}`);
      toast.success(`تم حذف ${row.title}`);
      setOpen(false);
      onChanged();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر حذف التنبيه");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Panel
      title={
        <div className="flex items-center gap-2">
          {row.title}
          <Badge variant={STATUS_BADGE_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>
        </div>
      }
      description={`${row.startsAt.slice(0, 10)} — ${row.endsAt.slice(0, 10)}`}
      action={
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onEdit(row)}>
            تعديل
          </Button>
          <AlertDialog open={open} onOpenChange={setOpen}>
            <AlertDialogTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="text-muted-foreground hover:text-down"
                aria-label={`حذف ${row.title}`}
              >
                <Trash2 className="size-4" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader className="text-start">
                <AlertDialogTitle>حذف {row.title}؟</AlertDialogTitle>
                <AlertDialogDescription className="leading-relaxed">
                  هيتم مسح التنبيه نهائيًا ومش هيظهر للمستخدمين تاني. مش هينفع التراجع بعد الحذف.
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
        </div>
      }
    >
      <p className="text-[13px] leading-relaxed text-muted-foreground">{row.body}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-muted-foreground">
        <span>الفئة:</span>
        {row.audiences?.length ? (
          row.audiences.map((audience) => (
            <Badge key={audience} variant="outline">
              {AUDIENCE_LABEL[audience]}
            </Badge>
          ))
        ) : (
          <Badge variant="outline">الكل</Badge>
        )}
        {row.ctaLabel && row.ctaUrl && (
          <span dir="ltr" className="ms-auto">
            {row.ctaLabel} → {row.ctaUrl}
          </span>
        )}
      </div>
    </Panel>
  );
}
