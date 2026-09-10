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
`);

db.prepare(`
  INSERT OR IGNORE INTO users (id, email, name, password_salt, password_hash, created_at)
  VALUES ('local', 'local@alytic.local', 'Local CLI', 'local', 'local', ?)
`).run(new Date().toISOString());

const findUserByEmail = db.prepare('SELECT * FROM users WHERE email = ? COLLATE NOCASE');
const findUserById = db.prepare('SELECT * FROM users WHERE id = ?');
const insertUser = db.prepare(`
  INSERT INTO users (id, email, name, password_salt, password_hash, created_at)
  VALUES (@id, @email, @name, @passwordSalt, @passwordHash, @createdAt)
`);
const findPortfolio = db.prepare('SELECT state_json FROM portfolios WHERE user_id = ?');
const upsertPortfolio = db.prepare(`
  INSERT INTO portfolios (user_id, state_json, created_at, updated_at)
  VALUES (@userId, @stateJson, @now, @now)
  ON CONFLICT(user_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at
`);

export function getUserByEmail(email) { return findUserByEmail.get(email); }
export function getUserById(id) { return findUserById.get(id); }
export function createUser(user) { insertUser.run(user); }
export function touchUserLogin(id, timestamp) { db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(timestamp, id); }

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

export { db, DB_FILE };
