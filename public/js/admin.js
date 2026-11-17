/* 管理员控制台：开局控制 / 全参数 / 天气 / 地图 / 队伍 / 报表 / 播报 / 审计 */
(function () {
  const S = { st: null, tab: 'dash', socket: null, map: null, saving: false };
  const el = (id) => document.getElementById(id);
  const main = () => el('main');
  const icon = DG.icon;
  const fmt = DG.fmt;
  const esc = DG.escapeHtml;

  const NAV = [
    ['dash', '指挥台', 'bolt'],
    ['config', '参数中心', 'gear'],
    ['weather', '天气矩阵', 'storm'],
    ['map', '地图编辑器', 'map'],
    ['teams', '队伍与账号', 'user'],
    ['reports', '报表导出', 'cash'],
    ['broadcast', '播报', 'skull'],
    ['audit', '审计日志', 'eye'],
    ['security', '账号安全', 'logout'],
  ];

  function navHtml() {
    return `<div class="brand">
      <div class="sigil"><svg viewBox="0 0 24 24" fill="none" stroke="#3FE0C8" stroke-width="1.6"><path d="M3 19h18"/><path d="M6 19V12l6-5 6 5v7"/><path d="M10 19v-5h4v5"/></svg></div>
      <b style="font-size:14px;letter-spacing:.1em">控制台</b>
      <span style="display:block;font-size:9px;letter-spacing:.28em;color:var(--muted)">DESERT GOLD</span>
    </div>` + NAV.map(([id, label, ic]) => `
      <button class="navitem ${S.tab === id ? 'on' : ''}" data-nav="${id}">${icon(ic)}<span>${label}</span></button>`).join('');
  }

  async function load(force) {
    try {
      const st = await DG.api('/api/admin/state');
      S.st = st;
      document.querySelectorAll('.navitem').forEach((b) => b.classList.toggle('on', b.dataset.nav === S.tab));
      render();
    } catch (err) {
      if (err.status === 401 || err.status === 403) location.href = '/';
      else DG.toast(err.message, 'warn');
    }
  }

  function render() {
    const st = S.st;
    if (!st) { main().innerHTML = '<div class="muted">正在读取沙盘状态…</div>'; return; }
    const map = { dash: renderDash, config: renderConfig, weather: renderWeather, map: renderMap, teams: renderTeams, reports: renderReports, broadcast: renderBroadcast, audit: renderAudit, security: renderSecurity };
    main().innerHTML = (map[S.tab] || renderDash)(st);
    if (S.tab === 'map') mountAdminMap(st);
  }

  /* ---------------- 通用 ---------------- */

  function phaseText(p) { return DG.PHASE[p] || p; }

  function statusChip(s) {
    if (!s) return '<span class="chip">草稿</span>';
    const map = { DRAFT: '草稿', OPEN: '已开营', RUNNING: '进行中', PAUSED: '已暂停', ENDED: '已结束' };
    return `<span class="chip dot ${s === 'RUNNING' ? 'ok' : s === 'PAUSED' ? 'warn' : s === 'ENDED' ? 'bad' : ''}">${map[s] || s}</span>`;
  }

  function countdown(st) {
    if (!st.session.phaseEndsAt) return '—';
    const remain = Date.parse(st.session.phaseEndsAt) - Date.parse(st.serverNow);
    return remain > 0 ? fmt.mmss(remain) : '00:00';
  }

  function field(label, path, val, opts = {}) {
    const type = opts.type || 'number';
    if (type === 'text') {
      return `<label class="field"><span>${label}</span><input class="input" data-cfg="${path}"${opts.list ? ' data-list="1"' : ''} value="${esc(val)}"></label>`;
    }
    if (type === 'bool') {
      return `<label class="switch" style="align-self:end;padding:10px 0"><input type="checkbox" data-cfg="${path}" ${val ? 'checked' : ''}><i></i><span style="font-size:12px;color:var(--muted)">${label}</span></label>`;
    }
    if (type === 'select') {
      return `<label class="field"><span>${label}</span><select class="select" data-cfg="${path}">${(opts.options || []).map(([v, t]) => `<option value="${v}" ${String(val) === String(v) ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`;
    }
    return `<label class="field"><span>${label}</span><input class="input num-input" type="number" step="${opts.step || 1}" data-cfg="${path}" value="${val}"></label>`;
  }

  function collectPatch(root) {
    const patch = {};
    root.querySelectorAll('[data-cfg]').forEach((inp) => {
      const parts = inp.dataset.cfg.split('.');
      let obj = patch;
      for (let i = 0; i < parts.length - 1; i += 1) {
        obj[parts[i]] = obj[parts[i]] || {};
        obj = obj[parts[i]];
      }
      const key = parts[parts.length - 1];
      if (inp.type === 'checkbox') obj[key] = inp.checked;
      else if (inp.type === 'number') obj[key] = Number(inp.value);
      else if (inp.dataset.json === '1') { try { obj[key] = JSON.parse(inp.value); } catch (e) { throw new Error(`${key} 不是合法 JSON`); } }
      else if (inp.dataset.list === '1') obj[key] = inp.value.split(/[,，\s]+/).map((v) => Number(v)).filter((v) => Number.isFinite(v));
      else obj[key] = inp.value;
    });
    return patch;
  }

  async function saveConfig(scopeEl, extra = {}) {
    if (S.saving) return;
    let patch;
    try { patch = collectPatch(scopeEl); } catch (err) { DG.toast(err.message, 'warn', 6000); return; }
    S.saving = true;
    try {
      await DG.api(`/api/admin/config?sessionId=${encodeURIComponent(S.st.session.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...patch, ...extra, sessionId: S.st.session.id }),
      });
      DG.toast('参数已保存，玩家端立即生效', 'success');
      await load();
    } catch (err) {
      DG.toast(err.message, 'warn', 6000);
    } finally { S.saving = false; }
  }

  async function sessionCmd(cmd, body) {
    try {
      await DG.api(`/api/admin/session/${S.st.session.id}/${cmd}`, { method: 'POST', body: JSON.stringify(body || {}) });
      DG.toast({ open: '沙盘已开营', pause: '已暂停计时', resume: '已恢复计时', extend: '已延长倒计时', settle: '已触发结算', end: '本局已结束', reset: '已重置本局', skip: '已跳到下一阶段' }[cmd] || '操作完成', 'success');
      await load();
    } catch (err) { DG.toast(err.message, 'warn', 6000); }
  }

  /* ---------------- 指挥台 ---------------- */

  function renderDash(st) {
    const s = st.session;
    const teams = st.teams || [];
    const stats = st.stats || {};
    const rows = teams.map((t) => `
      <tr>
        <td><span style="display:inline-block;width:8px;height:8px;border-radius:2px;transform:rotate(45deg);background:${esc(t.color)};margin-right:8px"></span>${esc(t.name)}</td>
        <td><span class="chip ${t.status === 'DEAD' ? 'bad' : t.status === 'RETURNED' ? 'ok' : t.status === 'LOST' ? 'warn' : ''}">${t.status === 'DEAD' ? '出局' : t.status === 'RETURNED' ? '归营' : t.status === 'LOST' ? '迷路' : '行进'}</span></td>
        <td class="num">${esc(t.nodeId || '—')}</td>
        <td class="num">${t.water} / ${t.food}</td>
        <td class="num">${t.gold}</td>
        <td class="num">${fmt.money(t.cash)}</td>
        <td class="num">${t.weight}</td>
        <td>${t.report ? (t.report.dug ? '<span class="chip ok dot">已挖金</span>' : '<span class="chip dot">已提交</span>') : '<span class="dim">未提交</span>'}</td>
        <td class="row-actions">
          <button class="btn btn-ghost btn-sm" data-team="${t.id}" data-team-action="kill">判死</button>
          <button class="btn btn-ghost btn-sm" data-team="${t.id}" data-team-action="revive">复活</button>
          <button class="btn btn-ghost btn-sm" data-team="${t.id}" data-team-action="reset">重置</button>
        </td>
      </tr>`).join('');

    return `
      <div class="adm-head">
        <div>
          <div class="micro">CONTROL ROOM</div>
          <h2>${esc(st.config.task.title || s.name)}</h2>
          <div class="muted" style="font-size:12px;margin-top:6px">${statusChip(s.status)} <span class="chip">${phaseText(s.phase)}</span> <span class="chip">第 ${s.currentDay} / ${s.totalDays} 天</span> <span class="chip">倒计时 ${countdown(st)}</span></div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button class="btn btn-ghost btn-sm" id="btnScreenPage">打开大屏</button>
          <button class="btn btn-ghost btn-sm" id="btnLogout">退出</button>
        </div>
      </div>

      <div class="grid g4" style="margin-bottom:16px">
        <div class="stat"><div class="k">队伍</div><div class="v">${stats.total || 0}</div></div>
        <div class="stat"><div class="k">在线</div><div class="v teal">${stats.online || 0}</div></div>
        <div class="stat"><div class="k">已提交 / 存活</div><div class="v">${stats.submitted || 0} / ${stats.alive || 0}</div></div>
        <div class="stat"><div class="k">归营 / 出局</div><div class="v"><span class="sand">${stats.returned || 0}</span> / <span class="blood">${stats.dead || 0}</span></div></div>
      </div>

      <div class="panel" style="margin-bottom:16px">
        <div class="panel-head"><span class="micro">开局与节奏</span><span class="dim" style="font-size:11px">所有操作立即同步到玩家端</span></div>
        <div class="panel-body">
          <div class="ctl">
            <button class="btn btn-primary" data-cmd="open">${s.status === 'DRAFT' ? '开营（进入准备）' : '重新开营'}</button>
            <button class="btn btn-ghost" data-cmd="skip">跳到下一阶段</button>
            <button class="btn btn-ghost" data-cmd="extend" data-min="2">+2 分钟</button>
            <button class="btn btn-ghost" data-cmd="extend" data-min="5">+5 分钟</button>
            <button class="btn btn-ghost" data-cmd="pause">暂停计时</button>
            <button class="btn btn-ghost" data-cmd="resume">恢复计时</button>
            <button class="btn btn-ghost" data-cmd="settle">立即结算当天</button>
            <button class="btn btn-danger" data-cmd="end">结束本局</button>
            <button class="btn btn-danger" data-cmd="reset">重置本局（保留队伍）</button>
          </div>
          <div class="hint" style="margin-top:12px">阶段顺序：准备 → 天气播报 → 行动 → 结算 → 日报 → 次日行动。所有队伍提交后会提前结算；到点未提交按“原地停留”处理。</div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-head"><span class="micro">实时棋盘</span><span class="dim" style="font-size:11px">每 5 秒自动刷新</span></div>
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>队伍</th><th>状态</th><th>位置</th><th>水 / 食物</th><th>金子</th><th>现金</th><th>载重</th><th>今日</th><th></th></tr></thead>
            <tbody>${rows || '<tr><td colspan="9" class="dim">还没有队伍</td></tr>'}</tbody>
          </table>
        </div>
      </div>`;
  }

  /* ---------------- 参数中心 ---------------- */

  function renderConfig(st) {
    const c = st.config;
    const presetBtns = st.presets.map((p) => `<button class="btn btn-ghost btn-sm" data-preset="${p.id}" title="${esc(p.note || '')}">${p.label}</button>`).join('');
    return `
      <div class="adm-head"><div><div class="micro">PARAMETERS</div><h2>参数中心</h2>
        <div class="muted" style="font-size:12px;margin-top:6px">这里的每一项都会直接影响结算。改完点右上角保存。</div></div>
        <button class="btn btn-primary" data-save="config">保存全部参数</button>
      </div>

      <div id="cfgRoot" class="grid" style="gap:14px">
        <div class="cfg-sec">
          <header><span class="micro">规则预设</span><span class="dim" style="font-size:11px">载入后覆盖价格 / 消耗 / 经济，再手动微调</span></header>
          <div class="body"><div style="grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap">${presetBtns}</div></div>
        </div>

        <div class="cfg-sec">
          <header><span class="micro">起始资源</span><span class="dim" style="font-size:11px">每支新队伍开局</span></header>
          <div class="body">
            ${field('起始现金（元）', 'start.cash', c.start.cash)}
            ${field('载重上限（磅）', 'start.capacity', c.start.capacity)}
            ${field('开局水（皮囊）', 'start.water', c.start.water)}
            ${field('开局食物（盘）', 'start.food', c.start.food)}
            ${field('开局帐篷（顶）', 'start.tentUnits', c.start.tentUnits)}
            ${field('开局指南针（个）', 'start.compass', c.start.compass)}
            ${field('队伍人数', 'start.membersPerTeam', c.start.membersPerTeam)}
          </div>
        </div>

        <div class="cfg-sec">
          <header><span class="micro">价格与重量</span><span class="dim" style="font-size:11px">大本营价 · 村庄倍率 · 单位重量</span></header>
          <div class="body">
            ${field('水 · 大本营价', 'prices.water.base', c.prices.water.base)}
            ${field('水 · 村庄倍率', 'prices.water.villageMultiplier', c.prices.water.villageMultiplier, { step: 0.1 })}
            ${field('水 · 每皮囊重量', 'prices.water.weight', c.prices.water.weight)}
            ${field('食物 · 大本营价', 'prices.food.base', c.prices.food.base)}
            ${field('食物 · 村庄倍率', 'prices.food.villageMultiplier', c.prices.food.villageMultiplier, { step: 0.1 })}
            ${field('食物 · 每盘重量', 'prices.food.weight', c.prices.food.weight)}
            ${field('帐篷 · 售价', 'prices.tent.base', c.prices.tent.base)}
            ${field('帐篷 · 可用次数', 'prices.tent.uses', c.prices.tent.uses)}
            ${field('帐篷 · 每次重量', 'prices.tent.weightPerUse', c.prices.tent.weightPerUse)}
            ${field('指南针 · 售价', 'prices.compass.base', c.prices.compass.base)}
            ${field('指南针 · 重量', 'prices.compass.weight', c.prices.compass.weight)}
            ${field('金子 · 每块重量', 'prices.gold.weight', c.prices.gold.weight)}
            ${field('每天可挖块数', 'prices.gold.digPerDay', c.prices.gold.digPerDay)}
          </div>
        </div>

        <div class="cfg-sec">
          <header><span class="micro">天气消耗</span><span class="dim" style="font-size:11px">水 / 食物，按天候与装备组合</span></header>
          <div class="body">
            ${field('晴天 · 水', 'consume.sunny.water', c.consume.sunny.water)}
            ${field('晴天 · 食物', 'consume.sunny.food', c.consume.sunny.food)}
            ${field('高温 · 水', 'consume.heat.water', c.consume.heat.water)}
            ${field('高温 · 食物', 'consume.heat.food', c.consume.heat.food)}
            ${field('沙尘暴 · 水', 'consume.storm_plain.water', c.consume.storm_plain.water)}
            ${field('沙尘暴 · 食物', 'consume.storm_plain.food', c.consume.storm_plain.food)}
            ${field('沙尘暴+帐篷 · 水', 'consume.storm_tent.water', c.consume.storm_tent.water)}
            ${field('沙尘暴+帐篷 · 食物', 'consume.storm_tent.food', c.consume.storm_tent.food)}
            ${field('沙尘暴+指南针 · 水', 'consume.storm_compass.water', c.consume.storm_compass.water)}
            ${field('沙尘暴+指南针 · 食物', 'consume.storm_compass.food', c.consume.storm_compass.food)}
            ${field('沙尘暴+高温 · 水', 'consume.stormheat_plain.water', c.consume.stormheat_plain.water)}
            ${field('沙尘暴+高温 · 食物', 'consume.stormheat_plain.food', c.consume.stormheat_plain.food)}
            ${field('沙高+帐篷 · 水', 'consume.stormheat_tent.water', c.consume.stormheat_tent.water)}
            ${field('沙高+帐篷 · 食物', 'consume.stormheat_tent.food', c.consume.stormheat_tent.food)}
            ${field('沙高+指南针 · 水', 'consume.stormheat_compass.water', c.consume.stormheat_compass.water)}
            ${field('沙高+指南针 · 食物', 'consume.stormheat_compass.food', c.consume.stormheat_compass.food)}
            ${field('迷路持续天数', 'consume.lostDays', c.consume.lostDays)}
          </div>
        </div>

        <div class="cfg-sec">
          <header><span class="micro">规则开关</span><span class="dim" style="font-size:11px">判定口径</span></header>
          <div class="body">
            ${field('水/食物归零即死', 'rules.dieAtZero', c.rules.dieAtZero, { type: 'bool' })}
            ${field('大本营免消耗', 'rules.baseSafe', c.rules.baseSafe, { type: 'bool' })}
            ${field('到达藏宝山当天可挖', 'rules.digOnArrival', c.rules.digOnArrival, { type: 'bool' })}
            ${field('帐篷与指南针互斥', 'rules.tentCompassExclusive', c.rules.tentCompassExclusive, { type: 'bool' })}
            ${field('村庄水换粮', 'rules.villageWaterToFood.enabled', c.rules.villageWaterToFood.enabled, { type: 'bool' })}
            ${field('换粮消耗水', 'rules.villageWaterToFood.waterCost', c.rules.villageWaterToFood.waterCost)}
            ${field('换粮得到食物', 'rules.villageWaterToFood.foodGain', c.rules.villageWaterToFood.foodGain)}
            ${field('全员提交即结算', 'rules.autoSettleOnAllSubmitted', c.rules.autoSettleOnAllSubmitted, { type: 'bool' })}
            ${field('封盘前不可撤回（秒）', 'rules.recallBeforeSeconds', c.rules.recallBeforeSeconds)}
            ${field('未提交按停留处理', 'rules.timeoutPolicy', c.rules.timeoutPolicy, { type: 'select', options: [['STAY', '原地停留'], ['DEATH', '视为放弃']] })}
          </div>
        </div>

        <div class="cfg-sec">
          <header><span class="micro">金价与经济</span><span class="dim" style="font-size:11px">归营名次决定金价</span></header>
          <div class="body">
            ${field('计价方式', 'economy.priceMode', c.economy.priceMode, { type: 'select', options: [['PIECE', '按块（元/块）'], ['POUND', '按重量（元/磅）']] })}
            ${field('金价序列（逗号）', 'economy.returnPrices', c.economy.returnPrices, { type: 'text', list: true })}
            ${field('税率（0-1）', 'economy.taxRate', c.economy.taxRate, { step: 0.01 })}
            ${field('挖金最多者免税', 'economy.taxExemptTopDigger', c.economy.taxExemptTopDigger, { type: 'bool' })}
          </div>
          <div class="body wide"><div class="hint">金价序列用逗号分隔，第 1 个数字给第 1 个归营队伍，依次往下；超出序列长度则取最后一个。</div></div>
        </div>

        <div class="cfg-sec">
          <header><span class="micro">计时</span><span class="dim" style="font-size:11px">秒</span></header>
          <div class="body">
            ${field('准备阶段', 'timing.prepSeconds', c.timing.prepSeconds)}
            ${field('天气播报', 'timing.briefSeconds', c.timing.briefSeconds)}
            ${field('第 1 天行动', 'timing.day1Seconds', c.timing.day1Seconds)}
            ${field('每日行动', 'timing.daySeconds', c.timing.daySeconds)}
            ${field('日报停留', 'timing.reportSeconds', c.timing.reportSeconds)}
            ${field('最后预警（秒）', 'timing.warnSeconds', c.timing.warnSeconds)}
            ${field('总天数', 'session.totalDays', c.session.totalDays)}
          </div>
        </div>

        <div class="cfg-sec">
          <header><span class="micro">任务文案</span><span class="dim" style="font-size:11px">玩家候场页显示</span></header>
          <div class="body wide">
            ${field('任务标题', 'task.title', c.task.title, { type: 'text' })}
            ${field('副标题', 'task.subtitle', c.task.subtitle, { type: 'text' })}
            <label class="field"><span>任务简报</span><textarea class="textarea" data-cfg="task.briefing">${esc(c.task.briefing || '')}</textarea></label>
            <label class="field"><span>目标说明</span><textarea class="textarea" data-cfg="task.goal">${esc(c.task.goal || '')}</textarea></label>
            <label class="field"><span>死亡播报语</span><input class="input" data-cfg="task.deathBanner" value="${esc(c.task.deathBanner || '')}"></label>
          </div>
        </div>

        <div class="cfg-sec">
          <header><span class="micro">情报</span><span class="dim" style="font-size:11px">大本营购买 · 可改文案与效果</span></header>
          <div class="body">
            ${field('情报耗费 · 水', 'intel.water', c.intel.water)}
            ${field('情报耗费 · 食物', 'intel.food', c.intel.food)}
            ${field('独占（买断）', 'intel.exclusive', c.intel.exclusive, { type: 'bool' })}
          </div>
          <div class="body wide">
            <label class="field"><span>情报列表（JSON，可增删改）</span><textarea class="textarea" data-cfg="intel.items" data-json="1" style="min-height:220px">${esc(JSON.stringify(c.intel.items, null, 2))}</textarea></label>
            <div class="hint">每条结构：{ id, title, text, effect }。effect 可选：knowledge / mountainWater / tombCompass。</div>
          </div>
        </div>
      </div>`;
  }

  /* ---------------- 天气 ---------------- */

  const TERRAINS = [['BASE', '大本营'], ['DESERT', '沙漠'], ['VILLAGE', '村庄'], ['OASIS', '绿洲'], ['TOMB', '古墓'], ['MOUNTAIN', '藏宝山']];
  const WEATHERS = [['SUNNY', '晴'], ['HEAT', '高温'], ['STORM', '沙尘暴'], ['STORM_HEAT', '沙尘暴+高温']];

  function renderWeather(st) {
    const m = st.config.weather.matrix;
    const rows = m.map((r) => `
      <tr>
        <td class="num" style="color:var(--muted)">D${String(r.day).padStart(2, '0')}</td>
        ${TERRAINS.map(([k]) => `<td><select data-wday="${r.day}" data-wterrain="${k}">${WEATHERS.map(([v, t]) => `<option value="${v}" ${r[k] === v ? 'selected' : ''}>${t}</option>`).join('')}</select></td>`).join('')}
      </tr>`).join('');
    return `
      <div class="adm-head"><div><div class="micro">WEATHER MATRIX</div><h2>天气矩阵</h2>
        <div class="muted" style="font-size:12px;margin-top:6px">每天、每种地形各有一条天候。大本营固定晴天，绿洲不会沙尘暴（系统自动护栏）。</div></div>
        <button class="btn btn-primary" data-save="weather">保存天气</button></div>
      <div class="maskscroll">
        <table class="matrix">
          <thead><tr><th>天</th>${TERRAINS.map(([, t]) => `<th>${t}</th>`).join('')}</tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="hint" style="margin-top:10px">修改后立刻影响当前及后续结算。若只想微调几天，直接改对应行即可。</div>`;
  }

  /* ---------------- 地图 ---------------- */

  function renderMap(st) {
    const map = st.config.map;
    const nodeRows = map.nodes.map((n) => `
      <tr>
        <td><input class="input" style="padding:5px 8px;font-family:var(--font-mono);font-size:12px;width:78px" data-node="${n.id}" data-prop="id" value="${esc(n.id)}"></td>
        <td><input class="input" style="padding:5px 8px;font-size:12px" data-node="${n.id}" data-prop="name" value="${esc(n.name)}"></td>
        <td><select class="select" style="padding:5px 8px;font-size:12px" data-node="${n.id}" data-prop="type">${TERRAINS.map(([v, t]) => `<option value="${v}" ${n.type === v ? 'selected' : ''}>${t}</option>`).join('')}</select></td>
        <td><input class="input" style="padding:5px 8px;width:64px;font-size:12px" data-node="${n.id}" data-prop="x" value="${n.x}"></td>
        <td><input class="input" style="padding:5px 8px;width:64px;font-size:12px" data-node="${n.id}" data-prop="y" value="${n.y}"></td>
      </tr>`).join('');
    const edgeText = map.edges.map((e) => `${e.fromId}-${e.toId}`).join('\n');
    return `
      <div class="adm-head"><div><div class="micro">MAP EDITOR</div><h2>地图编辑器</h2>
        <div class="muted" style="font-size:12px;margin-top:6px">坐标是网格坐标（x 向右、y 向下）。邻接表用“节点-节点”，每行一条，双向生效。</div></div>
        <div style="display:flex;gap:8px"><button class="btn btn-ghost" id="btnMapReset">恢复默认地图</button><button class="btn btn-primary" data-save="map">保存地图</button></div></div>
      <div class="grid g2" style="grid-template-columns:minmax(0,1.2fr) minmax(0,.8fr)">
        <div class="grid" style="gap:14px">
          <div class="cfg-sec">
            <header><span class="micro">节点（${map.nodes.length}）</span><span class="dim" style="font-size:11px">改 id 会同时改写邻接表里的引用</span></header>
            <div class="table-wrap" style="max-height:340px;overflow:auto"><table class="table"><thead><tr><th>ID</th><th>名称</th><th>地形</th><th>X</th><th>Y</th></tr></thead><tbody>${nodeRows}</tbody></table></div>
          </div>
          <div class="cfg-sec">
            <header><span class="micro">邻接表</span><span class="dim" style="font-size:11px">每行一条，如 S1-S2</span></header>
            <div class="body wide"><textarea class="textarea" id="edgeText" style="min-height:200px">${esc(edgeText)}</textarea></div>
          </div>
        </div>
        <div class="grid" style="gap:14px;align-content:start">
          <div class="panel"><div class="panel-head"><span class="micro">预览</span><span class="dim" id="mapCheck" style="font-size:11px">—</span></div>
            <div class="admin-map"><canvas id="adminMapCanvas"></canvas></div>
          </div>
          <div class="panel"><div class="panel-head"><span class="micro">地图体检</span></div>
            <div class="panel-body" id="mapReport" style="font-size:12px;color:var(--muted);line-height:1.9">
              点“校验”检查连通性、最短路径与平衡性。
            </div>
            <div class="panel-body" style="padding-top:0;display:flex;gap:8px"><button class="btn btn-ghost btn-sm" id="btnMapCheck">校验</button><button class="btn btn-ghost btn-sm" id="btnBalance">平衡测算</button></div>
          </div>
        </div>
      </div>`;
  }

  function mountAdminMap(st) {
    const canvas = el('adminMapCanvas');
    if (!canvas) return;
    if (S.map) { S.map.canvas = canvas; S.map._resize(); }
    else S.map = new DesertMap(canvas, {});
    S.map.setData({ nodes: st.config.map.nodes, edges: st.config.map.edges, teams: [], selfId: null });
  }

  function collectMap() {
    const nodes = [];
    const rename = {};
    const rows = [...main().querySelectorAll('[data-node][data-prop="id"]')];
    rows.forEach((inp, idx) => {
      const oldId = (S.st.config.map.nodes[idx] || {}).id;
      const id = inp.value.trim();
      if (oldId && oldId !== id) rename[oldId] = id;
      const row = inp.closest('tr');
      nodes.push({
        id,
        name: row.querySelector('[data-prop="name"]').value.trim(),
        type: row.querySelector('[data-prop="type"]').value,
        x: Number(row.querySelector('[data-prop="x"]').value),
        y: Number(row.querySelector('[data-prop="y"]').value),
      });
    });
    const mapId = (x) => rename[x] || x;
    const edges = el('edgeText').value.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[^-]+-[^-]+$/.test(l)).map((l) => {
      const [a, b] = l.split('-').map((x) => mapId(x.trim()));
      return { fromId: a, toId: b };
    });
    return { nodes, edges };
  }

  /* ---------------- 队伍 ---------------- */

  function renderTeams(st) {
    const rows = (st.teams || []).map((t) => `
      <tr>
        <td><input class="input" style="padding:5px 8px;font-size:12px;width:130px" data-team-id="${t.id}" data-team-prop="name" value="${esc(t.name)}"></td>
        <td><span class="chip">${esc((st.users.find((u) => u.teamId === t.id) || {}).username || '—')}</span></td>
        <td><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:${esc(t.color)}"></span> <input class="input" style="padding:4px 6px;width:86px;font-size:11px" data-team-id="${t.id}" data-team-prop="color" value="${esc(t.color)}"></td>
        <td class="num">${t.water} / ${t.food}</td>
        <td class="num">${t.gold}</td>
        <td><span class="chip ${t.status === 'DEAD' ? 'bad' : t.status === 'RETURNED' ? 'ok' : ''}">${t.status}</span></td>
        <td class="row-actions">
          <button class="btn btn-ghost btn-sm" data-team="${t.id}" data-team-action="reset">重置</button>
          <button class="btn btn-ghost btn-sm" data-team="${t.id}" data-team-action="kill">判死</button>
          <button class="btn btn-ghost btn-sm" data-team="${t.id}" data-team-action="revive">复活</button>
          <button class="btn btn-danger btn-sm" data-team="${t.id}" data-team-action="delete">删除</button>
        </td>
      </tr>`).join('');
    return `
      <div class="adm-head"><div><div class="micro">TEAMS & ACCOUNTS</div><h2>队伍与账号</h2>
        <div class="muted" style="font-size:12px;margin-top:6px">队伍账号用于登录玩家端；密码至少 10 位含大小写与数字。</div></div></div>

      <div class="grid g2" style="margin-bottom:16px">
        <div class="panel"><div class="panel-head"><span class="micro">新建一支队伍</span></div>
          <div class="panel-body grid" style="gap:10px">
            <div class="grid g2" style="gap:10px">
              <label class="field"><span>队名</span><input class="input" id="newName" placeholder="如 沙岭一号"></label>
              <label class="field"><span>登录账号</span><input class="input" id="newUser" placeholder="team09"></label>
              <label class="field"><span>密码</span><input class="input" id="newPass" placeholder="至少 10 位"></label>
              <label class="field"><span>队伍色（#hex）</span><input class="input" id="newColor" value="#e7b15c"></label>
            </div>
            <label class="field"><span>口号（可选）</span><input class="input" id="newSlogan" placeholder="一句让对手记住的话"></label>
            <button class="btn btn-primary" id="btnCreateTeam">创建队伍与账号</button>
          </div>
        </div>
        <div class="panel"><div class="panel-head"><span class="micro">批量导入</span><span class="dim" style="font-size:11px">队名,账号,密码（每行一支）</span></div>
          <div class="panel-body grid" style="gap:10px">
            <textarea class="textarea" id="importCsv" style="min-height:120px" placeholder="沙岭一号,team09,desert888&#10;赤狐商队,team10,desert888"></textarea>
            <button class="btn btn-ghost" id="btnImportTeams">导入</button>
          </div>
        </div>
      </div>

      <div class="panel"><div class="panel-head"><span class="micro">队伍清单</span><span class="dim" style="font-size:11px">改名 / 改色后点保存</span><button class="btn btn-ghost btn-sm" id="btnSaveTeams">保存</button></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>队名</th><th>账号</th><th>队伍色</th><th>水 / 食物</th><th>金子</th><th>状态</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="7" class="dim">暂无队伍</td></tr>'}</tbody></table></div>
      </div>

      <div class="panel" style="margin-top:16px"><div class="panel-head"><span class="micro">重置队伍密码</span></div>
        <div class="panel-body" style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
          <label class="field" style="flex:1;min-width:160px"><span>账号</span><input class="input" id="resetUser" placeholder="team01"></label>
          <label class="field" style="flex:1;min-width:200px"><span>新密码</span><input class="input" id="resetPass" placeholder="至少 10 位"></label>
          <button class="btn btn-ghost" id="btnResetPass">重置</button>
        </div>
      </div>`;
  }

  /* ---------------- 报表 ---------------- */

  function renderReports(st) {
    const day = st.session.currentDay || 0;
    return `
      <div class="adm-head"><div><div class="micro">EXPORTS</div><h2>报表导出</h2>
        <div class="muted" style="font-size:12px;margin-top:6px">Excel 直接下载，可用于课堂复盘与成绩统计。</div></div></div>
      <div class="grid g3">
        <div class="panel"><div class="panel-head"><span class="micro">当日日报</span></div>
          <div class="panel-body grid" style="gap:10px">
            <label class="field"><span>第几天</span><input class="input" id="expDay" type="number" value="${day}" min="1"></label>
            <button class="btn btn-primary" data-export="daily">下载日报</button>
            <div class="hint">含位置、天气、水粮购入与消耗、费用、结余、当日小结。</div>
          </div></div>
        <div class="panel"><div class="panel-head"><span class="micro">成本总表</span></div>
          <div class="panel-body grid" style="gap:10px">
            <label class="field"><span>第几天</span><input class="input" id="expDayCost" type="number" value="${day}" min="1"></label>
            <button class="btn btn-primary" data-export="cost">下载成本表</button>
            <div class="hint">水、食物、帐篷、指南针、情报与当日支出合计。</div>
          </div></div>
        <div class="panel"><div class="panel-head"><span class="micro">终局成绩</span></div>
          <div class="panel-body grid" style="gap:10px">
            <div class="kv"><div class="r"><span>归营队伍</span><span class="num">${(st.scores || []).filter((s) => s.returned).length}</span></div>
            <div class="r"><span>出局队伍</span><span class="num">${(st.scores || []).filter((s) => s.status === 'DEAD').length}</span></div></div>
            <button class="btn btn-primary" data-export="final">下载最终成绩</button>
            <div class="hint">按净收益排名，含兑换价、税与免税标记。</div>
          </div></div>
      </div>
      <div class="panel" style="margin-top:16px"><div class="panel-head"><span class="micro">当前计分预览</span></div>
        <div class="table-wrap"><table class="table"><thead><tr><th>#</th><th>队伍</th><th>状态</th><th>金块</th><th>兑换价</th><th>收益</th><th>现金</th><th>税</th><th>净收益</th></tr></thead>
        <tbody>${(st.scores || []).map((s, i) => `<tr><td class="num">${i + 1}</td><td>${esc(s.name)}</td><td>${s.returned ? '<span class="chip ok">归营</span>' : s.status === 'DEAD' ? '<span class="chip bad">出局</span>' : '<span class="chip">未归</span>'}</td><td class="num">${s.gold}</td><td class="num">${s.price}${s.priceMode === 'PIECE' ? '/块' : '/磅'}</td><td class="num">${s.goldValue}</td><td class="num">${s.cash}</td><td class="num">${s.exempt ? '免税' : s.tax}</td><td class="num sand">${s.net}</td></tr>`).join('') || '<tr><td colspan="9" class="dim">暂无数据</td></tr>'}</tbody></table></div>
      </div>`;
  }

  /* ---------------- 播报 / 审计 / 安全 ---------------- */

  function renderBroadcast(st) {
    const list = [];
    return `
      <div class="adm-head"><div><div class="micro">BROADCAST</div><h2>播报</h2>
        <div class="muted" style="font-size:12px;margin-top:6px">消息会同时出现在玩家端底部滚动条与大屏。</div></div></div>
      <div class="panel"><div class="panel-body grid" style="gap:12px">
        <label class="field"><span>内容</span><textarea class="textarea" id="bcText" placeholder="如：第 8 天将有强沙尘暴，山上的队伍请检查帐篷。"></textarea></label>
        <div style="display:flex;gap:10px;align-items:center">
          <label class="field" style="width:180px"><span>级别</span><select class="select" id="bcLevel"><option value="info">普通</option><option value="warn">警告</option><option value="death">死亡播报</option></select></label>
          <button class="btn btn-primary" id="btnBroadcast" style="margin-top:16px">发出播报</button>
        </div>
      </div></div>
      <div class="panel" style="margin-top:16px"><div class="panel-head"><span class="micro">近期播报</span></div>
        <div class="panel-body grid" style="gap:8px">${list.length ? '' : '<div class="dim" style="font-size:12px">历史播报可在玩家端滚动条查看。发出后可在大屏确认。</div>'}</div></div>`;
  }

  function renderAudit(st) {
    const rows = (st.audit || []).map((l) => `
      <tr><td class="num" style="white-space:nowrap">${fmt.date(l.created_at)}</td><td>${esc(l.actor || 'system')}</td><td>${esc(l.action)}</td><td class="dim" style="font-size:11px;max-width:420px;overflow:hidden;text-overflow:ellipsis">${esc((l.after_json || '').slice(0, 120))}</td></tr>`).join('');
    return `
      <div class="adm-head"><div><div class="micro">AUDIT</div><h2>审计日志</h2>
        <div class="muted" style="font-size:12px;margin-top:6px">所有参数、地图、队伍变更都会留痕，方便复盘谁改了什么。</div></div></div>
      <div class="panel"><div class="table-wrap"><table class="table"><thead><tr><th>时间</th><th>操作者</th><th>动作</th><th>内容</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="dim">暂无日志</td></tr>'}</tbody></table></div></div>`;
  }

  function renderSecurity() {
    return `
      <div class="adm-head"><div><div class="micro">SECURITY</div><h2>账号安全</h2>
        <div class="muted" style="font-size:12px;margin-top:6px">上线后请立刻修改初始管理员密码。</div></div></div>
      <div class="panel" style="max-width:520px"><div class="panel-body grid" style="gap:12px">
        <label class="field"><span>新密码</span><input class="input" id="newAdminPass" placeholder="至少 10 位，含大小写与数字"></label>
        <div class="hint">密码要求：≥10 位，包含大写字母、小写字母、数字。</div>
        <button class="btn btn-primary" id="btnChangePass">修改密码</button>
      </div></div>`;
  }

  /* ---------------- 事件 ---------------- */

  document.addEventListener('click', async (e) => {
    const nav = e.target.closest('[data-nav]');
    if (nav) { S.tab = nav.dataset.nav; render(); document.querySelectorAll('.navitem').forEach((b) => b.classList.toggle('on', b.dataset.nav === S.tab)); return; }

    const cmd = e.target.closest('[data-cmd]');
    if (cmd) {
      const c = cmd.dataset.cmd;
      if (c === 'reset' && !confirm('重置本局会清空所有日报与行动记录（队伍保留），确定？')) return;
      if (c === 'end' && !confirm('结束本局后玩家端进入终局展示，确定？')) return;
      await sessionCmd(c, c === 'extend' ? { minutes: Number(cmd.dataset.min || 2) } : {});
      return;
    }

    const save = e.target.closest('[data-save]');
    if (save) {
      const kind = save.dataset.save;
      if (kind === 'config') { await saveConfig(el('cfgRoot')); return; }
      if (kind === 'weather') {
        const matrix = [];
        main().querySelectorAll('[data-wday]').forEach((sel) => {
          const day = Number(sel.dataset.wday);
          let row = matrix.find((r) => r.day === day);
          if (!row) { row = { day }; matrix.push(row); }
          row[sel.dataset.wterrain] = sel.value;
        });
        matrix.sort((a, b) => a.day - b.day);
        try {
          await DG.api('/api/admin/weather', { method: 'PUT', body: JSON.stringify({ sessionId: S.st.session.id, matrix }) });
          DG.toast('天气矩阵已保存', 'success');
          await load();
        } catch (err) { DG.toast(err.message, 'warn', 6000); }
        return;
      }
      if (kind === 'map') {
        const { nodes, edges } = collectMap();
        try {
          const r = await DG.api('/api/admin/map', { method: 'PUT', body: JSON.stringify({ sessionId: S.st.session.id, nodes, edges }) });
          DG.toast(`地图已保存（${nodes.length} 节点）`, 'success');
          await load();
        } catch (err) { DG.toast(err.message, 'warn', 8000); }
        return;
      }
    }

    const preset = e.target.closest('[data-preset]');
    if (preset) {
      try {
        await DG.api(`/api/admin/session/${S.st.session.id}/preset`, { method: 'POST', body: JSON.stringify({ preset: preset.dataset.preset }) });
        DG.toast(`${preset.textContent} 预设已载入`, 'success');
        await load();
      } catch (err) { DG.toast(err.message, 'warn', 6000); }
      return;
    }

    const teamBtn = e.target.closest('[data-team-action]');
    if (teamBtn) {
      const id = teamBtn.dataset.team;
      const act = teamBtn.dataset.teamAction;
      if (act === 'delete' && !confirm('删除队伍会同时删除其账号与历史记录，确定？')) return;
      try {
        if (act === 'delete') await DG.api(`/api/admin/teams/${id}`, { method: 'DELETE' });
        else await DG.api(`/api/admin/teams/${id}`, { method: 'PATCH', body: JSON.stringify({ action: act }) });
        DG.toast('已更新队伍', 'success');
        await load();
      } catch (err) { DG.toast(err.message, 'warn'); }
      return;
    }

    const exp = e.target.closest('[data-export]');
    if (exp) {
      const type = exp.dataset.export;
      let day = S.st.session.currentDay || 1;
      const input = type === 'cost' ? el('expDayCost') : el('expDay');
      if (input) day = Number(input.value) || day;
      window.location = `/api/admin/export?type=${type}&day=${day}`;
      return;
    }

    if (e.target.closest('#btnCreateTeam')) {
      const name = el('newName').value.trim();
      const username = el('newUser').value.trim();
      const password = el('newPass').value;
      const color = el('newColor').value.trim();
      const slogan = el('newSlogan').value.trim();
      if (!name || !username || !password) { DG.toast('队名、账号、密码必填', 'warn'); return; }
      try {
        await DG.api('/api/admin/teams', { method: 'POST', body: JSON.stringify({ name, username, password, color, slogan, sessionId: S.st.session.id }) });
        DG.toast('队伍已创建', 'success');
        await load();
      } catch (err) { DG.toast(err.message, 'warn'); }
      return;
    }

    if (e.target.closest('#btnImportTeams')) {
      try {
        const r = await DG.api('/api/admin/teams/import', { method: 'POST', body: JSON.stringify({ csv: el('importCsv').value, sessionId: S.st.session.id }) });
        DG.toast(`成功导入 ${r.created} 支队伍${r.errors && r.errors.length ? `，${r.errors.length} 行失败` : ''}`, r.errors && r.errors.length ? 'warn' : 'success', 7000);
        await load();
      } catch (err) { DG.toast(err.message, 'warn'); }
      return;
    }

    if (e.target.closest('#btnSaveTeams')) {
      const rows = [...main().querySelectorAll('[data-team-id]')].reduce((acc, inp) => {
        const id = inp.dataset.teamId;
        acc[id] = acc[id] || {};
        acc[id][inp.dataset.teamProp] = inp.value;
        return acc;
      }, {});
      try {
        for (const [id, patch] of Object.entries(rows)) {
          await DG.api(`/api/admin/teams/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
        }
        DG.toast('队伍信息已保存', 'success');
        await load();
      } catch (err) { DG.toast(err.message, 'warn'); }
      return;
    }

    if (e.target.closest('#btnResetPass')) {
      const username = el('resetUser').value.trim();
      const password = el('resetPass').value;
      try {
        await DG.api('/api/admin/users/reset', { method: 'POST', body: JSON.stringify({ username, password }) });
        DG.toast('密码已重置', 'success');
      } catch (err) { DG.toast(err.message, 'warn'); }
      return;
    }

    if (e.target.closest('#btnBroadcast')) {
      const text = el('bcText').value.trim();
      if (!text) { DG.toast('播报内容为空', 'warn'); return; }
      try {
        await DG.api('/api/admin/broadcast', { method: 'POST', body: JSON.stringify({ text, level: el('bcLevel').value }) });
        el('bcText').value = '';
        DG.toast('播报已发出', 'success');
      } catch (err) { DG.toast(err.message, 'warn'); }
      return;
    }

    if (e.target.closest('#btnChangePass')) {
      const password = el('newAdminPass').value;
      try {
        await DG.api('/api/auth/password', { method: 'POST', body: JSON.stringify({ password }) });
        DG.toast('密码已更新，请重新登录', 'success');
        setTimeout(() => { location.href = '/'; }, 1800);
      } catch (err) { DG.toast(err.message, 'warn'); }
      return;
    }

    if (e.target.closest('#btnMapReset')) {
      if (!confirm('恢复默认为 38 格原始地图，确定？')) return;
      try {
        await DG.api('/api/admin/map/reset', { method: 'POST', body: JSON.stringify({ sessionId: S.st.session.id }) });
        DG.toast('地图已恢复默认', 'success');
        await load();
      } catch (err) { DG.toast(err.message, 'warn'); }
      return;
    }

    if (e.target.closest('#btnMapCheck')) {
      const { nodes, edges } = collectMap();
      try {
        const r = await DG.api('/api/admin/map/preview', { method: 'POST', body: JSON.stringify({ nodes, edges }) });
        el('mapReport').innerHTML = `<div style="color:${r.ok ? 'var(--ok)' : 'var(--blood)'}">${r.ok ? '地图合法' : '地图有问题'}</div>
          <div>节点 ${nodes.length} · 边 ${edges.length} · 最短到藏宝山 ${r.toMountain ?? '—'} 天</div>
          ${(r.issues || []).map((i) => `<div style="color:var(--blood)">· ${esc(i)}</div>`).join('')}
          ${(r.warnings || []).map((i) => `<div style="color:var(--amber)">· ${esc(i)}</div>`).join('')}`;
      } catch (err) { DG.toast(err.message, 'warn'); }
      return;
    }

    if (e.target.closest('#btnBalance')) {
      try {
        const b = await DG.api('/api/admin/balance');
        el('mapReport').innerHTML = `<div>单程 ${b.toMountain} 天 · 往返 ${b.roundTrip} 天 · 可挖 ${b.digDays} 天</div>
          <div>理论满挖 ${b.gold} 块 · 金价 ${b.goldValue} · 税 ${b.tax}</div>
          <div class="sand">理论净收益 ${b.net}</div>
          <div class="dim" style="font-size:11px">按最短路径与晴天上限估算，用于判断参数是否过松或过紧。</div>`;
      } catch (err) { DG.toast(err.message, 'warn'); }
      return;
    }

    if (e.target.closest('#btnScreenPage')) { window.open('/screen', '_blank'); return; }
    if (e.target.closest('#btnLogout')) { await DG.api('/api/auth/logout', { method: 'POST' }); location.href = '/'; }
  });

  /* ---------------- 启动 ---------------- */

  async function boot() {
    try {
      const me = await DG.api('/api/auth/me');
      if (!me.user || me.user.role !== 'ADMIN') { location.href = '/'; return; }
      el('nav').innerHTML = navHtml();
      await load();
      S.socket = DG.connectSocket((evt) => {
        if (evt === 'refresh' && S.tab === 'dash') load();
        if (evt === 'report') load();
      });
      S.socket.on('game:refresh', () => { if (S.tab === 'dash') load(); });
    } catch (err) {
      location.href = '/';
    }
    setInterval(() => { if (S.tab === 'dash' && !document.hidden) load(); }, 5000);
  }

  boot();
})();
