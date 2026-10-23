/**
 * Stage 2 of the WhatsApp lifecycle rollout: test-project users at each point
 * of the lifecycle, on the team's own phones, so a copy of the n8n workflow
 * can send every template for real.
 *
 *   npm --prefix backend run whatsapp:seed-test-users -- --phones +201012345678,+201112345678 [--points stoploss,ending]
 *
 * Points, in order: welcome, stoploss, ending, ended, survey, renewal. Phones
 * are unique per account, so each phone holds one point at a time: with fewer
 * phones than points the first ones are seeded and the rest listed as skipped
 * (pick others with --points). Any earlier @test.local user on those phones is
 * deleted first; a phone owned by a real account stops the script.
 *
 * Refuses to run against production, and refuses any phone that isn't on
 * WHATSAPP_ALLOWED_PHONES — the same guard the backend applies.
 */
import '../src/loadEnv.js';

import crypto from 'node:crypto';

import { supabase } from '../src/db.js';
import { normalizePhone } from '../src/phone.js';
import { dueStepFor } from '../src/whatsapp/eligibility.js';
import { DEFAULT_STEPS } from '../src/whatsapp/steps.js';
import { testEmail } from '../test/helpers/test-database.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const POINTS = {
  welcome: 'trial_welcome',
  stoploss: 'trial_stoploss',
  ending: 'trial_ending',
  ended: 'trial_ended',
  survey: 'survey',
  renewal: 'renewal',
};

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}
function fail(message) {
  console.error(`seed-whatsapp-test-users: ${message}`);
  process.exit(1);
}

if (String(process.env.SUPABASE_URL ?? '').includes('xssjwnevhbpcdmtbatiy')) fail('SUPABASE_URL is production — point backend/.env at the test project first.');
const allowed = new Set(String(process.env.WHATSAPP_ALLOWED_PHONES ?? '').split(',').map((p) => normalizePhone(p)).filter(Boolean));
const phones = String(arg('phones') ?? '').split(',').map((p) => normalizePhone(p)).filter(Boolean);
if (!phones.length) fail('pass --phones +2010...,+2011...');
for (const phone of phones) if (!allowed.has(phone)) fail(`${phone} is not on WHATSAPP_ALLOWED_PHONES`);
const points = String(arg('points') ?? Object.keys(POINTS).join(',')).split(',');
for (const point of points) if (!POINTS[point]) fail(`unknown point "${point}" (use ${Object.keys(POINTS).join(', ')})`);

const now = new Date();
const launchAt = new Date(now.getTime() - 30 * DAY_MS);
const steps = Object.fromEntries(Object.entries(DEFAULT_STEPS).map(([key, step]) => [key, { ...step, enabled: true }]));

/**
 * The confirmation time that puts a user at `step` right now. Searched hour by
 * hour with the real rules, so weekends and EGX holidays are accounted for.
 */
function verifiedAtFor(step, subscription) {
  for (let hours = 0; hours < 40 * 24; hours++) {
    const verifiedAt = new Date(now.getTime() - hours * HOUR_MS).toISOString();
    const user = { id: 'probe', name: 'x', phone: 'x', email_verified: true, email_verified_at: verifiedAt, created_at: now.toISOString() };
    if (dueStepFor({ user, subscription, sent: [], steps, launchAt, now }).step === step) return verifiedAt;
  }
  fail(`no confirmation time puts a user at ${step} now`);
}

const seeded = [];
for (const [i, point] of points.entries()) {
  const phone = phones[i];
  if (!phone) {
    console.log(`skipped ${point}: no phone left (re-run with --points ${points.slice(i).join(',')})`);
    continue;
  }
  const { data: owner } = await supabase.from('users').select('id, email').eq('phone', phone).maybeSingle();
  if (owner && !owner.email.endsWith('@test.local')) fail(`${phone} belongs to a real account (${owner.id})`);
  if (owner) await supabase.from('users').delete().eq('id', owner.id);

  const step = POINTS[point];
  const subscription = step === 'renewal' ? { current_period_end: new Date(now.getTime() - 2 * DAY_MS).toISOString() } : null;
  const id = crypto.randomUUID();
  const email = testEmail(`wa-${point}`);
  const { error } = await supabase.from('users').insert({
    id,
    email,
    email_canonical: email,
    name: `اختبار ${point}`,
    phone,
    password_salt: crypto.randomBytes(16).toString('hex'),
    password_hash: crypto.randomBytes(32).toString('hex'),
    email_verified: true,
    email_verified_at: verifiedAtFor(step, subscription),
    created_at: now.toISOString(),
  });
  if (error) fail(`insert ${point}: ${error.message}`);
  if (subscription) {
    const { error: subError } = await supabase
      .from('subscriptions')
      .insert({ user_id: id, plan: 'long_monthly', tier: 'long', current_period_end: subscription.current_period_end });
    if (subError) fail(`subscription for ${point}: ${subError.message}`);
  }
  seeded.push({ point, step, phone, id });
}

console.table(seeded);
console.log('Run the n8n "Fetch Due" node (or wait for the schedule) between 10:00 and 21:00 Cairo time.');
