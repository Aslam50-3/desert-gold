'use strict';

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_FILE = process.env.DB_FILE || path.join(DATA_DIR, 'desert-gold.db');
const db = new Database(DB_FILE);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'PLAYER',
  team_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  fails INTEGER NOT NULL DEFAULT 0,
  lock_until TEXT,
  must_change INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  current_day INTEGER NOT NULL DEFAULT 0,
  phase TEXT NOT NULL DEFAULT 'IDLE',
  phase_ends_at TEXT,
  open_from TEXT,
  open_to TEXT,
  config_json TEXT NOT NULL,
  next_return_rank INTEGER NOT NULL DEFAULT 1,
  settled_json TEXT NOT NULL DEFAULT '[]',
  paused_ms INTEGER,
  created_at TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT
);

CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  name TEXT NOT NULL,
  slogan TEXT,
  color TEXT NOT NULL,
  cash INTEGER NOT NULL DEFAULT 1000,
  water INTEGER NOT NULL DEFAULT 0,
  food INTEGER NOT NULL DEFAULT 0,
  gold INTEGER NOT NULL DEFAULT 0,
  tent_left INTEGER NOT NULL DEFAULT 0,
  compass INTEGER NOT NULL DEFAULT 0,
  node_id TEXT NOT NULL DEFAULT 'BASE',
  arrived_day INTEGER,
  status TEXT NOT NULL DEFAULT 'ALIVE',
  lost_until INTEGER,
  lost_weather TEXT,
  return_rank INTEGER,
  returned_day INTEGER,
  returned_at TEXT,
  dead_reason TEXT,
  dead_day INTEGER,
  intel_ids TEXT NOT NULL DEFAULT '[]',
  action_json TEXT,
  client_action_id TEXT,
  submitted_at TEXT,
  members_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  day INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  client_action_id TEXT UNIQUE NOT NULL,
  submitted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  day INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cost_totals (
  session_id TEXT NOT NULL,
  day INTEGER NOT NULL,
  team_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (session_id, day, team_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  actor TEXT,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS broadcasts (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  level TEXT NOT NULL DEFAULT 'info',
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reports ON reports(session_id, day);
CREATE INDEX IF NOT EXISTS idx_actions ON actions(session_id, day);
`);

function nowIso() {
  return new Date().toISOString();
}

function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

module.exports = { db, nowIso, uid, DB_FILE, DATA_DIR };
