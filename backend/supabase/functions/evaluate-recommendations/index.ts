// Supabase Edge Function: resolves open recommendations once a day.
//
// Called by pg_cron after the EGX close (see supabase/recommendations-cron.sql).
// Reads every row in `recommendations` that is still open or whose horizon
// hasn't ended, the session bars the backend recorded in
// `recommendation_prices`, and writes back each call's outcome (or, while it
// is still open, its running mark) and what the stock actually did over the
// horizon — which keeps being followed after the call itself closes. The rules themselves live in
// evaluate.js so the backend's tests exercise the same code.
//
// Safe to re-run: every run re-reads all bars since each call was issued, and
// each update is conditioned on the row still being open, so two overlapping
// runs can't resolve a call twice. The table's guard trigger refuses any
// change to issue fields or to an already-closed row regardless.

import { createClient } from 'npm:@supabase/supabase-js@2';
import { evaluateRecommendation, evaluateStockMove } from './evaluate.js';

const PAGE = 1000;
// Benchmark index bars, stored in recommendation_prices under these tickers.
const INDICES = ['EGX30', 'EGX70', 'EGX33', 'EGX100'];

type Row = Record<string, unknown>;

// deno-lint-ignore no-explicit-any
async function fetchAll(query: (from: number, to: number) => any): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) return rows;
  }
}

/** Constant-time string comparison, so the secret can't be guessed a character at a time. */
function safeEqual(a: string | null, b: string | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  if (!safeEqual(req.headers.get('X-Cron-Secret'), Deno.env.get('EVALUATE_CRON_SECRET'))) {
    return new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 });
  }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const open = await fetchAll((from, to) =>
      db
        .from('recommendations')
        .select('id, status, ticker, action, ref_price, target_price, stop_price, horizon_days, egx30_at_issue, benchmark, indices_at_issue, issued_on')
        .or('status.eq.open,stock_move_final.eq.false')
        .order('id')
        .range(from, to),
    );
    if (!open.length) return Response.json({ ok: true, open: 0, tracking: 0 });

    const tickers = [...new Set(open.map((r) => String(r.ticker)))];
    const since = open.map((r) => String(r.issued_on)).sort()[0];
    const bars = await fetchAll((from, to) =>
      db
        .from('recommendation_prices')
        .select('ticker, session_date, open, high, low, close')
        .in('ticker', [...tickers, ...INDICES])
        .gt('session_date', since)
        .order('ticker')
        .order('session_date')
        .range(from, to),
    );

    const byTicker = new Map<string, Row[]>();
    for (const b of bars) {
      const list = byTicker.get(String(b.ticker)) ?? [];
      list.push({ ...b, date: b.session_date });
      byTicker.set(String(b.ticker), list);
    }
    const indexCloses = new Map<string, Map<string, number>>(
      INDICES.map((index) => [
        index,
        new Map((byTicker.get(index) ?? []).map((b) => [String(b.session_date), Number(b.close)])),
      ]),
    );

    const evaluatedAt = new Date().toISOString();
    const counts = {
      open: open.filter((r) => r.status === 'open').length,
      tracking: open.filter((r) => r.status !== 'open').length,
      resolved: 0,
      marked: 0,
      stockMoved: 0,
      noData: 0,
      failed: 0,
    };
    for (const rec of open) {
      const after = (byTicker.get(String(rec.ticker)) ?? []).filter((b) => String(b.date) > String(rec.issued_on));
      const stockMove = evaluateStockMove(rec, after);
      if (!stockMove) {
        counts.noData++;
        continue;
      }
      // An open call gets its outcome and the stock's move; a closed one whose
      // horizon still runs gets the stock's move only. Each update is
      // conditioned on the state it was read in, so overlapping runs can't
      // write twice.
      const result = rec.status === 'open' ? evaluateRecommendation(rec, after, indexCloses) : null;
      const query = db
        .from('recommendations')
        .update({ ...(result ?? {}), ...stockMove, evaluated_at: evaluatedAt })
        .eq('id', rec.id);
      const { error } = await (result ? query.eq('status', 'open') : query.eq('stock_move_final', false));
      if (error) {
        counts.failed++;
        console.error(`[evaluate] recommendation ${rec.id}:`, error.message);
      } else if (!result) counts.stockMoved++;
      else if (result.status === 'open') counts.marked++;
      else counts.resolved++;
    }

    console.log('[evaluate]', JSON.stringify(counts));
    return Response.json({ ok: true, ...counts });
  } catch (err) {
    console.error('[evaluate] failed:', err);
    return Response.json({ ok: false, error: String((err as Error).message ?? err) }, { status: 500 });
  }
});
