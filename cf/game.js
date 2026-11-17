'use strict';
/**
 * Cloudflare 版沙盘内核：一个 Durable Object = 一场沙盘。
 * 存储用 DO SQLite（ctx.storage.sql），实时层用 DO 原生 WebSocket，
 * 规则/结算复用 src/engine/*（与 Express 版同一套引擎）。
 */
import cfgMod from '../src/engine/config.js';
import settleMod from '../src/engine/settle.js';
import scoreMod from '../src/engine/score.js';
import rulesMod from '../src/engine/rules.js';

const {
  buildConfig, normalizeConfig, PRESETS,
  TERRAIN, TERRAIN_LABEL, WEATHER_LABEL,
} = cfgMod;
const { settleDay, actionErrors, normalizeAction, previewConsumptionTable } = settleMod;
const { computeScores, balanceProbe } = scoreMod;
const rules = rulesMod;

const TEAM_COLORS = ['#E7B15C', '#3FE0C8', '#FF7A6B', '#6FA8FF', '#8FD14F', '#B08CFF', '#FF6FA5', '#C9B79A'];
const TEAM_NAMES = ['沙岭一号', '赤狐商队', '枯井行者', '孤星旅团', '风蚀小队', '黑曜驼帮', '落日寻金', '流沙游侠'];
const PLAYER_PASS = 'desert888';

const nowIso = () => new Date().toISOString();
const uid = (p) => `${p}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;

/* ------------------------------ 密码 / 令牌 ------------------------------ */

const enc = new TextEncoder();
const b64url = (buf) => {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 60000, hash: 'SHA-256' }, key, 256
  );
  return `pbkdf2$${b64url(salt)}$${b64url(bits)}`;
}

async function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'pbkdf2') return false;
  const salt = Uint8Array.from(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 60000, hash: 'SHA-256' }, key, 256
  );
  return b64url(bits) === parts[2];
}

async function hmacKey(secret) {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function signToken(payload, secret) {
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  return `${body}.${b64url(sig)}`;
}

async function verifyToken(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    const key = await hmacKey(secret);
    const ok = await crypto.subtle.verify('HMAC', key, Uint8Array.from(atob(sig.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)), enc.encode(body));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(body.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))));
    if (payload.exp && payload.exp < Date.now()) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

/* ------------------------------ Durable Object ------------------------------ */

export class GameRoom {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.initSchema();
      const s = this.getMeta('session');
      if (!s) await this.seed();
    });
  }

  /* ---------- 存储 ---------- */

  all(query, ...params) {
    return this.sql.exec(query, ...params).toArray();
  }

  one(query, ...params) {
    const rows = this.all(query, ...params);
    return rows.length ? rows[0] : null;
  }

  initSchema() {
    this.sql.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS teams (id TEXT PRIMARY KEY, idx INTEGER, data TEXT)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS actions (day INTEGER, team_id TEXT, client_id TEXT, data TEXT, PRIMARY KEY (day, team_id))');
    this.sql.exec('CREATE TABLE IF NOT EXISTS reports (day INTEGER, team_id TEXT, data TEXT, PRIMARY KEY (day, team_id))');
    this.sql.exec('CREATE TABLE IF NOT EXISTS broadcasts (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT, level TEXT, created_at TEXT)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, username TEXT UNIQUE, hash TEXT, role TEXT, team_id TEXT, must_change INTEGER, active INTEGER)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS audits (id INTEGER PRIMARY KEY AUTOINCREMENT, actor TEXT, action TEXT, created_at TEXT, payload TEXT)');
  }

  getMeta(key) {
    const row = this.one('SELECT value FROM meta WHERE key=?', key);
    return row ? row.value : null;
  }

  setMeta(key, value) {
    this.sql.exec('INSERT OR REPLACE INTO meta (key, value) VALUES (?,?)', key, value);
  }

  /** 令牌密钥只存在这个 DO 的私有存储里，不进仓库、不进 wrangler 配置。 */
  get jwtSecret() {
    if (this._jwtSecret) return this._jwtSecret;
    let secret = this.getMeta('jwt_secret');
    if (!secret) {
      secret = `${crypto.randomUUID()}${crypto.randomUUID()}`;
      this.setMeta('jwt_secret', secret);
    }
    this._jwtSecret = secret;
    return secret;
  }

  getSession() {
    const raw = this.getMeta('session');
    return raw ? JSON.parse(raw) : null;
  }

  saveSession(s) {
    this.setMeta('session', JSON.stringify(s));
  }

  getTeams() {
    return this.all('SELECT data FROM teams ORDER BY idx ASC').map((r) => JSON.parse(r.data));
  }

  getTeam(id) {
    const row = this.one('SELECT data FROM teams WHERE id=?', id);
    return row ? JSON.parse(row.data) : null;
  }

  saveTeam(t) {
    this.sql.exec('UPDATE teams SET data=? WHERE id=?', JSON.stringify(t), t.id);
  }

  insertTeam(t, idx) {
    this.sql.exec('INSERT OR REPLACE INTO teams (id, idx, data) VALUES (?,?,?)', t.id, idx, JSON.stringify(t));
  }

  getActions(day) {
    const out = {};
    for (const r of this.all('SELECT team_id, data FROM actions WHERE day=?', day)) out[r.team_id] = JSON.parse(r.data);
    return out;
  }

  getReport(day, teamId) {
    const row = this.one('SELECT data FROM reports WHERE day=? AND team_id=?', day, teamId);
    return row ? JSON.parse(row.data) : null;
  }

  lastReport(teamId) {
    const row = this.one('SELECT data FROM reports WHERE team_id=? ORDER BY day DESC LIMIT 1', teamId);
    return row ? JSON.parse(row.data) : null;
  }

  /* ---------- 初始化数据 ---------- */

  async seed() {
    const cfg = normalizeConfig(buildConfig({ preset: 'PPT', name: '首场 · 沙漠掘金' }));
    const session = {
      id: 'main',
      name: cfg.task.title,
      status: 'DRAFT',
      phase: 'IDLE',
      current_day: 0,
      phase_ends_at: null,
      settled: [],
      next_return_rank: 1,
      paused_ms: null,
      config: cfg,
      open_from: null,
      open_to: null,
      created_at: nowIso(),
      started_at: null,
      ended_at: null,
    };
    this.saveSession(session);

    TEAM_NAMES.forEach((name, i) => {
      const team = {
        id: `team${String(i + 1).padStart(2, '0')}`,
        name,
        slogan: '活着回来，就是最大的胜利',
        color: TEAM_COLORS[i % TEAM_COLORS.length],
        cash: cfg.start.cash,
        water: cfg.start.water,
        food: cfg.start.food,
        gold: 0,
        tent_left: 0,
        compass: 0,
        node_id: 'BASE',
        status: 'ALIVE',
        lost_until: null,
        lost_weather: null,
        return_rank: null,
        arrived_day: 0,
        intel_ids: [],
        submitted_at: null,
        dead_reason: null,
        dead_day: null,
        returned_day: null,
        action_json: null,
        client_action_id: null,
      };
      this.insertTeam(team, i);
      this.sql.exec(
        'INSERT OR IGNORE INTO users (id, username, hash, role, team_id, must_change, active) VALUES (?,?,?,?,?,0,1)',
        uid('u'), `team${String(i + 1).padStart(2, '0')}`, '__pending__', 'PLAYER', team.id
      );
    });
    // 口令异步算，先占位再覆盖
    const adminUser = this.env.ADMIN_USER || 'A';
    const adminPass = this.env.ADMIN_PASS || 'Aa0123456789';
    this.sql.exec(
      'INSERT OR IGNORE INTO users (id, username, hash, role, team_id, must_change, active) VALUES (?,?,?,?,?,0,1)',
      uid('u'), adminUser, await hashPassword(adminPass), 'ADMIN', null
    );
    for (let i = 1; i <= TEAM_NAMES.length; i += 1) {
      const uname = `team${String(i).padStart(2, '0')}`;
      this.sql.exec('UPDATE users SET hash=? WHERE username=?', await hashPassword(PLAYER_PASS), uname);
    }
  }

  /* ---------- 广播 / 实时 ---------- */

  broadcast(event, payload) {
    const text = JSON.stringify({ event, payload: payload || {} });
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(text); } catch (e) { /* 忽略断开的连接 */ }
    }
  }

  async webSocketMessage() { /* 前端只收不发，忽略 */ }

  async webSocketClose(ws) {
    try { ws.close(); } catch (e) { /* noop */ }
  }

  postBroadcast(text, level) {
    this.sql.exec('INSERT INTO broadcasts (text, level, created_at) VALUES (?,?,?)', text, level || 'info', nowIso());
    this.broadcast('game:toast', { text, level: level || 'info' });
  }

  recentBroadcasts(limit) {
    return this.all('SELECT text, level, created_at FROM broadcasts ORDER BY id DESC LIMIT ?', limit || 12);
  }

  /* ---------- 阶段机 ---------- */

  async schedule() {
    const s = this.getSession();
    if (!s || !s.phase_ends_at || s.status === 'PAUSED' || s.status === 'ENDED' || s.status === 'DRAFT') {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    const at = Math.max(Date.now() + 50, Date.parse(s.phase_ends_at));
    await this.ctx.storage.setAlarm(at);
  }

  async alarm() {
    await this.tick();
    await this.schedule();
  }

  async tick() {
    let guard = 0;
    while (guard < 4) {
      guard += 1;
      const s = this.getSession();
      if (!s) break;
      if (s.status === 'PAUSED' || s.status === 'ENDED' || s.status === 'DRAFT') break;
      if (!s.phase_ends_at) break;
      if (Date.parse(s.phase_ends_at) > Date.now() + 30) break;
      this.advance(s);
    }
    await this.schedule();
  }

  beginDay(day) {
    const s = this.getSession();
    const cfg = s.config;
    s.current_day = day;
    s.status = 'RUNNING';
    s.paused_ms = null;
    const brief = day === 1 ? Math.max(cfg.timing.briefSeconds, 15) : cfg.timing.briefSeconds;
    s.phase = 'BRIEF';
    s.phase_ends_at = new Date(Date.now() + brief * 1000).toISOString();
    this.saveSession(s);
    this.broadcast('game:dayStart', { day, totalDays: cfg.session.totalDays, weather: this.publicWeather(day) });
    this.broadcast('game:refresh', {});
  }

  beginAction() {
    const s = this.getSession();
    const cfg = s.config;
    const secs = s.current_day === 1 ? cfg.timing.day1Seconds : cfg.timing.daySeconds;
    s.phase = 'ACTION';
    s.phase_ends_at = new Date(Date.now() + secs * 1000).toISOString();
    this.saveSession(s);
    this.broadcast('game:phase', { phase: 'ACTION', day: s.current_day, endsAt: s.phase_ends_at });
    this.broadcast('game:refresh', {});
  }

  advance(s) {
    if (s.phase === 'PREP') { this.beginDay(1); return; }
    if (s.phase === 'BRIEF') { this.beginAction(); return; }
    if (s.phase === 'ACTION') {
      const teams = this.getTeams().filter((t) => t.status !== 'DEAD' && t.status !== 'RETURNED' && t.status !== 'STUCK');
      for (const t of teams) {
        const has = this.one('SELECT team_id FROM actions WHERE day=? AND team_id=?', s.current_day, t.id);
        if (!has) {
          const auto = { ...normalizeAction(null), __auto: true, __submitted: false };
          this.sql.exec('INSERT OR IGNORE INTO actions (day, team_id, client_id, data) VALUES (?,?,?,?)', s.current_day, t.id, `auto_${t.id}_${s.current_day}`, JSON.stringify(auto));
        }
      }
      s.phase = 'SETTLING';
      this.saveSession(s);
      this.settleCurrentDay();
      return;
    }
    if (s.phase === 'SETTLING') { this.settleCurrentDay(); return; }
    if (s.phase === 'REPORT') {
      if (s.current_day >= s.config.session.totalDays) this.finish();
      else this.beginDay(s.current_day + 1);
    }
  }

  start() {
    const s = this.getSession();
    if (!s) return;
    s.status = 'OPEN';
    s.started_at = nowIso();
    s.ended_at = null;
    s.phase = 'PREP';
    s.phase_ends_at = new Date(Date.now() + s.config.timing.prepSeconds * 1000).toISOString();
    this.saveSession(s);
    this.broadcast('game:refresh', {});
  }

  pause() {
    const s = this.getSession();
    if (!s || s.status === 'PAUSED') return;
    s.paused_ms = s.phase_ends_at ? Math.max(0, Date.parse(s.phase_ends_at) - Date.now()) : 0;
    s.status = 'PAUSED';
    s.phase_ends_at = null;
    this.saveSession(s);
    this.postBroadcast('讲师暂停了沙盘，倒计时已冻结', 'warn');
    this.broadcast('game:refresh', {});
  }

  resume() {
    const s = this.getSession();
    if (!s || s.status !== 'PAUSED') return;
    s.status = s.phase === 'PREP' ? 'OPEN' : 'RUNNING';
    s.phase_ends_at = new Date(Date.now() + (s.paused_ms || 0)).toISOString();
    s.paused_ms = null;
    this.saveSession(s);
    this.broadcast('game:refresh', {});
  }

  extend(minutes) {
    const s = this.getSession();
    if (!s) return;
    const ms = Math.max(1, Number(minutes) || 2) * 60000;
    if (s.status === 'PAUSED') s.paused_ms = (s.paused_ms || 0) + ms;
    else if (s.phase_ends_at) s.phase_ends_at = new Date(Math.max(Date.now(), Date.parse(s.phase_ends_at)) + ms).toISOString();
    this.saveSession(s);
    this.broadcast('game:refresh', {});
    this.postBroadcast(`讲师延长了 ${Math.round(ms / 60000)} 分钟`, 'info');
  }

  finish() {
    const s = this.getSession();
    if (!s) return;
    for (const t of this.getTeams()) {
      if (t.status === 'ALIVE' || t.status === 'LOST') {
        t.status = 'STUCK';
        this.saveTeam(t);
      }
    }
    s.status = 'ENDED';
    s.phase = 'ENDED';
    s.phase_ends_at = null;
    s.ended_at = nowIso();
    this.saveSession(s);
    this.ctx.storage.deleteAlarm();
    this.broadcast('game:ended', { scores: computeScores({ cfg: s.config, teams: this.getTeams() }) });
    this.broadcast('game:refresh', {});
  }

  /* ---------- 结算 ---------- */

  settleCurrentDay() {
    const s = this.getSession();
    if (!s) return { ok: false, reason: 'no-session' };
    const day = s.current_day;
    if (!day) return { ok: false, reason: 'no-day' };
    if (s.settled.includes(day)) return { ok: false, reason: 'already-settled' };

    const cfg = s.config;
    const teams = this.getTeams();
    const { results, nextReturnRank } = settleDay({
      cfg, map: cfg.map, teams, actionsByTeam: this.getActions(day), day, startReturnRank: s.next_return_rank || 1,
    });

    for (const { team, report } of results) {
      if (team.status === 'DEAD' && !team.dead_day) team.dead_day = day;
      team.action_json = null;
      team.client_action_id = null;
      team.submitted_at = null;
      this.saveTeam(team);
      this.sql.exec('INSERT OR REPLACE INTO reports (day, team_id, data) VALUES (?,?,?)', day, team.id, JSON.stringify(report));
    }

    s.settled = Array.from(new Set([...s.settled, day]));
    s.next_return_rank = nextReturnRank;
    s.phase = 'REPORT';
    s.phase_ends_at = new Date(Date.now() + cfg.timing.reportSeconds * 1000).toISOString();
    this.saveSession(s);

    for (const { team, report } of results) {
      if (report.died) this.broadcast('game:toast', { level: 'death', text: `${team.name} 在第 ${day} 天${report.deadReason}，退出本局`, teamId: team.id });
      else if (report.lost && !report.returned) this.broadcast('game:toast', { level: 'warn', text: `${team.name} 在第 ${day} 天遭遇${report.weatherLabel}，迷路 ${cfg.consume.lostDays} 天`, teamId: team.id });
      else if (report.returned && report.returnRank) this.broadcast('game:toast', { level: 'success', text: `${team.name} 第 ${report.returnRank} 个回到大本营，金价锁定`, teamId: team.id });
      this.broadcast('team:report', { teamId: team.id, day, report });
    }
    this.broadcast('game:dayEnd', { day });
    this.broadcast('game:refresh', {});
    return { ok: true, day };
  }

  /* ---------- 玩家行动 ---------- */

  submitAction(teamId, action, clientActionId) {
    const s = this.getSession();
    if (!s) return { status: 404, error: '局不存在' };
    if (s.status !== 'RUNNING' || s.phase !== 'ACTION') return { status: 409, error: '当前不在行动窗口' };
    const team = this.getTeam(teamId);
    if (!team) return { status: 404, error: '队伍不存在' };
    if (['DEAD', 'RETURNED', 'STUCK'].includes(team.status)) return { status: 409, error: '队伍已退出本局' };

    const dup = clientActionId ? this.one('SELECT data FROM actions WHERE team_id=? AND client_id=?', teamId, clientActionId) : null;
    if (dup) return { ok: true, idempotent: true, action: JSON.parse(dup.data) };

    const errors = actionErrors({ cfg: s.config, map: s.config.map, team, action, day: s.current_day });
    if (errors.length) return { status: 422, error: errors.join('；'), errors };

    const stamped = { ...normalizeAction(action), __submitted: true, __auto: false };
    this.sql.exec('INSERT OR REPLACE INTO actions (day, team_id, client_id, data) VALUES (?,?,?,?)', s.current_day, teamId, clientActionId || uid('c'), JSON.stringify(stamped));
    team.action_json = stamped;
    team.client_action_id = clientActionId || null;
    team.submitted_at = nowIso();
    this.saveTeam(team);
    this.broadcast('game:refresh', {});

    if (s.config.rules.autoSettleOnAllSubmitted) {
      const alive = this.getTeams().filter((t) => !['DEAD', 'RETURNED', 'STUCK'].includes(t.status));
      const submitted = this.all('SELECT team_id FROM actions WHERE day=?', s.current_day).length;
      if (alive.length > 0 && submitted >= alive.length) {
        s.phase_ends_at = new Date(Date.now() + 800).toISOString();
        this.saveSession(s);
        this.postBroadcast('所有队伍已提交，沙盘提前结算', 'info');
        this.schedule();
      }
    }
    return { ok: true, action: stamped };
  }

  recallAction(teamId) {
    const s = this.getSession();
    if (!s || s.phase !== 'ACTION' || s.status !== 'RUNNING') return { error: '不在行动窗口' };
    const remain = s.phase_ends_at ? Date.parse(s.phase_ends_at) - Date.now() : 0;
    if (remain < s.config.rules.recallBeforeSeconds * 1000) return { error: `最后 ${s.config.rules.recallBeforeSeconds} 秒不能撤回` };
    const team = this.getTeam(teamId);
    if (!team || !team.client_action_id) return { error: '没有可撤回的行动' };
    this.sql.exec('DELETE FROM actions WHERE day=? AND team_id=?', s.current_day, teamId);
    team.action_json = null;
    team.client_action_id = null;
    team.submitted_at = null;
    this.saveTeam(team);
    this.broadcast('game:refresh', {});
    return { ok: true };
  }

  /* ---------- 序列化 ---------- */

  publicWeather(day) {
    const s = this.getSession();
    const row = s.config.weather.matrix.find((r) => Number(r.day) === Number(day));
    if (!row) return [];
    return TERRAIN.map((t) => ({ terrain: t, label: TERRAIN_LABEL[t], weather: row[t], weatherLabel: WEATHER_LABEL[row[t]] }));
  }

  publicTeams(revealAll) {
    const cfg = this.getSession().config;
    const teams = this.getTeams();
    const maxGold = teams.reduce((m, t) => Math.max(m, t.gold || 0), 0);
    return teams.map((t) => {
      const base = { id: t.id, name: t.name, color: t.color, status: t.status };
      if (revealAll) {
        return {
          ...base, nodeId: t.node_id, water: t.water, food: t.food, gold: t.gold, cash: t.cash,
          tentLeft: t.tent_left, compass: t.compass, lostUntil: t.lost_until, returnRank: t.return_rank,
          returnedDay: t.returned_day, deadReason: t.dead_reason, weight: rules.weightUsed(cfg, t),
          submittedAt: t.submitted_at, submitted: Boolean(t.submitted_at),
        };
      }
      if (t.status === 'RETURNED') return { ...base, returnRank: t.return_rank, gold: t.gold, goldStar: maxGold > 0 && t.gold === maxGold, returnedDay: t.returned_day };
      if (t.status === 'DEAD') return { ...base, deadReason: t.dead_reason, deadDay: t.dead_day };
      return { ...base, moving: true, submitted: Boolean(t.submitted_at) };
    });
  }

  playerState(team) {
    const s = this.getSession();
    const cfg = s.config;
    const weight = rules.weightUsed(cfg, team);
    const neighbors = rules.neighbors(cfg.map, team.node_id);
    const nodeType = rules.terrainOf(cfg.map, team.node_id);
    const takenIntel = this.getTeams().flatMap((t) => t.intel_ids || []);
    const report = this.getReport(s.current_day, team.id);
    const day = s.current_day;

    return {
      serverNow: nowIso(),
      session: {
        id: s.id, name: s.name, status: s.status, phase: s.phase, currentDay: s.current_day,
        totalDays: cfg.session.totalDays,
        timing: { ...cfg.timing, totalDays: cfg.session.totalDays, phase: s.phase, phaseEndsAt: s.phase_ends_at, currentDay: s.current_day, status: s.status, openFrom: s.open_from, openTo: s.open_to },
      },
      task: cfg.task,
      team: {
        id: team.id, name: team.name, slogan: team.slogan, color: team.color,
        cash: team.cash, water: team.water, food: team.food, gold: team.gold,
        tentLeft: team.tent_left, compass: team.compass, nodeId: team.node_id, nodeType,
        nodeLabel: TERRAIN_LABEL[nodeType], status: team.status, lostUntil: team.lost_until,
        returnRank: team.return_rank, returnedDay: team.returned_day,
        intelIds: team.intel_ids || [], weight, capacity: cfg.start.capacity,
        neighbors: neighbors.map((id) => {
          const node = cfg.map.nodes.find((n) => n.id === id);
          const type = node ? node.type : 'DESERT';
          return { id, name: node ? node.name : id, type, label: TERRAIN_LABEL[type] };
        }),
        canDig: nodeType === 'MOUNTAIN' && (cfg.rules.digOnArrival || s.current_day > (team.arrived_day || 0)),
        distanceToBase: rules.bfs(cfg.map, team.node_id).get('BASE') ?? null,
      },
      prices: {
        water: cfg.prices.water.base, food: cfg.prices.food.base, tent: cfg.prices.tent.base, compass: cfg.prices.compass.base,
        waterAtVillage: Math.round(cfg.prices.water.base * cfg.prices.water.villageMultiplier),
        foodAtVillage: Math.round(cfg.prices.food.base * cfg.prices.food.villageMultiplier),
        weights: {
          water: cfg.prices.water.weight, food: cfg.prices.food.weight,
          tent: cfg.prices.tent.weightPerUse * cfg.prices.tent.uses,
          compass: cfg.prices.compass.weight, gold: cfg.prices.gold.weight,
        },
      },
      rules: {
        villageWaterToFood: cfg.rules.villageWaterToFood, tentCompassExclusive: cfg.rules.tentCompassExclusive,
        digOnArrival: cfg.rules.digOnArrival, recallBeforeSeconds: cfg.rules.recallBeforeSeconds,
        tentUses: cfg.prices.tent.uses,
      },
      economy: {
        priceMode: cfg.economy.priceMode, returnPrices: cfg.economy.returnPrices, taxRate: cfg.economy.taxRate,
        taxExemptTopDigger: cfg.economy.taxExemptTopDigger, goldWeight: cfg.prices.gold.weight,
      },
      intel: {
        costText: `${cfg.intel.water} 皮囊水 + ${cfg.intel.food} 盘食物 + 1 天`,
        exclusive: cfg.intel.exclusive,
        items: cfg.intel.items.map((i) => ({
          id: i.id, title: i.title, text: i.text,
          taken: cfg.intel.exclusive ? takenIntel.includes(i.id) && !(team.intel_ids || []).includes(i.id) : false,
          mine: (team.intel_ids || []).includes(i.id),
        })),
      },
      weatherToday: this.publicWeather(day),
      action: team.action_json || null,
      submittedAt: team.submitted_at,
      report,
      lastReport: this.lastReport(team.id),
      teams: this.publicTeams(false),
      consumptionTable: previewConsumptionTable(cfg),
      leaderboard: computeScores({ cfg, teams: this.getTeams() }),
      broadcasts: this.recentBroadcasts(12),
      map: { nodes: cfg.map.nodes, edges: cfg.map.edges },
    };
  }

  adminState() {
    const s = this.getSession();
    const cfg = s.config;
    const teams = this.getTeams();
    const day = s.current_day;
    const reportMap = {};
    if (day) for (const t of teams) { const r = this.getReport(day, t.id); if (r) reportMap[t.id] = r; }
    const users = this.all("SELECT id, username, role, team_id, active, must_change FROM users WHERE role='PLAYER' ORDER BY username ASC");
    return {
      serverNow: nowIso(),
      session: {
        id: s.id, name: s.name, status: s.status, phase: s.phase, phaseEndsAt: s.phase_ends_at,
        currentDay: s.current_day, totalDays: cfg.session.totalDays, openFrom: s.open_from, openTo: s.open_to, pausedMs: s.paused_ms,
      },
      config: cfg,
      teams: this.publicTeams(true).map((t) => ({ ...t, report: reportMap[t.id] || null, cost: reportMap[t.id] ? reportMap[t.id].costs : null })),
      stats: {
        total: teams.length,
        alive: teams.filter((t) => t.status === 'ALIVE' || t.status === 'LOST').length,
        dead: teams.filter((t) => t.status === 'DEAD').length,
        returned: teams.filter((t) => t.status === 'RETURNED').length,
        submitted: teams.filter((t) => t.submitted_at).length,
        online: this.ctx.getWebSockets().length,
      },
      audit: this.all('SELECT actor, action, created_at FROM audits ORDER BY id DESC LIMIT 60'),
      scores: computeScores({ cfg, teams }),
      consumptionTable: previewConsumptionTable(cfg),
      balance: balanceProbe({ cfg, map: cfg.map }),
      presets: Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label, note: p.note })),
      users: users.map((u) => ({ id: u.id, username: u.username, active: Boolean(u.active), teamId: u.team_id, mustChange: Boolean(u.must_change) })),
      sessions: [{ id: s.id, name: s.name, status: s.status, current_day: s.current_day, created_at: s.created_at }],
    };
  }

  /* ---------- 鉴权 ---------- */

  // 管理员与队伍各用一枚 Cookie，同一个浏览器里可以由两个标签页分别登录，互不顶号。
  async userFromRequest(req, kind) {
    const cookie = req.headers.get('cookie') || '';
    const names = kind === 'admin' ? ['dg_admin'] : kind === 'team' ? ['dg_team'] : ['dg_admin', 'dg_team'];
    for (const name of names) {
      const m = cookie.match(new RegExp(`${name}=([^;]+)`));
      if (!m) continue;
      const payload = await verifyToken(decodeURIComponent(m[1]), this.jwtSecret);
      if (!payload) continue;
      const user = this.one('SELECT * FROM users WHERE id=?', payload.uid);
      if (!user || !user.active) continue;
      if (kind === 'admin' && user.role !== 'ADMIN') continue;
      if (kind === 'team' && (user.role !== 'PLAYER' || !user.team_id)) continue;
      return user;
    }
    return null;
  }

  /* ---------- 路由 ---------- */

  async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (path === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    await this.tick();

    const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
      status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
    });
    const fail = (status, error, extra) => json({ error, ...(extra || {}) }, status);
    let body = null;
    if (method !== 'GET' && method !== 'HEAD') body = await request.json().catch(() => null);

    const adminUser = await this.userFromRequest(request, 'admin');
    const teamUser = await this.userFromRequest(request, 'team');

    if (path === '/api/auth/login' && method === 'POST') {
      const { username, password, mode } = body || {};
      if (!username || !password) return fail(422, '请输入账号与密码');
      const row = this.one('SELECT * FROM users WHERE username=?', String(username).trim());
      if (!row || !row.active) return fail(401, '账号或密码不正确');
      if (!(await verifyPassword(password, row.hash))) return fail(401, '账号或密码不正确');
      if (mode === 'admin' && row.role !== 'ADMIN') return fail(403, '这不是管理员账号');
      if (mode === 'player' && row.role !== 'PLAYER') return fail(403, '这不是队伍账号');
      const token = await signToken({ uid: row.id, username: row.username, role: row.role, teamId: row.team_id, exp: Date.now() + 7 * 86400000 }, this.jwtSecret);
      const cookieName = row.role === 'ADMIN' ? 'dg_admin' : 'dg_team';
      return json({ ok: true, role: row.role, username: row.username, mustChange: Boolean(row.must_change) }, 200, {
        'set-cookie': `${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 86400}`,
      });
    }

    if (path === '/api/auth/logout' && method === 'POST') {
      // 只退出自己这一侧，另一个身份的标签页不受影响；不带 role 时两边都退。
      const want = (body || {}).role || (new URL(request.url)).searchParams.get('role');
      const names = want === 'admin' ? ['dg_admin'] : want === 'player' || want === 'team' ? ['dg_team'] : ['dg_admin', 'dg_team'];
      const headers = new Headers({ 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      for (const name of names) headers.append('set-cookie', `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
    }

    if (path === '/api/auth/me' && method === 'GET') {
      const shape = (u) => {
        if (!u) return null;
        const team = u.team_id ? this.getTeam(u.team_id) : null;
        return {
          id: u.id, username: u.username, role: u.role, mustChange: Boolean(u.must_change),
          team: team ? { id: team.id, name: team.name, color: team.color } : null,
        };
      };
      return json({ admin: shape(adminUser), team: shape(teamUser), user: shape(adminUser || teamUser) });
    }

    if (path === '/api/auth/password' && method === 'POST') {
      const pwUser = adminUser || teamUser;
      if (!pwUser) return fail(401, '请先登录');
      const pw = String((body || {}).password || '');
      const err = pw.length < 8 ? '密码至少 8 位' : (pw.length > 64 ? '密码太长' : null);
      if (err) return fail(422, err);
      this.sql.exec('UPDATE users SET hash=?, must_change=0 WHERE id=?', await hashPassword(pw), pwUser.id);
      return json({ ok: true });
    }

    /* 玩家端 */
    if (path === '/api/player/state' && method === 'GET') {
      if (!teamUser) return fail(401, '请用队伍账号登录');
      const team = this.getTeam(teamUser.team_id);
      if (!team) return fail(404, '队伍不存在');
      return json(this.playerState(team));
    }

    if (path === '/api/player/action' && method === 'POST') {
      if (!teamUser) return fail(401, '请用队伍账号登录');
      const { action, clientActionId } = body || {};
      if (!clientActionId) return fail(422, '缺少 clientActionId');
      const result = this.submitAction(teamUser.team_id, action, clientActionId);
      if (!result.ok) return fail(result.status || 400, result.error, { errors: result.errors });
      return json(result);
    }

    if (path === '/api/player/action' && method === 'DELETE') {
      if (!teamUser) return fail(401, '请用队伍账号登录');
      const result = this.recallAction(teamUser.team_id);
      if (!result.ok) return fail(409, result.error);
      return json(result);
    }

    if (path === '/api/player/reports' && method === 'GET') {
      if (!teamUser) return fail(401, '请用队伍账号登录');
      const rows = this.all('SELECT day, data FROM reports WHERE team_id=? ORDER BY day ASC', teamUser.team_id);
      return json({ reports: rows.map((r) => JSON.parse(r.data)) });
    }

    if (path === '/api/screen/state' && method === 'GET') {
      const s = this.getSession();
      if (!s) return fail(404, '还没有沙盘任务');
      return json({
        serverNow: nowIso(),
        session: {
          id: s.id, name: s.name, status: s.status, phase: s.phase, currentDay: s.current_day,
          totalDays: s.config.session.totalDays, phaseEndsAt: s.phase_ends_at,
        },
        teams: this.publicTeams(true),
        leaderboard: computeScores({ cfg: s.config, teams: this.getTeams() }),
        map: s.config.map,
        weatherToday: this.publicWeather(s.current_day),
        broadcasts: this.recentBroadcasts(8),
        consumptionTable: previewConsumptionTable(s.config),
      });
    }

    /* 管理端 */
    if (path.startsWith('/api/admin/')) {
      if (!adminUser) return fail(401, '请用管理员账号登录');
      const s = this.getSession();
      if (!s) return fail(404, '还没有沙盘任务');

      if (path === '/api/admin/state' && method === 'GET') return json(this.adminState());

      if (path === '/api/admin/session' && method === 'POST') {
        const b = body || {};
        const preset = PRESETS[b.preset] ? b.preset : 'PPT';
        const cfg = normalizeConfig(buildConfig({ preset, name: b.name || '新沙盘任务' }));
        if (b.totalDays) cfg.session.totalDays = Number(b.totalDays);
        if (b.prepSeconds != null) cfg.timing.prepSeconds = Number(b.prepSeconds);
        if (b.day1Seconds) cfg.timing.day1Seconds = Number(b.day1Seconds);
        if (b.daySeconds) cfg.timing.daySeconds = Number(b.daySeconds);
        const fresh = {
          id: 'main', name: cfg.task.title, status: 'DRAFT', phase: 'IDLE', current_day: 0,
          phase_ends_at: null, settled: [], next_return_rank: 1, paused_ms: null, config: cfg,
          created_at: nowIso(), started_at: null, ended_at: null, open_from: b.openFrom || null, open_to: b.openTo || null,
        };
        this.saveSession(fresh);
        this.sql.exec('DELETE FROM actions');
        this.sql.exec('DELETE FROM reports');
        return json({ ok: true, id: 'main' });
      }

      if (path === '/api/admin/config' && method === 'PATCH') {
        const patch = { ...(body || {}) };
        delete patch.sessionId;
        const before = s.config;
        const merged = { ...before, ...patch };
        for (const key of ['start', 'prices', 'consume', 'rules', 'economy', 'intel', 'timing', 'session', 'task', 'meta']) {
          if (patch[key]) merged[key] = { ...(before[key] || {}), ...patch[key] };
        }
        if (patch.prices) {
          merged.prices = { ...before.prices };
          for (const k of Object.keys(patch.prices)) merged.prices[k] = { ...(before.prices[k] || {}), ...patch.prices[k] };
        }
        merged.weather = before.weather;
        merged.map = before.map;
        s.config = normalizeConfig(merged);
        this.saveSession(s);
        this.broadcast('game:refresh', {});
        return json({ ok: true, config: s.config });
      }

      if (path === '/api/admin/weather' && method === 'PUT') {
        const matrix = (body || {}).matrix;
        if (!Array.isArray(matrix)) return fail(422, '天气矩阵格式不对');
        s.config = normalizeConfig({ ...s.config, weather: { matrix } });
        this.saveSession(s);
        this.broadcast('game:refresh', {});
        return json({ ok: true, weather: s.config.weather });
      }

      if (path === '/api/admin/map/preview' && method === 'POST') {
        return json(rules.validateMap({ nodes: (body || {}).nodes, edges: (body || {}).edges }));
      }

      if (path === '/api/admin/map' && method === 'PUT') {
        const { nodes, edges } = body || {};
        const check = rules.validateMap({ nodes, edges });
        if (!check.ok) return fail(422, check.issues.join('；'), { check });
        s.config = normalizeConfig({ ...s.config, map: { nodes, edges } });
        this.saveSession(s);
        this.broadcast('game:refresh', {});
        return json({ ok: true, map: s.config.map, check });
      }

      if (path === '/api/admin/map/reset' && method === 'POST') {
        s.config = normalizeConfig({ ...s.config, map: buildConfig({ preset: s.config.meta.preset }).map });
        this.saveSession(s);
        return json({ ok: true, map: s.config.map });
      }

      if (path === '/api/admin/balance' && method === 'GET') {
        return json(balanceProbe({ cfg: s.config, map: s.config.map }));
      }

      const sessionMatch = path.match(/^\/api\/admin\/session\/[^/]+\/(open|pause|resume|extend|settle|end|reset|skip)$/);
      if (sessionMatch && method === 'POST') {
        const action = sessionMatch[1];
        if (action === 'open') this.start();
        if (action === 'pause') this.pause();
        if (action === 'resume') this.resume();
        if (action === 'extend') this.extend((body || {}).minutes);
        if (action === 'settle') {
          if (s.phase !== 'ACTION' && s.phase !== 'SETTLING') return fail(409, '当前不在行动阶段');
          this.settleCurrentDay();
        }
        if (action === 'end') {
          if (s.status === 'DRAFT' || s.status === 'ENDED') return fail(409, '当前没有进行中的沙盘，先开营再结束');
          this.finish();
        }
        if (action === 'reset') this.resetSession();
        if (action === 'skip') {
          s.phase_ends_at = new Date(Date.now() - 10).toISOString();
          this.saveSession(s);
          this.advance(s);
        }
        this.audit(adminUser.username, `session:${action}`, body);
        this.broadcast('game:refresh', {});
        await this.schedule();
        return json({ ok: true });
      }

      const presetMatch = path.match(/^\/api\/admin\/session\/[^/]+\/preset$/);
      if (presetMatch && method === 'POST') {
        const presetId = (body || {}).preset;
        if (!PRESETS[presetId]) return fail(422, '未知预设');
        const fresh = buildConfig({ preset: presetId, name: s.config.task.title });
        s.config = normalizeConfig({
          ...s.config,
          meta: { ...s.config.meta, preset: presetId, presetLabel: PRESETS[presetId].label },
          prices: fresh.prices, consume: fresh.consume, economy: fresh.economy,
          start: { ...s.config.start, ...fresh.start },
          rules: { ...s.config.rules, ...fresh.rules },
        });
        this.saveSession(s);
        this.audit(adminUser.username, 'config:preset', { preset: presetId });
        this.broadcast('game:refresh', {});
        return json({ ok: true, config: s.config });
      }

      if (path === '/api/admin/teams' && method === 'POST') {
        const { name, slogan, username, password, color } = body || {};
        if (!name || !username || !password) return fail(422, '队名、用户名、密码必填');
        if (this.one('SELECT id FROM users WHERE username=?', username)) return fail(409, '用户名已存在');
        if (String(password).length < 8) return fail(422, '密码至少 8 位');
        const count = this.getTeams().length;
        const team = {
          id: uid('t'), name, slogan: slogan || '', color: color || TEAM_COLORS[count % TEAM_COLORS.length],
          cash: s.config.start.cash, water: s.config.start.water, food: s.config.start.food, gold: 0,
          tent_left: s.config.start.tentUnits * s.config.prices.tent.uses, compass: s.config.start.compass,
          node_id: 'BASE', status: 'ALIVE', lost_until: null, lost_weather: null, return_rank: null,
          arrived_day: 0, intel_ids: [], submitted_at: null, dead_reason: null, dead_day: null,
          returned_day: null, action_json: null, client_action_id: null,
        };
        this.insertTeam(team, count);
        this.sql.exec('INSERT INTO users (id, username, hash, role, team_id, must_change, active) VALUES (?,?,?,?,?,0,1)',
          uid('u'), username, await hashPassword(password), 'PLAYER', team.id);
        this.audit(adminUser.username, 'team:create', { name, username });
        this.broadcast('game:refresh', {});
        return json({ ok: true, id: team.id });
      }

      if (path === '/api/admin/teams/import' && method === 'POST') {
        const csv = String((body || {}).csv || '');
        if (!csv.trim()) return fail(422, 'CSV 内容为空');
        const created = [];
        const errors = [];
        const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        for (let i = 0; i < lines.length; i += 1) {
          const cols = lines[i].split(/[,，\t]/).map((c) => c.trim());
          if (i === 0 && /队名|name|username/i.test(cols[0]) && cols.length >= 3) continue;
          if (cols.length < 3) { errors.push(`第 ${i + 1} 行字段不足`); continue; }
          const [name, username, password] = cols;
          if (this.one('SELECT id FROM users WHERE username=?', username)) { errors.push(`第 ${i + 1} 行用户名 ${username} 已存在`); continue; }
          const team = {
            id: uid('t'), name, slogan: '', color: TEAM_COLORS[this.getTeams().length % TEAM_COLORS.length],
            cash: s.config.start.cash, water: s.config.start.water, food: s.config.start.food, gold: 0,
            tent_left: s.config.start.tentUnits * s.config.prices.tent.uses, compass: s.config.start.compass,
            node_id: 'BASE', status: 'ALIVE', lost_until: null, lost_weather: null, return_rank: null,
            arrived_day: 0, intel_ids: [], submitted_at: null, dead_reason: null, dead_day: null,
            returned_day: null, action_json: null, client_action_id: null,
          };
          this.insertTeam(team, this.getTeams().length);
          this.sql.exec('INSERT INTO users (id, username, hash, role, team_id, must_change, active) VALUES (?,?,?,?,?,0,1)',
            uid('u'), username, await hashPassword(password), 'PLAYER', team.id);
          created.push(name);
        }
        this.broadcast('game:refresh', {});
        return json({ ok: true, created: created.length, errors });
      }

      const teamMatch = path.match(/^\/api\/admin\/teams\/([^/]+)$/);
      if (teamMatch) {
        const id = teamMatch[1];
        const team = this.getTeam(id);
        if (!team) return fail(404, '队伍不存在');
        if (method === 'PATCH') {
          const b = body || {};
          if (b.action === 'kill') {
            team.status = 'DEAD';
            team.dead_reason = '讲师手动判定';
            team.dead_day = s.current_day || null;
          } else if (b.action === 'revive') {
            team.status = 'ALIVE';
            team.dead_reason = null;
            team.dead_day = null;
            team.lost_until = null;
            team.water = Math.max(team.water || 0, 1);
            team.food = Math.max(team.food || 0, 1);
          } else if (b.action === 'reset') {
            Object.assign(team, {
              cash: s.config.start.cash, water: s.config.start.water, food: s.config.start.food, gold: 0,
              tent_left: s.config.start.tentUnits * s.config.prices.tent.uses, compass: s.config.start.compass,
              node_id: 'BASE', arrived_day: 0, status: 'ALIVE', lost_until: null, return_rank: null,
              returned_day: null, intel_ids: [], action_json: null, client_action_id: null, submitted_at: null,
              dead_reason: null, dead_day: null,
            });
          } else {
            if (b.name) team.name = b.name;
            if (b.slogan !== undefined) team.slogan = b.slogan;
            if (b.color) team.color = b.color;
            for (const k of ['water', 'food', 'cash', 'gold']) if (b[k] != null) team[k] = Number(b[k]);
          }
          this.saveTeam(team);
          this.audit(adminUser.username, `team:${b.action || 'update'}`, { id });
          this.broadcast('game:refresh', {});
          return json({ ok: true });
        }
        if (method === 'DELETE') {
          this.sql.exec('DELETE FROM teams WHERE id=?', id);
          this.sql.exec('DELETE FROM users WHERE team_id=?', id);
          this.sql.exec('DELETE FROM actions WHERE team_id=?', id);
          this.sql.exec('DELETE FROM reports WHERE team_id=?', id);
          this.broadcast('game:refresh', {});
          return json({ ok: true });
        }
      }

      if (path === '/api/admin/users/reset' && method === 'POST') {
        const { username, password, active } = body || {};
        const row = this.one('SELECT * FROM users WHERE username=?', username);
        if (!row) return fail(404, '账号不存在');
        if (password) {
          if (String(password).length < 8) return fail(422, '密码至少 8 位');
          this.sql.exec('UPDATE users SET hash=?, must_change=0 WHERE id=?', await hashPassword(password), row.id);
        }
        if (active != null) this.sql.exec('UPDATE users SET active=? WHERE id=?', active ? 1 : 0, row.id);
        return json({ ok: true });
      }

      if (path === '/api/admin/broadcast' && method === 'POST') {
        const text = String((body || {}).text || '').trim();
        if (!text) return fail(422, '播报内容为空');
        this.postBroadcast(text.slice(0, 200), (body || {}).level || 'info');
        return json({ ok: true });
      }

      if (path === '/api/admin/audit' && method === 'GET') {
        return json({ audit: this.all('SELECT actor, action, created_at FROM audits ORDER BY id DESC LIMIT 60') });
      }

      if (path === '/api/admin/export' && method === 'GET') {
        const cfg = s.config;
        const teams = this.getTeams();
        const scores = computeScores({ cfg, teams });
        const head = ['队伍', '状态', '现金', '水', '食物', '金块', '名次', '估值'];
        const rows = teams.map((t, i) => {
          const sc = scores.find((x) => x.teamId === t.id) || {};
          return [t.name, t.status, t.cash, t.water, t.food, t.gold, sc.rank ?? '', sc.total ?? ''];
        });
        const csv = [head, ...rows].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
        return new Response(`\ufeff${csv}`, {
          headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="desert-gold-scores-${day0()}.csv"` },
        });
      }

      if (path === '/api/admin/seed' && method === 'POST') return json({ ok: true });
      return fail(404, '接口不存在');
    }

    if (path === '/api/health' || path === '/api/healthz') {
      return json({ ok: true, time: nowIso(), engine: 'durable-object' });
    }
    return fail(404, '接口不存在');
  }

  resetSession() {
    const s = this.getSession();
    const cfg = s.config;
    for (const t of this.getTeams()) {
      Object.assign(t, {
        cash: cfg.start.cash, water: cfg.start.water, food: cfg.start.food, gold: 0,
        tent_left: cfg.start.tentUnits * cfg.prices.tent.uses, compass: cfg.start.compass,
        node_id: 'BASE', arrived_day: 0, status: 'ALIVE', lost_until: null, lost_weather: null,
        return_rank: null, returned_day: null, intel_ids: [], action_json: null,
        client_action_id: null, submitted_at: null, dead_reason: null, dead_day: null,
      });
      this.saveTeam(t);
    }
    this.sql.exec('DELETE FROM actions');
    this.sql.exec('DELETE FROM reports');
    this.sql.exec('DELETE FROM broadcasts');
    Object.assign(s, { status: 'DRAFT', phase: 'IDLE', current_day: 0, phase_ends_at: null, settled: [], next_return_rank: 1, paused_ms: null, started_at: null, ended_at: null });
    this.saveSession(s);
    this.ctx.storage.deleteAlarm();
    this.broadcast('game:refresh', {});
  }

  audit(actor, action, payload) {
    this.sql.exec('INSERT INTO audits (actor, action, created_at, payload) VALUES (?,?,?,?)', actor || '—', action, nowIso(), JSON.stringify(payload || null));
  }
}

function day0() {
  return new Date().toISOString().slice(0, 10);
}

