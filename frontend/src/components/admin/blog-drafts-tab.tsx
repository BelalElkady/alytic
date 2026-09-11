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
import { api, post } from "@/lib/api";

type ContentBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

type BlogDraft = {
  id: string;
  slot: "morning" | "evening";
  postDate: string;
  slug: string;
  title: string;
  dek: string | null;
  content: ContentBlock[];
  tags: string[];
  sources: { title: string; url: string }[] | null;
  status: "draft" | "approved" | "rejected" | "published";
  generationModel: string | null;
  reviewModel: string | null;
  review: { verdict: "pass" | "flag"; notes: string } | null;
  generatedAt: string;
};

/** Draft blog posts written by src/agent/blogGenerator.js, waiting for a human to approve or reject before /api/blog serves them. */
export function BlogDraftsTab() {
  const [rows, setRows] = useState<BlogDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

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
        مسودات مكتوبة تلقائيًا (qwen3) ومراجَعة بنموذج ثاني قبل ما توصلك هنا. راجع المحتوى والمصادر
        قبل النشر — النشر بيظهر المقالة فورًا في /blog وفي الشريط المتحرك.
      </Notice>

      {rows.length === 0 ? (
        <EmptyState
          title="مفيش مسودات في انتظار المراجعة"
          hint="هتظهر هنا أول ما الجدولة اليومية تولّد مقالة جديدة."
        />
      ) : (
        rows.map((row) => (
          <Panel
            key={row.id}
            title={row.title}
            description={
              <>
                {row.postDate} · {row.slot === "morning" ? "صباحية" : "مسائية"} ·{" "}
                {row.generationModel ?? "—"}
              </>
            }
            action={
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busyId === row.id}
                  onClick={() => void decide(row.id, "reject")}
                >
                  رفض
                </Button>
                <Button
                  size="sm"
                  disabled={busyId === row.id}
                  onClick={() => void decide(row.id, "approve")}
                >
                  نشر
                </Button>
              </div>
            }
          >
            {row.review && (
              <Notice tone={row.review.verdict === "flag" ? "warn" : "success"} className="mb-4">
                مراجعة {row.reviewModel ?? ""}: {row.review.notes}
              </Notice>
            )}
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
          </Panel>
        ))
      )}
    </div>
  );
}
