import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { ApiError, api, post, patch as patchRequest, del } from "./api";
import {
  clearInvestStyle,
  explicitInvestStyle,
  isStyleKey,
  setInvestStyle,
  useActiveInvestStyle,
  type StyleKey,
} from "./invest-style";

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
  /** Close date (YYYY-MM-DD) the row's analysis is based on. */
  asOf?: string | null;
  midTarget?: any;
  longTarget?: any;
  position: Position;
  /** Not trading today (suspended) — see tradingHalted in backend/src/data/cache.js. */
  halted?: { since: string } | null;
  [key: string]: any;
};
export type Portfolio = any;
/** One /api/quotes entry. */
export type Quote = {
  price?: number;
  changePct?: number | null;
  time?: number | null;
  halted?: { since: string } | null;
};

/**
 * A row priced at the desk's shared live quote — the same price, change and
 * halted state every page shows for that stock, from the same poll.
 */
export function applyQuote<T extends Row>(row: T, quote: Quote | undefined): T {
  if (!quote?.price) return row;
  return {
    ...row,
    price: quote.price,
    lastTradePrice: quote.price,
    lastTradeTime: quote.time,
    changePct: quote.changePct ?? row.changePct,
    halted: "halted" in quote ? quote.halted : row.halted,
    position: row.position ? repricePosition(row.position, quote.price) : row.position,
  };
}

/**
 * Re-derives every price-dependent field of an open position at a live price.
 * The server prices a position once, at fetch time; the live quote then keeps
 * moving, and if only the P&L followed it the stop and target tiles would
 * describe a price the rail above them no longer shows. Mirrors analyze.js:
 * a stop is only breached when the last completed close AND the live price
 * are both under it (stops are honored on a close, not an intraday wick).
 */
export function repricePosition(position: Position, price: number): Position {
  const { shares, avgCost, stop, stopAtClose, targetLevel, closePrice } = position;
  const next = {
    ...position,
    marketValue: shares * price,
    unrealizedEgp: shares * (price - avgCost),
    unrealizedPct: ((price - avgCost) / avgCost) * 100,
  };
  if (typeof stop === "number") {
    next.distanceToStopPct = ((price - stop) / price) * 100;
    // The close is judged against the stop that was in force then, which a
    // stop raised during the session doesn't change.
    if (typeof closePrice === "number")
      next.stopBreached = closePrice < (stopAtClose ?? stop) && price < stop;
  }
  if (typeof targetLevel === "number") {
    next.distanceToTargetPct = ((targetLevel - price) / price) * 100;
  }
  return next;
}
export type LogEntry = any;
/** One AI stock verdict — mirrors backend/src/agent/schemas.js StockVerdictSchema. */
export type Verdict = any;
export type Stock = { code: string; ar?: string; en?: string };
export type User = {
  name?: string;
  email: string;
  phone?: string | null;
  emailVerified?: boolean;
  isAdmin?: boolean;
  /** Read-only view of the admin users table and nothing else (see backend MARKETER_READS). */
  isMarketer?: boolean;
  /** Can manage the white-label sites (see backend isPlatformAdmin). Only ever true on the main site. */
  isPlatformAdmin?: boolean;
  /** Can edit the shared index lists (see backend canEditIndices). Only ever true on the main site. */
  canEditIndices?: boolean;
  createdAt?: string;
  trialDaysLeft?: number;
  trialDaysTotal?: number;
  trialActive?: boolean;
  trialEndsAt?: string;
  plan?: "long_monthly" | "long_yearly" | "trader_monthly" | "trader_yearly" | "custom" | null;
  tier?: "free" | "long" | "trader" | null;
  subscriptionActive?: boolean;
  currentPeriodEnd?: string | null;
  hasAccess?: boolean;
  awaitingEmailVerification?: boolean;
  [key: string]: any;
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export const PRICE_REFRESH_MS = 20 * 1000;
/**
 * How often an open desk re-reads each position's stop and target while the
 * session is on. Live prices arrive every PRICE_REFRESH_MS, but the stop is
 * set by the server (and re-set upward as the price climbs), so it only
 * reaches the card when the analysis is fetched again.
 */
const LEVELS_REFRESH_MS = 5 * 60 * 1000;
/** The shortest gap before a price crossing a target re-reads the levels early. */
const LEVELS_SOON_MS = 30 * 1000;

/** Sun–Thu, 09:30–15:00 Cairo — a little wider than EGX's own 10:00–14:30 session. */
function egxSessionLikelyOpen(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Cairo",
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  if (get("weekday") === "Fri" || get("weekday") === "Sat") return false;
  const minutes = Number(get("hour")) * 60 + Number(get("minute"));
  return minutes >= 9 * 60 + 30 && minutes <= 15 * 60;
}

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
  updateName: (name: string) => Promise<void>;
  refreshUser: () => Promise<User | null>;
  pf: Portfolio;
  rows: Row[];
  /**
   * Stocks the Portfolio holds that `rows` leaves out, as of the last full
   * load — "no-cost": no average cost recorded, so there's no P&L to show;
   * "analysis": the stock's analysis failed. They're in none of the totals.
   */
  unlisted: Array<{ code: string; reason: "no-cost" | "analysis" }>;
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
  /**
   * The latest live quote per code — the one price source for every page.
   * Held stocks are always polled; other codes only while a page watches them.
   */
  quotes: Record<string, Quote>;
  /** Adds codes to the shared price poll (fetched right away); call the returned function to stop. */
  watchQuotes: (codes: string[]) => () => void;
  detailCode: string | null;
  openDetail: (code: string | null) => void;
  marketFocus: "cash" | null;
  openMarket: (focus: "cash" | null) => void;
  manualOpen: boolean;
  setManualOpen: (open: boolean) => void;
  /** Which tab the manual-entry dialog shows when it opens — see openManual. */
  manualTab: "edit" | "new";
  /** Opens the manual-entry dialog on the given tab ("edit" unless asked for "new" — logging a trade). */
  openManual: (tab?: "edit" | "new") => void;
  /** The signed-in user's Portfolios, from GET /api/portfolios — verbatim, refreshed alongside pf. */
  portfolios: Array<{
    id: number;
    name: string;
    style: string | null;
    value: number;
    pl: number;
    cash: number;
    /** Its holdings, so a Portfolio that isn't selected is valued at the same live `quotes` as the one that is. `price` is the fallback for a code with no quote. */
    positions?: Array<{ code: string; shares: number; avgCost: number; price: number }>;
    positionCount: number;
    active: boolean;
    readOnly: boolean;
  }>;
  /** The User's tier cap on Portfolios (#103) — 1 or 3. From GET /api/portfolios. */
  portfolioCap: number;
  /** The Portfolio the desk is currently pointed at, or null before it's known. */
  activePortfolioId: number | null;
  /**
   * Switches the desk to another Portfolio: persists the choice and reloads.
   * `knownStyle` lets a caller that already knows the target's style (a
   * just-created Portfolio, not yet in `portfolios`) skip the lookup.
   */
  switchPortfolio: (id: number, knownStyle?: StyleKey, refreshPortfolioList?: boolean) => void;
  /** Creates a new Portfolio and switches the desk to it. */
  createPortfolio: (name: string, style: StyleKey) => Promise<void>;
  /** Renames and/or restyles a Portfolio, then refreshes the summary list. */
  renamePortfolio: (id: number, patch: { name?: string; style?: StyleKey }) => Promise<void>;
  /** Deletes a Portfolio — blocked server-side if it's the User's last one. */
  deletePortfolio: (id: number) => Promise<void>;
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
  const [marketFocus, setMarketFocus] = useState<"cash" | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualTab, setManualTab] = useState<"edit" | "new">("edit");
  const [portfolios, setPortfolios] = useState<DeskValue["portfolios"]>([]);
  const [portfolioCap, setPortfolioCap] = useState(1);
  const [activePortfolioId, setActivePortfolioId] = useState<number | null>(null);
  const openManual = useCallback((tab: "edit" | "new" = "edit") => {
    setManualTab(tab);
    setManualOpen(true);
  }, []);

  const rowsRef = useRef<Row[]>([]);
  rowsRef.current = rows;
  const lastRefreshAt = useRef(0);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [unlisted, setUnlisted] = useState<DeskValue["unlisted"]>([]);
  // Codes a page (the market or cash scan) wants priced beyond the held ones,
  // counted so two views watching the same code don't drop it for each other.
  const watchedRef = useRef(new Map<string, number>());

  // Which rule set the engine sizes and gates recommendations with — the
  // same style the settings/portfolio pages already show, kept in the
  // dependency array below so a style change (manual or newly inferred)
  // re-fetches positions with the matching stop/target/recommendation.
  const { style } = useActiveInvestStyle(pf?.trades);

  // Keeps the manual style pick and its server copy in step once the
  // portfolio loads: a pick made on this device (including ones from before
  // the server kept a copy) is pushed up, and a pick made on another device
  // is adopted here when this one is still in auto mode.
  const serverStyle = pf ? (pf.settings?.investStyle ?? null) : undefined;
  useEffect(() => {
    if (serverStyle === undefined) return;
    const local = explicitInvestStyle();
    if (local && local !== serverStyle) {
      void post("/api/settings/style", { style: local }).catch(() => { });
    } else if (!local && isStyleKey(serverStyle)) {
      setInvestStyle(serverStyle);
    }
  }, [serverStyle]);

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

  const reloadPortfolioList = useCallback(async () => {
    const { portfolios: list, activePortfolioId: activeId, cap } = await api("/api/portfolios");
    setPortfolios(list ?? []);
    setActivePortfolioId(activeId ?? null);
    setPortfolioCap(cap ?? 1);
  }, []);

  /**
   * Same sequence as before: portfolio → scan of held codes → daily log.
   * `pf` and `rows` are committed together, only once both are known — never
   * `pf` alone — because `totals` reads `pf.cash` and `rows` together
   * (below): committing `pf` first would briefly blend the new Portfolio's
   * cash with the previous one's still-stale position values, a jump the
   * desk switcher made visible as numbers "hallucinating" before settling.
   */
  const reload = useCallback(async ({
    refreshPortfolioList = true,
    scanStyle = style,
  }: { refreshPortfolioList?: boolean; scanStyle?: StyleKey } = {}) => {
    setLoading(true);
    try {
      const portfolio = await api("/api/portfolio");
      const codes = Object.keys(portfolio?.positions ?? {});
      const scanned = codes.length
        ? (await api(`/api/scan?codes=${codes.join(",")}&style=${scanStyle}`)).results.filter(
          (r: Row) => r.position,
        )
        : [];
      setPf(portfolio);
      setRows(scanned);
      const listed = new Set((scanned as Row[]).map((row) => row.code));
      setUnlisted(
        codes
          .filter((code) => (portfolio.positions[code]?.shares ?? 0) > 0 && !listed.has(code))
          .map((code) => ({
            code,
            reason: portfolio.positions[code].avgCost > 0 ? ("analysis" as const) : ("no-cost" as const),
          })),
      );
      // The switcher values a Portfolio from `quotes` once it's no longer the
      // selected one — so they must hold the very prices its rows showed
      // while it was, or its profit would change just by switching away.
      setQuotes((previous) => {
        const next = { ...previous };
        for (const row of scanned as Row[]) {
          if (row.price) next[row.code] = { ...next[row.code], price: row.price };
        }
        return next;
      });
      if (refreshPortfolioList) {
        // A transient failure here (or a version-skew 404 against an old
        // cached bundle) must never block the rest of reload()'s fetches,
        // which the UI does depend on — the desk switcher just goes empty.
        try {
          await reloadPortfolioList();
        } catch {
          setPortfolios([]);
          setActivePortfolioId(null);
          setPortfolioCap(1);
        }
      }
      setLog((await api("/api/log")).log ?? {});
      setError(null);
    } catch (caught) {
      if (await handledExpiry(caught)) return;
      setError(caught instanceof Error ? caught.message : "حدث خطأ غير متوقع");
    } finally {
      setLoading(false);
    }
  }, [style, handledExpiry, reloadPortfolioList]);

  const reloadPortfolio = useCallback(async () => {
    setPf(await api("/api/portfolio"));
    try {
      await reloadPortfolioList();
    } catch {
      // Keep the previous all-wallet summary if its refresh fails.
    }
  }, [reloadPortfolioList]);

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

  /**
   * Re-reads the held stocks' analysis so stops and targets follow the market
   * during the session: the server re-sets a stop upward as the price climbs,
   * and sets a new target once the price passes one. Runs quietly — no loading
   * state — and keeps the newer live price the quote poll may already have put
   * on the row rather than the one the scan saw. `soon` is for a price that
   * just crossed a target: it waits only LEVELS_SOON_MS since the last read,
   * not the full interval.
   */
  // Starts at "now": the desk's own load has just read the levels.
  const lastLevelsAt = useRef(Date.now());
  const refreshLevels = useCallback(
    async ({ soon = false }: { soon?: boolean } = {}) => {
      const current = rowsRef.current;
      if (!current.length || document.hidden || !egxSessionLikelyOpen()) return;
      const minGap = soon ? LEVELS_SOON_MS : LEVELS_REFRESH_MS - 1000;
      if (Date.now() - lastLevelsAt.current < minGap) return;
      lastLevelsAt.current = Date.now();
      try {
        const codes = current.map((row) => row.code).join(",");
        const { results } = await api(
          `/api/scan?codes=${encodeURIComponent(codes)}&style=${style}`,
        );
        const fresh = new Map<string, Row>(
          (results as Row[]).filter((r) => r.position).map((r) => [r.code, r]),
        );
        setRows((previous) =>
          previous.map((row) => {
            const next = fresh.get(row.code);
            if (!next) return row;
            if (!(row.price && next.position)) return next;
            return {
              ...next,
              price: row.price,
              lastTradePrice: row.lastTradePrice,
              lastTradeTime: row.lastTradeTime,
              changePct: row.changePct,
              position: repricePosition(next.position, row.price),
            };
          }),
        );
      } catch (caught) {
        await handledExpiry(caught);
      }
    },
    [style, handledExpiry],
  );

  const refreshPrices = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      const current = rowsRef.current;
      // One request for every code on any page, so the portfolio, market and
      // cash views never show a stock at two different prices.
      const codes = [...new Set([...current.map((row) => row.code), ...watchedRef.current.keys()])];
      if (
        !codes.length ||
        (typeof document !== "undefined" && document.hidden) ||
        !egxSessionLikelyOpen()
      )
        return;
      if (!force && Date.now() - lastRefreshAt.current < PRICE_REFRESH_MS - 1000) return;
      lastRefreshAt.current = Date.now();
      try {
        const { quotes } = (await api(
          `/api/quotes?codes=${encodeURIComponent(codes.join(","))}`,
        )) as {
          quotes?: Record<string, Quote>;
        };
        // A price that has just run past a stock's target needs a new one, and
        // only the server sets it — don't wait out the interval for that.
        // `reachedTarget` being set means the server already handled this one.
        const crossedTarget = current.some((row) => {
          const q = quotes?.[row.code]?.price;
          const p = row.position;
          return (
            q && p && typeof p.targetLevel === "number" && q >= p.targetLevel && !p.reachedTarget
          );
        });
        if (crossedTarget) void refreshLevels({ soon: true });
        setQuotes((previous) => ({ ...previous, ...quotes }));
        setRows((previous) => previous.map((row) => applyQuote(row, quotes?.[row.code])));
        setPriceError(false);
        setLastPriceSync(
          new Date().toLocaleTimeString("ar-EG", {
            hour: "2-digit",
            minute: "2-digit",
            numberingSystem: "latn",
          }),
        );
      } catch (caught) {
        if (await handledExpiry(caught)) return;
        setPriceError(true);
      }
    },
    [handledExpiry, refreshLevels],
  );

  const watchQuotes = useCallback(
    (codes: string[]) => {
      const watched = watchedRef.current;
      for (const code of codes) watched.set(code, (watched.get(code) ?? 0) + 1);
      // Price the new codes now — and the held ones with them, in the same
      // request — rather than leaving them on the scan's price until the next tick.
      void refreshPrices({ force: true });
      return () => {
        for (const code of codes) {
          const count = (watched.get(code) ?? 0) - 1;
          if (count > 0) watched.set(code, count);
          else watched.delete(code);
        }
      };
    },
    [refreshPrices],
  );

  // Every Portfolio's holdings are priced, not just the selected one's, so the
  // switcher can value them all from the same quotes. The poll only runs
  // during the session — outside it, one fetch fills in the codes the
  // selected Portfolio's own scan hasn't already priced.
  const walletCodes = useMemo(
    () => [...new Set(portfolios.flatMap((p) => (p.positions ?? []).map((x) => x.code)))].sort().join(","),
    [portfolios],
  );
  useEffect(() => {
    if (!walletCodes) return;
    const stop = watchQuotes(walletCodes.split(","));
    if (!egxSessionLikelyOpen()) {
      void api(`/api/quotes?codes=${encodeURIComponent(walletCodes)}`)
        .then(({ quotes: fresh }: { quotes?: Record<string, Quote> }) =>
          setQuotes((previous) => ({ ...fresh, ...previous })),
        )
        .catch(() => {});
    }
    return stop;
  }, [walletCodes, watchQuotes]);

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

  const initialLoad = useEffectEvent(() => {
    void loadUniverse();
    void loadIndices();
    void reload();
  });

  useEffect(() => {
    if (!user || !hasAccess) return;
    initialLoad();
  }, [user, hasAccess]);

  useEffect(() => {
    if (!user || !hasAccess) return;
    const timer = setInterval(() => void refreshPrices(), PRICE_REFRESH_MS);
    const levelsTimer = setInterval(() => void refreshLevels(), LEVELS_REFRESH_MS);
    const onVisible = () => {
      if (!document.hidden) {
        void refreshPrices({ force: true });
        void refreshLevels();
        // The same account can change on another device while this tab sits in
        // the background — a trade, or a recommendation asked for there (kept
        // in pf.lastVerdicts). A phone keeps a tab open for days, so without
        // this it went on showing the portfolio it first loaded.
        void reloadPortfolio().catch(() => { });
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      clearInterval(levelsTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [user, hasAccess, refreshPrices, refreshLevels, reloadPortfolio]);

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
  // The style pick lives in localStorage, which belongs to the browser, not the
  // account — so whoever signs in starts from a clean slate and gets the saved
  // server copy adopted (see the sync effect above) or, with none, is asked to
  // choose. Otherwise a second person on a shared device would silently inherit
  // the previous person's pick and skip the mandatory choice.
  const signIn = useCallback(async (mode: "login" | "register", body: Record<string, unknown>) => {
    const result = await post(`/api/auth/${mode}`, body);
    if (mode === "login") {
      clearInvestStyle();
      setUser(result.user);
    }
  }, []);

  const signInWithGoogle = useCallback(async (credential: string) => {
    const result = await post("/api/auth/google", { credential });
    clearInvestStyle();
    setUser(result.user);
  }, []);

  const signOut = useCallback(async () => {
    await post("/api/auth/logout");
    if (typeof window !== "undefined") window.location.reload();
  }, []);

  const resendVerification = useCallback(async (email: string) => {
    await post("/api/auth/resend-verification", { email });
  }, []);

  // The trial only unlocks once the email is confirmed (see accessInfo on the
  // backend), so flipping the local flag isn't enough — re-read the entitlement
  // picture too, or a signed-in user would still see the "confirm your email"
  // wall until the next tab refocus.
  const markEmailVerified = useCallback(() => {
    setUser((previous) => (previous ? { ...previous, emailVerified: true } : previous));
    void refreshUser().catch(() => { });
  }, [refreshUser]);

  const updatePhone = useCallback(async (phone: string) => {
    const result = await post("/api/account/phone", { phone });
    setUser(result.user);
  }, []);

  const updateName = useCallback(async (name: string) => {
    const result = await post("/api/account/name", { name });
    setUser(result.user);
  }, []);

  // Persists the choice under the same key activePortfolioHeader() reads, so
  // every subsequent request (including this reload) is scoped to it.
  //
  // Also adopts the target Portfolio's own style locally, *before* reload()
  // lands: the sync effect above (serverStyle) treats this device's local
  // style as the thing to push to the server whenever it differs from what
  // just loaded. Switching Portfolios changes serverStyle to a different
  // Portfolio's style on purpose — without adopting it first, that effect
  // reads it as a stale local pick and overwrites the Portfolio being
  // switched to with whatever style this device last had active, silently
  // discarding the style it was created or renamed with.
  const switchPortfolio = useCallback(
    (id: number, knownStyle?: StyleKey, refreshPortfolioList = false) => {
      try {
        localStorage.setItem("alytic-active-portfolio", String(id));
      } catch {
        /* localStorage unavailable — the switch still applies for this session */
      }
      const style = knownStyle ?? portfolios.find((p) => p.id === id)?.style;
      if (isStyleKey(style)) setInvestStyle(style);
      setActivePortfolioId(id);
      setPortfolios((current) => current.map((portfolio) => ({ ...portfolio, active: portfolio.id === id })));
      // Clears the totals along with the tag: otherwise the switcher's active
      // highlight and HeroBar's name tag jump to the new Portfolio instantly,
      // while its numbers stay the previous Portfolio's until reload()
      // resolves — reload()'s loading skeleton (HeroBar) takes over instead.
      setPf(null);
      setRows([]);
      setUnlisted([]);
      void reload({ refreshPortfolioList, scanStyle: isStyleKey(style) ? style : undefined });
    },
    [reload, portfolios],
  );

  /** Creates a new Portfolio and switches the desk to it. */
  const createPortfolio = useCallback(
    async (name: string, style: StyleKey) => {
      const { id } = await post("/api/portfolios", { name, style });
      // Known immediately — the summary list a plain switch reads from
      // doesn't include this Portfolio yet (it only refreshes via reload()).
      switchPortfolio(id, style, true);
    },
    [switchPortfolio],
  );

  /** Renames and/or restyles a Portfolio, then refreshes the summary list. */
  const renamePortfolio = useCallback(
    async (id: number, patch: { name?: string; style?: StyleKey }) => {
      await patchRequest(`/api/portfolios/${id}`, patch);
      // Restyling the Portfolio currently open adopts it locally too — same
      // clobber risk switchPortfolio guards against, see its comment.
      if (patch.style && id === activePortfolioId) setInvestStyle(patch.style);
      await reload();
    },
    [reload, activePortfolioId],
  );

  /**
   * Deletes a Portfolio. If it was the active one, switches to whichever
   * Portfolio the server falls back to (the primary) rather than leaving
   * activePortfolioId/localStorage pointing at a now-deleted id.
   */
  const deletePortfolio = useCallback(
    async (id: number) => {
      await del(`/api/portfolios/${id}`);
      if (activePortfolioId === id) {
        const { activePortfolioId: fallbackId, portfolios: list, cap } = await api("/api/portfolios");
        setPortfolios(list ?? []);
        setPortfolioCap(cap ?? 1);
        const fallback = list?.find((p: { id: number }) => p.id === fallbackId) ?? list?.[0];
        switchPortfolio(fallback?.id, fallback?.style);
      } else {
        await reload();
      }
    },
    [activePortfolioId, reload, switchPortfolio],
  );

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
    updateName,
    refreshUser,
    pf,
    rows,
    unlisted,
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
    quotes,
    watchQuotes,
    detailCode,
    openDetail: setDetailCode,
    marketFocus,
    openMarket: setMarketFocus,
    manualOpen,
    setManualOpen,
    manualTab,
    openManual,
    portfolios,
    portfolioCap,
    activePortfolioId,
    switchPortfolio,
    createPortfolio,
    renamePortfolio,
    deletePortfolio,
  };

  return <DeskContext.Provider value={value}>{children}</DeskContext.Provider>;
}
