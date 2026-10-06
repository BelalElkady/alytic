import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  EmptyState,
  ErrorState,
  LoadingBlock,
  Notice,
  Panel,
} from "@/components/desk/state-blocks";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { RichTextEditor } from "@/components/admin/rich-text-editor";
import { api, patch, post } from "@/lib/api";

type ContentBlock =
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] }
  | { type: "html"; html: string };

type ImageSpec = {
  concept: string;
  alt: string;
  caption: string;
  ratioAndFilename: string;
};

type BlogDraft = {
  id: string;
  batchIndex: number;
  postDate: string;
  slug: string;
  primaryKeyword: string;
  secondaryKeywords: string[];
  title: string;
  metaDescription: string;
  dek: string | null;
  content: ContentBlock[];
  tags: string[];
  sources: { title: string; url: string }[] | null;
  image: ImageSpec | null;
  imageUrl: string | null;
  imageSourceUrl: string | null;
  imageCreditName: string | null;
  status: "draft" | "approved" | "rejected" | "published";
  generationModel: string | null;
  reviewModel: string | null;
  review: { verdict: "pass" | "flag"; notes: string } | null;
  generatedAt: string;
};

type DraftEdit = {
  title: string;
  dek: string;
  metaDescription: string;
  tags: string;
  blocks: ContentBlock[];
};

const toDraftEdit = (row: BlogDraft): DraftEdit => ({
  title: row.title,
  dek: row.dek ?? "",
  metaDescription: row.metaDescription,
  tags: row.tags?.join("، ") ?? "",
  blocks: row.content.map((block) => ({ ...block })),
});

function countWords(content: ContentBlock[]): number {
  const text = content
    .map((b) =>
      b.type === "list"
        ? b.items.join(" ")
        : b.type === "html"
          ? b.html.replace(/<[^>]*>/g, " ")
          : b.text,
    )
    .join(" ")
    .trim();
  return text ? text.split(/\s+/).length : 0;
}

/** Draft blog posts written by src/agent/blogGenerator.js, waiting for a human to approve or reject before /api/blog serves them. */
export function BlogDraftsTab() {
  const [rows, setRows] = useState<BlogDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<DraftEdit | null>(null);

  const load = () => {
    api("/api/admin/blog-drafts?status=draft")
      .then((result) => {
        setRows(result.posts);
        setError(null);
      })
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "تعذر تحميل مسودات المدونة"),
      );
  };

  useEffect(() => {
    load();
  }, []);

  const decide = async (id: string, action: "approve" | "reject") => {
    setBusyId(id);
    try {
      await post(`/api/admin/blog-drafts/${id}/${action}`);
      toast.success(action === "approve" ? "اتنشرت المقالة" : "اترفضت المسودة");
      setRows((prev) => prev?.filter((r) => r.id !== id) ?? null);
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر تنفيذ الإجراء");
    } finally {
      setBusyId(null);
    }
  };

  const startEdit = (row: BlogDraft) => {
    setEditId(row.id);
    setEdit(toDraftEdit(row));
  };

  const cancelEdit = () => {
    setEditId(null);
    setEdit(null);
  };

  const saveEdit = async (id: string) => {
    if (!edit) return;
    setBusyId(id);
    const tags = edit.tags
      .split(/[،,]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
    try {
      await patch(`/api/admin/blog-drafts/${id}`, {
        title: edit.title.trim(),
        dek: edit.dek.trim() || null,
        metaDescription: edit.metaDescription.trim(),
        tags,
        content: edit.blocks,
      });
      toast.success("اتحفظت التعديلات");
      setRows(
        (previous) =>
          previous?.map((row) =>
            row.id === id
              ? {
                ...row,
                title: edit.title.trim(),
                dek: edit.dek.trim() || null,
                metaDescription: edit.metaDescription.trim(),
                tags,
                content: edit.blocks,
              }
              : row,
          ) ?? null,
      );
      cancelEdit();
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر حفظ التعديلات");
    } finally {
      setBusyId(null);
    }
  };

  const updateBlock = (
    index: number,
    patchBlock: { text?: string; items?: string[]; html?: string },
  ) => {
    setEdit((previous) => {
      if (!previous) return previous;
      const blocks = previous.blocks.map((block, blockIndex) =>
        blockIndex === index ? ({ ...block, ...patchBlock } as ContentBlock) : block,
      );
      return { ...previous, blocks };
    });
  };

  const removeBlock = (index: number) => {
    setEdit((previous) =>
      previous
        ? { ...previous, blocks: previous.blocks.filter((_, blockIndex) => blockIndex !== index) }
        : previous,
    );
  };

  const addBlock = (type: ContentBlock["type"]) => {
    setEdit((previous) => {
      if (!previous) return previous;
      const block: ContentBlock =
        type === "list"
          ? { type: "list", items: [""] }
          : type === "heading"
            ? { type: "heading", level: 2, text: "" }
            : { type: "paragraph", text: "" };
      return { ...previous, blocks: [...previous.blocks, block] };
    });
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
      <Notice tone="info">
        10 مسودات مكتوبة تلقائيًا كل يوم ومراجَعة بنموذج ثاني قبل ما توصلك هنا. راجع المحتوى
        والمصادر وعدد الكلمات قبل النشر — النشر بيظهر المقالة فورًا في /blog وفي الشريط المتحرك.
      </Notice>

      {rows.length === 0 ? (
        <EmptyState
          title="مفيش مسودات في انتظار المراجعة"
          hint="هتظهر هنا أول ما الجدولة اليومية تولّد مقالة جديدة."
        />
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
                  {row.postDate} · مقالة {row.batchIndex}/10 · {row.generationModel ?? "—"} ·{" "}
                  {countWords(row.content)} كلمة
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
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => startEdit(row)}
                    >
                      تعديل
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() => void decide(row.id, "reject")}
                    >
                      رفض
                    </Button>
                    <Button
                      size="sm"
                      disabled={busy}
                      onClick={() => void decide(row.id, "approve")}
                    >
                      نشر
                    </Button>
                  </div>
                )
              }
            >
              {isEditing && edit ? (
                <div className="space-y-3">
                  <div className="space-y-1">
                    <label className="text-[12px] text-muted-foreground">العنوان</label>
                    <Input
                      value={edit.title}
                      disabled={busy}
                      onChange={(event) => setEdit({ ...edit, title: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[12px] text-muted-foreground">المقدمة</label>
                    <Textarea
                      rows={2}
                      value={edit.dek}
                      disabled={busy}
                      onChange={(event) => setEdit({ ...edit, dek: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[12px] text-muted-foreground">
                      الوصف التعريفي (meta description)
                    </label>
                    <Textarea
                      rows={2}
                      value={edit.metaDescription}
                      disabled={busy}
                      onChange={(event) =>
                        setEdit({ ...edit, metaDescription: event.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[12px] text-muted-foreground">
                      الوسوم (افصل بينها بفاصلة)
                    </label>
                    <Input
                      value={edit.tags}
                      disabled={busy}
                      onChange={(event) => setEdit({ ...edit, tags: event.target.value })}
                    />
                  </div>
                  <div className="space-y-3 border-t pt-3">
                    {edit.blocks.map((block, index) => (
                      <div key={index} className="space-y-1">
                        <div className="flex items-center justify-between">
                          <label className="text-[12px] text-muted-foreground">
                            {block.type === "heading"
                              ? "عنوان فرعي"
                              : block.type === "list"
                                ? "قائمة (سطر لكل عنصر)"
                                : block.type === "html"
                                  ? "محتوى المقالة"
                                  : "فقرة"}
                          </label>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy}
                            onClick={() => removeBlock(index)}
                          >
                            حذف الفقرة
                          </Button>
                        </div>
                        {block.type === "html" ? (
                          <RichTextEditor
                            key={`${editId}-${index}`}
                            initialHtml={block.html}
                            disabled={busy}
                            onChange={(html) => updateBlock(index, { html })}
                          />
                        ) : block.type === "list" ? (
                          <Textarea
                            rows={3}
                            value={block.items.join("\n")}
                            disabled={busy}
                            onChange={(event) =>
                              updateBlock(index, { items: event.target.value.split("\n") })
                            }
                          />
                        ) : (
                          <Textarea
                            rows={block.type === "heading" ? 1 : 3}
                            value={block.text}
                            disabled={busy}
                            onChange={(event) => updateBlock(index, { text: event.target.value })}
                          />
                        )}
                      </div>
                    ))}
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => addBlock("paragraph")}
                      >
                        + فقرة
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => addBlock("heading")}
                      >
                        + عنوان فرعي
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => addBlock("list")}
                      >
                        + قائمة
                      </Button>
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {row.review && (
                    <Notice
                      tone={row.review.verdict === "flag" ? "warn" : "success"}
                      className="mb-4"
                    >
                      مراجعة {row.reviewModel ?? ""}: {row.review.notes}
                    </Notice>
                  )}
                  <div className="flex flex-wrap gap-1.5">
                    <Badge>{row.primaryKeyword}</Badge>
                    {row.secondaryKeywords?.map((kw) => (
                      <Badge key={kw} variant="outline">
                        {kw}
                      </Badge>
                    ))}
                  </div>
                  <p className="mt-2 text-[12px] text-muted-foreground">
                    الوصف التعريفي (meta): {row.metaDescription}
                  </p>
                  {row.dek && <p className="mt-2 text-[13px] text-muted-foreground">{row.dek}</p>}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {row.tags?.map((tag) => (
                      <Badge key={tag} variant="outline">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                  {row.imageUrl && (
                    <div className="mt-3">
                      <img
                        src={row.imageUrl}
                        alt={row.image?.alt ?? row.title}
                        className="aspect-[16/9] w-full rounded-lg border object-cover"
                      />
                      {row.imageCreditName && (
                        <p className="mt-1 text-[11px] text-muted-foreground">
                          Photo by{" "}
                          {row.imageSourceUrl ? (
                            <a
                              href={row.imageSourceUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="underline"
                            >
                              {row.imageCreditName}
                            </a>
                          ) : (
                            row.imageCreditName
                          )}{" "}
                          on Unsplash
                        </p>
                      )}
                    </div>
                  )}
                  <div className="mt-4 space-y-2 text-[13px] leading-relaxed">
                    {row.content.map((block, index) =>
                      block.type === "html" ? (
                        // Sanitized by the backend when the article is saved.
                        <div
                          key={index}
                          className="blog-html"
                          dangerouslySetInnerHTML={{ __html: block.html }}
                        />
                      ) : block.type === "list" ? (
                        <ul key={index} className="list-disc ps-5">
                          {block.items.map((item, itemIndex) => (
                            <li key={itemIndex}>{item}</li>
                          ))}
                        </ul>
                      ) : (
                        <p
                          key={index}
                          className={
                            block.type === "heading"
                              ? block.level === 3
                                ? "font-semibold ps-3"
                                : "font-semibold"
                              : ""
                          }
                        >
                          {block.text}
                        </p>
                      ),
                    )}
                  </div>
                  {row.sources && row.sources.length > 0 && (
                    <div className="mt-4 border-t pt-3 text-[12px] text-muted-foreground">
                      المصادر:{" "}
                      {row.sources.map((s, index) => (
                        <span key={s.url}>
                          {index > 0 && "، "}
                          <a href={s.url} target="_blank" rel="noreferrer" className="underline">
                            {s.title}
                          </a>
                        </span>
                      ))}
                    </div>
                  )}
                </>
              )}
            </Panel>
          );
        })
      )}
    </div>
  );
}
