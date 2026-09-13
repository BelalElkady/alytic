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

import { ApiError, api, post } from "./api";
import { useActiveInvestStyle } from "./invest-style";

/* Types kept intentionally loose: they mirror the existing API responses
 * and must not constrain fields the engine may add. */
/* eslint-disable @typescript-eslint/no-explicit-any */
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
  createdAt?: string;
  trialDaysLeft?: number;
  trialDaysTotal?: number;
  trialActive?: boolean;
  trialEndsAt?: string;
  plan?: "monthly" | "yearly" | "custom" | null;
  subscriptionActive?: boolean;
  currentPeriodEnd?: string | null;
  hasAccess?: boolean;
  [key: string]: any;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

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
  refreshUser: () => Promise<User | null>;
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

// eslint-disable-next-line react-refresh/only-export-components
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

  // Which rule set the engine sizes and gates recommendations with — the
  // same style the settings/portfolio pages already show, kept in the
  // dependency array below so a style change (manual or newly inferred)
  // re-fetches positions with the matching stop/target/recommendation.
  const { style } = useActiveInvestStyle(pf?.trades);

  // Re-reads entitlements without a sign-out. Activation is manual, so a user
  // who has sent their InstaPay transfer needs a way to pick up the unlock the
  // moment an admin grants the period — see SubscribePanel's "حوّلت بالفعل".
  const refreshUser = useCallback(async () => {
    const { user: me } = await api("/api/auth/me");
    setUser(me ?? null);
    return me ?? null;
  }, []);

  /**
   * A 402 means the trial or the subscription ran out mid-session (the tab was
   * open across the expiry). Re-reading /api/auth/me flips hasAccess, which
   * swaps the desk for the subscribe screen — so the user gets that explanation
   * rather than a failed-request error where their portfolio used to be.
   */
  const handledExpiry = useCallback(
    async (caught: unknown) => {
      if (!(caught instanceof ApiError) || caught.status !== 402) return false;
      await refreshUser();
      return true;
    },
    [refreshUser],
  );

  /** Same sequence as before: portfolio → scan of held codes → daily log. */
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const portfolio = await api("/api/portfolio");
      setPf(portfolio);
      const codes = Object.keys(portfolio?.positions ?? {});
      const scanned = codes.length
        ? (await api(`/api/scan?codes=${codes.join(",")}&style=${style}`)).results.filter(
            (r: Row) => r.position,
          )
        : [];
      setRows(scanned);
      setLog((await api("/api/log")).log ?? {});
      setError(null);
    } catch (caught) {
      if (await handledExpiry(caught)) return;
      setError(caught instanceof Error ? caught.message : "حدث خطأ غير متوقع");
    } finally {
      setLoading(false);
    }
  }, [style, handledExpiry]);

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

  const refreshPrices = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
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
                    row.position.shares *
                    (quote.price - row.position.avgCost)
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
      } catch (caught) {
        if (await handledExpiry(caught)) return;
        setPriceError(true);
      }
    },
    [handledExpiry],
  );

  /* Session check on mount — unchanged endpoint and cookie behaviour. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { user: me } = await api("/api/auth/me");
        if (!cancelled && me) {
          setUser(me);
        }
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

  // hasAccess === false means the trial lapsed with no live plan: the desk
  // renders the paywall instead, so loading (and paying for) scans and quotes
  // that the API would answer with 402 anyway is pure waste.
  const hasAccess = user ? user.hasAccess !== false : false;

  useEffect(() => {
    if (!user || !hasAccess) return;
    void loadUniverse();
    void loadIndices();
    void reload();
  }, [user, hasAccess, loadUniverse, loadIndices, reload]);

  useEffect(() => {
    if (!user || !hasAccess) return;
    const timer = setInterval(() => void refreshPrices(), PRICE_REFRESH_MS);
    const onVisible = () => {
      if (!document.hidden) void refreshPrices({ force: true });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user, hasAccess, refreshPrices]);

  // Activation is a manual admin action from a separate session, so a tab
  // that's been open since before the grant never learns about it on its
  // own — trialActive/subscriptionActive were only read once at mount. Catch
  // up whenever the tab regains focus, the same trigger refreshPrices above
  // already uses, so the header badge and paywall reflect a grant without
  // requiring a full reload or logout/login.
  useEffect(() => {
    if (!user) return;
    const onVisible = () => {
      if (!document.hidden) void refreshUser();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [user, refreshUser]);

  // Registration no longer logs the caller in directly (the backend never
  // reveals whether the email was already taken, so it can't hand back a
  // session for either case) — only "login" actually establishes one here.
  const signIn = useCallback(async (mode: "login" | "register", body: Record<string, unknown>) => {
    const result = await post(`/api/auth/${mode}`, body);
    if (mode === "login") setUser(result.user);
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
    refreshUser,
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
