/**
 * Independent technical-indicator cross-check, exposed to the analyst as a
 * client-side tool (see `client.js`'s tool-use loop and `analyst.js`'s
 * `crossCheckTool`).
 *
 * This calls out to `scripts/cross_check_indicators.py`, which fetches its
 * own price series via yfinance and recomputes RSI/MACD/Bollinger with
 * pandas — a second data source and a second implementation, independent of
 * Alytic's own `src/ta/indicators.js` and `src/data/yahoo.js`. It exists so
 * the model can notice "my own engine disagrees with an outside source" as a
 * real signal, not so it can pick whichever number it prefers: the engine's
 * own numbers remain authoritative for every stop, target and quantity the
 * app acts on. A discrepancy here is worth a `riskFlags` or `conflictNoted`
 * entry, never a reason to override the brief.
 */

import { execFile } from 'node:child_process';
import { toYahoo } from '../config/universe.js';

const PYTHON = process.env.ALYTIC_PYTHON ?? 'python';
const SCRIPT_PATH = new URL('../../scripts/cross_check_indicators.py', import.meta.url).pathname
  .replace(/^\/([A-Za-z]:)/, '$1'); // strip the leading slash Windows file URLs pick up
const TIMEOUT_MS = 20_000;

/**
 * @param {string} code - EGX ticker code, e.g. 'COMI'
 * @returns {Promise<object>} the script's JSON output — either indicator
 *   values or `{ error }` on failure. Never throws for a bad ticker or empty
 *   series; only throws if the interpreter itself can't be run at all.
 */
export async function crossCheckIndicators(code) {
  const symbol = toYahoo(code);
  return new Promise((resolve, reject) => {
    execFile(PYTHON, [SCRIPT_PATH, symbol], { timeout: TIMEOUT_MS }, (err, stdout, stderr) => {
      if (err) {
        // A timeout or a missing interpreter is an environment problem, not a
        // per-ticker one — report it the same way the script reports its own
        // errors so the caller has one shape to handle either way.
        resolve({ error: `تعذر تشغيل أداة التحقق المستقلة: ${err.message}${stderr ? ` — ${stderr.slice(0, 300)}` : ''}` });
        return;
      }
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        resolve({ error: `رد غير صالح من أداة التحقق المستقلة: ${stdout.slice(0, 300)}` });
      }
    });
  });
}
