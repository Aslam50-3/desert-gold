'use strict';

const express = require('express');
const bcrypt = require('bcryptjs');
const ExcelJS = require('exceljs');
const { db, nowIso, uid } = require('./db');
const auth = require('./auth');
const service = require('./service');
const { normalizeConfig, buildConfig, PRESETS, TERRAIN, TERRAIN_LABEL, WEATHER_LABEL } = require('./engine/config');
const rules = require('./engine/rules');
const { previewConsumptionTable } = require('./engine/settle');
const { computeScores, balanceProbe } = require('./engine/score');
const { seed, TEAM_COLORS } = require('./seed');

const router = express.Router();
router.use(express.json({ limit: '2mb' }));
router.use(auth.attachUser);

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ============================ 鉴权 ============================ */

router.post('/auth/login', (req, res) => {
  const { username, password, mode } = req.body || {};
  const result = auth.login({ username, password, mode });
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  auth.setCookie(res, result.token);
  res.json({
    ok: true,
    role: result.user.role,
    username: result.user.username,
    mustChange: Boolean(result.user.must_change),
  });
});

router.post('/auth/logout', (req, res) => {
  auth.clearCookie(res);
  res.json({ ok: true });
});

router.get('/auth/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  let team = null;
  if (req.user.team_id) team = db.prepare('SELECT id, name, color FROM teams WHERE id=?').get(req.user.team_id);
  res.json({ user: { id: req.user.id, username: req.user.username, role: req.user.role, mustChange: Boolean(req.user.must_change), team } });
});

router.post('/auth/password', auth.requireAuth, (req, res) => {
  const { password } = req.body || {};
  const err = auth.validatePassword(password);
  if (err) return res.status(422).json({ error: err });
  db.prepare('UPDATE users SET password_hash=?, must_change=0 WHERE id=?').run(bcrypt.hashSync(password, 10), req.user.id);
  res.json({ ok: true });
});

/* ============================ 玩家端 ============================ */

router.get('/player/state', auth.requirePlayer, (req, res) => {
  const session = service.currentSession();
  if (!session) return res.status(404).json({ error: '还没有沙盘任务' });
  const team = db.prepare('SELECT * FROM teams WHERE id=?').get(req.user.team_id);
  if (!team) return res.status(404).json({ error: '队伍不存在' });
  if (team.session_id !== session.id) {
    // 玩家绑定的是旧局：仍允许查看，但标记为已归档
    return res.json({ ...service.playerState(service.parseSession(service.getSessionRow(team.session_id)), team), archived: true });
  }
  res.json(service.playerState(session, team));
});

router.post('/player/action', auth.requirePlayer, (req, res) => {
  const session = service.currentSession();
  if (!session) return res.status(404).json({ error: '还没有沙盘任务' });
  const { action, clientActionId } = req.body || {};
  if (!clientActionId) return res.status(422).json({ error: '缺少 clientActionId' });
  const result = service.submitAction({
    sessionId: session.id,
    teamId: req.user.team_id,
    action,
    clientActionId,
  });
  if (!result.ok) return res.status(result.status || 400).json({ error: result.error, errors: result.errors });
  res.json(result);
});

router.delete('/player/action', auth.requirePlayer, (req, res) => {
  const session = service.currentSession();
  if (!session) return res.status(404).json({ error: '还没有沙盘任务' });
  const result = service.recallAction({ sessionId: session.id, teamId: req.user.team_id });
  if (!result.ok) return res.status(409).json({ error: result.error });
  res.json(result);
});

router.get('/player/reports', auth.requirePlayer, (req, res) => {
  const session = service.currentSession();
  if (!session) return res.status(404).json({ error: '还没有沙盘任务' });
  const rows = db.prepare('SELECT day, payload_json FROM reports WHERE session_id=? AND team_id=? ORDER BY day ASC').all(session.id, req.user.team_id);
  res.json({ reports: rows.map((r) => JSON.parse(r.payload_json)) });
});

/* 大屏：只读公开信息 */
router.get('/screen/state', (req, res) => {
  const session = service.currentSession();
  if (!session) return res.status(404).json({ error: '还没有沙盘任务' });
  res.json({
    serverNow: nowIso(),
    session: {
      id: session.id, name: session.name, status: session.status, phase: session.phase,
      currentDay: session.current_day, totalDays: session.config.session.totalDays,
      phaseEndsAt: session.phase_ends_at,
    },
    teams: service.publicTeams(session.id, { revealAll: true }),
    leaderboard: computeScores({ cfg: session.config, teams: service.getTeams(session.id) }),
    map: session.config.map,
    weatherToday: service.publicWeather(session.config, session.current_day),
    broadcasts: db.prepare('SELECT text, level, created_at FROM broadcasts WHERE session_id=? ORDER BY created_at DESC LIMIT 8').all(session.id),
    consumptionTable: previewConsumptionTable(session.config),
  });
});

/* ============================ 管理端 ============================ */

function sessionOr404(req, res) {
  const row = req.params.id ? service.getSessionRow(req.params.id) : service.getSessionRow(service.currentSession().id);
  if (!row) {
    res.status(404).json({ error: '局不存在' });
    return null;
  }
  return service.parseSession(row);
}

router.get('/admin/state', auth.requireAdmin, (req, res) => {
  const queryId = req.query.sessionId;
  const session = queryId ? service.getSessionRow(queryId) : service.currentSession();
  if (!session) return res.status(404).json({ error: '还没有沙盘任务' });
  const parsed = session.config ? session : service.parseSession(session);
  const teams = db.prepare('SELECT * FROM users WHERE role=?').all('PLAYER');
  res.json({
    ...service.adminState(parsed),
    presets: Object.entries(PRESETS).map(([id, p]) => ({ id, label: p.label, note: p.note })),
    users: teams.map((u) => ({ id: u.id, username: u.username, active: Boolean(u.active), teamId: u.team_id })),
    sessions: db.prepare('SELECT id, name, status, current_day, created_at FROM sessions ORDER BY created_at DESC').all(),
  });
});

router.post('/admin/session', auth.requireAdmin, (req, res) => {
  const body = req.body || {};
  const preset = PRESETS[body.preset] ? body.preset : 'PPT';
  const cfg = buildConfig({ preset, name: body.name || '新沙盘任务' });
  if (body.totalDays) cfg.session.totalDays = Number(body.totalDays);
  if (body.prepSeconds != null) cfg.timing.prepSeconds = Number(body.prepSeconds);
  if (body.day1Seconds) cfg.timing.day1Seconds = Number(body.day1Seconds);
  if (body.daySeconds) cfg.timing.daySeconds = Number(body.daySeconds);
  if (body.openFrom) cfg.session.openFrom = body.openFrom;
  if (body.openTo) cfg.session.openTo = body.openTo;
  const normalized = normalizeConfig(cfg);
  const id = uid('s');
  db.prepare(
    `INSERT INTO sessions (id, name, status, current_day, phase, config_json, open_from, open_to, created_at)
     VALUES (?,?, 'DRAFT', 0, 'IDLE', ?, ?, ?, ?)`
  ).run(id, normalized.task.title, JSON.stringify(normalized), body.openFrom || null, body.openTo || null, nowIso());
  service.logAudit({ sessionId: id, actor: req.user.username, action: 'session:create', after: normalized });
  res.json({ ok: true, id });
});

router.patch('/admin/session/:id', auth.requireAdmin, (req, res) => {
  const row = service.getSessionRow(req.params.id);
  if (!row) return res.status(404).json({ error: '局不存在' });
  const { name, openFrom, openTo } = req.body || {};
  db.prepare('UPDATE sessions SET name=?, open_from=?, open_to=? WHERE id=?').run(
    name || row.name, openFrom !== undefined ? openFrom : row.open_from, openTo !== undefined ? openTo : row.open_to, req.params.id
  );
  res.json({ ok: true });
});

function sessionAction(action) {
  return (req, res) => {
    const row = service.getSessionRow(req.params.id);
    if (!row) return res.status(404).json({ error: '局不存在' });
    const s = service.parseSession(row);
    const actor = req.user.username;
    if (action === 'open') service.openSession(s.id);
    if (action === 'pause') service.pauseSession(s.id);
    if (action === 'resume') service.resumeSession(s.id);
    if (action === 'extend') service.extendSession(s.id, Number((req.body || {}).minutes || 2));
    if (action === 'settle') {
      if (s.phase !== 'ACTION' && s.phase !== 'SETTLING') return res.status(409).json({ error: '当前不在行动阶段' });
      service.settleSessionDay(s.id);
    }
    if (action === 'end') service.finishSession(s.id);
    if (action === 'reset') service.resetSession(s.id, { keepTeams: true });
    if (action === 'skip') {
      db.prepare('UPDATE sessions SET phase_ends_at=? WHERE id=?').run(new Date(Date.now() - 10).toISOString(), s.id);
      service.advancePhase(s.id);
    }
    service.logAudit({ sessionId: s.id, actor, action: `session:${action}`, after: (req.body || null) });
    res.json({ ok: true });
  };
}

router.post('/admin/session/:id/open', auth.requireAdmin, sessionAction('open'));
router.post('/admin/session/:id/pause', auth.requireAdmin, sessionAction('pause'));
router.post('/admin/session/:id/resume', auth.requireAdmin, sessionAction('resume'));
router.post('/admin/session/:id/extend', auth.requireAdmin, sessionAction('extend'));
router.post('/admin/session/:id/settle', auth.requireAdmin, sessionAction('settle'));
router.post('/admin/session/:id/end', auth.requireAdmin, sessionAction('end'));
router.post('/admin/session/:id/reset', auth.requireAdmin, sessionAction('reset'));
router.post('/admin/session/:id/skip', auth.requireAdmin, sessionAction('skip'));

/* ------------- 参数中心 ------------- */

router.patch('/admin/config', auth.requireAdmin, (req, res) => {
  const session = req.params.id ? null : service.currentSession();
  const target = service.getSessionRow((req.body || {}).sessionId || (session && session.id));
  if (!target) return res.status(404).json({ error: '局不存在' });
  const before = JSON.parse(target.config_json);
  const patch = { ...(req.body || {}) };
  delete patch.sessionId;
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
  const normalized = normalizeConfig(merged);
  db.prepare('UPDATE sessions SET config_json=? WHERE id=?').run(JSON.stringify(normalized), target.id);
  service.clearCfgCache(target.id);
  service.logAudit({ sessionId: target.id, actor: req.user.username, action: 'config:update', before, after: normalized });
  service.broadcast('game:refresh', {}, `session:${target.id}`);
  res.json({ ok: true, config: normalized });
});

/* 一键载入规则预设（保留地图、天气、总天数与计时） */
router.post('/admin/session/:id/preset', auth.requireAdmin, (req, res) => {
  const row = service.getSessionRow(req.params.id);
  if (!row) return res.status(404).json({ error: '局不存在' });
  const presetId = (req.body || {}).preset;
  if (!PRESETS[presetId]) return res.status(422).json({ error: '未知预设' });
  const before = JSON.parse(row.config_json);
  const fresh = buildConfig({ preset: presetId, name: before.task.title });
  const merged = normalizeConfig({
    ...before,
    meta: { ...before.meta, preset: presetId, presetLabel: PRESETS[presetId].label },
    prices: fresh.prices,
    consume: fresh.consume,
    economy: fresh.economy,
    start: { ...before.start, ...fresh.start },
    rules: { ...before.rules, ...fresh.rules },
  });
  db.prepare('UPDATE sessions SET config_json=? WHERE id=?').run(JSON.stringify(merged), row.id);
  service.clearCfgCache(row.id);
  service.logAudit({ sessionId: row.id, actor: req.user.username, action: 'config:preset', after: { preset: presetId } });
  service.broadcast('game:refresh', {}, `session:${row.id}`);
  res.json({ ok: true, config: merged });
});

router.put('/admin/weather', auth.requireAdmin, (req, res) => {  const { sessionId, matrix } = req.body || {};
  const row = service.getSessionRow(sessionId || (service.currentSession() || {}).id);
  if (!row) return res.status(404).json({ error: '局不存在' });
  const before = JSON.parse(row.config_json);
  const cfg = service.parseSession(row).config;
  cfg.weather.matrix = matrix;
  const normalized = normalizeConfig({ ...before, weather: { matrix } });
  db.prepare('UPDATE sessions SET config_json=? WHERE id=?').run(JSON.stringify(normalized), row.id);
  service.clearCfgCache(row.id);
  service.logAudit({ sessionId: row.id, actor: req.user.username, action: 'weather:update', before: before.weather, after: normalized.weather });
  service.broadcast('game:refresh', {}, `session:${row.id}`);
  res.json({ ok: true, weather: normalized.weather });
});

router.put('/admin/map', auth.requireAdmin, (req, res) => {
  const { sessionId, nodes, edges } = req.body || {};
  const row = service.getSessionRow(sessionId || (service.currentSession() || {}).id);
  if (!row) return res.status(404).json({ error: '局不存在' });
  const check = rules.validateMap({ nodes, edges });
  if (!check.ok) return res.status(422).json({ error: check.issues.join('；'), check });
  const before = JSON.parse(row.config_json);
  const normalized = normalizeConfig({ ...before, map: { nodes, edges } });
  db.prepare('UPDATE sessions SET config_json=? WHERE id=?').run(JSON.stringify(normalized), row.id);
  service.clearCfgCache(row.id);
  service.logAudit({ sessionId: row.id, actor: req.user.username, action: 'map:update', before: before.map, after: normalized.map });
  service.broadcast('game:refresh', {}, `session:${row.id}`);
  res.json({ ok: true, map: normalized.map, check });
});

router.post('/admin/map/preview', auth.requireAdmin, (req, res) => {
  const { nodes, edges } = req.body || {};
  const check = rules.validateMap({ nodes, edges });
  res.json(check);
});

router.post('/admin/map/reset', auth.requireAdmin, (req, res) => {
  const row = service.getSessionRow((req.body || {}).sessionId || (service.currentSession() || {}).id);
  if (!row) return res.status(404).json({ error: '局不存在' });
  const before = JSON.parse(row.config_json);
  const fresh = buildConfig({ preset: before.meta.preset });
  const normalized = normalizeConfig({ ...before, map: fresh.map });
  db.prepare('UPDATE sessions SET config_json=? WHERE id=?').run(JSON.stringify(normalized), row.id);
  service.clearCfgCache(row.id);
  service.logAudit({ sessionId: row.id, actor: req.user.username, action: 'map:reset' });
  res.json({ ok: true, map: normalized.map });
});

router.get('/admin/balance', auth.requireAdmin, (req, res) => {
  const session = service.currentSession();
  if (!session) return res.status(404).json({ error: '还没有沙盘任务' });
  res.json(balanceProbe({ cfg: session.config, map: session.config.map }));
});

/* ------------- 队伍 / 账号 ------------- */

router.post('/admin/teams', auth.requireAdmin, (req, res) => {
  const { name, slogan, username, password, color, sessionId } = req.body || {};
  if (!name || !username || !password) return res.status(422).json({ error: '队名、用户名、密码必填' });
  if (db.prepare('SELECT id FROM users WHERE username=?').get(username)) return res.status(409).json({ error: '用户名已存在' });
  const session = sessionId ? service.parseSession(service.getSessionRow(sessionId)) : service.currentSession();
  if (!session) return res.status(404).json({ error: '还没有沙盘任务' });
  const cfg = session.config;
  const count = db.prepare('SELECT COUNT(*) AS c FROM teams WHERE session_id=?').get(session.id).c;
  const teamId = uid('t');
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO teams (id, session_id, name, slogan, color, cash, water, food, gold, tent_left, compass, node_id, status, intel_ids, members_json, created_at)
       VALUES (?,?,?,?,?,?,?,?,0,?,?,'BASE','ALIVE','[]','[]',?)`
    ).run(
      teamId, session.id, name, slogan || '', color || TEAM_COLORS[count % TEAM_COLORS.length],
      cfg.start.cash, cfg.start.water, cfg.start.food,
      cfg.start.tentUnits * cfg.prices.tent.uses, cfg.start.compass, nowIso()
    );
    db.prepare('INSERT INTO users (id, username, password_hash, role, team_id, active, created_at) VALUES (?,?,?,?,?,1,?)')
      .run(uid('u'), username, bcrypt.hashSync(password, 10), 'PLAYER', teamId, nowIso());
  });
  tx();
  service.logAudit({ sessionId: session.id, actor: req.user.username, action: 'team:create', after: { name, username } });
  res.json({ ok: true, id: teamId });
});

router.post('/admin/teams/import', auth.requireAdmin, (req, res) => {
  const { csv, sessionId } = req.body || {};
  if (!csv) return res.status(422).json({ error: 'CSV 内容为空' });
  const session = sessionId ? service.parseSession(service.getSessionRow(sessionId)) : service.currentSession();
  if (!session) return res.status(404).json({ error: '还没有沙盘任务' });
  const cfg = session.config;
  const lines = String(csv).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const created = [];
  const errors = [];
  lines.forEach((line, i) => {
    const cols = line.split(/[,，\t]/).map((c) => c.trim());
    if (i === 0 && /队名|name|username/i.test(cols[0]) && cols.length >= 3) return;
    if (cols.length < 3) {
      errors.push(`第 ${i + 1} 行字段不足（需：队名,用户名,密码）`);
      return;
    }
    const [name, username, password] = cols;
    if (db.prepare('SELECT id FROM users WHERE username=?').get(username)) {
      errors.push(`第 ${i + 1} 行用户名 ${username} 已存在`);
      return;
    }
    const teamId = uid('t');
    const count = db.prepare('SELECT COUNT(*) AS c FROM teams WHERE session_id=?').get(session.id).c;
    try {
      db.transaction(() => {
        db.prepare(
          `INSERT INTO teams (id, session_id, name, slogan, color, cash, water, food, gold, tent_left, compass, node_id, status, intel_ids, members_json, created_at)
           VALUES (?,?,?,?,?,?,?,?,0,?,?,'BASE','ALIVE','[]','[]',?)`
        ).run(
          teamId, session.id, name, '', TEAM_COLORS[count % TEAM_COLORS.length],
          cfg.start.cash, cfg.start.water, cfg.start.food,
          cfg.start.tentUnits * cfg.prices.tent.uses, cfg.start.compass, nowIso()
        );
        db.prepare('INSERT INTO users (id, username, password_hash, role, team_id, active, created_at) VALUES (?,?,?,?,?,1,?)')
          .run(uid('u'), username, bcrypt.hashSync(password, 10), 'PLAYER', teamId, nowIso());
      })();
      created.push(name);
    } catch (err) {
      errors.push(`第 ${i + 1} 行导入失败：${err.message}`);
    }
  });
  service.logAudit({ sessionId: session.id, actor: req.user.username, action: 'team:import', after: { count: created.length } });
  res.json({ ok: true, created: created.length, errors });
});

router.patch('/admin/teams/:id', auth.requireAdmin, (req, res) => {
  const team = db.prepare('SELECT * FROM teams WHERE id=?').get(req.params.id);
  if (!team) return res.status(404).json({ error: '队伍不存在' });
  const { action, name, slogan, color, water, food, cash, gold } = req.body || {};
  if (action === 'kill') {
    db.prepare("UPDATE teams SET status='DEAD', dead_reason='讲师手动判定', dead_day=? WHERE id=?").run(service.currentSession().current_day || null, team.id);
  } else if (action === 'revive') {
    db.prepare("UPDATE teams SET status='ALIVE', dead_reason=NULL, dead_day=NULL, lost_until=NULL, water=MAX(water,1), food=MAX(food,1) WHERE id=?").run(team.id);
  } else if (action === 'reset') {
    const session = service.parseSession(service.getSessionRow(team.session_id));
    const cfg = session.config;
    db.prepare(
      `UPDATE teams SET cash=?, water=?, food=?, gold=0, tent_left=?, compass=?, node_id='BASE', arrived_day=NULL, status='ALIVE',
       lost_until=NULL, return_rank=NULL, returned_day=NULL, intel_ids='[]', action_json=NULL, client_action_id=NULL, submitted_at=NULL WHERE id=?`
    ).run(cfg.start.cash, cfg.start.water, cfg.start.food, cfg.start.tentUnits * cfg.prices.tent.uses, cfg.start.compass, team.id);
  } else {
    db.prepare('UPDATE teams SET name=?, slogan=?, color=? WHERE id=?').run(name || team.name, slogan ?? team.slogan, color || team.color, team.id);
    if (water != null || food != null || cash != null || gold != null) {
      db.prepare('UPDATE teams SET water=?, food=?, cash=?, gold=? WHERE id=?').run(
        water != null ? Number(water) : team.water,
        food != null ? Number(food) : team.food,
        cash != null ? Number(cash) : team.cash,
        gold != null ? Number(gold) : team.gold,
        team.id
      );
    }
  }
  service.logAudit({ sessionId: team.session_id, actor: req.user.username, action: `team:${action || 'update'}`, before: team, after: req.body });
  res.json({ ok: true });
});

router.delete('/admin/teams/:id', auth.requireAdmin, (req, res) => {
  const team = db.prepare('SELECT * FROM teams WHERE id=?').get(req.params.id);
  if (!team) return res.status(404).json({ error: '队伍不存在' });
  db.transaction(() => {
    db.prepare('DELETE FROM users WHERE team_id=?').run(team.id);
    db.prepare('DELETE FROM reports WHERE team_id=?').run(team.id);
    db.prepare('DELETE FROM actions WHERE team_id=?').run(team.id);
    db.prepare('DELETE FROM cost_totals WHERE team_id=?').run(team.id);
    db.prepare('DELETE FROM teams WHERE id=?').run(team.id);
  })();
  service.logAudit({ sessionId: team.session_id, actor: req.user.username, action: 'team:delete', before: team });
  res.json({ ok: true });
});

router.post('/admin/users/reset', auth.requireAdmin, (req, res) => {
  const { username, password, active } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!user) return res.status(404).json({ error: '账号不存在' });
  if (password) {
    const err = auth.validatePassword(password);
    if (err) return res.status(422).json({ error: err });
    db.prepare('UPDATE users SET password_hash=?, must_change=0 WHERE id=?').run(bcrypt.hashSync(password, 10), user.id);
  }
  if (active != null) db.prepare('UPDATE users SET active=? WHERE id=?').run(active ? 1 : 0, user.id);
  service.logAudit({ sessionId: null, actor: req.user.username, action: 'user:reset', before: user, after: req.body });
  res.json({ ok: true });
});

/* ------------- 广播 / 导出 / 审计 ------------- */

router.post('/admin/broadcast', auth.requireAdmin, (req, res) => {
  const session = service.currentSession();
  const { text, level } = req.body || {};
  if (!text) return res.status(422).json({ error: '广播内容为空' });
  const id = uid('b');
  db.prepare('INSERT INTO broadcasts (id, session_id, level, text, created_at) VALUES (?,?,?,?,?)')
    .run(id, session ? session.id : null, level || 'info', text, nowIso());
  service.broadcast('game:toast', { level: level || 'info', text }, session ? `session:${session.id}` : null);
  res.json({ ok: true, id });
});

router.get('/admin/audit', auth.requireAdmin, (req, res) => {
  res.json({ logs: db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200').all() });
});

router.get('/admin/export', auth.requireAdmin, async (req, res) => {
  const session = service.currentSession();
  if (!session) return res.status(404).json({ error: '还没有沙盘任务' });
  const type = req.query.type || 'final';
  const day = Number(req.query.day || session.current_day || 0);
  const wb = new ExcelJS.Workbook();
  wb.creator = '沙漠掘金 · 沙盘';
  const teamName = (id) => (db.prepare('SELECT name FROM teams WHERE id=?').get(id) || {}).name || id;

  if (type === 'daily') {
    const sheet = wb.addWorksheet(`第${day}天日报`);
    sheet.columns = [
      { header: '队伍', key: 'team', width: 16 },
      { header: '位置', key: 'node', width: 12 },
      { header: '天气+对策', key: 'weather', width: 20 },
      { header: '水购入', key: 'buyWater', width: 10 },
      { header: '水消耗', key: 'useWater', width: 10 },
      { header: '水费用', key: 'waterCost', width: 10 },
      { header: '食物购入', key: 'buyFood', width: 10 },
      { header: '食物消耗', key: 'useFood', width: 10 },
      { header: '食物费用', key: 'foodCost', width: 10 },
      { header: '帐篷消耗', key: 'tent', width: 10 },
      { header: '指南针消耗', key: 'compass', width: 12 },
      { header: '水余额', key: 'water', width: 10 },
      { header: '食物余额', key: 'food', width: 10 },
      { header: '现金', key: 'cash', width: 10 },
      { header: '金子', key: 'gold', width: 8 },
      { header: '载重', key: 'weight', width: 14 },
      { header: '状态', key: 'status', width: 10 },
      { header: '当日小结', key: 'summary', width: 50 },
    ];
    const rows = db.prepare('SELECT team_id, payload_json FROM reports WHERE session_id=? AND day=?').all(session.id, day);
    for (const r of rows) {
      const p = JSON.parse(r.payload_json);
      sheet.addRow({
        team: teamName(r.team_id),
        node: p.nodeId ? `${p.nodeId}（${p.terrainLabel}）` : '—',
        weather: `${p.weatherLabel || ''}${p.countermeasure ? ` / ${p.countermeasure}` : ''}`,
        buyWater: p.purchases ? p.purchases.water.qty : 0,
        useWater: p.consumed ? p.consumed.water : 0,
        waterCost: p.costs ? p.costs.waterCost : 0,
        buyFood: p.purchases ? p.purchases.food.qty : 0,
        useFood: p.consumed ? p.consumed.food : 0,
        foodCost: p.costs ? p.costs.foodCost : 0,
        tent: p.consumed ? p.consumed.tent : 0,
        compass: p.consumed ? p.consumed.compass : 0,
        water: p.balance ? p.balance.water : 0,
        food: p.balance ? p.balance.food : 0,
        cash: p.balance ? p.balance.cash : 0,
        gold: p.balance ? p.balance.gold : 0,
        weight: p.balance ? `${p.balance.weight}/${p.balance.capacity}` : '',
        status: p.died ? '死亡' : p.returned ? '已返回' : p.lost ? '迷路' : '行进',
        summary: p.summary || '',
      });
    }
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2A2118' } };
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFE7B15C' } };
  } else if (type === 'cost') {
    const sheet = wb.addWorksheet(`第${day}天成本总表`);
    sheet.columns = [
      { header: '队伍', key: 'team', width: 16 },
      { header: '水费', key: 'waterCost', width: 10 },
      { header: '食物费', key: 'foodCost', width: 10 },
      { header: '帐篷费', key: 'tentCost', width: 10 },
      { header: '指南针费', key: 'compassCost', width: 12 },
      { header: '情报费', key: 'intelCost', width: 10 },
      { header: '当日支出', key: 'total', width: 12 },
      { header: '小结', key: 'summary', width: 50 },
    ];
    const rows = db.prepare('SELECT team_id, payload_json FROM cost_totals WHERE session_id=? AND day=?').all(session.id, day);
    for (const r of rows) {
      const p = JSON.parse(r.payload_json);
      sheet.addRow({ team: teamName(r.team_id), ...p });
    }
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFE7B15C' } };
  } else {
    const sheet = wb.addWorksheet('最终成绩');
    sheet.columns = [
      { header: '序号', key: 'no', width: 6 },
      { header: '队名', key: 'name', width: 16 },
      { header: '状态', key: 'status', width: 10 },
      { header: '所用天数', key: 'usedDays', width: 10 },
      { header: '返回排名', key: 'returnRank', width: 10 },
      { header: '金块数', key: 'gold', width: 8 },
      { header: '兑换价', key: 'price', width: 10 },
      { header: '收益', key: 'goldValue', width: 12 },
      { header: '现金节余', key: 'cash', width: 12 },
      { header: '税', key: 'tax', width: 10 },
      { header: '净收益', key: 'net', width: 12 },
      { header: '总排名', key: 'rank', width: 8 },
    ];
    const scores = computeScores({ cfg: session.config, teams: service.getTeams(session.id) });
    scores.forEach((s, i) => sheet.addRow({
      no: i + 1, name: s.name,
      status: s.returned ? '已返回' : s.status === 'DEAD' ? '死亡' : '困死',
      usedDays: s.usedDays || '', returnRank: s.returnRank || '', gold: s.gold,
      price: s.priceMode === 'PIECE' ? `${s.price}/块` : `${s.price}/磅`,
      goldValue: s.goldValue, cash: s.cash, tax: s.exempt ? '免税' : s.tax, net: s.net, rank: s.rank,
    }));
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFE7B15C' } };
  }

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="desert-gold-${type}-${day}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
});

/* ============================ 初始化 ============================ */

router.post('/admin/seed', auth.requireAdmin, (req, res) => {
  seed();
  res.json({ ok: true });
});

router.get('/health', (req, res) => res.json({ ok: true, time: nowIso() }));

module.exports = router;
