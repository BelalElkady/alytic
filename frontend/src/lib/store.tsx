import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { api, post } from "./api";

/* Types kept intentionally loose: they mirror the existing API responses
 * and must not constrain fields the engine may add. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Position = any;
export type Row = {
  code: string;
  name?: string;
  sector?: string;
  price?: number;
  changePct?: number | null;
  midTarget?: any;
  longTarget?: any;
  position: Position;
  [key: string]: any;
};
export type Portfolio = any;
export type LogEntry = any;
export type Stock = { code: string; ar?: string; en?: string };
export type User = {
  name?: string;
  email: string;
  phone?: string | null;
  emailVerified?: boolean;
  isAdmin?: boolean;
  [key: string]: any;
};

export const PRICE_REFRESH_MS = 20 * 1000;

type Totals = {
  cost: number;
  value: number;
  pl: number;
  plPct: number;
  day: number;
  cash: number;
  hasDay: boolean;
};

type DeskValue = {
  user: User | null;
  authChecked: boolean;
  signIn: (mode: "login" | "register", body: Record<string, unknown>) => Promise<void>;
  signInWithGoogle: (credential: string) => Promise<void>;
  signOut: () => Promise<void>;
  resendVerification: (email: string) => Promise<void>;
  markEmailVerified: () => void;
  updatePhone: (phone: string) => Promise<void>;
  pf: Portfolio;
  rows: Row[];
  log: Record<string, LogEntry>;
  universe: Stock[];
  indices: Record<string, string[]>;
  aiAvailable: boolean;
  loading: boolean;
  error: string | null;
  lastPriceSync: string | null;
  priceError: boolean;
  totals: Totals;
  reload: () => Promise<void>;
  reloadPortfolio: () => Promise<void>;
  reloadLog: () => Promise<void>;
  refreshPrices: (options?: { force?: boolean }) => Promise<void>;
  detailCode: string | null;
  openDetail: (code: string | null) => void;
  marketFocus: "market" | "cash" | null;
  openMarket: (focus: "market" | "cash" | null) => void;
  manualOpen: boolean;
  setManualOpen: (open: boolean) => void;
};

const DeskContext = createContext<DeskValue | null>(null);

export function useDesk() {
  const value = useContext(DeskContext);
  if (!value) throw new Error("useDesk must be used inside <DeskProvider>");
  return value;
}

export function DeskProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [pf, setPf] = useState<Portfolio>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [log, setLog] = useState<Record<string, LogEntry>>({});
  const [universe, setUniverse] = useState<Stock[]>([]);
  const [indices, setIndices] = useState<Record<string, string[]>>({});
  const [aiAvailable, setAiAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPriceSync, setLastPriceSync] = useState<string | null>(null);
  const [priceError, setPriceError] = useState(false);
  const [detailCode, setDetailCode] = useState<string | null>(null);
  const [marketFocus, setMarketFocus] = useState<"market" | "cash" | null>(null);
  const [manualOpen, setManualOpen] = useState(false);

  const rowsRef = useRef<Row[]>([]);
  rowsRef.current = rows;
  const lastRefreshAt = useRef(0);

  /** Same sequence as before: portfolio → scan of held codes → daily log. */
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const portfolio = await api("/api/portfolio");
      setPf(portfolio);
      const codes = Object.keys(portfolio?.positions ?? {});
      const scanned = codes.length
        ? (await api(`/api/scan?codes=${codes.join(",")}`)).results.filter((r: Row) => r.position)
        : [];
      setRows(scanned);
      setLog((await api("/api/log")).log ?? {});
      setError(null);
    } catch (caught: any) {
      setError(caught?.message ?? "حدث خطأ غير متوقع");
    } finally {
      setLoading(false);
    }
  }, []);

  const reloadPortfolio = useCallback(async () => {
    setPf(await api("/api/portfolio"));
  }, []);

  const reloadLog = useCallback(async () => {
    setLog((await api("/api/log")).log ?? {});
  }, []);

  const loadUniverse = useCallback(async () => {
    try {
      const { stocks, aiAvailable: ai } = await api("/api/universe");
      setUniverse([...stocks].sort((a: Stock, b: Stock) => a.code.localeCompare(b.code)));
      setAiAvailable(Boolean(ai));
    } catch {
      setUniverse([]);
    }
  }, []);

  const loadIndices = useCallback(async () => {
    try {
      const { indices: byIndex } = await api("/api/indices");
      const byCode: Record<string, string[]> = {};
      for (const [name, codes] of Object.entries(byIndex ?? {}) as [string, string[]][]) {
        for (const code of codes) (byCode[code] ??= []).push(name);
      }
      setIndices(byCode);
    } catch {
      setIndices({});
    }
  }, []);

  const refreshPrices = useCallback(async ({ force = false }: { force?: boolean } = {}) => {
    const current = rowsRef.current;
    if (!current.length || (typeof document !== "undefined" && document.hidden)) return;
    if (!force && Date.now() - lastRefreshAt.current < PRICE_REFRESH_MS - 1000) return;
    lastRefreshAt.current = Date.now();
    try {
      const codes = current.map((row) => row.code).join(",");
      const { quotes } = await api(`/api/quotes?codes=${encodeURIComponent(codes)}`);
      setRows((previous) =>
        previous.map((row) => {
          const quote = quotes?.[row.code];
          if (!quote?.price) return row;
          const position = row.position
            ? {
                ...row.position,
                marketValue: +(row.position.shares * quote.price).toFixed(2),
                unrealizedEgp: +(
                  row.position.shares * (quote.price - row.position.avgCost)
                ).toFixed(2),
                unrealizedPct: +(
                  ((quote.price - row.position.avgCost) / row.position.avgCost) *
                  100
                ).toFixed(2),
              }
            : row.position;
          return {
            ...row,
            price: quote.price,
            lastTradePrice: quote.price,
            lastTradeTime: quote.time,
            changePct: quote.changePct ?? row.changePct,
            position,
          };
        }),
      );
      setPriceError(false);
      setLastPriceSync(
        new Date().toLocaleTimeString("ar-EG", { hour: "2-digit", minute: "2-digit" }),
      );
    } catch {
      setPriceError(true);
    }
  }, []);

  /* Session check on mount — unchanged endpoint and cookie behaviour. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { user: me } = await api("/api/auth/me");
        if (!cancelled && me) setUser(me);
      } catch {
        /* offline or unauthenticated — the auth screen handles both */
      } finally {
        if (!cancelled) setAuthChecked(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!user) return;
    void loadUniverse();
    void loadIndices();
    void reload();
  }, [user, loadUniverse, loadIndices, reload]);

  useEffect(() => {
    if (!user) return;
    const timer = setInterval(() => void refreshPrices(), PRICE_REFRESH_MS);
    const onVisible = () => {
      if (!document.hidden) void refreshPrices({ force: true });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user, refreshPrices]);

  const signIn = useCallback(async (mode: "login" | "register", body: Record<string, unknown>) => {
    const result = await post(`/api/auth/${mode}`, body);
    setUser(result.user);
  }, []);

  const signInWithGoogle = useCallback(async (credential: string) => {
    const result = await post("/api/auth/google", { credential });
    setUser(result.user);
  }, []);

  const signOut = useCallback(async () => {
    await post("/api/auth/logout");
    if (typeof window !== "undefined") window.location.reload();
  }, []);

  const resendVerification = useCallback(async (email: string) => {
    await post("/api/auth/resend-verification", { email });
  }, []);

  const markEmailVerified = useCallback(() => {
    setUser((previous) => (previous ? { ...previous, emailVerified: true } : previous));
  }, []);

  const updatePhone = useCallback(async (phone: string) => {
    const result = await post("/api/account/phone", { phone });
    setUser(result.user);
  }, []);

  const totals = useMemo<Totals>(() => {
    const cost = rows.reduce((sum, r) => sum + r.position.shares * r.position.avgCost, 0);
    const value = rows.reduce((sum, r) => sum + (r.position.marketValue ?? 0), 0);
    const pl = value - cost;
    const day = rows.reduce(
      (sum, r) => sum + ((r.position.shares ?? 0) * (r.price ?? 0) * (r.changePct ?? 0)) / 100,
      0,
    );
    return {
      cost,
      value,
      pl,
      plPct: cost ? (pl / cost) * 100 : 0,
      day,
      cash: pf?.cash ?? 0,
      hasDay: rows.some((r) => r.changePct != null),
    };
  }, [rows, pf]);

  const value: DeskValue = {
    user,
    authChecked,
    signIn,
    signInWithGoogle,
    signOut,
    resendVerification,
    markEmailVerified,
    updatePhone,
    pf,
    rows,
    log,
    universe,
    indices,
    aiAvailable,
    loading,
    error,
    lastPriceSync,
    priceError,
    totals,
    reload,
    reloadPortfolio,
    reloadLog,
    refreshPrices,
    detailCode,
    openDetail: setDetailCode,
    marketFocus,
    openMarket: setMarketFocus,
    manualOpen,
    setManualOpen,
  };

  return <DeskContext.Provider value={value}>{children}</DeskContext.Provider>;
}
