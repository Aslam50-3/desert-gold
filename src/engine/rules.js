'use strict';

const { TERRAIN, WEATHER, TERRAIN_LABEL, WEATHER_LABEL } = require('./config');

function buildGraph(map) {
  const nodes = new Map();
  for (const n of map.nodes) nodes.set(n.id, n);
  const adj = new Map();
  for (const id of nodes.keys()) adj.set(id, new Set());
  for (const e of map.edges) {
    if (!nodes.has(e.fromId) || !nodes.has(e.toId)) continue;
    adj.get(e.fromId).add(e.toId);
    adj.get(e.toId).add(e.fromId);
  }
  return { nodes, adj };
}

function neighbors(map, nodeId) {
  const { adj } = buildGraph(map);
  return Array.from(adj.get(nodeId) || []);
}

function bfs(map, startId) {
  const { adj } = buildGraph(map);
  const dist = new Map([[startId, 0]]);
  const queue = [startId];
  while (queue.length) {
    const cur = queue.shift();
    for (const next of adj.get(cur) || []) {
      if (!dist.has(next)) {
        dist.set(next, dist.get(cur) + 1);
        queue.push(next);
      }
    }
  }
  return dist;
}

function terrainOf(map, nodeId) {
  const node = map.nodes.find((n) => n.id === nodeId);
  return node ? node.type : 'DESERT';
}

function weightUsed(cfg, team) {
  const p = cfg.prices;
  return (
    team.water * p.water.weight +
    team.food * p.food.weight +
    team.gold * p.gold.weight +
    (team.tent_left || 0) * p.tent.weightPerUse +
    (team.compass || 0) * p.compass.weight
  );
}

function capacityLeft(cfg, team) {
  return cfg.start.capacity - weightUsed(cfg, team);
}

function unitPrice(cfg, nodeType, item) {
  const p = cfg.prices;
  if (nodeType === 'BASE') {
    if (item === 'water') return p.water.base;
    if (item === 'food') return p.food.base;
    if (item === 'tent') return p.tent.base;
    if (item === 'compass') return p.compass.base;
  }
  if (nodeType === 'VILLAGE') {
    if (item === 'water') return Math.round(p.water.base * p.water.villageMultiplier);
    if (item === 'food') return Math.round(p.food.base * p.food.villageMultiplier);
  }
  return null;
}

function itemWeight(cfg, item) {
  const p = cfg.prices;
  if (item === 'water') return p.water.weight;
  if (item === 'food') return p.food.weight;
  if (item === 'tent') return p.tent.weightPerUse; // 按“耐久”折算重量，买一顶等于 uses 次
  if (item === 'compass') return p.compass.weight;
  return 0;
}

function purchasableItems(cfg, nodeType) {
  if (nodeType === 'BASE') return ['water', 'food', 'tent', 'compass'];
  if (nodeType === 'VILLAGE') return ['water', 'food'];
  return [];
}

function takeWaterAllowed(cfg, nodeType, intelIds = []) {
  if (nodeType === 'OASIS') return true;
  if (nodeType === 'MOUNTAIN') {
    const item = (cfg.intel.items || []).find((i) => i.id === 'mountain_water');
    const hasIntel = intelIds.includes('mountain_water');
    return Boolean(item && item.effect === 'mountainWater' && hasIntel);
  }
  return false;
}

/**
 * 解析“天气 + 对策”的消耗。
 * @returns {{water:number, food:number, lost:boolean, gear:'tent'|'compass'|null, tombCompass:boolean}}
 */
function resolveConsumption(cfg, weather, gear = null, { tombCompass = false } = {}) {
  const c = cfg.consume;
  const stormy = weather === WEATHER.STORM || weather === WEATHER.STORM_HEAT;
  const hot = weather === WEATHER.HEAT || weather === WEATHER.STORM_HEAT;
  const baseKey = weather === WEATHER.STORM_HEAT ? 'stormheat' : 'storm';

  let key = 'sunny';
  let used = null;
  if (!stormy && !hot) key = 'sunny';
  else if (!stormy && hot) key = 'heat';
  else if (stormy) {
    if (gear === 'tent') {
      key = `${baseKey}_tent`;
      used = 'tent';
    } else if (gear === 'compass') {
      key = `${baseKey}_compass`;
      used = 'compass';
    } else if (tombCompass) {
      key = `${baseKey}_compass`;
      used = 'tombIntel';
    } else {
      key = `${baseKey}_plain`;
    }
  }

  const rule = c[key] || c.sunny;
  const lost = stormy && !(gear === 'tent' || gear === 'compass' || tombCompass);
  return {
    water: rule.water,
    food: rule.food,
    lost,
    gear: used,
    key,
  };
}

function lostConsumption(cfg, weather) {
  return weather === WEATHER.STORM_HEAT ? cfg.consume.lostStormHeat : cfg.consume.lostStorm;
}

function weatherOfDay(cfg, day, nodeType) {
  const row = cfg.weather.matrix.find((r) => Number(r.day) === Number(day));
  if (!row) return WEATHER.SUNNY;
  return row[nodeType] || 'SUNNY';
}

function dfsFarthest(map) {
  const dist = bfs(map, 'BASE');
  let farthest = null;
  for (const [id, d] of dist.entries()) {
    if (!farthest || d > farthest.dist) farthest = { id, dist: d };
  }
  return farthest;
}

function shortestPath(map, fromId, toId) {
  const { adj } = buildGraph(map);
  const prev = new Map([[fromId, null]]);
  const queue = [fromId];
  while (queue.length) {
    const cur = queue.shift();
    if (cur === toId) break;
    for (const next of adj.get(cur) || []) {
      if (!prev.has(next)) {
        prev.set(next, cur);
        queue.push(next);
      }
    }
  }
  if (!prev.has(toId)) return null;
  const path = [];
  let cur = toId;
  while (cur !== null) {
    path.unshift(cur);
    cur = prev.get(cur);
  }
  return path;
}

function validateMap(map) {
  const { nodes, adj } = buildGraph(map);
  const issues = [];
  if (!nodes.has('BASE')) issues.push('缺少大本营节点 BASE');
  if (!nodes.has('MOUNTAIN')) issues.push('缺少藏宝山节点 MOUNTAIN');
  const connect = bfs(map, 'BASE');
  for (const n of nodes.values()) {
    if (!connect.has(n.id)) issues.push(`节点 ${n.id} 与大本营不连通`);
  }
  for (const [id, set] of adj.entries()) {
    if (!set.size) issues.push(`节点 ${id} 没有任何连线`);
  }
  return {
    ok: issues.length === 0,
    issues,
    toMountain: connect.get('MOUNTAIN') || null,
    roundTrip: connect.has('MOUNTAIN') ? connect.get('MOUNTAIN') * 2 : null,
  };
}

function describeWeather(w) {
  return WEATHER_LABEL[w] || w;
}

function describeTerrain(t) {
  return TERRAIN_LABEL[t] || t;
}

module.exports = {
  buildGraph,
  neighbors,
  bfs,
  terrainOf,
  weightUsed,
  capacityLeft,
  unitPrice,
  itemWeight,
  purchasableItems,
  takeWaterAllowed,
  resolveConsumption,
  lostConsumption,
  weatherOfDay,
  dfsFarthest,
  shortestPath,
  validateMap,
  describeWeather,
  describeTerrain,
  TERRAIN,
  WEATHER,
};
