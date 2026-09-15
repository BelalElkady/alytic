import { useMemo, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/desk/state-blocks";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { post } from "@/lib/api";

// Best-effort Arabic → Latin so an Arabic title still produces a readable
// /blog/<slug> URL instead of an empty or garbled one.
const ARABIC_TRANSLITERATION: Record<string, string> = {
  "أ": "a", "إ": "i", "آ": "a", "ا": "a", "ب": "b", "ت": "t", "ث": "th", "ج": "j",
  "ح": "h", "خ": "kh", "د": "d", "ذ": "dh", "ر": "r", "ز": "z", "س": "s", "ش": "sh",
  "ص": "s", "ض": "d", "ط": "t", "ظ": "z", "ع": "a", "غ": "gh", "ف": "f", "ق": "q",
  "ك": "k", "ل": "l", "م": "m", "ن": "n", "ه": "h", "و": "w", "ي": "y", "ى": "a",
  "ة": "a", "ء": "",
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4", "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};

function slugify(title: string): string {
  const transliterated = title
    .replace(/[ً-ٰٟۖ-ۭ]/g, "") // strip Arabic diacritics
    .split("")
    .map((ch) => ARABIC_TRANSLITERATION[ch] ?? ch)
    .join("");
  const base = transliterated
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "article";
}

/** Splits free-form article text into the paragraph blocks the site's blog renderer expects — blank lines separate paragraphs. */
function toContentBlocks(text: string) {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .map((paragraph) => ({ type: "paragraph" as const, text: paragraph }));
}

const emptyForm = () => ({ title: "", content: "", metaDescription: "" });

/** Lets an admin write and publish (or save as a draft for review) an article by hand, alongside the auto-generated pipeline. */
export function NewArticleTab() {
  const [form, setForm] = useState(emptyForm());
  const [busy, setBusy] = useState<"draft" | "publish" | null>(null);

  const baseSlug = useMemo(() => slugify(form.title), [form.title]);

  const validate = (): string | null => {
    if (!form.title.trim()) return "العنوان مطلوب";
    if (!form.metaDescription.trim()) return "الوصف التعريفي مطلوب";
    if (toContentBlocks(form.content).length === 0) return "المقالة لازم تحتوي على محتوى";
    return null;
  };

  const submit = async (publish: boolean) => {
    const problem = validate();
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(publish ? "publish" : "draft");
    try {
      const title = form.title.trim();
      const content = toContentBlocks(form.content);
      const metaDescription = form.metaDescription.trim();
      const dateSuffix = new Date().toISOString().slice(0, 10);

      // The slug is derived automatically and isn't shown for editing, so a
      // same-day duplicate title can't be fixed by hand — retry a few times
      // with a growing numeric suffix instead of failing outright.
      let lastError: unknown = null;
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const slug = attempt === 1 ? `${baseSlug}-${dateSuffix}` : `${baseSlug}-${dateSuffix}-${attempt}`;
        try {
          const { post: created } = await post<{ post: { slug: string } }>("/api/admin/blog-drafts", {
            title,
            slug,
            metaDescription,
            content,
            publish,
          });
          toast.success(
            publish
              ? `اتنشرت المقالة على /blog/${created.slug}`
              : "اتحفظت المسودة — هتلاقيها في تبويب قيد المراجعة",
          );
          setForm(emptyForm());
          return;
        } catch (caught) {
          lastError = caught;
          const isDuplicateSlug = caught instanceof Error && caught.message.includes("نفس الرابط");
          if (!isDuplicateSlug) throw caught;
        }
      }
      throw lastError;
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
          <label className="text-[12px] text-muted-foreground">العنوان (Meta Title)</label>
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <p dir="ltr" className="text-[11.5px] text-muted-foreground">
            /blog/{form.title.trim() ? `${baseSlug}-...` : "..."}
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
          <label className="text-[12px] text-muted-foreground">نص المقالة (سطر فاضي بين كل فقرة والتانية)</label>
          <Textarea
            rows={16}
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <Button disabled={busy !== null} onClick={() => void submit(true)}>
            انشر المقالة
          </Button>
          <Button variant="outline" disabled={busy !== null} onClick={() => void submit(false)}>
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
