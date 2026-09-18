import { useCallback, useEffect, useRef, useState } from "react";
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

// A bit above the backend's own limit for the slug call (see /api/admin/blog-slug).
const SLUG_TIMEOUT_MS = 30_000;

/** Rejects if `promise` hasn't settled within `ms`, so a hung request can't leave the form waiting forever. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("توليد الرابط أخد وقت طويل — اكتبه بنفسك")), ms);
    promise.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

/** Keeps only what the backend's slug regex accepts: lowercase English letters, digits and single hyphens. */
function sanitizeSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The same clean-up for use while typing: keeps a trailing hyphen so "egx-" can grow into "egx-30" — sanitizeSlug runs on submit. */
function sanitizeSlugInput(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "");
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
  // slug fields. Refs, not state: the async generation below must see the
  // latest value when its response lands, not the one from when it started.
  const slugTouchedRef = useRef(false);
  const slugRequestRef = useRef(0);
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

  /**
   * Fills the slug with an English translation of the title. Never blocks the
   * field: the admin can type their own slug at any point, which discards the
   * pending result. Only the latest request may write to the form or clear the
   * loading flag.
   */
  const generateSlug = useCallback(async (title: string) => {
    const requestId = ++slugRequestRef.current;
    setSlugLoading(true);
    try {
      const { slug } = await withTimeout(
        post<{ slug: string }>("/api/admin/blog-slug", { title }),
        SLUG_TIMEOUT_MS,
      );
      if (requestId === slugRequestRef.current && !slugTouchedRef.current) {
        setForm((f) => ({ ...f, slug: sanitizeSlug(slug) }));
      }
    } catch (caught) {
      if (requestId === slugRequestRef.current) {
        toast.error(caught instanceof Error ? caught.message : "تعذر توليد الرابط تلقائيًا — اكتبه بنفسك");
      }
    } finally {
      if (requestId === slugRequestRef.current) setSlugLoading(false);
    }
  }, []);

  // Regenerate about a second after the admin stops typing the title, so the
  // slug is ready without needing to leave the field first.
  useEffect(() => {
    const title = form.title.trim();
    if (!title || slugTouchedRef.current) return;
    const timer = setTimeout(() => void generateSlug(title), 1000);
    return () => clearTimeout(timer);
  }, [form.title, generateSlug]);

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
      slugTouchedRef.current = false;
      slugRequestRef.current++;
      setSlugLoading(false);
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
          <div className="flex items-center justify-between gap-2">
            <label className="text-[12px] text-muted-foreground">الرابط (Slug — إنجليزي)</label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-[11.5px]"
              disabled={slugLoading || !form.title.trim()}
              onClick={() => {
                slugTouchedRef.current = false;
                void generateSlug(form.title.trim());
              }}
            >
              {slugLoading ? "بيترجم العنوان..." : "توليد تلقائي من العنوان"}
            </Button>
          </div>
          <Input
            dir="ltr"
            value={form.slug}
            onChange={(e) => {
              // Typing takes over from auto-generation: drop any request still in flight.
              slugTouchedRef.current = true;
              slugRequestRef.current++;
              setSlugLoading(false);
              setForm({ ...form, slug: sanitizeSlugInput(e.target.value) });
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
