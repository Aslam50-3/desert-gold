'use strict';

const { db, nowIso, uid } = require('./db');
const { normalizeConfig, TERRAIN_LABEL, WEATHER_LABEL } = require('./engine/config');
const rules = require('./engine/rules');
const { settleDay, actionErrors, normalizeAction } = require('./engine/settle');
const { computeScores } = require('./engine/score');

let emit = () => {};
function setEmitter(fn) {
  emit = fn;
}
function broadcast(event, payload, room) {
  emit(event, payload, room);
}

/* ----------------------------- 基础读取 ----------------------------- */

function getSessionRow(id) {
  return db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);
}

function parseSession(row) {
  if (!row) return null;
  return {
    ...row,
    config: normalizeConfig(JSON.parse(row.config_json || '{}')),
    settled: JSON.parse(row.settled_json || '[]'),
  };
}

function currentSession() {
  const row =
    db.prepare("SELECT * FROM sessions WHERE status IN ('OPEN','RUNNING','PAUSED') ORDER BY created_at DESC LIMIT 1").get() ||
    db.prepare('SELECT * FROM sessions ORDER BY created_at DESC LIMIT 1').get();
  return parseSession(row);
}

function getTeams(sessionId) {
  return db.prepare('SELECT * FROM teams WHERE session_id = ? ORDER BY created_at ASC').all(sessionId);
}

function engineTeam(row) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    cash: row.cash,
    water: row.water,
    food: row.food,
    gold: row.gold,
    tent_left: row.tent_left,
    compass: row.compass,
    node_id: row.node_id,
    status: row.status,
    lost_until: row.lost_until,
    lost_weather: row.lost_weather,
    return_rank: row.return_rank,
    arrived_day: row.arrived_day,
    intel_ids: JSON.parse(row.intel_ids || '[]'),
    submitted_at: row.submitted_at,
    dead_reason: row.dead_reason,
    returned_day: row.returned_day,
  };
}

function writeEngineTeam(team) {
  db.prepare(
    `UPDATE teams SET cash=?, water=?, food=?, gold=?, tent_left=?, compass=?, node_id=?, status=?,
      lost_until=?, lost_weather=?, return_rank=?, arrived_day=?, dead_reason=?, dead_day=?, intel_ids=?,
      returned_day=?, returned_at=?, action_json=NULL, submitted_at=NULL, client_action_id=NULL
     WHERE id=?`
  ).run(
    team.cash, team.water, team.food, team.gold, team.tent_left || 0, team.compass || 0, team.node_id,
    team.status, team.lost_until || null, team.lost_weather || null, team.return_rank || null,
    team.arrived_day || null, team.dead_reason || null,
    team.status === 'DEAD' ? (team.dead_day || null) : null,
    JSON.stringify(team.intel_ids || []),
    team.returned_day || null, team.returned_at || null,
    team.id
  );
}

/* ----------------------------- 时钟与阶段 ----------------------------- */

function setPhase(sessionId, phase, endsAt) {
  db.prepare('UPDATE sessions SET phase=?, phase_ends_at=? WHERE id=?').run(phase, endsAt, sessionId);
}

function beginDay(sessionId, day) {
  const s = parseSession(getSessionRow(sessionId));
  const cfg = s.config;
  db.prepare('UPDATE sessions SET current_day=?, status=?, paused_ms=NULL WHERE id=?').run(day, 'RUNNING', sessionId);
  const briefMs = day === 1 ? Math.max(cfg.timing.briefSeconds, 15) : cfg.timing.briefSeconds;
  setPhase(sessionId, 'BRIEF', new Date(Date.now() + briefMs * 1000).toISOString());
  broadcast('game:dayStart', { day, totalDays: cfg.session.totalDays, weather: publicWeather(cfg, day) }, `session:${sessionId}`);
  broadcast('game:refresh', {}, `session:${sessionId}`);
}

function beginAction(sessionId) {
  const s = parseSession(getSessionRow(sessionId));
  const cfg = s.config;
  const seconds = s.current_day === 1 ? cfg.timing.day1Seconds : cfg.timing.daySeconds;
  setPhase(sessionId, 'ACTION', new Date(Date.now() + seconds * 1000).toISOString());
  broadcast('game:phase', { phase: 'ACTION', day: s.current_day, endsAt: new Date(Date.now() + seconds * 1000).toISOString() }, `session:${sessionId}`);
  broadcast('game:refresh', {}, `session:${sessionId}`);
}

function openSession(sessionId) {
  const s = parseSession(getSessionRow(sessionId));
  if (!s) return;
  db.prepare('UPDATE sessions SET status=?, started_at=?, ended_at=NULL WHERE id=?').run('OPEN', nowIso(), sessionId);
  const endsAt = new Date(Date.now() + s.config.timing.prepSeconds * 1000).toISOString();
  setPhase(sessionId, 'PREP', endsAt);
  broadcast('game:refresh', {}, `session:${sessionId}`);
}

function pauseSession(sessionId) {
  const s = parseSession(getSessionRow(sessionId));
  if (!s || s.status === 'PAUSED') return;
  const remain = s.phase_ends_at ? Math.max(0, Date.parse(s.phase_ends_at) - Date.now()) : null;
  db.prepare('UPDATE sessions SET status=?, paused_ms=? WHERE id=?').run('PAUSED', remain, sessionId);
  db.prepare('UPDATE sessions SET phase_ends_at=NULL WHERE id=?').run(sessionId);
  broadcast('game:refresh', {}, `session:${sessionId}`);
  broadcast('game:toast', { level: 'warn', text: '讲师暂停了沙盘，倒计时已冻结' }, `session:${sessionId}`);
}

function resumeSession(sessionId) {
  const s = parseSession(getSessionRow(sessionId));
  if (!s || s.status !== 'PAUSED') return;
  const remain = s.paused_ms || 0;
  db.prepare('UPDATE sessions SET status=?, paused_ms=NULL WHERE id=?').run(s.phase === 'PREP' ? 'OPEN' : 'RUNNING', sessionId);
  const endsAt = new Date(Date.now() + remain).toISOString();
  db.prepare('UPDATE sessions SET phase_ends_at=? WHERE id=?').run(endsAt, sessionId);
  broadcast('game:refresh', {}, `session:${sessionId}`);
}

function extendSession(sessionId, minutes) {
  const s = parseSession(getSessionRow(sessionId));
  if (!s) return;
  if (s.status === 'PAUSED') {
    db.prepare('UPDATE sessions SET paused_ms=? WHERE id=?').run((s.paused_ms || 0) + minutes * 60000, sessionId);
  } else if (s.phase_ends_at) {
    const base = Math.max(Date.now(), Date.parse(s.phase_ends_at));
    db.prepare('UPDATE sessions SET phase_ends_at=? WHERE id=?').run(new Date(base + minutes * 60000).toISOString(), sessionId);
  }
  broadcast('game:refresh', {}, `session:${sessionId}`);
  broadcast('game:toast', { level: 'info', text: `讲师延长了 ${minutes} 分钟` }, `session:${sessionId}`);
}

function publicWeather(cfg, day) {
  const row = cfg.weather.matrix.find((r) => Number(r.day) === Number(day));
  if (!row) return [];
  return rules.TERRAIN.map((t) => ({
    terrain: t,
    label: TERRAIN_LABEL[t],
    weather: row[t],
    weatherLabel: WEATHER_LABEL[row[t]],
  }));
}

/* ----------------------------- 结算 ----------------------------- */

function settleSessionDay(sessionId, { forced = false } = {}) {
  const s = parseSession(getSessionRow(sessionId));
  if (!s) return { ok: false, reason: 'no-session' };
  const day = s.current_day;
  if (!day) return { ok: false, reason: 'no-day' };
  if (s.settled.includes(day)) return { ok: false, reason: 'already-settled' };

  const cfg = s.config;
  const map = cfg.map;
  const teamRows = getTeams(sessionId);
  const actionRows = db.prepare('SELECT * FROM actions WHERE session_id=? AND day=?').all(sessionId, day);
  const actionsByTeam = {};
  for (const a of actionRows) actionsByTeam[a.team_id] = JSON.parse(a.payload_json);

  const engineTeams = teamRows.map(engineTeam);
  const { results, nextReturnRank } = settleDay({
    cfg, map, teams: engineTeams, actionsByTeam, day, startReturnRank: s.next_return_rank || 1,
  });

  const tx = db.transaction(() => {
    for (const { team, report } of results) {
      const prev = teamRows.find((t) => t.id === team.id);
      if (prev && team.status === 'DEAD' && prev.status !== 'DEAD') team.dead_day = day;
      writeEngineTeam(team);
      db.prepare('INSERT INTO reports (id, session_id, team_id, day, payload_json, created_at) VALUES (?,?,?,?,?,?)')
        .run(uid('r'), sessionId, team.id, day, JSON.stringify(report), nowIso());
      db.prepare('INSERT OR REPLACE INTO cost_totals (session_id, day, team_id, payload_json) VALUES (?,?,?,?)')
        .run(sessionId, day, team.id, JSON.stringify({ ...report.costs, cashDelta: report.cashDelta, summary: report.summary }));
    }
    const settled = Array.from(new Set([...s.settled, day]));
    db.prepare('UPDATE sessions SET settled_json=?, next_return_rank=? WHERE id=?').run(JSON.stringify(settled), nextReturnRank, sessionId);
  });
  tx();

  // 事件播报
  for (const { team, report } of results) {
    if (report.died) {
      broadcast('game:toast', { level: 'death', text: `${team.name} 在第 ${day} 天${report.deadReason}，退出本局`, teamId: team.id }, `session:${sessionId}`);
    }
    if (report.lost && !report.returned) {
      broadcast('game:toast', { level: 'warn', text: `${team.name} 在第 ${day} 天遭遇${report.weatherLabel}，迷路 ${cfg.consume.lostDays} 天`, teamId: team.id }, `session:${sessionId}`);
    }
    if (report.returned && report.returnRank) {
      broadcast('game:toast', { level: 'success', text: `${team.name} 第 ${report.returnRank} 个回到大本营，金价锁定`, teamId: team.id }, `session:${sessionId}`);
    }
    broadcast('team:report', { teamId: team.id, day, report }, `team:${team.id}`);
  }

  const reportMs = cfg.timing.reportSeconds * 1000;
  db.prepare("UPDATE sessions SET phase='REPORT' WHERE id=?").run(sessionId);
  db.prepare('UPDATE sessions SET phase_ends_at=? WHERE id=?').run(new Date(Date.now() + reportMs).toISOString(), sessionId);
  broadcast('game:dayEnd', { day }, `session:${sessionId}`);
  broadcast('game:refresh', {}, `session:${sessionId}`);
  return { ok: true, day, results: results.map((r) => ({ teamId: r.team.id, report: r.report })) };
}

function finishSession(sessionId) {
  const s = parseSession(getSessionRow(sessionId));
  const teams = getTeams(sessionId);
  const tx = db.transaction(() => {
    for (const t of teams) {
      if (t.status === 'ALIVE' || t.status === 'LOST') {
        db.prepare("UPDATE teams SET status='STUCK' WHERE id=?").run(t.id);
      }
    }
    db.prepare("UPDATE sessions SET status='ENDED', phase='ENDED', phase_ends_at=NULL, ended_at=? WHERE id=?").run(nowIso(), sessionId);
  });
  tx();
  const scores = computeScores({ cfg: s.config, teams: getTeams(sessionId) });
  broadcast('game:ended', { scores }, `session:${sessionId}`);
  broadcast('game:refresh', {}, `session:${sessionId}`);
  return scores;
}

function advancePhase(sessionId) {
  const s = parseSession(getSessionRow(sessionId));
  if (!s || s.status === 'PAUSED' || s.status === 'ENDED' || s.status === 'DRAFT') return;
  if (!s.phase_ends_at || Date.parse(s.phase_ends_at) > Date.now() + 30) return;

  if (s.phase === 'PREP') {
    beginDay(sessionId, 1);
    return;
  }
  if (s.phase === 'BRIEF') {
    beginAction(sessionId);
    return;
  }
  if (s.phase === 'ACTION') {
    // 行动窗口结束：未提交者自动原地停留
    const teams = getTeams(sessionId).filter((t) => t.status !== 'DEAD' && t.status !== 'RETURNED');
    for (const t of teams) {
      const has = db.prepare('SELECT id FROM actions WHERE session_id=? AND day=? AND team_id=?').get(sessionId, s.current_day, t.id);
      if (!has) {
        const auto = { ...normalizeAction(null), __auto: true, __submitted: false };
        const cid = `auto_${t.id}_${s.current_day}`;
        db.prepare('INSERT OR IGNORE INTO actions (id, session_id, team_id, day, payload_json, client_action_id, submitted_at) VALUES (?,?,?,?,?,?,?)')
          .run(uid('a'), sessionId, t.id, s.current_day, JSON.stringify(auto), cid, nowIso());
      }
    }
    db.prepare("UPDATE sessions SET phase='SETTLING' WHERE id=?").run(sessionId);
    settleSessionDay(sessionId);
    return;
  }
  if (s.phase === 'SETTLING') {
    settleSessionDay(sessionId);
    return;
  }
  if (s.phase === 'REPORT') {
    if (s.current_day >= s.config.session.totalDays) {
      finishSession(sessionId);
    } else {
      beginDay(sessionId, s.current_day + 1);
    }
  }
}

function tick() {
  const rows = db
    .prepare("SELECT id FROM sessions WHERE status IN ('OPEN','RUNNING') AND phase NOT IN ('IDLE','ENDED')")
    .all();
  for (const row of rows) {
    try {
      advancePhase(row.id);
    } catch (err) {
      console.error('[tick]', err);
    }
  }
}

/* ----------------------------- 玩家行动 ----------------------------- */

function submitAction({ sessionId, teamId, action, clientActionId }) {
  const s = parseSession(getSessionRow(sessionId));
  if (!s) return { ok: false, status: 400, error: '局不存在' };
  if (s.status !== 'RUNNING' || s.phase !== 'ACTION') return { ok: false, status: 409, error: '当前不在行动窗口' };
  const row = db.prepare('SELECT * FROM teams WHERE id=? AND session_id=?').get(teamId, sessionId);
  if (!row) return { ok: false, status: 404, error: '队伍不存在' };
  if (row.status === 'DEAD' || row.status === 'RETURNED' || row.status === 'STUCK') {
    return { ok: false, status: 409, error: '队伍已退出本局' };
  }
  const existing = db.prepare('SELECT * FROM actions WHERE client_action_id=?').get(clientActionId);
  if (existing) {
    return { ok: true, idempotent: true, action: JSON.parse(existing.payload_json) };
  }
  const team = engineTeam(row);
  const errors = actionErrors({ cfg: s.config, map: s.config.map, team, action, day: s.current_day });
  if (errors.length) return { ok: false, status: 422, error: errors.join('；'), errors };
  const stamped = { ...normalizeAction(action), __submitted: true, __auto: false };
  const tx = db.transaction(() => {
    db.prepare('INSERT INTO actions (id, session_id, team_id, day, payload_json, client_action_id, submitted_at) VALUES (?,?,?,?,?,?,?)')
      .run(uid('a'), sessionId, teamId, s.current_day, JSON.stringify(stamped), clientActionId, nowIso());
    db.prepare('UPDATE teams SET action_json=?, client_action_id=?, submitted_at=? WHERE id=?')
      .run(JSON.stringify(stamped), clientActionId, nowIso(), teamId);
  });
  try {
    tx();
  } catch (err) {
    return { ok: false, status: 409, error: '行动已提交或已结算' };
  }
  broadcast('team:update', { teamId }, `session:${sessionId}`);

  // 全员提交 → 提前结算
  if (s.config.rules.autoSettleOnAllSubmitted) {
    const aliveTeams = getTeams(sessionId).filter((t) => t.status !== 'DEAD' && t.status !== 'RETURNED' && t.status !== 'STUCK');
    const submitted = db.prepare('SELECT COUNT(*) AS c FROM actions WHERE session_id=? AND day=?').get(sessionId, s.current_day).c;
    if (aliveTeams.length > 0 && submitted >= aliveTeams.length) {
      db.prepare('UPDATE sessions SET phase_ends_at=? WHERE id=?').run(new Date(Date.now() + 800).toISOString(), sessionId);
      broadcast('game:toast', { level: 'info', text: '所有队伍已提交，沙盘提前结算' }, `session:${sessionId}`);
    }
  }
  return { ok: true, action: stamped };
}

function recallAction({ sessionId, teamId }) {
  const s = parseSession(getSessionRow(sessionId));
  if (!s || s.phase !== 'ACTION' || s.status !== 'RUNNING') return { ok: false, error: '不在行动窗口' };
  const endsAt = s.phase_ends_at ? Date.parse(s.phase_ends_at) : 0;
  const remain = endsAt - Date.now();
  if (remain < s.config.rules.recallBeforeSeconds * 1000) {
    return { ok: false, error: `最后 ${s.config.rules.recallBeforeSeconds} 秒不能撤回` };
  }
  const row = db.prepare('SELECT * FROM teams WHERE id=? AND session_id=?').get(teamId, sessionId);
  if (!row || !row.client_action_id) return { ok: false, error: '没有可撤回的行动' };
  db.prepare('DELETE FROM actions WHERE client_action_id=?').run(row.client_action_id);
  db.prepare('UPDATE teams SET action_json=NULL, client_action_id=NULL, submitted_at=NULL WHERE id=?').run(teamId);
  broadcast('team:update', { teamId }, `session:${sessionId}`);
  return { ok: true };
}

/* ----------------------------- 状态序列化 ----------------------------- */

function timingState(s) {
  return {
    ...s.config.timing,
    totalDays: s.config.session.totalDays,
    phase: s.phase,
    phaseEndsAt: s.phase_ends_at,
    currentDay: s.current_day,
    status: s.status,
    openFrom: s.open_from,
    openTo: s.open_to,
  };
}

function publicTeams(sessionId, { revealAll = false } = {}) {
  const teams = getTeams(sessionId);
  const maxGold = teams.reduce((m, t) => Math.max(m, t.gold), 0);
  return teams.map((t) => {
    const base = { id: t.id, name: t.name, color: t.color, status: t.status };
    if (revealAll) {
      return {
        ...base,
        nodeId: t.node_id,
        water: t.water,
        food: t.food,
        gold: t.gold,
        cash: t.cash,
        tentLeft: t.tent_left,
        compass: t.compass,
        lostUntil: t.lost_until,
        returnRank: t.return_rank,
        returnedDay: t.returned_day,
        deadReason: t.dead_reason,
        weight: rules.weightUsed(getCfgOf(sessionId), engineTeam(t)),
      };
    }
    if (t.status === 'RETURNED') {
      return { ...base, returnRank: t.return_rank, gold: t.gold, goldStar: maxGold > 0 && t.gold === maxGold, returnedDay: t.returned_day };
    }
    if (t.status === 'DEAD') return { ...base, deadReason: t.dead_reason, deadDay: t.dead_day };
    return { ...base, moving: true };
  });
}

const cfgCache = new Map();
function clearCfgCache(sessionId) {
  if (sessionId) cfgCache.delete(sessionId);
  else cfgCache.clear();
}
function getCfgOf(sessionId) {
  if (cfgCache.has(sessionId)) return cfgCache.get(sessionId);
  const s = parseSession(getSessionRow(sessionId));
  if (!s) return normalizeConfig({});
  cfgCache.set(sessionId, s.config);
  return s.config;
}

function playerState(session, teamRow) {
  const cfg = session.config;
  const team = engineTeam(teamRow);
  const tRow = db.prepare('SELECT * FROM teams WHERE id=?').get(teamRow.id);
  const weight = rules.weightUsed(cfg, team);
  const neighbors = rules.neighbors(cfg.map, tRow.node_id);
  const nodeType = rules.terrainOf(cfg.map, tRow.node_id);
  const todayRow = cfg.weather.matrix.find((r) => Number(r.day) === Number(session.current_day));
  const takenIntel = db.prepare("SELECT intel_ids FROM teams WHERE session_id=?").all(session.id)
    .flatMap((r) => JSON.parse(r.intel_ids || '[]'));
  const report = db.prepare('SELECT payload_json FROM reports WHERE session_id=? AND team_id=? AND day=?').get(session.id, teamRow.id, session.current_day);
  const dayReport = report ? JSON.parse(report.payload_json) : null;
  const lastReport = db.prepare('SELECT payload_json FROM reports WHERE session_id=? AND team_id=? ORDER BY day DESC LIMIT 1').get(session.id, teamRow.id);
  const broadcasts = db.prepare('SELECT text, level, created_at FROM broadcasts WHERE session_id=? ORDER BY created_at DESC LIMIT 12').all(session.id);

  return {
    serverNow: nowIso(),
    session: {
      id: session.id,
      name: session.name,
      status: session.status,
      phase: session.phase,
      currentDay: session.current_day,
      totalDays: cfg.session.totalDays,
      timing: timingState(session),
    },
    task: cfg.task,
    team: {
      id: tRow.id,
      name: tRow.name,
      slogan: tRow.slogan,
      color: tRow.color,
      cash: tRow.cash,
      water: tRow.water,
      food: tRow.food,
      gold: tRow.gold,
      tentLeft: tRow.tent_left,
      compass: tRow.compass,
      nodeId: tRow.node_id,
      nodeType,
      nodeLabel: TERRAIN_LABEL[nodeType],
      status: tRow.status,
      lostUntil: tRow.lost_until,
      returnRank: tRow.return_rank,
      returnedDay: tRow.returned_day,
      intelIds: JSON.parse(tRow.intel_ids || '[]'),
      weight,
      capacity: cfg.start.capacity,
      neighbors: neighbors.map((id) => {
        const node = cfg.map.nodes.find((n) => n.id === id);
        const type = node ? node.type : 'DESERT';
        return { id, name: node ? node.name : id, type, label: TERRAIN_LABEL[type] };
      }),
      canDig: nodeType === 'MOUNTAIN' && (cfg.rules.digOnArrival || session.current_day > (tRow.arrived_day || 0)),
      distanceToBase: rules.bfs(cfg.map, tRow.node_id).get('BASE') ?? null,
    },
    prices: {
      water: cfg.prices.water.base,
      food: cfg.prices.food.base,
      tent: cfg.prices.tent.base,
      compass: cfg.prices.compass.base,
      waterAtVillage: Math.round(cfg.prices.water.base * cfg.prices.water.villageMultiplier),
      foodAtVillage: Math.round(cfg.prices.food.base * cfg.prices.food.villageMultiplier),
      weights: {
        water: cfg.prices.water.weight,
        food: cfg.prices.food.weight,
        tent: cfg.prices.tent.weightPerUse * cfg.prices.tent.uses,
        compass: cfg.prices.compass.weight,
        gold: cfg.prices.gold.weight,
      },
    },
    rules: {
      villageWaterToFood: cfg.rules.villageWaterToFood,
      tentCompassExclusive: cfg.rules.tentCompassExclusive,
      digOnArrival: cfg.rules.digOnArrival,
      recallBeforeSeconds: cfg.rules.recallBeforeSeconds,
      tentUses: cfg.prices.tent.uses,
    },
    economy: {
      priceMode: cfg.economy.priceMode,
      returnPrices: cfg.economy.returnPrices,
      taxRate: cfg.economy.taxRate,
      taxExemptTopDigger: cfg.economy.taxExemptTopDigger,
      goldWeight: cfg.prices.gold.weight,
    },
    intel: {
      costText: `${cfg.intel.water} 皮囊水 + ${cfg.intel.food} 盘食物 + 1 天`,
      exclusive: cfg.intel.exclusive,
      items: cfg.intel.items.map((i) => ({
        id: i.id,
        title: i.title,
        text: i.text,
        taken: cfg.intel.exclusive ? takenIntel.includes(i.id) && !JSON.parse(tRow.intel_ids || '[]').includes(i.id) : false,
        mine: JSON.parse(tRow.intel_ids || '[]').includes(i.id),
      })),
    },
    weatherToday: todayRow
      ? rules.TERRAIN.map((t) => ({ terrain: t, label: TERRAIN_LABEL[t], weather: todayRow[t], weatherLabel: WEATHER_LABEL[todayRow[t]] }))
      : [],
    action: tRow.action_json ? JSON.parse(tRow.action_json) : null,
    submittedAt: tRow.submitted_at,
    report: dayReport,
    lastReport: lastReport ? JSON.parse(lastReport.payload_json) : null,
    teams: publicTeams(session.id),
    consumptionTable: require('./engine/settle').previewConsumptionTable(cfg),
    leaderboard: computeScores({ cfg, teams: getTeams(session.id) }),
    broadcasts,
    map: { nodes: cfg.map.nodes, edges: cfg.map.edges },
  };
}

function adminState(session) {
  const cfg = session.config;
  const teams = getTeams(session.id);
  const day = session.current_day;
  const reports = day
    ? db.prepare('SELECT team_id, payload_json FROM reports WHERE session_id=? AND day=?').all(session.id, day)
    : [];
  const reportMap = {};
  for (const r of reports) reportMap[r.team_id] = JSON.parse(r.payload_json);
  const costRows = day
    ? db.prepare('SELECT team_id, payload_json FROM cost_totals WHERE session_id=? AND day=?').all(session.id, day)
    : [];
  const costs = {};
  for (const c of costRows) costs[c.team_id] = JSON.parse(c.payload_json);
  const audit = db.prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 60').all();
  const online = onlineCount(session.id);
  return {
    serverNow: nowIso(),
    session: {
      id: session.id,
      name: session.name,
      status: session.status,
      phase: session.phase,
      phaseEndsAt: session.phase_ends_at,
      currentDay: day,
      totalDays: cfg.session.totalDays,
      openFrom: session.open_from,
      openTo: session.open_to,
      pausedMs: session.paused_ms,
    },
    config: cfg,
    teams: publicTeams(session.id, { revealAll: true }).map((t) => ({ ...t, report: reportMap[t.id] || null, cost: costs[t.id] || null })),
    stats: {
      total: teams.length,
      alive: teams.filter((t) => t.status === 'ALIVE' || t.status === 'LOST').length,
      dead: teams.filter((t) => t.status === 'DEAD').length,
      returned: teams.filter((t) => t.status === 'RETURNED').length,
      submitted: teams.filter((t) => t.submitted_at).length,
      online,
    },
    audit,
    scores: computeScores({ cfg, teams }),
    consumptionTable: require('./engine/settle').previewConsumptionTable(cfg),
    balance: require('./engine/score').balanceProbe({ cfg, map: cfg.map }),
  };
}

const onlineMap = new Map();
function markOnline(teamId, socketId, online = true) {
  if (!onlineMap.has(teamId)) onlineMap.set(teamId, new Set());
  const set = onlineMap.get(teamId);
  if (online) set.add(socketId);
  else set.delete(socketId);
}
function onlineCount(sessionId) {
  const teams = getTeams(sessionId).map((t) => t.id);
  return teams.filter((id) => (onlineMap.get(id) || new Set()).size > 0).length;
}

function resetSession(sessionId, { keepTeams = true } = {}) {
  const s = parseSession(getSessionRow(sessionId));
  if (!s) return false;
  const cfg = s.config;
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM reports WHERE session_id=?').run(sessionId);
    db.prepare('DELETE FROM actions WHERE session_id=?').run(sessionId);
    db.prepare('DELETE FROM cost_totals WHERE session_id=?').run(sessionId);
    db.prepare("UPDATE sessions SET status='DRAFT', current_day=0, phase='IDLE', phase_ends_at=NULL, settled_json='[]', next_return_rank=1, started_at=NULL, ended_at=NULL, paused_ms=NULL WHERE id=?").run(sessionId);
    if (keepTeams) {
      const teams = getTeams(sessionId);
      for (const t of teams) {
        db.prepare(
          `UPDATE teams SET cash=?, water=?, food=?, gold=0, tent_left=?, compass=?, node_id='BASE', arrived_day=NULL,
            status='ALIVE', lost_until=NULL, lost_weather=NULL, return_rank=NULL, returned_day=NULL, returned_at=NULL,
            dead_reason=NULL, dead_day=NULL, intel_ids=?, action_json=NULL, client_action_id=NULL, submitted_at=NULL WHERE id=?`
        ).run(cfg.start.cash, cfg.start.water, cfg.start.food, cfg.start.tentUnits * cfg.prices.tent.uses, cfg.start.compass,
          JSON.stringify([]), t.id);
      }
    }
  });
  tx();
  broadcast('game:refresh', {}, `session:${sessionId}`);
  return true;
}

function logAudit({ sessionId, actor, action, before, after }) {
  db.prepare('INSERT INTO audit_logs (id, session_id, actor, action, before_json, after_json, created_at) VALUES (?,?,?,?,?,?,?)')
    .run(uid('log'), sessionId, actor, action, JSON.stringify(before || null), JSON.stringify(after || null), nowIso());
}

module.exports = {
  setEmitter,
  broadcast,
  getSessionRow,
  parseSession,
  currentSession,
  getTeams,
  engineTeam,
  publicWeather,
  openSession,
  pauseSession,
  resumeSession,
  extendSession,
  advancePhase,
  tick,
  settleSessionDay,
  finishSession,
  submitAction,
  recallAction,
  playerState,
  adminState,
  publicTeams,
  resetSession,
  logAudit,
  markOnline,
  timingState,
  getCfgOf,
  clearCfgCache,
};
