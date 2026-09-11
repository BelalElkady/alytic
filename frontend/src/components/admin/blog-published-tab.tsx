import { useEffect, useState } from "react";
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
} from "@/components/ui/alert-dialog";
import { EmptyState, ErrorState, LoadingBlock, Panel } from "@/components/desk/state-blocks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, del, patch, post } from "@/lib/api";

type ContentBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

type BlogPost = {
  id: string;
  slot: "morning" | "evening";
  postDate: string;
  slug: string;
  title: string;
  dek: string | null;
  content: ContentBlock[];
  tags: string[];
  publishedAt: string | null;
};

type EditState = {
  title: string;
  dek: string;
  tags: string;
  blocks: ContentBlock[];
};

const toEditState = (row: BlogPost): EditState => ({
  title: row.title,
  dek: row.dek ?? "",
  tags: row.tags?.join("، ") ?? "",
  blocks: row.content.map((b) => ({ ...b })),
});

/** Live posts already served by /api/blog — lets an admin fix, pull back to review, or permanently remove them. */
export function PublishedPostsTab() {
  const [rows, setRows] = useState<BlogPost[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const load = () => {
    api("/api/admin/blog-drafts?status=published")
      .then((result) => {
        setRows(result.posts);
        setError(null);
      })
      .catch((caught: any) => setError(caught?.message ?? "تعذر تحميل المقالات المنشورة"));
  };

  useEffect(() => {
    load();
  }, []);

  const startEdit = (row: BlogPost) => {
    setEditId(row.id);
    setEdit(toEditState(row));
  };

  const cancelEdit = () => {
    setEditId(null);
    setEdit(null);
  };

  const saveEdit = async (id: string) => {
    if (!edit) return;
    setBusyId(id);
    const tags = edit.tags.split(/[،,]/).map((t) => t.trim()).filter(Boolean);
    try {
      await patch(`/api/admin/blog-drafts/${id}`, {
        title: edit.title.trim(),
        dek: edit.dek.trim() || null,
        tags,
        content: edit.blocks,
      });
      toast.success("اتحفظت التعديلات");
      setRows((prev) =>
        prev?.map((r) =>
          r.id === id ? { ...r, title: edit.title.trim(), dek: edit.dek.trim() || null, tags, content: edit.blocks } : r,
        ) ?? null,
      );
      cancelEdit();
    } catch (caught: any) {
      toast.error(caught?.message ?? "تعذر حفظ التعديلات");
    } finally {
      setBusyId(null);
    }
  };

  const unpublish = async (id: string) => {
    setBusyId(id);
    try {
      await post(`/api/admin/blog-drafts/${id}/unpublish`);
      toast.success("اتشالت المقالة من الموقع ورجعت مسودة");
      setRows((prev) => prev?.filter((r) => r.id !== id) ?? null);
    } catch (caught: any) {
      toast.error(caught?.message ?? "تعذر إلغاء النشر");
    } finally {
      setBusyId(null);
    }
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    const id = deleteId;
    setBusyId(id);
    try {
      await del(`/api/admin/blog-drafts/${id}`);
      toast.success("اتحذفت المقالة نهائيًا");
      setRows((prev) => prev?.filter((r) => r.id !== id) ?? null);
      setDeleteId(null);
    } catch (caught: any) {
      toast.error(caught?.message ?? "تعذر حذف المقالة");
    } finally {
      setBusyId(null);
    }
  };

  const updateBlock = (index: number, patchBlock: { text?: string; items?: string[] }) => {
    setEdit((prev) => {
      if (!prev) return prev;
      const blocks = prev.blocks.map((b, i) => (i === index ? ({ ...b, ...patchBlock } as ContentBlock) : b));
      return { ...prev, blocks };
    });
  };

  const removeBlock = (index: number) => {
    setEdit((prev) => (prev ? { ...prev, blocks: prev.blocks.filter((_, i) => i !== index) } : prev));
  };

  const addBlock = (type: ContentBlock["type"]) => {
    setEdit((prev) => {
      if (!prev) return prev;
      const block: ContentBlock = type === "list" ? { type: "list", items: [""] } : { type, text: "" };
      return { ...prev, blocks: [...prev.blocks, block] };
    });
  };

  if (error) return <ErrorState message={error} action={<Button variant="outline" size="sm" onClick={load}>حاول تاني</Button>} />;
  if (!rows) return <LoadingBlock rows={3} />;

  return (
    <div className="space-y-4">
      {rows.length === 0 ? (
        <EmptyState title="مفيش مقالات منشورة دلوقتي" hint="المقالات اللي بتوافق عليها من تبويب المسودات هتظهر هنا." />
      ) : (
        rows.map((row) => {
          const isEditing = editId === row.id;
          const busy = busyId === row.id;
          return (
            <Panel
              key={row.id}
              title={row.title}
              description={
                <>
                  {row.postDate} · {row.slot === "morning" ? "صباحية" : "مسائية"}
                  {row.publishedAt && ` · اتنشرت ${new Date(row.publishedAt).toLocaleString("ar-EG")}`}
                </>
              }
              action={
                isEditing ? (
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={busy} onClick={cancelEdit}>
                      إلغاء
                    </Button>
                    <Button size="sm" disabled={busy} onClick={() => void saveEdit(row.id)}>
                      حفظ
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => startEdit(row)}>
                      تعديل
                    </Button>
                    <Button variant="outline" size="sm" disabled={busy} onClick={() => void unpublish(row.id)}>
                      إلغاء النشر
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      className="text-down hover:text-down"
                      onClick={() => setDeleteId(row.id)}
                    >
                      حذف
                    </Button>
                  </div>
                )
              }
            >
              {isEditing && edit ? (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[12px] text-muted-foreground">العنوان</label>
                    <Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[12px] text-muted-foreground">المقدمة</label>
                    <Textarea rows={2} value={edit.dek} onChange={(e) => setEdit({ ...edit, dek: e.target.value })} />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[12px] text-muted-foreground">الوسوم (افصل بينها بفاصلة)</label>
                    <Input value={edit.tags} onChange={(e) => setEdit({ ...edit, tags: e.target.value })} />
                  </div>
                  <div className="space-y-3 border-t pt-3">
                    {edit.blocks.map((block, index) => (
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
                </div>
              ) : (
                <>
                  {row.dek && <p className="text-[13px] text-muted-foreground">{row.dek}</p>}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {row.tags?.map((tag) => (
                      <Badge key={tag} variant="outline">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                  <div className="mt-4 space-y-2 text-[13px] leading-relaxed">
                    {row.content.map((block, index) =>
                      block.type === "list" ? (
                        <ul key={index} className="list-disc ps-5">
                          {block.items.map((item, itemIndex) => (
                            <li key={itemIndex}>{item}</li>
                          ))}
                        </ul>
                      ) : (
                        <p key={index} className={block.type === "heading" ? "font-semibold" : ""}>
                          {block.text}
                        </p>
                      ),
                    )}
                  </div>
                </>
              )}
            </Panel>
          );
        })
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader className="text-start">
            <AlertDialogTitle>حذف المقالة نهائيًا؟</AlertDialogTitle>
            <AlertDialogDescription className="leading-relaxed">
              هتتشال المقالة من قاعدة البيانات بالكامل ومش هينفع استرجاعها بعد الحذف. لو عايز بس تشيلها من
              الموقع، استخدم "إلغاء النشر" بدل الحذف.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:justify-start">
            <AlertDialogAction
              onClick={() => void confirmDelete()}
              disabled={busyId === deleteId}
              className="bg-down text-white hover:bg-down/90"
            >
              نعم، احذف
            </AlertDialogAction>
            <AlertDialogCancel disabled={busyId === deleteId}>إلغاء</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
