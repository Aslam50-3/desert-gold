'use strict';

const {
  neighbors,
  terrainOf,
  unitPrice,
  purchasableItems,
  takeWaterAllowed,
  resolveConsumption,
  lostConsumption,
  weatherOfDay,
  capacityLeft,
  weightUsed,
  bfs,
} = require('./rules');
const { TERRAIN_LABEL, WEATHER_LABEL } = require('./config');

function actionErrors({ cfg, map, team, action, day }) {
  const errors = [];
  if (!action || typeof action !== 'object') return ['行动为空'];
  if (team.status === 'DEAD') errors.push('队伍已死亡，无法提交行动');
  if (team.status === 'RETURNED') errors.push('队伍已返回大本营，无需再行动');
  const nodeId = team.node_id;
  const nodeType = terrainOf(map, nodeId);
  const lostNow = team.status === 'LOST' && team.lost_until && day <= team.lost_until;
  if (lostNow) {
    if (action.moveTo) errors.push('迷路中无法移动');
    if (action.askIntel) errors.push('迷路中无法问情报');
    if (action.takeWater) errors.push('迷路中无法取水');
    const buy = action.buy || {};
    if ((buy.water || 0) + (buy.food || 0) + (buy.tent || 0) + (buy.compass || 0) > 0) errors.push('迷路中无法采购');
    return errors;
  }
  if (action.moveTo) {
    if (!neighbors(map, nodeId).includes(action.moveTo)) errors.push('目标格不与当前格相邻');
  }
  if (action.askIntel) {
    if (nodeType !== 'BASE') errors.push('只有大本营才能向沙漠老怪问情报');
    if (action.moveTo) errors.push('问情报当天不可移动');
  }
  const buy = action.buy || {};
  const allowed = purchasableItems(cfg, nodeType);
  for (const item of ['water', 'food', 'tent', 'compass']) {
    const qty = Number(buy[item] || 0);
    if (!Number.isInteger(qty) || qty < 0) errors.push(`采购数量不合法：${item}`);
    if (qty > 0 && !allowed.includes(item)) errors.push(`${TERRAIN_LABEL[nodeType]}买不到${item}`);
  }
  if (action.takeWater) {
    if (!takeWaterAllowed(cfg, nodeType, team.intel_ids || [])) errors.push('此地不能取水');
  }
  if (action.useTent && action.useCompass && cfg.rules.tentCompassExclusive) errors.push('帐篷与指南针不能同时使用');
  if (action.useTent && (team.tent_left || 0) <= 0) errors.push('没有可用的帐篷');
  if (action.useCompass && (team.compass || 0) <= 0) errors.push('没有指南针');
  if (cfg.rules.villageWaterToFood.enabled && action.exchangeWaterForFood) {
    if (nodeType !== 'VILLAGE') errors.push('只有在村庄才能用水换食物');
  }
  // 采购预算与载重
  let cash = team.cash;
  let cap = capacityLeft(cfg, team);
  for (const item of ['water', 'food', 'tent', 'compass']) {
    const qty = Number(buy[item] || 0);
    if (!qty) continue;
    const price = unitPrice(cfg, nodeType, item) || 0;
    const w = item === 'water' ? cfg.prices.water.weight : item === 'food' ? cfg.prices.food.weight : item === 'tent' ? cfg.prices.tent.weightPerUse * cfg.prices.tent.uses : cfg.prices.compass.weight;
    if (price * qty > cash) errors.push(`现金不足：${item}`);
    if (w * qty > cap) errors.push(`载重不足：${item}`);
    cash -= price * qty;
    cap -= w * qty;
  }
  const takeWater = Number(action.takeWater || 0);
  if (action.takeWater === true) {
    // true 表示“尽可能取满”，由结算端计算
  } else if (Number.isFinite(takeWater) && takeWater > 0) {
    const maxByWeight = Math.floor(capacityLeft(cfg, team) / cfg.prices.water.weight);
    if (takeWater > maxByWeight) errors.push(`载重不足，最多可取 ${maxByWeight} 皮囊水`);
  }
  return errors;
}

function emptyAction() {
  return {
    moveTo: null,
    stay: true,
    buy: { water: 0, food: 0, tent: 0, compass: 0 },
    takeWater: 0,
    askIntel: false,
    intelId: null,
    useTent: false,
    useCompass: false,
    exchangeWaterForFood: false,
    note: '',
  };
}

function normalizeAction(action) {
  const a = { ...emptyAction(), ...(action || {}) };
  a.buy = { water: 0, food: 0, tent: 0, compass: 0, ...((action && action.buy) || {}) };
  for (const k of Object.keys(a.buy)) a.buy[k] = Math.max(0, Math.round(Number(a.buy[k] || 0)));
  a.takeWater = a.takeWater === true ? true : Math.max(0, Math.round(Number(a.takeWater || 0)));
  return a;
}

function fmtMoney(n) {
  return `¥${Math.round(n)}`;
}

function buildSummary(ctx) {
  const { day, fromLabel, toLabel, weatherLabel, gearLabel, consumed, lost, died, returned, rank, gold, terrainLabel } = ctx;
  if (died) return `第 ${day} 天，${toLabel}·${weatherLabel}。水和食物见底——你没能走出这片沙。`;
  if (lost && !ctx.lostOngoing) {
    return `第 ${day} 天，${toLabel}·${weatherLabel}。没有帐篷也没有指南针，队伍在原地迷了 ${ctx.lostDays} 天。`;
  }
  if (lost) return `第 ${day} 天，迷路第 ${ctx.lostDayIndex} 天，仍在 ${toLabel} 打转，水 -${consumed.water}、食物 -${consumed.food}。`;
  if (returned) return `第 ${day} 天，你回到了大本营，第 ${rank} 个抵达，金价锁定在 ${ctx.priceText}。`;
  const moved = ctx.moved ? `${fromLabel} → ${toLabel}` : `停留在 ${toLabel}`;
  return `第 ${day} 天，${moved} · ${weatherLabel}${gearLabel}；水 -${consumed.water}、食物 -${consumed.food}，现金 ${ctx.cashDelta >= 0 ? '+' : ''}${Math.round(ctx.cashDelta)}。`;
}

function buildAdvice(ctx) {
  const { cfg, team, map, nodeId, water, food, distanceToBase, waterPerDay } = ctx;
  const nodeType = terrainOf(map, nodeId);
  if (team.status === 'DEAD') return '本局结束。数据已保留，可用于复盘。';
  if (team.status === 'RETURNED') return '已经回到大本营，等待终局结算即可。';
  const days = distanceToBase;
  if (nodeType === 'MOUNTAIN') {
    return `距大本营 ${days} 天路程。按晴天耗水估算，回程至少还要 ${days} 皮囊水与 ${days} 盘食物；沙尘暴日会翻倍，别把最后一口水留在山上。`;
  }
  if (days === null) return '当前位置与大本营不连通，请让管理员检查地图。';
  const needWater = Math.ceil(days * waterPerDay);
  if (water < needWater) {
    const oasis = nearestOfType(map, nodeId, 'OASIS', 4);
    const village = nearestOfType(map, nodeId, 'VILLAGE', 4);
    const target = oasis ? `绿洲 ${oasis.id}（${oasis.dist} 天）` : village ? `村庄 ${village.id}（${village.dist} 天）` : null;
    return `水线告急：回营还要 ${days} 天，按晴天算至少 ${needWater} 皮囊，你只有 ${water}。${target ? `建议先绕去${target}补水。` : '最近的补给点都很远，考虑先回撤。'}`;
  }
  if (food < Math.ceil(days * 1)) {
    return `食物只够 ${food} 天，回营要 ${days} 天。村庄可补水补粮，别硬撑。`;
  }
  return `水线安全（约 ${water} 皮囊 / 回营 ${days} 天）。可以继续推进，但留出沙尘暴的余量。`;
}

function nearestOfType(map, fromId, type, maxDist = 6) {
  const dist = bfs(map, fromId);
  let best = null;
  for (const n of map.nodes) {
    if (n.type !== type) continue;
    const d = dist.get(n.id);
    if (d && d <= maxDist && (!best || d < best.dist)) best = { id: n.id, dist: d };
  }
  return best;
}

/**
 * 单队单日结算（纯函数，不触碰数据库）。
 * team / action 均为快照，返回新的 team 快照与日报。
 */
function settleTeam({ cfg, map, team, action, day, nextReturnRank, distances }) {
  const a = normalizeAction(action);
  const before = {
    cash: team.cash,
    water: team.water,
    food: team.food,
    gold: team.gold,
    tentLeft: team.tent_left || 0,
    compass: team.compass || 0,
  };
  const notes = [];
  const fromId = team.node_id;
  let nodeId = fromId;
  let nodeType = terrainOf(map, nodeId);
  const t = { ...team, intel_ids: team.intel_ids || [] };
  const purchases = {
    water: { qty: 0, cost: 0, weight: 0 },
    food: { qty: 0, cost: 0, weight: 0 },
    tent: { qty: 0, cost: 0, weight: 0 },
    compass: { qty: 0, cost: 0, weight: 0 },
  };
  let intelPurchase = null;
  let tookWater = 0;
  let dug = 0;
  let lostOngoing = false;
  let lostTriggered = false;
  const cashDeltaStart = t.cash;

  // 1) 迷路中断：不可移动、不可采购
  const lostNow = t.status === 'LOST' && t.lost_until && day <= t.lost_until;
  if (lostNow) {
    lostOngoing = true;
    t.status = 'LOST';
  } else {
    t.status = 'ALIVE';
    t.lost_until = null;
  }

  if (!lostOngoing) {
    // 2) 采购（在出发地）
    const allowed = purchasableItems(cfg, nodeType);
    for (const item of ['water', 'food', 'tent', 'compass']) {
      const qty = a.buy[item];
      if (!qty) continue;
      if (!allowed.includes(item)) {
        notes.push(`${TERRAIN_LABEL[nodeType]}买不到${item === 'water' ? '水' : item === 'food' ? '食物' : item === 'tent' ? '帐篷' : '指南针'}，已忽略`);
        continue;
      }
      const unit = unitPrice(cfg, nodeType, item) || 0;
      const unitWeight = item === 'water' ? cfg.prices.water.weight : item === 'food' ? cfg.prices.food.weight : item === 'tent' ? cfg.prices.tent.weightPerUse : cfg.prices.compass.weight;
      const addWeight = item === 'tent' ? cfg.prices.tent.weightPerUse * cfg.prices.tent.uses : unitWeight;
      if (unit * qty > t.cash) {
        notes.push(`现金不足，${item}采购 ${qty} 份未完成`);
        continue;
      }
      if (addWeight * qty > capacityLeft(cfg, t)) {
        notes.push(`载重不足，${item}采购 ${qty} 份未完成`);
        continue;
      }
      t.cash -= unit * qty;
      if (item === 'water') t.water += qty;
      if (item === 'food') t.food += qty;
      if (item === 'tent') t.tent_left = (t.tent_left || 0) + qty * cfg.prices.tent.uses;
      if (item === 'compass') t.compass = (t.compass || 0) + qty;
      purchases[item] = { qty, cost: unit * qty, weight: addWeight * qty };
    }

    // 3) 村庄用水换食物
    if (a.exchangeWaterForFood && cfg.rules.villageWaterToFood.enabled && nodeType === 'VILLAGE') {
      const { waterCost, foodGain } = cfg.rules.villageWaterToFood;
      if (t.water >= waterCost) {
        t.water -= waterCost;
        t.food += foodGain;
        notes.push(`在村庄用 ${waterCost} 皮囊水换了 ${foodGain} 盘食物`);
      } else {
        notes.push('水不够，换不了食物');
      }
    }

    // 4) 问情报（大本营，停留一天）
    if (a.askIntel) {
      if (nodeType !== 'BASE') {
        notes.push('只有大本营才能问情报');
      } else {
        const intelCfg = cfg.intel;
        const item = (intelCfg.items || []).find((i) => i.id === a.intelId);
        if (!item) {
          notes.push('情报编号无效');
        } else if (intelCfg.exclusive && t.intel_ids.includes(item.id)) {
          notes.push('这条情报你已经买断');
        } else if (t.water < intelCfg.water || t.food < intelCfg.food) {
          notes.push('水和食物不足以支付情报代价');
        } else {
          t.water -= intelCfg.water;
          t.food -= intelCfg.food;
          t.intel_ids = Array.from(new Set([...t.intel_ids, item.id]));
          intelPurchase = { id: item.id, title: item.title, water: intelCfg.water, food: intelCfg.food };
          notes.push(`用 1 天 + ${intelCfg.water} 水 + ${intelCfg.food} 食，换到「${item.title}」`);
        }
      }
    }

    // 5) 移动（问情报当天不可移动）
    if (a.moveTo && !intelPurchase) {
      if (neighbors(map, fromId).includes(a.moveTo)) {
        nodeId = a.moveTo;
      } else {
        notes.push('目标格不相邻，已原地停留');
      }
    }
  } else {
    notes.push('迷路中：原地打转，无法采购、取水或移动');
  }

  nodeType = terrainOf(map, nodeId);

  // 6) 取水（在到达地）
  const wantWater = a.takeWater === true ? -1 : Number(a.takeWater || 0);
  if (!lostOngoing && (wantWater !== 0)) {
    if (!takeWaterAllowed(cfg, nodeType, t.intel_ids)) {
      notes.push('此地不能取水');
    } else if (nodeType === 'OASIS' || nodeType === 'MOUNTAIN') {
      const maxByWeight = Math.floor(capacityLeft(cfg, t) / cfg.prices.water.weight);
      const qty = wantWater === -1 ? maxByWeight : Math.min(wantWater, maxByWeight);
      t.water += qty;
      tookWater = qty;
      if (wantWater !== -1 && wantWater > maxByWeight) notes.push(`载重限制，只取到 ${qty} 皮囊水`);
    }
  }

  // 7) 天气与消耗
  const weather = weatherOfDay(cfg, day, nodeType);
  const tombIntel = nodeType === 'TOMB' && (t.intel_ids || []).includes('tomb') && (cfg.intel.items || []).some((i) => i.id === 'tomb' && i.effect === 'tombCompass');
  const gearInput = a.useTent ? 'tent' : a.useCompass ? 'compass' : null;
  let consumeRule;
  let gearUsed = null;
  let lostTrigger = false;

  if (lostOngoing) {
    consumeRule = lostConsumption(cfg, t.lost_weather || weather);
    lostTrigger = false;
  } else if (cfg.rules.baseSafe && nodeId === 'BASE') {
    // 大本营补给充足：扎营当天不消耗水粮，否则空手队伍会在家里饿死
    consumeRule = { water: 0, food: 0 };
    gearUsed = null;
    notes.push('大本营内不消耗水粮');
  } else {
    let usable = gearInput;
    if (usable === 'tent' && (t.tent_left || 0) <= 0) {
      notes.push('帐篷耐久已用尽，按“无装备”结算');
      usable = null;
    }
    if (usable === 'compass' && (t.compass || 0) <= 0) {
      notes.push('没有指南针可用，按“无装备”结算');
      usable = null;
    }
    const resolved = resolveConsumption(cfg, weather, usable, { tombCompass: tombIntel });
    consumeRule = { water: resolved.water, food: resolved.food };
    lostTrigger = resolved.lost;
    gearUsed = resolved.gear;
    if (gearUsed === 'tent') {
      t.tent_left -= 1;
      if (t.tent_left === 0) notes.push('最后一个帐篷耐久用尽');
    } else if (gearUsed === 'compass') {
      t.compass -= 1;
      notes.push('指南针已消耗（一次性）');
    } else if (gearUsed === 'tombIntel') {
      notes.push('凭古墓情报，把古墓当作指南针使用');
    }
  }

  t.water -= consumeRule.water;
  t.food -= consumeRule.food;

  // 8) 死亡判定
  const atBase = nodeId === 'BASE';
  const zeroDeath = cfg.rules.dieAtZero && !(cfg.rules.baseSafe && atBase);
  const died = t.water < 0 || t.food < 0 || (zeroDeath && (t.water === 0 || t.food === 0));
  let deadReason = null;
  if (died) {
    deadReason = t.water <= 0 && t.food <= 0 ? '断水断粮' : t.water <= 0 ? '断水' : '断粮';
    if (t.water === 0 && t.food === 0) deadReason = '断水断粮';
    t.water = Math.max(0, t.water);
    t.food = Math.max(0, t.food);
    t.status = 'DEAD';
    t.dead_reason = deadReason;
    t.lost_until = null;
  } else if (lostTrigger) {
    lostTriggered = true;
    const lostDays = cfg.consume.lostDays;
    t.status = 'LOST';
    t.lost_until = day + Math.max(0, lostDays - 1);
    t.lost_weather = weather;
    t.lost_until = t.lost_until;
    notes.push(`沙尘暴迷路，原地停滞 ${lostDays} 天（至第 ${t.lost_until} 天）`);
  }

  // 9) 挖金（藏宝山，非到达当天）
  if (!died && nodeType === 'MOUNTAIN') {
    const arrived = t.arrived_day || day;
    const canDig = cfg.rules.digOnArrival || day > arrived;
    const perDay = cfg.prices.gold.digPerDay;
    if (!canDig) {
      notes.push('到达藏宝山当天需休整，次日起才能挖金');
    } else if (capacityLeft(cfg, t) < cfg.prices.gold.weight * perDay) {
      notes.push('载重不足，今天挖不了金子');
    } else {
      const qty = Math.min(perDay, Math.floor(capacityLeft(cfg, t) / cfg.prices.gold.weight));
      t.gold += qty;
      dug = qty;
    }
  }

  // 10) 返程排名
  let returnRank = t.return_rank || null;
  let returnedNow = false;
  if (!died && nodeId === 'BASE' && fromId !== 'BASE' && t.status !== 'RETURNED') {
    t.status = 'RETURNED';
    t.return_rank = nextReturnRank;
    t.returned_day = day;
    t.returned_at = new Date().toISOString();
    returnRank = nextReturnRank;
    returnedNow = true;
  }

  t.node_id = nodeId;
  if (nodeId === 'MOUNTAIN' && nodeId !== fromId) t.arrived_day = day;

  // 11) 成本
  const cashDelta = t.cash - cashDeltaStart;
  const costs = {
    waterCost: purchases.water.cost,
    foodCost: purchases.food.cost,
    tentCost: purchases.tent.cost,
    compassCost: purchases.compass.cost,
    intelCost: 0,
    total: cashDelta < 0 ? -cashDelta : 0,
  };

  const weight = weightUsed(cfg, t);
  const distancesFromHere = distances && distances[nodeId] ? distances[nodeId] : bfs(map, nodeId);
  const distanceToBase = distancesFromHere.get('BASE') ?? null;
  const price = cfg.economy.priceMode === 'PIECE'
    ? (cfg.economy.returnPrices[Math.min((returnRank || 99) - 1, cfg.economy.returnPrices.length - 1)] ?? cfg.economy.returnPrices[0])
    : (cfg.economy.returnPrices[Math.min((returnRank || 99) - 1, cfg.economy.returnPrices.length - 1)] ?? cfg.economy.returnPrices[0]);

  const gearLabel = gearUsed === 'tent' ? '（帐篷护住）' : gearUsed === 'compass' ? '（指南针指路）' : gearUsed === 'tombIntel' ? '（古墓情报当指南针）' : '';
  const summary = buildSummary({
    day,
    fromLabel: TERRAIN_LABEL[terrainOf(map, fromId)],
    toLabel: TERRAIN_LABEL[nodeType],
    terrainLabel: TERRAIN_LABEL[nodeType],
    weatherLabel: WEATHER_LABEL[weather],
    gearLabel,
    consumed: consumeRule,
    lost: lostTriggered || lostOngoing,
    lostOngoing,
    lostDays: cfg.consume.lostDays,
    lostDayIndex: t.lost_until ? Math.max(1, cfg.consume.lostDays - (t.lost_until - day)) : 0,
    died,
    returned: returnedNow,
    rank: returnRank,
    priceText: cfg.economy.priceMode === 'PIECE' ? `${price} 元/块` : `${price} 元/磅`,
    cashDelta,
    moved: nodeId !== fromId,
  });

  const advice = buildAdvice({
    cfg,
    team: t,
    map,
    nodeId,
    water: t.water,
    food: t.food,
    distanceToBase,
    waterPerDay: 1.4,
  });

  const report = {
    day,
    fromId,
    fromLabel: TERRAIN_LABEL[terrainOf(map, fromId)],
    nodeId,
    terrain: nodeType,
    terrainLabel: TERRAIN_LABEL[nodeType],
    weather,
    weatherLabel: WEATHER_LABEL[weather],
    countermeasure: gearLabel ? gearLabel.replace(/（|）/g, '') : lostOngoing || lostTriggered ? '迷路' : '常规',
    moved: nodeId !== fromId,
    purchases,
    tookWater,
    intel: intelPurchase,
    tookIntel: Boolean(intelPurchase),
    dug,
    consumed: {
      water: consumeRule.water,
      food: consumeRule.food,
      tent: gearUsed === 'tent' ? 1 : 0,
      compass: gearUsed === 'compass' ? 1 : 0,
      reason: consumeRuleReason(consumeRule, weather, gearUsed, lostOngoing || lostTriggered),
    },
    lost: lostOngoing || lostTriggered,
    lostUntil: t.lost_until || null,
    died,
    deadReason,
    returned: returnedNow,
    returnRank,
    cashDelta,
    costs,
    balance: {
      water: t.water,
      food: t.food,
      gold: t.gold,
      tentLeft: t.tent_left || 0,
      compass: t.compass || 0,
      cash: t.cash,
      weight,
      weightLeft: cfg.start.capacity - weight,
      capacity: cfg.start.capacity,
    },
    before,
    summary,
    advice,
    notes,
    submitted: Boolean(action && action.__submitted),
    autoStay: Boolean(action && action.__auto),
  };

  return { team: t, report };
}

function consumeRuleReason(rule, weather, gearUsed, lost) {
  if (lost) return `${WEATHER_LABEL[weather]} 无装备，迷路状态下按迷路消耗结算`;
  if (gearUsed === 'tent') return `${WEATHER_LABEL[weather]} 使用帐篷，避免迷路并保住食物`;
  if (gearUsed === 'compass') return `${WEATHER_LABEL[weather]} 使用指南针，避免迷路但耗水不减`;
  if (weather === 'HEAT') return '高温不可避免，水耗升至 3';
  return '晴天常规消耗';
}

/**
 * 全天结算：按提交时间/返回序位处理，保证排名确定性。
 */
function settleDay({ cfg, map, teams, actionsByTeam, day, startReturnRank = 1 }) {
  const now = Date.now();
  const distances = {};
  for (const n of map.nodes) distances[n.id] = bfs(map, n.id);
  const ordered = [...teams]
    .filter((t) => t.status !== 'DEAD' && t.status !== 'RETURNED')
    .sort((a, b) => {
      const at = a.submitted_at ? Date.parse(a.submitted_at) : now + 100000 + Math.random();
      const bt = b.submitted_at ? Date.parse(b.submitted_at) : now + 100000 + Math.random();
      if (at !== bt) return at - bt;
      return a.id.localeCompare(b.id);
    });

  let rank = startReturnRank;
  const results = [];
  for (const team of ordered) {
    const action = actionsByTeam[team.id] || { ...emptyAction(), __auto: true };
    const out = settleTeam({ cfg, map, team, action, day, nextReturnRank: rank, distances });
    if (out.team.status === 'RETURNED' && !team.return_rank) rank += 1;
    results.push(out);
  }
  // 已死亡/已返回队伍：仍要出“无行动”日报占位，保证每日总表完整
  for (const team of teams) {
    if (team.status !== 'DEAD' && team.status !== 'RETURNED') continue;
    if (results.find((r) => r.team.id === team.id)) continue;
    results.push({
      team,
      report: {
        day,
        nodeId: team.node_id,
        terrain: terrainOf(map, team.node_id),
        terrainLabel: TERRAIN_LABEL[terrainOf(map, team.node_id)],
        weather: weatherOfDay(cfg, day, terrainOf(map, team.node_id)),
        weatherLabel: WEATHER_LABEL[weatherOfDay(cfg, day, terrainOf(map, team.node_id))],
        consumed: { water: 0, food: 0, tent: 0, compass: 0, reason: '队伍已退出本局' },
        purchases: { water: { qty: 0, cost: 0, weight: 0 }, food: { qty: 0, cost: 0, weight: 0 }, tent: { qty: 0, cost: 0, weight: 0 }, compass: { qty: 0, cost: 0, weight: 0 } },
        balance: {
          water: team.water,
          food: team.food,
          gold: team.gold,
          tentLeft: team.tent_left || 0,
          compass: team.compass || 0,
          cash: team.cash,
          weight: weightUsed(cfg, team),
          weightLeft: cfg.start.capacity - weightUsed(cfg, team),
          capacity: cfg.start.capacity,
        },
        summary: team.status === 'DEAD' ? `第 ${day} 天 · ${TERRAIN_LABEL[terrainOf(map, team.node_id)]} · 队伍已在第 ${team.dead_day || '—'} 天退出` : `第 ${day} 天 · 已返回大本营，等待终局`,
        advice: '',
        notes: [],
        lost: false,
        died: team.status === 'DEAD',
        deadReason: team.dead_reason || '',
        returned: team.status === 'RETURNED',
        returnRank: team.return_rank || null,
        cashDelta: 0,
        costs: { waterCost: 0, foodCost: 0, tentCost: 0, compassCost: 0, intelCost: 0, total: 0 },
      },
    });
  }
  return { results, nextReturnRank: rank };
}

function previewConsumptionTable(cfg) {
  return [
    { label: '晴天', water: cfg.consume.sunny.water, food: cfg.consume.sunny.food, tent: 0, compass: 0, note: '常规' },
    { label: '高温', water: cfg.consume.heat.water, food: cfg.consume.heat.food, tent: 0, compass: 0, note: '不可规避' },
    { label: '沙尘暴（无装备）', water: cfg.consume.storm_plain.water, food: cfg.consume.storm_plain.food, tent: 0, compass: 0, note: `迷路 ${cfg.consume.lostDays} 天` },
    { label: '沙尘暴+帐篷', water: cfg.consume.storm_tent.water, food: cfg.consume.storm_tent.food, tent: 1, compass: 0, note: '不迷路' },
    { label: '沙尘暴+指南针', water: cfg.consume.storm_compass.water, food: cfg.consume.storm_compass.food, tent: 0, compass: 1, note: '不迷路' },
    { label: '沙尘暴+高温（无装备）', water: cfg.consume.stormheat_plain.water, food: cfg.consume.stormheat_plain.food, tent: 0, compass: 0, note: `迷路 ${cfg.consume.lostDays} 天` },
    { label: '沙尘暴+高温+帐篷', water: cfg.consume.stormheat_tent.water, food: cfg.consume.stormheat_tent.food, tent: 1, compass: 0, note: '不迷路' },
    { label: '沙尘暴+高温+指南针', water: cfg.consume.stormheat_compass.water, food: cfg.consume.stormheat_compass.food, tent: 0, compass: 1, note: '不迷路' },
  ];
}

module.exports = {
  actionErrors,
  normalizeAction,
  emptyAction,
  settleTeam,
  settleDay,
  previewConsumptionTable,
};
