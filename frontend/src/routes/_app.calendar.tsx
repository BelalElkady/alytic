import { createFileRoute } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { EmptyState, Notice, Panel, Spinner, Stat } from "@/components/desk/state-blocks";
import { Button } from "@/components/ui/button";
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
import { post } from "@/lib/api";
import { fmt, int, isoDay, pct, signed, tone } from "@/lib/format";
import { SITE_URL } from "@/lib/seo";
import { useDesk } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/calendar")({
  head: () => ({
    meta: [
      { title: "تقويم الإغلاقات — EGXpert" },
      {
        name: "description",
        content: "سجل يومي لقيمة المحفظة: إغلاق كل يوم، تعديلات الوقف والهدف، وملاحظاتك.",
      },
      { property: "og:title", content: "تقويم الإغلاقات — EGXpert" },
      {
        property: "og:description",
        content: "سجل يومي لقيمة المحفظة: إغلاق كل يوم، تعديلات الوقف والهدف، وملاحظاتك.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:url", content: `${SITE_URL}/calendar` },
    ],
  }),
  component: CalendarPage,
});

/** Sunday-first, matching Date#getDay(). Short forms are hand-written because
 * slicing Arabic day names produces broken words. */
const DOW = [
  { long: "الأحد", short: "أحد" },
  { long: "الاثنين", short: "اثنين" },
  { long: "الثلاثاء", short: "ثلاثاء" },
  { long: "الأربعاء", short: "أربعاء" },
  { long: "الخميس", short: "خميس" },
  { long: "الجمعة", short: "جمعة" },
  { long: "السبت", short: "سبت" },
];

const MONTHS = [
  "يناير",
  "فبراير",
  "مارس",
  "أبريل",
  "مايو",
  "يونيو",
  "يوليو",
  "أغسطس",
  "سبتمبر",
  "أكتوبر",
  "نوفمبر",
  "ديسمبر",
];

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 11 }, (_, index) => CURRENT_YEAR - 5 + index);

function CalendarPage() {
  const { log, reloadLog } = useDesk();
  const [month, setMonth] = useState(() => new Date());
  const [selected, setSelected] = useState(() => isoDay(new Date()));
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const dayCount = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (string | null)[] = [
    ...Array<null>(first.getDay()).fill(null),
    ...Array.from({ length: dayCount }, (_, index) =>
      isoDay(new Date(month.getFullYear(), month.getMonth(), index + 1)),
    ),
  ];

  const entry = log[selected];
  const noteValue = note ?? entry?.note ?? "";

  const saveNote = async () => {
    setSaving(true);
    try {
      await post("/api/log/note", { date: selected, note: noteValue });
      await reloadLog();
      toast.success("تم حفظ الملاحظة");
    } catch (caught) {
      toast.error(caught instanceof Error ? caught.message : "تعذر الحفظ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <Panel
        title={`${MONTHS[month.getMonth()]} ${month.getFullYear()}`}
        action={
          <div className="flex flex-wrap items-center gap-1.5">
            <Select
              value={String(month.getMonth())}
              onValueChange={(value) => setMonth(new Date(month.getFullYear(), Number(value), 1))}
            >
              <SelectTrigger className="h-9 w-[110px]" aria-label="اختر الشهر">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((name, index) => (
                  <SelectItem key={name} value={String(index)}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={String(month.getFullYear())}
              onValueChange={(value) => setMonth(new Date(Number(value), month.getMonth(), 1))}
            >
              <SelectTrigger className="h-9 w-[92px]" aria-label="اختر السنة">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {YEARS.map((year) => (
                  <SelectItem key={year} value={String(year)} className="num">
                    {year}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              aria-label="الشهر السابق"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            >
              <ChevronRight className="size-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="الشهر التالي"
              onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            >
              <ChevronLeft className="size-4" />
            </Button>
          </div>
        }
      >
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">
          {DOW.map((day) => (
            <div key={day.long} className="truncate py-1" title={day.long}>
              {day.short}
            </div>
          ))}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((day, index) => {
            if (!day) return <div key={`pad-${index}`} />;
            const dow = new Date(`${day}T12:00:00`).getDay();
            const weekend = dow === 5 || dow === 6;
            const dayEntry = log[day];
            return (
              <button
                key={day}
                type="button"
                onClick={() => {
                  setSelected(day);
                  setNote(null);
                }}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-0.5 rounded-lg border text-[12px] transition-colors hover:border-primary/50",
                  weekend && "bg-surface-2 text-muted-foreground",
                  dayEntry && (dayEntry.dayChange >= 0 ? "bg-up-soft" : "bg-down-soft"),
                  day === selected && "ring-2 ring-ring",
                )}
              >
                <span className="num font-medium">{+day.slice(-2)}</span>
                {dayEntry && (
                  <span className={cn("num text-[10.5px]", tone(dayEntry.dayChange))}>
                    {pct(dayEntry.dayChangePct, 1)}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </Panel>

      <Panel
        title={new Date(`${selected}T12:00:00`).toLocaleDateString("ar-EG", {
          weekday: "long",
          day: "numeric",
          month: "long",
        })}
      >
        {entry ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 rounded-lg border bg-surface p-3">
              <Stat label="قيمة المحفظة" value={int(entry.total)} />
              <Stat
                label="تغيّر اليوم"
                value={signed(entry.dayChange)}
                valueClassName={tone(entry.dayChange)}
              />
              <Stat label="إجمالي الربح" value={signed(entry.pl)} valueClassName={tone(entry.pl)} />
            </div>

            {entry.changes?.length ? (
              <Notice tone="info">
                <b>تعديلات الوقف/الهدف:</b>
                <ul className="mt-1 space-y-1">
                  {entry.changes.map((change: string) => (
                    <li key={change}>{change}</li>
                  ))}
                </ul>
              </Notice>
            ) : null}

            <div className="scrollbar-slim overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">السهم</TableHead>
                    <TableHead className="text-start">إغلاق</TableHead>
                    <TableHead className="text-start">الوقف</TableHead>
                    <TableHead className="text-start">التوصية</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(entry.prices ?? {}).map(([code, price]) => (
                    <TableRow key={code}>
                      <TableCell className="font-medium">{code}</TableCell>
                      <TableCell className="num text-right">{fmt(price)}</TableCell>
                      <TableCell className="num text-right text-down">
                        {fmt(entry.stops?.[code])}
                      </TableCell>
                      <TableCell className="max-w-72 text-[12.5px] whitespace-normal text-muted-foreground">
                        {entry.recs?.[code]?.text ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="space-y-2">
              <p className="text-[12.5px] font-medium text-muted-foreground">ملاحظة اليوم</p>
              <Textarea
                value={noteValue}
                onChange={(event) => setNote(event.target.value)}
                placeholder="اكتب ملاحظتك عن اليوم…"
                rows={3}
              />
              <Button size="sm" onClick={() => void saveNote()} disabled={saving}>
                {saving && <Spinner />}
                حفظ الملاحظة
              </Button>
            </div>
          </div>
        ) : (
          <EmptyState
            title="مفيش بيانات محفوظة لهذا اليوم"
            hint="الإغلاق بيتسجّل تلقائيًا بعد نهاية جلسة كل يوم تداول."
          />
        )}
      </Panel>
    </div>
  );
}
