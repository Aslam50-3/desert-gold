'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildConfig } = require('../src/engine/config');
const rules = require('../src/engine/rules');
const { settleTeam, previewConsumptionTable, actionErrors } = require('../src/engine/settle');
const { computeScores, balanceProbe } = require('../src/engine/score');

const cfg = buildConfig({ preset: 'PPT' });
const map = cfg.map;

test('地图校验：37 节点、连通、BASE→MOUNTAIN 最短 9 步', () => {
  const check = rules.validateMap(map);
  assert.equal(map.nodes.length, 38);
  assert.ok(check.ok, check.issues.join(';'));
  assert.equal(check.toMountain, 9);
  assert.equal(check.roundTrip, 18);
});

test('邻接表与手绘图一致的关键边', () => {
  assert.deepEqual(rules.neighbors(map, 'BASE').sort(), ['S1', 'S2']);
  assert.deepEqual(rules.neighbors(map, 'MOUNTAIN').sort(), ['S18', 'S26']);
  assert.ok(rules.neighbors(map, 'C1').includes('S6'));
  assert.ok(rules.neighbors(map, 'TOMB').includes('L1'));
});

test('PPT 版消耗表 8 种组合与规则一致', () => {
  const t = previewConsumptionTable(cfg);
  assert.deepEqual([t[0].water, t[0].food], [1, 1]);
  assert.deepEqual([t[1].water, t[1].food], [3, 1]);
  assert.deepEqual([t[2].water, t[2].food], [2, 5]);
  assert.deepEqual([t[3].water, t[3].food], [1, 1]);
  assert.deepEqual([t[4].water, t[4].food], [2, 5]);
  assert.deepEqual([t[5].water, t[5].food], [4, 5]);
  assert.deepEqual([t[6].water, t[6].food], [3, 1]);
  assert.deepEqual([t[7].water, t[7].food], [4, 5]);
});

test('resolveConsumption：帐篷挡沙尘暴、指南针不挡水耗', () => {
  const tent = rules.resolveConsumption(cfg, 'STORM', 'tent');
  assert.deepEqual([tent.water, tent.food, tent.lost], [1, 1, false]);
  const compass = rules.resolveConsumption(cfg, 'STORM', 'compass');
  assert.deepEqual([compass.water, compass.food, compass.lost], [2, 5, false]);
  const none = rules.resolveConsumption(cfg, 'STORM', null);
  assert.deepEqual([none.water, none.food, none.lost], [2, 5, true]);
  const heat = rules.resolveConsumption(cfg, 'HEAT', 'tent');
  assert.deepEqual([heat.water, heat.food], [3, 1]);
});

test('载重：水 50 磅、食物 20 磅、金子 50 磅、帐篷按耐久 20 磅', () => {
  const team = { water: 4, food: 10, gold: 2, tent_left: 3, compass: 1 };
  assert.equal(rules.weightUsed(cfg, team), 4 * 50 + 10 * 20 + 2 * 50 + 3 * 20 + 10);
});

test('价格：大本营原价、村庄 2 倍、沙漠不可购', () => {
  assert.equal(rules.unitPrice(cfg, 'BASE', 'water'), 25);
  assert.equal(rules.unitPrice(cfg, 'VILLAGE', 'water'), 50);
  assert.equal(rules.unitPrice(cfg, 'VILLAGE', 'food'), 20);
  assert.equal(rules.unitPrice(cfg, 'DESERT', 'water'), null);
  assert.deepEqual(rules.purchasableItems(cfg, 'OASIS'), []);
});

test('沙尘暴无装备：迷路 3 天且当日按迷路消耗扣减', () => {
  const team = {
    id: 't1', name: '测试队', color: '#fff', cash: 1000, water: 10, food: 20, gold: 0,
    tent_left: 0, compass: 0, node_id: 'S1', status: 'ALIVE', intel_ids: [],
  };
  // 第 4 天沙漠是沙尘暴+高温
  const out = settleTeam({ cfg, map, team, action: { moveTo: 'S5' }, day: 4, nextReturnRank: 1 });
  assert.equal(out.team.status, 'LOST');
  assert.equal(out.team.lost_until, 6);
  assert.equal(out.report.consumed.water, 4);
  assert.equal(out.report.consumed.food, 5);
});

test('迷路第 2 天不可移动，仍按迷路消耗扣', () => {
  const team = {
    id: 't2', name: '迷路队', color: '#fff', cash: 1000, water: 10, food: 20, gold: 0,
    tent_left: 0, compass: 0, node_id: 'S5', status: 'LOST', lost_until: 6, lost_weather: 'STORM_HEAT',
    intel_ids: [],
  };
  const errors = actionErrors({ cfg, map, team, action: { moveTo: 'S4' }, day: 5 });
  assert.ok(errors.length > 0);
  const out = settleTeam({ cfg, map, team, action: { moveTo: 'S4' }, day: 5, nextReturnRank: 1 });
  assert.equal(out.team.node_id, 'S5');
  assert.equal(out.report.consumed.water, 4);
  assert.equal(out.team.status, 'LOST');
});

test('死亡：断水当日死亡，不再挖金', () => {
  const team = {
    id: 't3', name: '断水队', color: '#fff', cash: 0, water: 0, food: 5, gold: 0,
    tent_left: 0, compass: 0, node_id: 'DESERT' === 'DESERT' ? 'S1' : 'S1', status: 'ALIVE', intel_ids: [],
  };
  const out = settleTeam({ cfg, map, team, action: {}, day: 2, nextReturnRank: 1 });
  assert.equal(out.team.status, 'DEAD');
  assert.ok(out.report.died);
});

test('藏宝山：到达当天不能挖，次日起每天 1 块', () => {
  const base = {
    id: 't4', name: '挖金队', color: '#fff', cash: 100, water: 6, food: 6, gold: 0,
    tent_left: 0, compass: 0, node_id: 'MOUNTAIN', status: 'ALIVE', intel_ids: [],
  };
  const arrive = settleTeam({ cfg, map, team: { ...base, arrived_day: 9, node_id: 'S18' }, action: { moveTo: 'MOUNTAIN' }, day: 9, nextReturnRank: 1 });
  assert.equal(arrive.team.gold, 0);
  assert.equal(arrive.team.arrived_day, 9);
  const dig = settleTeam({ cfg, map, team: { ...arrive.team }, action: {}, day: 10, nextReturnRank: 1 });
  assert.equal(dig.team.gold, 1);
  const dig2 = settleTeam({ cfg, map, team: { ...dig.team }, action: {}, day: 11, nextReturnRank: 1 });
  assert.equal(dig2.team.gold, 2);
});

test('返回排名与金价：第 1 名 1000 元/块', () => {
  const team = {
    id: 't5', name: '返程队', color: '#fff', cash: 200, water: 5, food: 5, gold: 2,
    tent_left: 0, compass: 0, node_id: 'S1', status: 'ALIVE', intel_ids: [],
  };
  const out = settleTeam({ cfg, map, team, action: { moveTo: 'BASE' }, day: 20, nextReturnRank: 1 });
  assert.equal(out.team.status, 'RETURNED');
  assert.equal(out.team.return_rank, 1);
  const scores = computeScores({ cfg, teams: [{ ...out.team, status: 'RETURNED', gold: 2, cash: 200 }] });
  // 2 块 × 1000 + 现金 200，挖金最多者免税
  assert.equal(scores[0].goldValue, 2000);
  assert.equal(scores[0].net, 2200);
});

test('税：20%，挖金最多的队伍免税', () => {
  const teams = [
    { id: 'a', name: 'A', status: 'RETURNED', gold: 3, cash: 100, return_rank: 1 },
    { id: 'b', name: 'B', status: 'RETURNED', gold: 1, cash: 100, return_rank: 2 },
  ];
  const s = computeScores({ cfg, teams });
  const a = s.find((x) => x.id === 'a');
  const b = s.find((x) => x.id === 'b');
  assert.equal(a.tax, 0); // 3 块最多 → 免税
  assert.equal(b.goldValue, 900);
  assert.equal(b.tax, 180);
  assert.equal(b.net, 820);
});

test('平衡性测算：25 天留出 5 天挖金，收益为正', () => {
  const probe = balanceProbe({ cfg, map });
  assert.ok(probe.ok);
  assert.equal(probe.toMountain, 9);
  assert.equal(probe.digDays, 6); // 25 - 18 - 1
  assert.ok(probe.net > 0);
});

test('大本营免消耗：空手留守不会饿死', () => {
  const team = {
    id: 't_base', name: 'B', color: '#fff', cash: 1000, water: 0, food: 0, gold: 0,
    tent_left: 0, compass: 0, node_id: 'BASE', status: 'ALIVE', intel_ids: [],
  };
  const out = settleTeam({ cfg, map, team, action: {}, day: 1, nextReturnRank: 1 });
  assert.equal(out.team.water, 0);
  assert.equal(out.team.food, 0);
  assert.equal(out.team.status, 'ALIVE');
  assert.equal(out.report.consumed.water, 0);
});
