import { createFileRoute } from "@tanstack/react-router";

import { EmptyState, LoadingBlock, Notice, Panel } from "@/components/desk/state-blocks";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { fmt, pct, tone } from "@/lib/format";
import { SITE_URL } from "@/lib/seo";
import { useDesk } from "@/lib/store";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/targets")({
  head: () => ({
    meta: [
      { title: "جدول الأهداف — EGXpert" },
      {
        name: "description",
        content: "أهداف كل سهم مرتبة من الأقرب للأبعد، مع المسافة والتقدير الزمني ومستويات الوقف.",
      },
      { property: "og:title", content: "جدول الأهداف — EGXpert" },
      {
        property: "og:description",
        content: "أهداف كل سهم مرتبة من الأقرب للأبعد، مع المسافة والتقدير الزمني ومستويات الوقف.",
      },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:url", content: `${SITE_URL}/targets` },
    ],
  }),
  component: TargetsPage,
});

const estimateTone = (weeks: number) =>
  weeks <= 2
    ? "border-up/40 bg-up-soft text-up"
    : weeks <= 6
      ? "border-border bg-surface-2"
      : weeks <= 16
        ? "border-warn/40 bg-warn-soft"
        : "border-down/40 bg-down-soft text-down";

function TargetsPage() {
  const { rows, loading, openDetail } = useDesk();

  if (loading && rows.length === 0) return <LoadingBlock rows={2} />;

  const estimates = rows
    .map((row) => ({ row, estimate: row.position.estimate }))
    .filter(({ estimate }) => estimate)
    .sort((a, b) => (a.estimate.distancePct ?? 0) - (b.estimate.distancePct ?? 0));

  return (
    <div className="space-y-4">
      <Panel
        title="جدول الأهداف"
        description="مرتب من الأقرب للأبعد. التقدير الزمني بيتحدث مع كل إغلاق جديد."
        bodyClassName="px-0 py-0 sm:px-0"
      >
        {estimates.length === 0 ? (
          <div className="p-4">
            <EmptyState title="مفيش أهداف محسوبة" hint="سجّل مراكزك الأول وهتظهر أهدافها هنا." />
          </div>
        ) : (
          <>
            <div className="scrollbar-slim overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-start">السهم</TableHead>
                    <TableHead className="text-start">الحالي</TableHead>
                    <TableHead className="text-start">الهدف</TableHead>
                    <TableHead className="text-start">المسافة</TableHead>
                    <TableHead className="text-start">اليوم</TableHead>
                    <TableHead className="text-start">التقدير الزمني</TableHead>
                    <TableHead className="text-start">
                      <TooltipProvider delayDuration={200}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="cursor-help underline decoration-dotted underline-offset-4">
                              ع/م من هنا
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-64 text-center leading-relaxed">
                            عائد/مخاطرة لو اشتريت بالسعر الحالي: المسافة للهدف المتوسط ÷ المسافة
                            للوقف، بوحدة R. كل ما زاد الرقم كل ما الفرصة أفضل بالنسبة للمخاطرة
                            المأخوذة.
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {estimates.map(({ row, estimate }) => (
                    <TableRow
                      key={row.code}
                      className="cursor-pointer"
                      onClick={() => openDetail(row.code)}
                    >
                      <TableCell>
                        <div className="font-medium">{row.code}</div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {row.sector}
                        </div>
                      </TableCell>
                      <TableCell className="num text-right">{fmt(row.price)}</TableCell>
                      <TableCell className="num text-right text-up">
                        {row.midTarget ? fmt(row.midTarget.price) : "—"}
                      </TableCell>
                      <TableCell className="num text-right font-medium">
                        {estimate.reached ? "—" : pct(estimate.distancePct, 1)}
                      </TableCell>
                      <TableCell className={cn("num text-right", tone(row.changePct))}>
                        {row.changePct != null ? pct(row.changePct) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={estimateTone(estimate.weeks)}>
                          {estimate.label}
                        </Badge>
                        {estimate.note && (
                          <span className="ms-2 text-[10.5px] text-muted-foreground">
                            {estimate.note}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="num text-right">
                        {row.position.riskRewardFromHere ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="p-4">
              <Notice tone="warn">
                التقديرات الزمنية تقريبية بناءً على سرعة السهم وزخمه — مش ضمان. أي كسر للوقف يلغي
                الهدف.
              </Notice>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}
