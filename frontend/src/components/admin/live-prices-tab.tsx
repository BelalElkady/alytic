import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { ErrorState, LoadingBlock, Notice, Panel, Stat } from "@/components/desk/state-blocks";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/lib/api";
import { arDay, exact, int } from "@/lib/format";

/** Mirrors liveQuoteStatus() in backend/src/data/live-quotes.js. */
export type LivePricesStatus = {
  config: {
    requested: boolean;
    enabled: boolean;
    hasKey: boolean;
    clientReady: boolean;
    allowlist: string[] | null;
    monthlyQuota: number | null;
    billingDay: number;
    ratePerSec: number;
    compare: boolean;
  };
  state: "off" | "ok" | "paused" | "rolled_back";
  sessionOpen: boolean;
  pausedUntil: string | null;
  period: {
    start: string;
    resetsOn: string;
    calls: number;
    quota: number | null;
    stopAt: number | null;
    rolledBack: boolean;
    reason: "count" | "oanor" | null;
    since: string | null;
  } | null;
  counters: {
    oanorCalls: number;
    oanorCodes: number;
    cacheHits: number;
    fromOanor: number;
    fellBack: number;
    rollbacks: number;
    breakerOpens: number;
  };
  events: { at: string; type: "rollback" | "breaker" | "error"; message: string }[];
  gaps: { code: string; pct: number; at: string }[];
};

const STATUS_PATH = "/api/platform/live-prices";
const REFRESH_MS = 30_000;

const EVENT_LABEL: Record<LivePricesStatus["events"][number]["type"], string> = {
  rollback: "الحصة خلصت",
  breaker: "إيقاف مؤقت",
  error: "خطأ",
};

const time = (iso: string) =>
  new Date(iso).toLocaleString("ar-EG", {
    timeZone: "Africa/Cairo",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    numberingSystem: "latn",
  });

/**
 * Whether the live-prices tab needs the admin's attention (subscribers have
 * silently fallen back to TradingView), for the dot on its trigger. Checked
 * once a minute while the admin panel is open.
 */
// eslint-disable-next-line react-refresh/only-export-components -- the hook and the tab it badges belong together
export function useLivePricesAlert(enabled: boolean) {
  const [alert, setAlert] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const check = () =>
      api<LivePricesStatus>(STATUS_PATH)
        .then((status) => {
          if (!cancelled) setAlert(status.state === "rolled_back" || status.state === "paused");
        })
        .catch(() => {});
    void check();
    const timer = setInterval(check, 60_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [enabled]);
  return alert;
}

/**
 * "الأسعار اللحظية": how subscribers' live prices are doing. Falling back to
 * TradingView is silent for Users and never logged, so this tab is the only
 * place the owner learns the oanor quota ran out, or that oanor is failing.
 */
export function LivePricesTab() {
  const [status, setStatus] = useState<LivePricesStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api<LivePricesStatus>(STATUS_PATH)
      .then((result) => {
        setStatus(result);
        setError(null);
      })
      .catch((caught) => setError(caught instanceof Error ? caught.message : "تعذر تحميل الحالة"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  if (error && !status)
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
  if (!status) return <LoadingBlock rows={3} />;

  const { config, period, counters } = status;
  const usedPct = period?.quota ? Math.min(100, (period.calls / period.quota) * 100) : null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <StateNotice status={status} />
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="shrink-0">
          <RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} />
          تحديث
        </Button>
      </div>

      {period && (
        <Panel
          title="حصة الفترة دي"
          description={`من ${arDay(period.start)} — بتتجدد ${arDay(period.resetsOn)}`}
        >
          <div className="space-y-3">
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span>
                <span className="num text-lg font-semibold">{int(period.calls)}</span>
                {period.quota ? (
                  <span className="text-muted-foreground">
                    {" "}
                    من <span className="num">{int(period.quota)}</span> طلب
                  </span>
                ) : (
                  <span className="text-muted-foreground"> طلب</span>
                )}
              </span>
              {period.stopAt !== null && (
                <span className="text-muted-foreground">
                  بيرجع لـ TradingView عند <span className="num">{int(period.stopAt)}</span>
                </span>
              )}
            </div>
            {usedPct !== null ? (
              <Progress value={usedPct} aria-label="نسبة الحصة المستخدمة" />
            ) : (
              <p className="text-[12.5px] text-muted-foreground">
                OANOR_MONTHLY_QUOTA مش متحدد — الوقف هيبقى بس لما oanor نفسه يرفض.
              </p>
            )}
          </div>
        </Panel>
      )}

      <Panel title="من وقت آخر تشغيل للسيرفر">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Stat
            label="طلبات لـ oanor"
            value={<span className="num">{int(counters.oanorCalls)}</span>}
          />
          <Stat
            label="أسعار من oanor"
            value={<span className="num">{int(counters.fromOanor)}</span>}
          />
          <Stat
            label="رجعت لـ TradingView"
            value={<span className="num">{int(counters.fellBack)}</span>}
          />
          <Stat label="من الكاش" value={<span className="num">{int(counters.cacheHits)}</span>} />
          <Stat
            label="إيقاف مؤقت"
            value={<span className="num">{int(counters.breakerOpens)}</span>}
          />
          <Stat label="خلصت الحصة" value={<span className="num">{int(counters.rollbacks)}</span>} />
        </div>
      </Panel>

      <Panel title="آخر الأحداث">
        {status.events.length ? (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-36">الوقت</TableHead>
                <TableHead className="w-28">النوع</TableHead>
                <TableHead>التفاصيل</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {status.events.map((event, index) => (
                <TableRow key={`${event.at}-${index}`}>
                  <TableCell className="num whitespace-nowrap text-[12.5px]">
                    {time(event.at)}
                  </TableCell>
                  <TableCell className="text-[12.5px]">{EVENT_LABEL[event.type]}</TableCell>
                  <TableCell className="text-[12.5px] leading-relaxed">{event.message}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : (
          <p className="text-[13px] text-muted-foreground">مفيش أحداث من وقت آخر تشغيل.</p>
        )}
      </Panel>

      {config.compare && (
        <Panel
          title="الفرق بين oanor و TradingView"
          description="آخر فرق لكل سهم (OANOR_COMPARE=1) — الأكبر الأول."
        >
          {status.gaps.length ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>السهم</TableHead>
                  <TableHead>الفرق</TableHead>
                  <TableHead>الوقت</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {status.gaps.map((gap) => (
                  <TableRow key={gap.code}>
                    <TableCell className="num">{gap.code}</TableCell>
                    <TableCell className="num">
                      {gap.pct > 0 ? "+" : ""}
                      {exact(Math.round(gap.pct * 100) / 100)}%
                    </TableCell>
                    <TableCell className="num text-[12.5px]">{time(gap.at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-[13px] text-muted-foreground">لسه مفيش مقارنات.</p>
          )}
        </Panel>
      )}

      <Panel title="الإعدادات">
        <dl className="grid gap-x-6 gap-y-2 text-[13px] sm:grid-cols-2">
          <Setting label="OANOR_ENABLED" value={config.requested ? "1" : "مقفول"} />
          <Setting label="OANOR_API_KEY" value={config.hasKey ? "متحدد" : "فاضي"} />
          <Setting label="عميل oanor" value={config.clientReady ? "جاهز" : "لسه متكتبش"} />
          <Setting
            label="OANOR_USER_IDS"
            value={
              config.allowlist ? `${config.allowlist.length} حساب (مرحلة التجربة)` : "كل المشتركين"
            }
          />
          <Setting
            label="يوم تجديد الحصة"
            value={<span className="num">{config.billingDay}</span>}
          />
          <Setting
            label="OANOR_RATE_PER_SEC"
            value={<span className="num">{config.ratePerSec}</span>}
          />
          <Setting label="OANOR_COMPARE" value={config.compare ? "شغّال" : "مقفول"} />
        </dl>
      </Panel>
    </div>
  );
}

function StateNotice({ status }: { status: LivePricesStatus }) {
  const { config, period } = status;
  if (status.state === "off") {
    const why = !config.requested
      ? "OANOR_ENABLED مش متحدد"
      : !config.hasKey
        ? "OANOR_API_KEY فاضي"
        : "عميل oanor لسه متكتبش (backend/src/data/oanor.js)";
    return (
      <Notice tone="info" className="flex-1">
        oanor مقفول ({why}) — كل الناس على أسعار TradingView.
      </Notice>
    );
  }
  if (status.state === "rolled_back" && period) {
    return (
      <Notice tone="danger" className="flex-1">
        <p className="font-semibold">
          الحصة خلصت — المشتركين على TradingView (متأخر حوالي ١٥ دقيقة) لحد {arDay(period.resetsOn)}
          .
        </p>
        <p className="mt-1 text-muted-foreground">
          {period.reason === "count"
            ? "وصلنا ٩٥٪ من OANOR_MONTHLY_QUOTA."
            : "oanor رفض الطلبات: الحصة خلصت أو الباقة مش مفعّلة."}
          {period.since ? ` من ${time(period.since)}.` : ""} المشتركين مش شايفين أي حاجة. عشان
          ترجّعها قبل التجديد: رقّي الباقة وارفع OANOR_MONTHLY_QUOTA وأعد تشغيل السيرفر.
        </p>
      </Notice>
    );
  }
  if (status.state === "paused" && status.pausedUntil) {
    return (
      <Notice tone="warn" className="flex-1">
        oanor متوقف مؤقتًا بعد خطأ (شوف آخر الأحداث) — المشتركين على TradingView لحد{" "}
        {time(status.pausedUntil)}، وبعدها بيرجع يجرّب لوحده.
      </Notice>
    );
  }
  return (
    <Notice tone="success" className="flex-1">
      المشتركين بياخدوا أسعار oanor.
      {!status.sessionOpen && " السوق مقفول دلوقتي، فـ oanor مبيتطلبش لحد الجلسة الجاية."}
    </Notice>
  );
}

function Setting({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b py-1.5 last:border-0">
      <dt className="num text-muted-foreground" dir="ltr">
        {label}
      </dt>
      <dd>{value}</dd>
    </div>
  );
}
