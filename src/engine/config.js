'use strict';

/* ============================================================
 * 沙漠掘金 · 规则配置基线
 * 所有数值均可被后台覆盖；本文件只提供默认值与三套预设。
 * ============================================================ */

const WEATHER = {
  SUNNY: 'SUNNY',
  HEAT: 'HEAT',
  STORM: 'STORM',
  STORM_HEAT: 'STORM_HEAT',
};

const TERRAIN = ['BASE', 'DESERT', 'VILLAGE', 'OASIS', 'TOMB', 'MOUNTAIN'];

const TERRAIN_LABEL = {
  BASE: '大本营',
  DESERT: '沙漠',
  VILLAGE: '村庄',
  OASIS: '绿洲',
  TOMB: '古墓',
  MOUNTAIN: '藏宝山',
};

const WEATHER_LABEL = {
  SUNNY: '晴天',
  HEAT: '高温',
  STORM: '沙尘暴',
  STORM_HEAT: '沙尘暴+高温',
};

/* ---------- 默认地图（37 节点，依据手绘沙盘还原） ---------- */
const DEFAULT_NODES = [
  { id: 'BASE', name: '大本营', type: 'BASE', x: 0.2, y: 6.4 },
  { id: 'S1', name: 'S1', type: 'DESERT', x: 0.6, y: 5.3 },
  { id: 'S2', name: 'S2', type: 'DESERT', x: 1.6, y: 6.6 },
  { id: 'S3', name: 'S3', type: 'DESERT', x: 1.8, y: 5.2 },
  { id: 'C1', name: 'C1', type: 'VILLAGE', x: 2.6, y: 6.3 },
  { id: 'S5', name: 'S5', type: 'DESERT', x: 0.4, y: 4.2 },
  { id: 'S4', name: 'S4', type: 'DESERT', x: 1.5, y: 4.3 },
  { id: 'S11', name: 'S11', type: 'DESERT', x: 0.2, y: 3.2 },
  { id: 'S12', name: 'S12', type: 'DESERT', x: 1.4, y: 3.1 },
  { id: 'S13', name: 'S13', type: 'DESERT', x: 0.1, y: 2.0 },
  { id: 'S14', name: 'S14', type: 'DESERT', x: 0.7, y: 1.0 },
  { id: 'C7', name: 'C7', type: 'VILLAGE', x: 1.8, y: 0.4 },
  { id: 'S15', name: 'S15', type: 'DESERT', x: 2.7, y: 0.9 },
  { id: 'S16', name: 'S16', type: 'DESERT', x: 3.6, y: 0.9 },
  { id: 'S17', name: 'S17', type: 'DESERT', x: 4.5, y: 0.9 },
  { id: 'S18', name: 'S18', type: 'DESERT', x: 5.4, y: 0.9 },
  { id: 'MOUNTAIN', name: '藏宝山', type: 'MOUNTAIN', x: 6.7, y: 0.5 },
  { id: 'S26', name: 'S26', type: 'DESERT', x: 7.1, y: 1.6 },
  { id: 'S19', name: 'S19', type: 'DESERT', x: 5.6, y: 1.8 },
  { id: 'C6', name: 'C6', type: 'VILLAGE', x: 6.7, y: 2.4 },
  { id: 'S20', name: 'S20', type: 'DESERT', x: 5.6, y: 2.6 },
  { id: 'C5', name: 'C5', type: 'VILLAGE', x: 7.0, y: 3.4 },
  { id: 'S21', name: 'S21', type: 'DESERT', x: 5.5, y: 3.5 },
  { id: 'S25', name: 'S25', type: 'DESERT', x: 6.4, y: 4.2 },
  { id: 'C4', name: 'C4', type: 'VILLAGE', x: 6.8, y: 5.2 },
  { id: 'S23', name: 'S23', type: 'DESERT', x: 5.5, y: 4.6 },
  { id: 'S22', name: 'S22', type: 'DESERT', x: 4.7, y: 4.4 },
  { id: 'TOMB', name: '古墓', type: 'TOMB', x: 3.7, y: 2.4 },
  { id: 'L1', name: 'L1', type: 'OASIS', x: 3.7, y: 3.6 },
  { id: 'L2', name: 'L2', type: 'OASIS', x: 2.7, y: 1.9 },
  { id: 'S10', name: 'S10', type: 'DESERT', x: 2.6, y: 3.3 },
  { id: 'S9', name: 'S9', type: 'DESERT', x: 3.3, y: 4.5 },
  { id: 'S8', name: 'S8', type: 'DESERT', x: 4.0, y: 5.2 },
  { id: 'S6', name: 'S6', type: 'DESERT', x: 2.7, y: 6.2 },
  { id: 'S7', name: 'S7', type: 'DESERT', x: 3.7, y: 6.4 },
  { id: 'C2', name: 'C2', type: 'VILLAGE', x: 3.5, y: 5.6 },
  { id: 'C3', name: 'C3', type: 'VILLAGE', x: 6.3, y: 5.9 },
  { id: 'S24', name: 'S24', type: 'DESERT', x: 7.0, y: 6.6 },
];

const DEFAULT_EDGE_TEXT = `BASE-S1, BASE-S2,
S1-S5, S1-S13,
S2-C1, S2-S3,
S3-C1, S3-S4,
C1-S6,
S5-S4, S5-S11,
S4-S10,
S11-S12, S11-S13,
S12-S10, S12-L2,
S10-L2,
S13-S14,
S14-C7,
C7-S15,
S15-L2, S15-S16,
S16-S17,
S17-S18, S17-TOMB,
S18-MOUNTAIN, S18-S19,
MOUNTAIN-S26,
S26-S19, S26-C6,
S19-S20, S19-TOMB,
TOMB-L1,
L1-S9, L1-S22,
S9-C2, S9-S8, S9-S10,
S8-S7, S8-S23, S8-C3, S8-S24,
C2-S6, C2-S7,
S6-S7,
S22-S23, S22-S21,
S20-S21, S20-C6,
S21-S25,
S23-S25,
C6-C5,
C5-S25, C5-C4,
S25-C4,
C4-S24, C4-C3,
C3-S24`;

const DEFAULT_EDGES = DEFAULT_EDGE_TEXT
  .split(/[,\n]/)
  .map((s) => s.trim())
  .filter(Boolean)
  .map((pair, i) => {
    const [fromId, toId] = pair.split('-').map((s) => s.trim());
    return { id: `E${i + 1}`, fromId, toId };
  });

/* ---------- 25 天天气矩阵（PPT 原表，顺序：大本营/沙漠/村庄/绿洲/古墓/大山） ---------- */
const WEATHER_ROWS = [
  ['SUNNY', 'HEAT', 'SUNNY', 'SUNNY', 'STORM', 'SUNNY'],
  ['SUNNY', 'SUNNY', 'SUNNY', 'HEAT', 'SUNNY', 'SUNNY'],
  ['SUNNY', 'SUNNY', 'SUNNY', 'SUNNY', 'STORM_HEAT', 'SUNNY'],
  ['SUNNY', 'STORM_HEAT', 'SUNNY', 'HEAT', 'SUNNY', 'HEAT'],
  ['SUNNY', 'HEAT', 'STORM', 'SUNNY', 'HEAT', 'SUNNY'],
  ['SUNNY', 'SUNNY', 'SUNNY', 'STORM', 'SUNNY', 'SUNNY'],
  ['SUNNY', 'SUNNY', 'SUNNY', 'SUNNY', 'STORM', 'SUNNY'],
  ['SUNNY', 'STORM', 'SUNNY', 'HEAT', 'SUNNY', 'HEAT'],
  ['SUNNY', 'HEAT', 'SUNNY', 'SUNNY', 'STORM', 'SUNNY'],
  ['SUNNY', 'SUNNY', 'HEAT', 'STORM', 'SUNNY', 'SUNNY'],
  ['SUNNY', 'SUNNY', 'SUNNY', 'SUNNY', 'STORM_HEAT', 'SUNNY'],
  ['SUNNY', 'STORM', 'SUNNY', 'HEAT', 'SUNNY', 'STORM'],
  ['SUNNY', 'HEAT', 'SUNNY', 'SUNNY', 'HEAT', 'SUNNY'],
  ['SUNNY', 'SUNNY', 'SUNNY', 'STORM', 'SUNNY', 'SUNNY'],
  ['SUNNY', 'SUNNY', 'STORM_HEAT', 'SUNNY', 'STORM_HEAT', 'SUNNY'],
  ['SUNNY', 'STORM', 'SUNNY', 'HEAT', 'SUNNY', 'STORM_HEAT'],
  ['SUNNY', 'HEAT', 'SUNNY', 'SUNNY', 'STORM', 'SUNNY'],
  ['SUNNY', 'SUNNY', 'SUNNY', 'STORM', 'SUNNY', 'SUNNY'],
  ['SUNNY', 'SUNNY', 'SUNNY', 'SUNNY', 'STORM_HEAT', 'SUNNY'],
  ['SUNNY', 'STORM', 'HEAT', 'HEAT', 'SUNNY', 'HEAT'],
  ['SUNNY', 'STORM_HEAT', 'SUNNY', 'SUNNY', 'STORM', 'SUNNY'],
  ['SUNNY', 'SUNNY', 'SUNNY', 'STORM', 'SUNNY', 'SUNNY'],
  ['SUNNY', 'SUNNY', 'SUNNY', 'SUNNY', 'SUNNY', 'SUNNY'],
  ['SUNNY', 'STORM', 'SUNNY', 'HEAT', 'STORM_HEAT', 'STORM'],
  ['SUNNY', 'HEAT', 'HEAT', 'SUNNY', 'SUNNY', 'SUNNY'],
];

const DEFAULT_WEATHER = WEATHER_ROWS.map((row, i) => ({
  day: i + 1,
  BASE: row[0],
  DESERT: row[1],
  VILLAGE: row[2],
  OASIS: row[3],
  TOMB: row[4],
  MOUNTAIN: row[5],
}));

/* ---------- 三套规则预设 ---------- */
const PRESETS = {
  PPT: {
    label: 'PPT版（课堂主推）',
    note: '沙尘暴 2水5食；沙尘暴+高温 4水5食；迷路 3 天；金价按“每块”。',
    consume: {
      sunny: { water: 1, food: 1 },
      heat: { water: 3, food: 1 },
      storm_plain: { water: 2, food: 5 },
      storm_tent: { water: 1, food: 1 },
      storm_compass: { water: 2, food: 5 },
      stormheat_plain: { water: 4, food: 5 },
      stormheat_tent: { water: 3, food: 1 },
      stormheat_compass: { water: 4, food: 5 },
      lostStorm: { water: 2, food: 5 },
      lostStormHeat: { water: 4, food: 5 },
      lostDays: 3,
    },
    economy: {
      priceMode: 'PIECE',
      returnPrices: [1000, 900, 850, 800, 750, 750, 750, 750],
      taxRate: 0.2,
      taxExemptTopDigger: true,
    },
  },
  TABLE: {
    label: '表格版（掘金表格.xls）',
    note: '沙尘暴 4水10食；沙尘暴+高温 8水10食；迷路 3 天；金价按“每磅”，每块 5000 元起。',
    consume: {
      sunny: { water: 1, food: 1 },
      heat: { water: 3, food: 1 },
      storm_plain: { water: 4, food: 10 },
      storm_tent: { water: 1, food: 1 },
      storm_compass: { water: 2, food: 5 },
      stormheat_plain: { water: 8, food: 10 },
      stormheat_tent: { water: 3, food: 1 },
      stormheat_compass: { water: 4, food: 5 },
      lostStorm: { water: 4, food: 10 },
      lostStormHeat: { water: 8, food: 10 },
      lostDays: 3,
    },
    economy: {
      priceMode: 'POUND',
      returnPrices: [100, 90, 85, 80, 75, 70, 65, 60],
      taxRate: 0.2,
      taxExemptTopDigger: true,
    },
  },
  CLASSIC: {
    label: '课堂记录表版',
    note: '沙尘暴 2水5食、迷路 2 天；沙尘暴+高温 5水4食；金价按“每磅”。',
    consume: {
      sunny: { water: 1, food: 1 },
      heat: { water: 3, food: 1 },
      storm_plain: { water: 2, food: 5 },
      storm_tent: { water: 1, food: 1 },
      storm_compass: { water: 2, food: 5 },
      stormheat_plain: { water: 5, food: 4 },
      stormheat_tent: { water: 3, food: 4 },
      stormheat_compass: { water: 5, food: 4 },
      lostStorm: { water: 2, food: 5 },
      lostStormHeat: { water: 5, food: 4 },
      lostDays: 2,
    },
    economy: {
      priceMode: 'POUND',
      returnPrices: [100, 90, 85, 80, 75, 70, 65, 60],
      taxRate: 0.2,
      taxExemptTopDigger: true,
    },
  },
};

const DEFAULT_INTEL = [
  {
    id: 'tomb',
    title: '古墓规律',
    text: '古墓中每隔一天会出现高温（或沙尘暴）。凭此情报，在古墓中可当指南针任意使用；古墓若是高温，则沙漠必定高温。',
    effect: 'tombCompass',
  },
  {
    id: 'mountain_water',
    title: '宝山秘密水源',
    text: '藏宝山中有一处秘密水源。凭此情报，可在藏宝山无限免费取水。',
    effect: 'mountainWater',
  },
  {
    id: 'storm',
    title: '沙漠沙尘暴',
    text: '沙漠中每 6 天必有一次沙尘暴；绿洲不会有沙尘暴。',
    effect: 'knowledge',
  },
  {
    id: 'heat',
    title: '气温规律',
    text: '沙漠与绿洲每隔 2 天必有一次高温。',
    effect: 'knowledge',
  },
];

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildConfig({ preset = 'PPT', name = '沙盘任务' } = {}) {
  const p = PRESETS[preset] || PRESETS.PPT;
  return {
    meta: { version: 2, preset, presetLabel: p.label },
    task: {
      title: name,
      subtitle: '第 25 天之前，必须走出这片沙漠',
      deathBanner: '离歌响起，又一支队伍留在了沙里。',
      rulesBook:
        '每天只能移动到相邻的一格；每天结算一次消耗。断水或断粮即当日死亡。' +
        '第 25 天结束仍未回到大本营，判定困死。金子在回到大本营时按返回名次兑换。',
    },
    start: {
      cash: 1000,
      capacity: 1000,
      water: 0,
      food: 0,
      tentUnits: 0,
      compass: 0,
      gold: 0,
      membersPerTeam: 8,
    },
    prices: {
      water: { base: 25, villageMultiplier: 2, weight: 50 },
      food: { base: 10, villageMultiplier: 2, weight: 20 },
      tent: { base: 400, weight: 60, uses: 3, weightPerUse: 20 },
      compass: { base: 100, weight: 10 },
      gold: { weight: 50, digPerDay: 1 },
    },
    consume: deepClone(p.consume),
    rules: {
      preset,
      dieAtZero: true,
      baseSafe: true,
      digOnArrival: false,
      tentCompassExclusive: true,
      villageWaterToFood: { enabled: true, waterCost: 2, foodGain: 1 },
      autoSettleOnAllSubmitted: true,
      recallBeforeSeconds: 10,
      timeoutPolicy: 'STAY',
      allowSelfRegister: false,
      soundOn: true,
    },
    economy: deepClone(p.economy),
    intel: { costDays: 1, water: 1, food: 1, exclusive: true, items: deepClone(DEFAULT_INTEL) },
    timing: {
      prepSeconds: 600,
      briefSeconds: 15,
      day1Seconds: 300,
      daySeconds: 120,
      reportSeconds: 30,
      warnSeconds: 30,
    },
    session: {
      totalDays: 25,
      openFrom: null,
      openTo: null,
      weatherMode: 'FIXED',
      seed: null,
    },
    weather: { matrix: deepClone(DEFAULT_WEATHER) },
    map: { nodes: deepClone(DEFAULT_NODES), edges: deepClone(DEFAULT_EDGES) },
  };
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clampInt(v, min, max, fallback) {
  const n = Math.round(num(v, fallback));
  return Math.min(max, Math.max(min, n));
}

function normalizeConfig(raw) {
  const base = buildConfig({ preset: (raw && raw.meta && raw.meta.preset) || 'PPT' });
  if (!raw || typeof raw !== 'object') return base;
  const cfg = { ...base, ...deepClone(raw) };
  cfg.meta = { ...base.meta, ...(raw.meta || {}) };
  cfg.task = { ...base.task, ...(raw.task || {}) };
  cfg.start = { ...base.start, ...(raw.start || {}) };
  cfg.prices = {
    water: { ...base.prices.water, ...((raw.prices || {}).water || {}) },
    food: { ...base.prices.food, ...((raw.prices || {}).food || {}) },
    tent: { ...base.prices.tent, ...((raw.prices || {}).tent || {}) },
    compass: { ...base.prices.compass, ...((raw.prices || {}).compass || {}) },
    gold: { ...base.prices.gold, ...((raw.prices || {}).gold || {}) },
  };
  cfg.consume = { ...base.consume, ...(raw.consume || {}) };
  cfg.rules = {
    ...base.rules,
    ...(raw.rules || {}),
    villageWaterToFood: { ...base.rules.villageWaterToFood, ...((raw.rules || {}).villageWaterToFood || {}) },
  };
  cfg.economy = { ...base.economy, ...(raw.economy || {}) };
  cfg.intel = { ...base.intel, ...(raw.intel || {}) };
  if (!Array.isArray(cfg.intel.items)) cfg.intel.items = deepClone(DEFAULT_INTEL);
  cfg.timing = { ...base.timing, ...(raw.timing || {}) };
  cfg.session = { ...base.session, ...(raw.session || {}) };

  // 数值护栏：防止后台随手填 0 或负数把一局玩坏
  cfg.start.cash = clampInt(cfg.start.cash, 0, 100000, 1000);
  cfg.start.capacity = clampInt(cfg.start.capacity, 100, 100000, 1000);
  for (const k of ['water', 'food', 'tentUnits', 'compass', 'gold']) {
    cfg.start[k] = clampInt(cfg.start[k], 0, 1000, 0);
  }
  cfg.prices.water.base = clampInt(cfg.prices.water.base, 1, 10000, 25);
  cfg.prices.food.base = clampInt(cfg.prices.food.base, 1, 10000, 10);
  cfg.prices.tent.base = clampInt(cfg.prices.tent.base, 1, 100000, 400);
  cfg.prices.compass.base = clampInt(cfg.prices.compass.base, 1, 100000, 100);
  cfg.prices.water.weight = clampInt(cfg.prices.water.weight, 1, 1000, 50);
  cfg.prices.food.weight = clampInt(cfg.prices.food.weight, 1, 1000, 20);
  cfg.prices.tent.weight = clampInt(cfg.prices.tent.weight, 1, 1000, 60);
  cfg.prices.tent.uses = clampInt(cfg.prices.tent.uses, 1, 10, 3);
  cfg.prices.tent.weightPerUse = clampInt(cfg.prices.tent.weightPerUse, 0, 1000, 20);
  cfg.prices.compass.weight = clampInt(cfg.prices.compass.weight, 0, 1000, 10);
  cfg.prices.gold.weight = clampInt(cfg.prices.gold.weight, 1, 1000, 50);
  cfg.prices.gold.digPerDay = clampInt(cfg.prices.gold.digPerDay, 0, 10, 1);
  cfg.prices.water.villageMultiplier = num(cfg.prices.water.villageMultiplier, 2);
  cfg.prices.food.villageMultiplier = num(cfg.prices.food.villageMultiplier, 2);
  for (const k of Object.keys(cfg.consume)) {
    if (k === 'lostDays') cfg.consume.lostDays = clampInt(cfg.consume[k], 0, 10, 3);
    else if (cfg.consume[k] && typeof cfg.consume[k] === 'object') {
      cfg.consume[k].water = clampInt(cfg.consume[k].water, 0, 100, 1);
      cfg.consume[k].food = clampInt(cfg.consume[k].food, 0, 100, 1);
    }
  }
  cfg.economy.taxRate = Math.min(1, Math.max(0, num(cfg.economy.taxRate, 0.2)));
  cfg.economy.returnPrices = (Array.isArray(cfg.economy.returnPrices) ? cfg.economy.returnPrices : base.economy.returnPrices)
    .map((v) => clampInt(v, 0, 100000, 75))
    .slice(0, 12);
  if (!cfg.economy.returnPrices.length) cfg.economy.returnPrices = [75];
  cfg.timing.prepSeconds = clampInt(cfg.timing.prepSeconds, 0, 7200, 600);
  cfg.timing.briefSeconds = clampInt(cfg.timing.briefSeconds, 0, 120, 15);
  cfg.timing.day1Seconds = clampInt(cfg.timing.day1Seconds, 10, 3600, 300);
  cfg.timing.daySeconds = clampInt(cfg.timing.daySeconds, 10, 3600, 120);
  cfg.timing.reportSeconds = clampInt(cfg.timing.reportSeconds, 0, 300, 30);
  cfg.timing.warnSeconds = clampInt(cfg.timing.warnSeconds, 5, 120, 30);
  cfg.session.totalDays = clampInt(cfg.session.totalDays, 3, 60, 25);

  // 天气矩阵必须 25(总量) × 6 地形，值只能是四种天气
  const totalDays = cfg.session.totalDays;
  const matrix = Array.isArray(cfg.weather && cfg.weather.matrix) ? cfg.weather.matrix : [];
  cfg.weather = { matrix: [] };
  for (let d = 1; d <= totalDays; d += 1) {
    const row = matrix.find((r) => Number(r.day) === d) || DEFAULT_WEATHER[d - 1] || DEFAULT_WEATHER[0];
    const item = { day: d };
    for (const t of TERRAIN) {
      const val = row[t];
      item[t] = WEATHER[val] ? val : 'SUNNY';
    }
    // 规则硬约束：大本营恒晴，绿洲不出现沙尘暴
    item.BASE = 'SUNNY';
    if (item.OASIS === 'STORM' || item.OASIS === 'STORM_HEAT') item.OASIS = 'HEAT';
    cfg.weather.matrix.push(item);
  }

  const nodes = Array.isArray(cfg.map && cfg.map.nodes) && cfg.map.nodes.length ? cfg.map.nodes : deepClone(DEFAULT_NODES);
  cfg.map = {
    nodes: nodes.map((n) => ({
      id: String(n.id),
      name: String(n.name || n.id),
      type: ['BASE', 'DESERT', 'VILLAGE', 'OASIS', 'TOMB', 'MOUNTAIN'].includes(n.type) ? n.type : 'DESERT',
      x: num(n.x, 0),
      y: num(n.y, 0),
    })),
    edges: (Array.isArray(cfg.map && cfg.map.edges) ? cfg.map.edges : deepClone(DEFAULT_EDGES)).map((e, i) => ({
      id: String(e.id || `E${i + 1}`),
      fromId: String(e.fromId),
      toId: String(e.toId),
    })),
  };
  return cfg;
}

module.exports = {
  WEATHER,
  TERRAIN,
  TERRAIN_LABEL,
  WEATHER_LABEL,
  DEFAULT_NODES,
  DEFAULT_EDGES,
  DEFAULT_WEATHER,
  DEFAULT_INTEL,
  PRESETS,
  buildConfig,
  normalizeConfig,
  deepClone,
};
