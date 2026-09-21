#!/usr/bin/env node
/**
 * Grants (or revokes) the marketer role for an existing account: a read-only
 * view of the admin users table, and nothing else. Like make-admin.mjs there is
 * no UI for this on purpose.
 *
 *   node scripts/make-marketer.mjs someone@example.com          grant
 *   node scripts/make-marketer.mjs someone@example.com --revoke revoke
 */

import '../src/loadEnv.js';
import { getUserByEmail, setUserMarketer } from '../src/db.js';

const email = process.argv[2];
const revoke = process.argv.includes('--revoke');

if (!email) {
  console.error('Usage: node scripts/make-marketer.mjs <email> [--revoke]');
  process.exit(1);
}

const user = await getUserByEmail(email);
if (!user) {
  console.error(`No account found for ${email}`);
  process.exit(1);
}

if (!revoke && user.is_admin) {
  console.error(`${user.email} is an admin — revoke that first: node scripts/make-admin.mjs ${user.email} --revoke`);
  process.exit(1);
}

await setUserMarketer(user.id, !revoke);
console.log(`${revoke ? 'Revoked' : 'Granted'} marketer for ${user.email} (${user.id})`);
