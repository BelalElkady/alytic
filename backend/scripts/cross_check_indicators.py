#!/usr/bin/env python3
"""
Independent technical-indicator cross-check, called by the Node agent as a
tool (src/agent/crosscheck.js) during a portfolio review.

Alytic's own JS engine (src/ta/indicators.js) is the authoritative source for
every number the app shows or acts on — this script never feeds a stop,
target or quantity back into the app. Its only job is to recompute RSI/MACD/
Bollinger from a second, independently-fetched price series (yfinance instead
of Alytic's own Yahoo client) using a second implementation (pandas instead of
Alytic's hand-rolled JS math), so the analyst has a real way to notice "my own
engine's math or data disagrees with an independent source" instead of only
ever grading itself.

Usage: python cross_check_indicators.py <YAHOO_SYMBOL> [lookback_days]
Prints one JSON object to stdout. Exit code 0 always — errors are reported in
the JSON body (an `error` field), not via exit status, so the Node side gets
a uniform shape to parse rather than juggling stderr.
"""
import sys
import json
from datetime import datetime, timezone

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: cross_check_indicators.py <YAHOO_SYMBOL> [lookback_days]"}))
        return

    symbol = sys.argv[1]
    lookback_days = int(sys.argv[2]) if len(sys.argv) > 2 else 300

    try:
        import yfinance as yf
        import pandas as pd
    except ImportError as e:
        print(json.dumps({"error": f"missing Python dependency: {e}"}))
        return

    try:
        hist = yf.Ticker(symbol).history(period=f"{lookback_days}d", auto_adjust=True)
    except Exception as e:
        print(json.dumps({"error": f"yfinance fetch failed: {e}"}))
        return

    if hist is None or hist.empty or len(hist) < 30:
        print(json.dumps({"error": f"no usable data for {symbol} ({0 if hist is None else len(hist)} bars)"}))
        return

    close = hist["Close"].dropna()

    # RSI(14), Wilder smoothing — same period as Alytic's own src/ta/indicators.js.
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1 / 14, min_periods=14, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / 14, min_periods=14, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, pd.NA)
    rsi = 100 - (100 / (1 + rs))

    # MACD(12, 26, 9)
    ema_fast = close.ewm(span=12, adjust=False).mean()
    ema_slow = close.ewm(span=26, adjust=False).mean()
    macd_line = ema_fast - ema_slow
    signal_line = macd_line.ewm(span=9, adjust=False).mean()
    hist_line = macd_line - signal_line

    # Bollinger(20, 2)
    sma20 = close.rolling(20).mean()
    std20 = close.rolling(20).std()
    bb_upper = sma20 + 2 * std20
    bb_lower = sma20 - 2 * std20

    sma50 = close.rolling(50).mean()
    sma200 = close.rolling(200).mean() if len(close) >= 200 else None

    def last(series):
        if series is None or series.empty:
            return None
        v = series.iloc[-1]
        return None if pd.isna(v) else round(float(v), 2)

    result = {
        "symbol": symbol,
        "asOf": close.index[-1].strftime("%Y-%m-%d"),
        "close": last(close),
        "dataPoints": len(close),
        "rsi14": last(rsi),
        "macd": {"line": last(macd_line), "signal": last(signal_line), "hist": last(hist_line)},
        "bollinger": {"upper": last(bb_upper), "mid": last(sma20), "lower": last(bb_lower)},
        "sma20": last(sma20),
        "sma50": last(sma50),
        "sma200": last(sma200) if sma200 is not None else None,
        "source": "yfinance",
        "fetchedAt": datetime.now(timezone.utc).isoformat(),
    }
    print(json.dumps(result, ensure_ascii=False))

if __name__ == "__main__":
    main()
