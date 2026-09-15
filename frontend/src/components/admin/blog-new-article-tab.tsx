import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/desk/state-blocks";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { post } from "@/lib/api";

type ContentBlock =
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

const emptyForm = () => ({
  title: "",
  slug: "",
  dek: "",
  metaDescription: "",
  tags: "",
  blocks: [{ type: "paragraph", text: "" }] as ContentBlock[],
});

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Lets an admin write and publish (or save as a draft for review) an article by hand, alongside the auto-generated pipeline. */
export function NewArticleTab() {
  const [form, setForm] = useState(emptyForm());
  const [busy, setBusy] = useState<"draft" | "publish" | null>(null);

  const updateBlock = (index: number, patchBlock: { text?: string; items?: string[] }) => {
    setForm((prev) => ({
      ...prev,
      blocks: prev.blocks.map((b, i) => (i === index ? ({ ...b, ...patchBlock } as ContentBlock) : b)),
    }));
  };

  const removeBlock = (index: number) => {
    setForm((prev) => ({ ...prev, blocks: prev.blocks.filter((_, i) => i !== index) }));
  };

  const addBlock = (type: ContentBlock["type"]) => {
    setForm((prev) => {
      const block: ContentBlock =
        type === "list"
          ? { type: "list", items: [""] }
          : type === "heading"
            ? { type: "heading", level: 2, text: "" }
            : { type: "paragraph", text: "" };
      return { ...prev, blocks: [...prev.blocks, block] };
    });
  };

  const validate = (): string | null => {
    if (!form.title.trim()) return "العنوان مطلوب";
    if (!SLUG_PATTERN.test(form.slug.trim())) return "الرابط لازم يكون حروف إنجليزية صغيرة وأرقام وشرطات بس، من غير مسافات";
    if (!form.metaDescription.trim()) return "الوصف التعريفي مطلوب";
    const blocks = form.blocks.filter((b) => (b.type === "list" ? b.items.some((i) => i.trim()) : b.text.trim()));
    if (blocks.length === 0) return "المقالة لازم تحتوي على محتوى";
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
      const tags = form.tags
        .split(/[،,]/)
        .map((t) => t.trim())
        .filter(Boolean);
      const content = form.blocks.filter((b) =>
        b.type === "list" ? b.items.some((i) => i.trim()) : b.text.trim(),
      );
      await post("/api/admin/blog-drafts", {
        title: form.title.trim(),
        slug: form.slug.trim(),
        dek: form.dek.trim() || null,
        metaDescription: form.metaDescription.trim(),
        tags,
        content,
        publish,
      });
      toast.success(publish ? "اتنشرت المقالة" : "اتحفظت المسودة — هتلاقيها في تبويب قيد المراجعة");
      setForm(emptyForm());
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
          <label className="text-[12px] text-muted-foreground">العنوان</label>
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </div>
        <div className="space-y-1">
          <label className="text-[12px] text-muted-foreground">
            الرابط (بالإنجليزي، حروف صغيرة وأرقام وشرطات بس) — /blog/{form.slug || "..."}
          </label>
          <Input
            dir="ltr"
            value={form.slug}
            onChange={(e) => setForm({ ...form, slug: e.target.value.toLowerCase() })}
            placeholder="egx30-weekly-review"
          />
        </div>
        <div className="space-y-1">
          <label className="text-[12px] text-muted-foreground">المقدمة</label>
          <Textarea rows={2} value={form.dek} onChange={(e) => setForm({ ...form, dek: e.target.value })} />
        </div>
        <div className="space-y-1">
          <label className="text-[12px] text-muted-foreground">الوصف التعريفي (meta description، ١٤٠-١٦٠ حرف)</label>
          <Textarea
            rows={2}
            value={form.metaDescription}
            onChange={(e) => setForm({ ...form, metaDescription: e.target.value })}
          />
        </div>
        <div className="space-y-1">
          <label className="text-[12px] text-muted-foreground">الوسوم (افصل بينها بفاصلة)</label>
          <Input value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
        </div>
        <div className="space-y-3 border-t pt-3">
          {form.blocks.map((block, index) => (
            <div key={index} className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[12px] text-muted-foreground">
                  {block.type === "heading" ? "عنوان فرعي" : block.type === "list" ? "قائمة (سطر لكل عنصر)" : "فقرة"}
                </label>
                <Button variant="ghost" size="sm" onClick={() => removeBlock(index)}>
                  حذف الفقرة
                </Button>
              </div>
              {block.type === "list" ? (
                <Textarea
                  rows={3}
                  value={block.items.join("\n")}
                  onChange={(e) => updateBlock(index, { items: e.target.value.split("\n") })}
                />
              ) : (
                <Textarea
                  rows={block.type === "heading" ? 1 : 3}
                  value={block.text}
                  onChange={(e) => updateBlock(index, { text: e.target.value })}
                />
              )}
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => addBlock("paragraph")}>
              + فقرة
            </Button>
            <Button variant="outline" size="sm" onClick={() => addBlock("heading")}>
              + عنوان فرعي
            </Button>
            <Button variant="outline" size="sm" onClick={() => addBlock("list")}>
              + قائمة
            </Button>
          </div>
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
