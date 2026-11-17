'use strict';

const bcrypt = require('bcryptjs');
const { db, nowIso, uid } = require('./db');
const { buildConfig } = require('./engine/config');

const ADMIN_USER = process.env.ADMIN_USER || 'A';
const ADMIN_PASS = process.env.ADMIN_PASS || 'Aa0123456789';
const DEMO_PLAYER_PASS = process.env.DEMO_PLAYER_PASS || 'desert888';

const TEAM_COLORS = ['#E7B15C', '#3FE0C8', '#FF7A6B', '#6FA8FF', '#8FD14F', '#B08CFF', '#FF6FA5', '#C9B79A'];
const TEAM_NAMES = ['沙岭一号', '赤狐商队', '枯井行者', '孤星旅团', '风蚀小队', '黑曜驼帮', '落日寻金', '流沙游侠'];

function ensureAdmin() {
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(ADMIN_USER);
  if (exists) return;
  db.prepare(
    'INSERT INTO users (id, username, password_hash, role, active, created_at, must_change) VALUES (?,?,?,?,1,?,0)'
  ).run(uid('u'), ADMIN_USER, bcrypt.hashSync(ADMIN_PASS, 10), 'ADMIN', nowIso());
}

function ensureSession() {
  const row = db
    .prepare("SELECT * FROM sessions WHERE status IN ('DRAFT','OPEN','RUNNING','PAUSED') ORDER BY created_at DESC LIMIT 1")
    .get();
  if (row) return row;
  const cfg = buildConfig({ preset: 'PPT', name: '首场 · 沙漠掘金' });
  const id = uid('s');
  db.prepare(
    `INSERT INTO sessions (id, name, status, current_day, phase, config_json, created_at)
     VALUES (?,?, 'DRAFT', 0, 'IDLE', ?, ?)`
  ).run(id, cfg.task.title, JSON.stringify(cfg), nowIso());
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
}

function ensureDemoTeams(sessionId) {
  const count = db.prepare('SELECT COUNT(*) AS c FROM teams WHERE session_id = ?').get(sessionId).c;
  if (count > 0) return;
  const cfg = buildConfig();
  TEAM_NAMES.forEach((name, i) => {
    const teamId = uid('t');
    db.prepare(
      `INSERT INTO teams (id, session_id, name, slogan, color, cash, water, food, gold, tent_left, compass,
        node_id, status, intel_ids, members_json, created_at)
       VALUES (?,?,?,?,?,?,?,?,0,0,0,'BASE','ALIVE','[]','[]',?)`
    ).run(
      teamId, sessionId, name, '活着回来，就是最大的胜利', TEAM_COLORS[i % TEAM_COLORS.length],
      cfg.start.cash, cfg.start.water, cfg.start.food, nowIso()
    );
    const uname = `team${String(i + 1).padStart(2, '0')}`;
    const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(uname);
    if (!exists) {
      db.prepare(
        'INSERT INTO users (id, username, password_hash, role, team_id, active, created_at) VALUES (?,?,?,?,?,1,?)'
      ).run(uid('u'), uname, bcrypt.hashSync(DEMO_PLAYER_PASS, 10), 'PLAYER', teamId, nowIso());
    }
  });
}

function seed() {
  ensureAdmin();
  const session = ensureSession();
  ensureDemoTeams(session.id);
  return session;
}

module.exports = { seed, ensureAdmin, ADMIN_USER, TEAM_COLORS, TEAM_NAMES };
