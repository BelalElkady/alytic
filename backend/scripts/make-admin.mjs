#!/usr/bin/env node
/**
 * Grants (or revokes) admin access for an existing account, so it can reach
 * the /admin dashboard (index CSV uploads). There is no UI for this on
 * purpose — the first admin has to be set from the machine running the DB.
 *
 *   node scripts/make-admin.mjs someone@example.com          grant
 *   node scripts/make-admin.mjs someone@example.com --revoke revoke
 */

import { getUserByEmail, setUserAdmin } from '../src/db.js';

const email = process.argv[2];
const revoke = process.argv.includes('--revoke');

if (!email) {
  console.error('Usage: node scripts/make-admin.mjs <email> [--revoke]');
  process.exit(1);
}

const user = getUserByEmail(email);
if (!user) {
  console.error(`No account found for ${email}`);
  process.exit(1);
}

setUserAdmin(user.id, !revoke);
console.log(`${revoke ? 'Revoked' : 'Granted'} admin for ${user.email} (${user.id})`);
