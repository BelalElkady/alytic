import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = process.env.ALYTIC_DB_PATH ?? path.join(DATA_DIR, 'alytic.db');

fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL DEFAULT '',
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    google_id TEXT,
    email_verified INTEGER NOT NULL DEFAULT 0,
    verification_token TEXT,
    verification_token_expires TEXT,
    created_at TEXT NOT NULL,
    last_login_at TEXT
  );

  CREATE TABLE IF NOT EXISTS portfolios (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    state_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

  -- One AI-generated market report per (trading day, investor style), shared
  -- by every user rather than regenerated per request. See
  -- src/agent/marketAnalysis.js — this is the whole point of that feature:
  -- the deep scan runs once and everyone reads the same row.
  CREATE TABLE IF NOT EXISTS market_reports (
    report_date TEXT NOT NULL,
    style TEXT NOT NULL,
    report_json TEXT NOT NULL,
    model TEXT,
    usage_json TEXT,
    generated_at TEXT NOT NULL,
    PRIMARY KEY (report_date, style)
  );
`);

// Existing databases predate google_id/email_verified/verification_token* —
// add them in place rather than forcing a fresh DB file on every install.
const existingUserColumns = new Set(db.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
for (const [column, definition] of [
  ['google_id', 'TEXT'],
  ['email_verified', "INTEGER NOT NULL DEFAULT 0"],
  ['verification_token', 'TEXT'],
  ['verification_token_expires', 'TEXT'],
]) {
  if (!existingUserColumns.has(column)) db.exec(`ALTER TABLE users ADD COLUMN ${column} ${definition}`);
}

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id) WHERE google_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_users_verification_token ON users(verification_token) WHERE verification_token IS NOT NULL;
`);

db.prepare(`
  INSERT OR IGNORE INTO users (id, email, name, password_salt, password_hash, email_verified, created_at)
  VALUES ('local', 'local@alytic.local', 'Local CLI', 'local', 'local', 1, ?)
`).run(new Date().toISOString());

const findUserByEmail = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE');
const findUserById = db.prepare('SELECT * FROM users WHERE id = ?');
const findUserByGoogleId = db.prepare('SELECT * FROM users WHERE google_id = ?');
const findUserByVerificationToken = db.prepare('SELECT * FROM users WHERE verification_token = ?');
const insertUser = db.prepare(`
  INSERT INTO users (id, email, name, password_salt, password_hash, google_id, email_verified, verification_token, verification_token_expires, created_at)
  VALUES (@id, @email, @name, @passwordSalt, @passwordHash, @googleId, @emailVerified, @verificationToken, @verificationTokenExpires, @createdAt)
`);
const findPortfolio = db.prepare('SELECT state_json FROM portfolios WHERE user_id = ?');
const upsertPortfolio = db.prepare(`
  INSERT INTO portfolios (user_id, state_json, created_at, updated_at)
  VALUES (@userId, @stateJson, @now, @now)
  ON CONFLICT(user_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at
`);

export function getUserByEmail(email) { return findUserByEmail.get(email); }
export function getUserById(id) { return findUserById.get(id); }
export function getUserByGoogleId(googleId) { return findUserByGoogleId.get(googleId); }
export function getUserByVerificationToken(token) { return findUserByVerificationToken.get(token); }
export function createUser(user) {
  insertUser.run({ googleId: null, emailVerified: 0, verificationToken: null, verificationTokenExpires: null, ...user });
}
export function touchUserLogin(id, timestamp) { db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(timestamp, id); }
export function setVerificationToken(id, token, expiresAt) {
  db.prepare('UPDATE users SET verification_token = ?, verification_token_expires = ? WHERE id = ?').run(token, expiresAt, id);
}
export function markEmailVerified(id) {
  db.prepare("UPDATE users SET email_verified = 1, verification_token = NULL, verification_token_expires = NULL WHERE id = ?").run(id);
}
/** Attaches a Google account to an existing email/password user (same email on both). Google already confirmed the address. */
export function linkGoogleAccount(id, googleId) {
  db.prepare('UPDATE users SET google_id = ?, email_verified = 1 WHERE id = ?').run(googleId, id);
}

export function getPortfolio(userId) {
  const row = findPortfolio.get(userId);
  if (!row) return null;
  try { return JSON.parse(row.state_json); }
  catch { return null; }
}

export function putPortfolio(userId, state) {
  const now = new Date().toISOString();
  upsertPortfolio.run({ userId, stateJson: JSON.stringify({ ...state, updatedAt: now }), now });
}

const findMarketReport = db.prepare('SELECT * FROM market_reports WHERE report_date = ? AND style = ?');
const insertMarketReport = db.prepare(`
  INSERT INTO market_reports (report_date, style, report_json, model, usage_json, generated_at)
  VALUES (@reportDate, @style, @reportJson, @model, @usageJson, @generatedAt)
  ON CONFLICT(report_date, style) DO NOTHING
`);

/** @returns {object|null} the stored report for that day/style, or null if never generated. */
export function getMarketReport(reportDate, style) {
  const row = findMarketReport.get(reportDate, style);
  if (!row) return null;
  try {
    return { ...JSON.parse(row.report_json), _meta: { model: row.model, generatedAt: row.generated_at, usage: JSON.parse(row.usage_json ?? 'null') } };
  } catch {
    return null;
  }
}

/**
 * Stores today's report. `ON CONFLICT DO NOTHING` is deliberate: two requests
 * racing to generate the same (date, style) on a quiet morning must not let
 * the second, slightly-different generation silently replace the first —
 * whichever writes first is what every user sees for the rest of the day.
 * @returns {boolean} true if this call's report was the one actually stored.
 */
export function putMarketReport(reportDate, style, report, model, usage) {
  const info = insertMarketReport.run({
    reportDate,
    style,
    reportJson: JSON.stringify(report),
    model: model ?? null,
    usageJson: JSON.stringify(usage ?? null),
    generatedAt: new Date().toISOString(),
  });
  return info.changes > 0;
}

export { db, DB_FILE };
