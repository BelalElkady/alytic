import { useEffect, useState } from "react";

import { Panel } from "@/components/desk/state-blocks";
import { api } from "@/lib/api";
import { compact, pct, tone } from "@/lib/format";
import { cn } from "@/lib/utils";

/** One group as GET /api/indices/investor-flows returns it (see backend/src/investorFlows.js). */
export type FlowGroup = {
  nationality: "egyptian" | "arab" | "foreign" | "all";
  type: "individual" | "institution" | "all";
  netEgp: number;
  sharePct: number | null;
  buyEgp: number | null;
  sellEgp: number | null;
};

export type InvestorFlowsData = {
  sessionDate: string;
  groups: FlowGroup[];
  sourceUrl: string;
  fetchedAt: string;
};

const NATIONALITY_LABEL: Record<string, string> = {
  egyptian: "مصريين",
  arab: "عرب",
  foreign: "أجانب",
};
const TYPE_LABEL: Record<string, string> = {
  individual: "أفراد",
  institution: "مؤسسات",
};

export function groupLabel(nationality: string, type: string): string {
  const nat = NATIONALITY_LABEL[nationality];
  const kind = TYPE_LABEL[type];
  if (nat && kind) return `${nat} — ${kind}`;
  return nat ?? kind ?? "الكل";
}

/** A net figure in EGP, signed and at a fixed two decimals so every row reads the same way. */
export function flowAmount(value: number): { figure: string; unit: string } {
  const abs = Math.abs(value);
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const [div, unit] = abs >= 1_000_000_000 ? [1_000_000_000, "مليار ج.م"] : [1_000_000, "مليون ج.م"];
  return { figure: `${sign}${(abs / div).toFixed(2)}`, unit };
}

function FlowRow({ group }: { group: FlowGroup }) {
  const buying = group.netEgp > 0;
  const hasGross = group.buyEgp !== null && group.sellEgp !== null;
  const amount = flowAmount(group.netEgp);
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <div className="min-w-0">
        <div className="text-[15px] font-medium">{groupLabel(group.nationality, group.type)}</div>
        {(group.sharePct !== null || hasGross) && (
          <div className="num text-[13px] text-muted-foreground">
            {group.sharePct !== null && <>حصته {pct(group.sharePct).replace("+", "")}</>}
            {group.sharePct !== null && hasGross && " · "}
            {hasGross && (
              <>
                شراء {compact(group.buyEgp)} · بيع {compact(group.sellEgp)}
              </>
            )}
          </div>
        )}
      </div>
      <div className="shrink-0 text-left">
        <div className={cn("flex items-baseline gap-1.5", tone(group.netEgp))}>
          <span dir="ltr" className="num text-[19px] font-bold tabular-nums">
            {amount.figure}
          </span>
          <span className="text-[12px] font-medium">{amount.unit}</span>
        </div>
        <div className={cn("text-[13px] font-medium", tone(group.netEgp))}>
          {buying ? "صافي شراء" : group.netEgp < 0 ? "صافي بيع" : "متعادل"}
        </div>
      </div>
    </div>
  );
}

function FlowSection({ title, groups }: { title: string; groups: FlowGroup[] }) {
  if (!groups.length) return null;
  return (
    <div>
      <div className="mb-1 text-[13px] font-semibold text-muted-foreground">{title}</div>
      <div className="divide-y">
        {groups.map((group) => (
          <FlowRow key={`${group.nationality}/${group.type}`} group={group} />
        ))}
      </div>
    </div>
  );
}

const byOrder = (order: string[], key: "nationality" | "type") => (a: FlowGroup, b: FlowGroup) =>
  order.indexOf(a[key]) - order.indexOf(b[key]);

/**
 * Who bought and sold in the last closed session. Renders nothing at all —
 * not a placeholder, not an error, not an older session — unless the server
 * has figures for the current session that passed its checks.
 */
export function InvestorFlows() {
  const [flows, setFlows] = useState<InvestorFlowsData | null>(null);

  useEffect(() => {
    let cancelled = false;
    api("/api/indices/investor-flows")
      .then((result) => {
        if (!cancelled) setFlows(result?.flows ?? null);
      })
      .catch(() => {
        if (!cancelled) setFlows(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!flows) return null;

  const byNationality = flows.groups
    .filter((g) => g.type === "all" && g.nationality !== "all")
    .sort(byOrder(["egyptian", "arab", "foreign"], "nationality"));
  const byType = flows.groups
    .filter((g) => g.nationality === "all" && g.type !== "all")
    .sort(byOrder(["individual", "institution"], "type"));
  const cells = flows.groups
    .filter((g) => g.nationality !== "all" && g.type !== "all")
    .sort(
      (a, b) =>
        byOrder(["egyptian", "arab", "foreign"], "nationality")(a, b) ||
        byOrder(["individual", "institution"], "type")(a, b),
    );

  const date = new Date(`${flows.sessionDate}T12:00:00`).toLocaleDateString("ar-EG", {
    weekday: "long",
    day: "numeric",
    month: "long",
    numberingSystem: "latn",
  });

  return (
    <Panel
      title="تعاملات المستثمرين"
      description={`جلسة ${date} — الأرقام من أخبار السوق بعد الإغلاق`}
    >
      <div className="space-y-4">
        <FlowSection title="حسب الجنسية" groups={byNationality} />
        <FlowSection title="حسب النوع" groups={byType} />
        <FlowSection title="التفصيل" groups={cells} />
      </div>
    </Panel>
  );
}
