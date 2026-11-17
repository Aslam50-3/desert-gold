'use strict';

const { bfs } = require('./rules');

function priceForRank(cfg, rank) {
  const list = cfg.economy.returnPrices || [];
  if (!list.length) return 0;
  const idx = Math.min(Math.max((rank || list.length) - 1, 0), list.length - 1);
  return list[idx];
}

function goldValueOf(cfg, team) {
  const price = priceForRank(cfg, team.return_rank || 99);
  if (cfg.economy.priceMode === 'PIECE') return (team.gold || 0) * price;
  return (team.gold || 0) * cfg.prices.gold.weight * price;
}

function computeScores({ cfg, teams }) {
  const maxGold = teams.reduce((m, t) => Math.max(m, t.gold || 0), 0);
  const rows = teams.map((t) => {
    const price = priceForRank(cfg, t.return_rank || 99);
    const goldValue = goldValueOf(cfg, t);
    const returned = t.status === 'RETURNED';
    const exempt = Boolean(cfg.economy.taxExemptTopDigger) && maxGold > 0 && (t.gold || 0) === maxGold;
    const tax = returned && !exempt ? Math.round(goldValue * cfg.economy.taxRate) : 0;
    const net = returned ? goldValue + (t.cash || 0) - tax : 0;
    return {
      id: t.id,
      name: t.name,
      color: t.color,
      status: t.status,
      alive: t.status !== 'DEAD' && t.status !== 'STUCK',
      returned,
      usedDays: t.returned_day || null,
      returnRank: t.return_rank || null,
      gold: t.gold || 0,
      price,
      priceMode: cfg.economy.priceMode,
      goldValue,
      cash: t.cash || 0,
      tax,
      exempt,
      net,
      deadReason: t.dead_reason || null,
    };
  });

  rows.sort((a, b) => {
    if (a.returned !== b.returned) return a.returned ? -1 : 1;
    if (a.returned && b.returned) {
      if (a.returnRank !== b.returnRank) return (a.returnRank || 99) - (b.returnRank || 99);
    }
    return b.net - a.net;
  });
  rows.forEach((r, i) => {
    r.rank = i + 1;
  });
  return rows;
}

/** 后台“平衡性提示”：按最短路径估算理论最优收益，防止参数改崩 */
function balanceProbe({ cfg, map }) {
  const distBase = bfs(map, 'BASE');
  const toMountain = distBase.get('MOUNTAIN');
  if (!toMountain) return { ok: false, reason: '大本营与藏宝山不连通' };
  const roundTrip = toMountain * 2;
  const rest = cfg.rules.digOnArrival ? 0 : 1;
  const digDays = Math.max(0, cfg.session.totalDays - roundTrip - rest);
  const gold = digDays * cfg.prices.gold.digPerDay;
  const firstPrice = priceForRank(cfg, 1);
  const goldValue = cfg.economy.priceMode === 'PIECE' ? gold * firstPrice : gold * cfg.prices.gold.weight * firstPrice;
  const tax = cfg.economy.taxExemptTopDigger ? 0 : Math.round(goldValue * cfg.economy.taxRate);
  const supplyWater = roundTrip * 1.6 + digDays * 1.6;
  const supplyFood = roundTrip * 1.6 + digDays * 1.6;
  const cost = Math.round(supplyWater * cfg.prices.water.base + supplyFood * cfg.prices.food.base + cfg.prices.tent.base + cfg.prices.compass.base);
  return {
    ok: true,
    toMountain,
    roundTrip,
    rest,
    digDays,
    gold,
    goldValue,
    tax,
    net: goldValue + cfg.start.cash - cost - tax,
    cost,
    supplyWater: Math.round(supplyWater),
    supplyFood: Math.round(supplyFood),
    warning:
      roundTrip + rest > cfg.session.totalDays
        ? '最短往返已超过总天数，本局无解，请下调天数或修改地图'
        : null,
  };
}

module.exports = { computeScores, priceForRank, goldValueOf, balanceProbe };
