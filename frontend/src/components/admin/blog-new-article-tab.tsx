import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/desk/state-blocks";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { post, postRaw } from "@/lib/api";

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Keeps only what the backend's slug regex accepts: lowercase English letters, digits and single hyphens. */
function sanitizeSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Splits free-form article text into the paragraph blocks the site's blog renderer expects — blank lines separate paragraphs. */
function toContentBlocks(text: string) {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((paragraph) => ({ type: "paragraph" as const, text: paragraph }));
}

const emptyForm = () => ({ title: "", metaTitle: "", slug: "", content: "", metaDescription: "", imageUrl: "" });

/** Lets an admin write and publish (or save as a draft for review) an article by hand, alongside the auto-generated pipeline. */
export function NewArticleTab() {
  const [form, setForm] = useState(emptyForm());
  // The slug is generated (translated to English) from the title until the
  // admin edits it directly — same "auto until touched" pattern as most CMS
  // slug fields.
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugLoading, setSlugLoading] = useState(false);
  const [busy, setBusy] = useState<"draft" | "publish" | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const validate = (): string | null => {
    if (!form.title.trim()) return "العنوان مطلوب";
    if (!form.metaTitle.trim()) return "عنوان الميتا مطلوب";
    if (!sanitizeSlug(form.slug)) return "الرابط (Slug) مطلوب بحروف إنجليزية";
    if (!form.metaDescription.trim()) return "الوصف التعريفي مطلوب";
    if (toContentBlocks(form.content).length === 0) return "المقالة لازم تحتوي على محتوى";
    return null;
  };

  /** Fills the slug with an English translation of the title — unless the admin has typed their own slug in the meantime. */
  const generateSlug = async (title: string) => {
    if (!title.trim() || slugTouched) return;
    setSlugLoading(true);
    try {
      const { slug } = await post<{ slug: string }>("/api/admin/blog-slug", { title: title.trim() });
      setForm((f) => (f.title === title ? { ...f, slug: sanitizeSlug(slug) } : f));
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر توليد الرابط تلقائيًا — اكتبه بنفسك");
    } finally {
      setSlugLoading(false);
    }
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
      const { url } = await postRaw<{ url: string }>("/api/admin/blog-drafts/image", file, file.type);
      setForm((f) => ({ ...f, imageUrl: url }));
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر رفع الصورة");
    } finally {
      setUploadingImage(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const submit = async (publish: boolean) => {
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(publish ? "publish" : "draft");
    try {
      const { post: created } = await post<{ post: { slug: string } }>("/api/admin/blog-drafts", {
        title: form.title.trim(),
        metaTitle: form.metaTitle.trim(),
        slug: sanitizeSlug(form.slug),
        metaDescription: form.metaDescription.trim(),
        content: toContentBlocks(form.content),
        imageUrl: form.imageUrl || undefined,
        publish,
      });
      toast.success(
        publish
          ? `اتنشرت المقالة على /blog/${created.slug}`
          : "اتحفظت المسودة — هتلاقيها في تبويب قيد المراجعة",
      );
      setForm(emptyForm());
      setSlugTouched(false);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر حفظ المقالة");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel title="مقالة جديدة" description="اكتب مقالة يدويًا وانشرها على طول، أو احفظها كمسودة للمراجعة.">
      <div className="space-y-3">
        <div className="space-y-1">
          <label className="text-[12px] text-muted-foreground">العنوان (Title)</label>
          <Textarea
            rows={2}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            onBlur={(e) => void generateSlug(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[12px] text-muted-foreground">عنوان الميتا (Meta Title)</label>
          <Textarea
            rows={2}
            value={form.metaTitle}
            onChange={(e) => setForm({ ...form, metaTitle: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[12px] text-muted-foreground">الرابط (Slug — إنجليزي)</label>
          <Input
            dir="ltr"
            disabled={slugLoading}
            placeholder={slugLoading ? "بيترجم العنوان للإنجليزي..." : undefined}
            value={form.slug}
            onChange={(e) => {
              setSlugTouched(true);
              setForm({ ...form, slug: sanitizeSlug(e.target.value) });
            }}
          />
          <p dir="ltr" className="text-[11.5px] text-muted-foreground">
            /blog/{form.slug || "..."}
          </p>
        </div>
        <div className="space-y-1">
          <label className="text-[12px] text-muted-foreground">
            الوصف التعريفي (Meta Description، ١٤٠-١٦٠ حرف)
          </label>
          <Textarea
            rows={2}
            value={form.metaDescription}
            onChange={(e) => setForm({ ...form, metaDescription: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[12px] text-muted-foreground">صورة المقالة (اختياري)</label>
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
          {form.imageUrl ? (
            <div className="relative w-fit">
              <img src={form.imageUrl} alt="" className="aspect-[16/9] w-64 rounded-lg border object-cover" />
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="absolute -top-2 -end-2 size-6 rounded-full bg-background"
                onClick={() => setForm((f) => ({ ...f, imageUrl: "" }))}
                aria-label="إزالة الصورة"
              >
                <X className="size-3.5" />
              </Button>
            </div>
          ) : (
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
          )}
        </div>
        <div className="space-y-1">
          <label className="text-[12px] text-muted-foreground">نص المقالة (سطر فاضي بين كل فقرة والتانية)</label>
          <Textarea
            rows={16}
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <Button disabled={busy !== null || uploadingImage} onClick={() => void submit(true)}>
            انشر المقالة
          </Button>
          <Button variant="outline" disabled={busy !== null || uploadingImage} onClick={() => void submit(false)}>
            حفظ كمسودة
          </Button>
          <Badge variant="outline" className="ms-auto">
            المسودة بتتحفظ في تبويب "قيد المراجعة"
          </Badge>
        </div>
      </div>
    </Panel>
  );
}
