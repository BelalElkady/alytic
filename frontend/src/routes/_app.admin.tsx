import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { ErrorState, LoadingBlock, Notice, Panel, Spinner } from "@/components/desk/state-blocks";
import { Button } from "@/components/ui/button";
import { api, post, postRaw } from "@/lib/api";
import { useDesk } from "@/lib/store";

export const Route = createFileRoute("/_app/admin")({
  head: () => ({
    meta: [
      { title: "الإدارة — EGXpert" },
      { name: "description", content: "رفع قوائم أسهم المؤشرات (EGX30 / EGX70 / EGX33 / EGX100) كملف CSV." },
    ],
  }),
  component: AdminPage,
});

type IndexRow = {
  name: string;
  tickers: string[];
  count: number;
  source: "default" | "upload";
  updatedAt: string | null;
  updatedBy: string | null;
};

const LABELS: Record<string, string> = {
  EGX30: "EGX30",
  EGX70: "EGX70 EWI",
  EGX33: "EGX33 (شريعة)",
  EGX100: "EGX100",
};

function AdminPage() {
  const { user } = useDesk();
  const [rows, setRows] = useState<IndexRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api("/api/admin/indices")
      .then((result) => {
        setRows(result.indices);
        setError(null);
      })
      .catch((caught) => setError(caught?.message ?? "تعذر تحميل بيانات المؤشرات"));
  };

  useEffect(() => {
    if (user?.isAdmin) load();
  }, [user?.isAdmin]);

  if (!user?.isAdmin) {
    return <ErrorState message="الصفحة دي للمشرفين بس." />;
  }
  if (error) return <ErrorState message={error} action={<Button variant="outline" size="sm" onClick={load}>حاول تاني</Button>} />;
  if (!rows) return <LoadingBlock rows={3} />;

  return (
    <div className="space-y-4">
      <Notice tone="info">
        الملف: سطر لكل كود سهم (زي COMI)، أو CSV بعمود عنوانه Ticker/Code/Symbol/Reuters Code/RIC
        (بيتجاهل عمود ISIN لو موجود). كود مش موجود أصلًا في قاعدة الأسهم بيتضاف تلقائيًا كسهم جديد
        — لو الملف فيه عمود Company Name/Name بيتاخد منه الاسم. رفع ملف جديد بيستبدل القائمة بالكامل
        (EGX100 بيتحسب تلقائيًا من EGX30 + EGX70 إلا لو رُفع ملف مستقل ليه).
      </Notice>
      {rows.map((row) => (
        <IndexPanel key={row.name} row={row} onChanged={load} />
      ))}
    </div>
  );
}

function IndexPanel({ row, onChanged }: { row: IndexRow; onChanged: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [added, setAdded] = useState<string[]>([]);

  const upload = async (file: File) => {
    setBusy(true);
    setAdded([]);
    try {
      const text = await file.text();
      const result = await postRaw(`/api/admin/indices/${row.name}`, text, "text/csv");
      toast.success(`تم حفظ ${result.saved} كود لمؤشر ${LABELS[row.name] ?? row.name}`);
      if (result.added?.length) setAdded(result.added);
      onChanged();
    } catch (caught: any) {
      toast.error(caught?.message ?? "تعذر رفع الملف");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const reset = async () => {
    setBusy(true);
    try {
      await post(`/api/admin/indices/${row.name}/reset`);
      toast.success(`تم استرجاع القائمة الافتراضية لمؤشر ${LABELS[row.name] ?? row.name}`);
      setAdded([]);
      onChanged();
    } catch (caught: any) {
      toast.error(caught?.message ?? "تعذر الاسترجاع");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title={LABELS[row.name] ?? row.name}
      description={
        <>
          {row.count} كود · {row.source === "upload" ? "مرفوع يدويًا" : "افتراضي"}
          {row.updatedAt && ` · آخر تحديث ${new Date(row.updatedAt).toLocaleString("ar-EG")}`}
        </>
      }
      action={
        <div className="flex items-center gap-2">
          {row.source === "upload" && (
            <Button variant="outline" size="sm" onClick={() => void reset()} disabled={busy}>
              استرجاع الافتراضي
            </Button>
          )}
          <Button size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy && <Spinner />}
            رفع CSV
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />
        </div>
      }
    >
      <div className="flex flex-wrap gap-1.5">
        {row.tickers.map((code) => (
          <span key={code} className="rounded-md bg-surface px-2 py-1 text-[12px] font-medium">
            {code}
          </span>
        ))}
      </div>
      {added.length > 0 && (
        <Notice tone="warn" className="mt-3">
          الأكواد دي كانت جديدة على قاعدة الأسهم المتابَعة واتضافت بدون تصنيف قطاع أو فحص شرعي
          مُتحقَّق منه: {added.join("، ")}
        </Notice>
      )}
    </Panel>
  );
}
