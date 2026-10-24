/**
 * Stage 1 of the WhatsApp lifecycle rollout: who would get which step, on
 * real data, with nothing sent or written.
 *
 *   npm --prefix backend run whatsapp:dry-run -- --at 2026-11-02T11:00:00+02:00 [--launch-at <ISO>]
 *
 * Reads the `backup` schema of the backup project (last night's copy of
 * production) through BACKUP_DATABASE_URL, inside a READ ONLY transaction,
 * and runs the same dueStepFor() the /due endpoint uses, with every step
 * treated as switched on and nothing sent yet. Prints counts per step and per
 * skip reason, plus up to 10 user ids per step. Phone numbers are never
 * selected — only whether one exists.
 */
import '../src/loadEnv.js';

import pg from 'pg';

import { dueStepFor } from '../src/whatsapp/eligibility.js';
import { DEFAULT_STEPS } from '../src/whatsapp/steps.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

const at = new Date(arg('at') ?? Date.now());
const launchAt = new Date(arg('launch-at') ?? at.getTime() - 3 * DAY_MS);
if (Number.isNaN(at.getTime()) || Number.isNaN(launchAt.getTime())) {
  console.error('whatsapp-dry-run: --at and --launch-at must be ISO dates');
  process.exit(1);
}
if (!process.env.BACKUP_DATABASE_URL) {
  console.error('whatsapp-dry-run: set BACKUP_DATABASE_URL (session pooler string of the backup project, see docs/backups.md)');
  process.exit(1);
}

const steps = Object.fromEntries(Object.entries(DEFAULT_STEPS).map(([key, step]) => [key, { ...step, enabled: true }]));

const client = new pg.Client({ connectionString: process.env.BACKUP_DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query('begin read only');
  // to_jsonb(...)->> reads columns the copy may not have yet (it mirrors
  // production, which gets email_verified_at / whatsapp_opt_out_at only when
  // their schema blocks are applied) as null instead of failing.
  const { rows: users } = await client.query(`
    select id, name, phone is not null as has_phone, is_admin, is_marketer, is_suspended, email_verified, created_at,
           to_jsonb(u)->>'email_verified_at' as email_verified_at,
           to_jsonb(u)->>'whatsapp_opt_out_at' as whatsapp_opt_out_at
    from backup.users u`);
  const { rows: subscriptions } = await client.query('select user_id, current_period_end from backup.subscriptions');
  await client.query('rollback');

  const subscriptionOf = new Map(subscriptions.map((row) => [row.user_id, row]));
  const byStep = new Map();
  const bySkip = new Map();
  for (const row of users) {
    // A stand-in for "has a phone": the real number is never read.
    const user = { ...row, phone: row.has_phone ? 'present' : null };
    const due = dueStepFor({ user, subscription: subscriptionOf.get(row.id) ?? null, sent: [], steps, launchAt, now: at });
    if (due.step) {
      if (!byStep.has(due.step)) byStep.set(due.step, []);
      byStep.get(due.step).push(row.id);
    } else {
      bySkip.set(due.skip, (bySkip.get(due.skip) ?? 0) + 1);
    }
  }

  console.log(`WhatsApp dry run — at ${at.toISOString()}, launch ${launchAt.toISOString()}, ${users.length} users in backup.users`);
  console.log('\nWould send:');
  console.table(Object.fromEntries([...byStep].map(([step, ids]) => [step, { users: ids.length }])));
  console.log('Skipped:');
  console.table(Object.fromEntries([...bySkip].map(([reason, count]) => [reason, { users: count }])));
  for (const [step, ids] of byStep) console.log(`${step}: ${ids.slice(0, 10).join(', ')}${ids.length > 10 ? ', …' : ''}`);
} finally {
  await client.end();
}
