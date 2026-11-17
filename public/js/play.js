/* 玩家端：候场 / 沙盘 / 行动 / 商店 / 情报 / 日报 / 终局 */
(function () {
  const S = {
    state: null,
    offset: 0,
    socket: null,
    draft: null,
    map: null,
    day: -1,
    reportShown: -1,
    endedShown: false,
    deathShown: false,
    sound: localStorage.getItem('dg_sound') !== 'off',
    audio: null,
    submitting: false,
  };

  const el = (id) => document.getElementById(id);
  const esc = DG.escapeHtml;
  const icon = DG.icon;
  const fmt = DG.fmt;

  /* ---------------- 音效 ---------------- */

  function ac() {
    if (!S.audio) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      S.audio = new C();
    }
    if (S.audio.state === 'suspended') S.audio.resume();
    return S.audio;
  }

  function blip(kind) {
    if (!S.sound) return;
    const ctx = ac();
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    if (kind === 'submit') { o.type = 'triangle'; o.frequency.value = 420; g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.22); o.start(t); o.stop(t + 0.24); }
    else if (kind === 'danger') { o.type = 'sawtooth'; o.frequency.setValueAtTime(120, t); o.frequency.linearRampToValueAtTime(58, t + 0.7); g.gain.setValueAtTime(0.10, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.8); o.start(t); o.stop(t + 0.85); }
    else if (kind === 'gold') { o.type = 'sine'; o.frequency.setValueAtTime(880, t); o.frequency.exponentialRampToValueAtTime(1320, t + 0.18); g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3); o.start(t); o.stop(t + 0.32); }
    else { o.type = 'sine'; o.frequency.value = 620; g.gain.setValueAtTime(0.04, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.14); o.start(t); o.stop(t + 0.16); }
  }

  /* ---------------- 拉取 ---------------- */

  async function loadState(silent) {
    try {
      const s = await DG.api('/api/player/state');
      applyState(s, silent);
    } catch (err) {
      if (err.status === 401 || err.status === 403) location.href = '/?role=team';
      else if (!silent) DG.toast(err.message, 'warn');
    }
  }

  function applyState(s, silent) {
    const prev = S.state;
    S.state = s;
    S.offset = Date.parse(s.serverNow) - Date.now();
    if (s.session.currentDay !== S.day) {
      S.day = s.session.currentDay;
      S.draft = null;
    }
    S.endedShown = s.session.status === 'ENDED' ? S.endedShown : false;

    const isLobby = s.session.phase === 'IDLE' || s.session.status === 'DRAFT';
    el('lobbyView').classList.toggle('hidden', !isLobby);
    el('gameView').classList.toggle('hidden', isLobby);
    if (isLobby) renderLobby(s);
    else renderGame(s);

    // 归营 / 死亡 / 终局
    if (s.team.status === 'DEAD' && !S.deathShown) {
      S.deathShown = true;
      el('deathTitle').textContent = `第 ${s.session.currentDay} 天 · ${s.team.name} 留在了沙里`;
      el('deathSub').textContent = s.lastReport ? s.lastReport.summary : (s.team.returnRank ? '' : '水和食物见底，驼铃停在半途。');
      el('deathVeil').classList.remove('hidden');
      blip('danger');
    }
    if (s.team.status === 'RETURNED' && prev && prev.team.status !== 'RETURNED') blip('gold');

    if (s.session.status === 'ENDED' && !S.endedShown) {
      S.endedShown = true;
      setTimeout(() => openFinal(), 600);
    }

    // 日报自动弹出
    const day = s.session.currentDay;
    if (s.report && (s.session.phase === 'REPORT' || s.session.phase === 'ACTION' || s.session.phase === 'SETTLING') && S.reportShown !== day && s.session.currentDay > 0) {
      const key = `dg_report_${s.session.id}_${day}`;
      if (!sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, '1');
        S.reportShown = day;
        openReport(s.report);
      }
    }

    // 天气特效
    const wt = s.weatherToday.find((w) => w.terrain === (s.team.nodeType || 'DESERT'));
    const w = wt ? wt.weather : 'SUNNY';
    if (S.map) {
      S.map.setStorm(w === 'STORM' || w === 'STORM_HEAT');
      S.map.setHeat(w === 'HEAT' || w === 'STORM_HEAT');
    }
    if (!silent) {
      renderTicker(s.broadcasts);
    }
  }

  /* ---------------- 候场 ---------------- */

  function renderLobby(s) {
    el('lobbyTitle').textContent = s.session.name;
    el('lobbyTask').textContent = s.task.briefing || '';
    el('lobbyGoal').textContent = s.task.goal || '';
    el('lobbyDays').textContent = `${s.session.totalDays} 天`;
    el('lobbyTeamName').textContent = s.team.name;
    el('lobbySlogan').textContent = s.team.slogan || '';
    el('lobbyTeamKv').innerHTML = [
      ['起始现金', fmt.money(s.team.cash)],
      ['皮囊水 / 食物', `${s.team.water} / ${s.team.food}`],
      ['载重上限', `${s.team.capacity} 磅`],
      ['当前载重', `${s.team.weight} 磅`],
    ].map(([k, v]) => `<div class="r"><span>${k}</span><span class="num">${v}</span></div>`).join('');

    el('lobbyTeams').innerHTML = s.teams.map((t) => `
      <div style="display:flex;align-items:center;gap:9px;font-size:12.5px">
        <span style="width:8px;height:8px;border-radius:2px;transform:rotate(45deg);background:${esc(t.color)}"></span>
        <span style="flex:1">${esc(t.name)}</span>
        <span class="chip ${t.status === 'DEAD' ? 'bad' : t.status === 'RETURNED' ? 'ok' : ''} dot">${t.status === 'DEAD' ? '出局' : t.status === 'RETURNED' ? '已归营' : '在场'}</span>
      </div>`).join('') || '<div class="dim" style="font-size:12px">只有你一支队伍</div>';
    el('lobbyTeamCount').textContent = s.teams.length;

    const sunny = s.consumptionTable[0] || { water: 1, food: 1 };
    const rules = [
      ['行走与消耗', `每天最多移动一格。<b>晴天</b>消耗 ${sunny.water} 水 ${sunny.food} 食；沙尘暴、高温的消耗见完整表格。断水或断粮即淘汰。`],
      ['物资价格', `水 ${fmt.money(s.prices.water)} / 皮囊（${s.prices.weights.water} 磅），食物 ${fmt.money(s.prices.food)} / 盘（${s.prices.weights.food} 磅），帐篷 ${fmt.money(s.prices.tent)}（可用 ${s.rules.tentUses} 次），指南针 ${fmt.money(s.prices.compass)}。村庄补给溢价：水 ${fmt.money(s.prices.waterAtVillage)}、食物 ${fmt.money(s.prices.foodAtVillage)}。`],
      ['藏宝山', `到达${s.rules.digOnArrival ? '当天即可' : '当天需休整，次日起'}每天挖 1 块金子（${s.economy.goldWeight} 磅/块）。${s.rules.digOnArrival ? '' : '山上天气恶劣，别把最后一口水留在山上。'}`],
      ['归营与金价', `回到大本营即锁定名次与金价：第 1 名 ${s.economy.returnPrices[0]}，之后依次 ${s.economy.returnPrices.slice(1).join(' / ')}（${s.economy.priceMode === 'PIECE' ? '元/块' : '元/磅'}）。最终收益扣 ${Math.round(s.economy.taxRate * 100)}% 税${s.economy.taxExemptTopDigger ? '，挖金最多者免税' : ''}。`],
      ['情报', `在大本营可用 ${s.intel.costText} 购买一条情报${s.intel.exclusive ? '（每条仅一人可得）' : ''}。情报可能改变你的路线与生死。`],
      ['时间', `准备 ${Math.round(s.session.timing.prepSeconds / 60)} 分钟；第 1 天行动 ${Math.round(s.session.timing.day1Seconds / 60)} 分钟，之后每天 ${Math.round(s.session.timing.daySeconds / 60)} 分钟；结算后 ${s.session.timing.reportSeconds} 秒日报。`],
    ];
    el('lobbyRules').innerHTML = rules.map(([t, b], i) => `
      <details${i === 0 ? ' open' : ''}><summary>${t}</summary><div class="body">${b}</div></details>`).join('');

    el('lobbyLogout').innerHTML = icon('logout');
  }

  /* ---------------- 沙盘 ---------------- */

  function renderGame(s) {
    const t = s.team;
    el('topTeam').textContent = t.name;
    el('topSession').textContent = s.session.name;
    el('topDay').textContent = s.session.currentDay;
    el('topTotal').textContent = s.session.totalDays;
    el('phaseText').textContent = DG.PHASE[s.session.phase] || s.session.phase;
    el('hudLoc').innerHTML = `${icon(DG.TYPE_ICON[t.nodeType] || 'desert')} <span style="vertical-align:middle">${esc(t.nodeId)} · ${esc(t.nodeLabel)}</span>`;

    const statusChip = el('topStatus');
    statusChip.className = `chip dot ${S.socket && S.socket.connected ? 'ok' : 'warn'}`;
    statusChip.textContent = S.socket && S.socket.connected ? '实时连接' : '轮询同步';

    // rail
    const res = [
      ['water', '水', t.water, '皮囊', t.water <= 3 ? 'low' : ''],
      ['food', '食物', t.food, '盘', t.food <= 3 ? 'low' : ''],
      ['gold', '金子', t.gold, '块', 'gold'],
      ['tent', '帐篷', t.tentLeft, '次', t.tentLeft === 0 ? 'low' : ''],
      ['compass', '指南针', t.compass, '个', t.compass === 0 ? 'low' : ''],
      ['cash', '现金', t.cash, '元', ''],
    ];
    el('rail').innerHTML = res.map(([ic, k, v, unit, cls]) => `
      <div class="res ${cls}">
        <div class="k">${icon(ic)}<span>${k}</span></div>
        <div class="v">${fmt.int(v)}<small>${unit}</small></div>
      </div>`).join('') + `
      <div class="loadbox">
        <div class="k micro" style="font-size:9px">载重 ${t.weight}/${t.capacity}</div>
        <div class="loadbar ${t.weight > t.capacity * 0.9 ? 'hot' : ''}"><i style="width:${Math.min(100, (t.weight / t.capacity) * 100)}%"></i></div>
      </div>`;

    // weather
    el('weatherStrip').innerHTML = s.weatherToday.map((w) => `
      <div class="wcell ${w.weather === 'HEAT' ? 'HI' : w.weather === 'STORM' ? 'ST' : w.weather === 'STORM_HEAT' ? 'SH' : ''}">
        <div class="t">${esc(w.label)}</div>
        <div class="ico" style="color:${w.weather === 'SUNNY' ? '#cbb894' : w.weather === 'HEAT' ? '#f4a259' : '#ff5252'}">${icon(DG.W_ICON[w.weather] || 'sunny')}</div>
        <div class="w">${esc(DG.W_SHORT[w.weather] || w.weatherLabel)}</div>
      </div>`).join('');

    // move grid
    const canAct = s.session.phase === 'ACTION' && t.status === 'ALIVE';
    const lostNow = t.status === 'LOST' && t.lostUntil && s.session.currentDay <= t.lostUntil;
    const draft = ensureDraft(s);
    const moves = [{ id: null, name: '原地停留', type: 'STAY', label: '休整 / 扎营' }].concat(t.neighbors);
    el('moveGrid').innerHTML = moves.map((m) => {
      const on = (draft.moveTo || null) === m.id;
      const ic = m.type === 'STAY' ? 'tent' : DG.TYPE_ICON[m.type] || 'desert';
      return `<button class="mv ${on ? 'on' : ''}" data-move="${m.id || ''}" ${canAct && !lostNow ? '' : 'disabled'}>
        <span class="ico">${icon(ic)}</span>
        <span><span class="id">${esc(m.id || 'STAY')}</span><br><span class="ty">${esc(m.label)}</span></span>
      </button>`;
    }).join('');

    el('nodeChip').textContent = `${t.nodeLabel}${lostNow ? ' · 迷路中' : ''}`;
    el('nodeChip').className = `chip dot ${lostNow ? 'bad' : t.nodeType === 'MOUNTAIN' ? 'warn' : ''}`;

    // 补给按钮
    const canBuy = ['BASE', 'VILLAGE'].includes(t.nodeType) && !lostNow;
    const canWater = (t.nodeType === 'OASIS' || t.nodeType === 'MOUNTAIN' || (t.nodeType === 'BASE' && false)) && !lostNow;
    const canIntel = t.nodeType === 'BASE' && !lostNow;
    const canExchange = t.nodeType === 'VILLAGE' && s.rules.villageWaterToFood.enabled && !lostNow;
    const btns = [];
    btns.push({ key: 'buy', label: canBuy ? `采购 · ${t.nodeType === 'BASE' ? '大本营价' : '村庄价'}` : '此处无货', icon: 'cash', disabled: !canBuy || !canAct });
    if (t.nodeType === 'OASIS' || t.nodeType === 'MOUNTAIN') {
      btns.push({ key: 'water', label: draft.takeWater ? '今日取水 · 已选' : '今日取水', icon: 'water', disabled: !canAct || !canWater, on: Boolean(draft.takeWater) });
    }
    if (t.nodeType === 'VILLAGE') {
      btns.push({ key: 'exchange', label: `水换粮 ${s.rules.villageWaterToFood.waterCost}:${s.rules.villageWaterToFood.foodGain}`, icon: 'food', disabled: !canAct || !canExchange, on: Boolean(draft.exchangeWaterForFood) });
    }
    btns.push({ key: 'intel', label: canIntel ? '向沙漠老怪问情报' : '情报只在大本营', icon: 'skull', disabled: !canAct || !canIntel, on: Boolean(draft.askIntel) });
    el('supplyBtns').innerHTML = btns.map((b) => `
      <button class="mv ${b.on ? 'on' : ''}" data-act="${b.key}" ${b.disabled ? 'disabled' : ''}>
        <span class="ico">${icon(b.icon)}</span><span class="id" style="font-size:11.5px">${esc(b.label)}</span>
      </button>`).join('');

    // 装备
    const gearBtns = [
      { key: 'tent', label: `帐篷 (${t.tentLeft})`, on: draft.useTent, disabled: !canAct || t.tentLeft <= 0 || t.nodeType === 'BASE', icon: 'tent' },
      { key: 'compass', label: `指南针 (${t.compass})`, on: draft.useCompass, disabled: !canAct || t.compass <= 0 || t.nodeType === 'BASE', icon: 'compass' },
    ];
    el('gearBtns').innerHTML = gearBtns.map((b) => `
      <button class="mv ${b.on ? 'on' : ''}" data-gear="${b.key}" ${b.disabled ? 'disabled' : ''}>
        <span class="ico">${icon(b.icon)}</span><span class="id" style="font-size:11.5px">${esc(b.label)}</span>
      </button>`).join('');

    // 挖金提示
    const dig = t.canDig && t.nodeType === 'MOUNTAIN';
    el('digSect').style.display = dig ? '' : 'none';

    // 已握情报
    const mine = s.intel.items.filter((i) => i.mine);
    el('intelMine').style.display = mine.length ? '' : 'none';
    el('intelMineList').innerHTML = mine.map((i) => `
      <div class="summary-card" style="padding:10px 12px;gap:4px">
        <div style="font-size:12px;font-weight:700;color:var(--sand)">${esc(i.title)}</div>
        <div style="font-size:11.5px;color:var(--muted);line-height:1.6">${esc(i.text)}</div>
      </div>`).join('');

    // 草稿摘要
    const moveTxt = draft.moveTo ? `${t.nodeId} → ${draft.moveTo}` : '原地停留';
    el('draftMeta').textContent = moveTxt;
    const newWeight = t.weight + (draft.buy.water * s.prices.weights.water + draft.buy.food * s.prices.weights.food + draft.buy.tent * s.prices.weights.tent + draft.buy.compass * s.prices.weights.compass) + (draft.takeWater ? 0 : 0);
    el('weightMeta').textContent = `载重 ${newWeight} / ${t.capacity}`;
    el('weightMeta').className = newWeight > t.capacity ? 'blood mono' : '';

    // 提交态
    const submitted = Boolean(s.submittedAt);
    el('btnSubmit').disabled = !canAct || submitted || S.submitting;
    el('btnSubmit').textContent = submitted ? '已提交 · 等待结算' : S.submitting ? '提交中…' : '提交行动';
    el('btnRecall').style.display = submitted && canAct ? '' : 'none';

    // 地图
    if (!S.map) S.map = new DesertMap(el('mapCanvas'), { onNodeClick: (id) => onMapClick(id) });
    const prevTeams = S.map.teams && S.map.selfId ? S.map.teams.find((x) => x.id === S.map.selfId) : null;
    if (prevTeams && prevTeams.nodeId && prevTeams.nodeId !== t.nodeId) {
      S.map.playMove(t.id, prevTeams.nodeId, t.nodeId);
      if (s.report && s.report.moved) blip(s.report.dug ? 'gold' : 'move');
      if (s.report && s.report.dug) S.map.burstGold(t.nodeId);
    }
    S.map.setData({
      nodes: s.map.nodes,
      edges: s.map.edges,
      teams: [{ id: t.id, name: t.name, color: t.color, nodeId: t.nodeId, status: t.status }],
      selfId: t.id,
    });

    // 其他队伍（仅归营/出局可见）
    renderTicker(s.broadcasts);
    updateClock();
  }

  function ensureDraft(s) {
    if (!S.draft) {
      S.draft = {
        moveTo: null, buy: { water: 0, food: 0, tent: 0, compass: 0 }, takeWater: false,
        askIntel: false, intelId: null, useTent: false, useCompass: false, exchangeWaterForFood: false,
      };
    }
    if (s.action && s.action.__submitted) {
      S.draft = {
        moveTo: s.action.moveTo || null,
        buy: { ...s.action.buy },
        takeWater: Boolean(s.action.takeWater),
        askIntel: Boolean(s.action.askIntel),
        intelId: s.action.intelId || null,
        useTent: Boolean(s.action.useTent),
        useCompass: Boolean(s.action.useCompass),
        exchangeWaterForFood: Boolean(s.action.exchangeWaterForFood),
      };
    }
    return S.draft;
  }

  function onMapClick(id) {
    const s = S.state;
    if (!s || s.session.phase !== 'ACTION') return;
    if (!s.team.neighbors.find((n) => n.id === id)) return;
    S.draft.moveTo = S.draft.moveTo === id ? null : id;
    if (S.draft.moveTo) S.draft.askIntel = false;
    blip('click');
    renderGame(s);
  }

  /* ---------------- 时钟 ---------------- */

  const PHASE_SECONDS = (s) => {
    const t = s.session.timing;
    if (s.session.phase === 'PREP') return t.prepSeconds;
    if (s.session.phase === 'BRIEF') return t.briefSeconds;
    if (s.session.phase === 'ACTION') return s.session.currentDay <= 1 ? t.day1Seconds : t.daySeconds;
    if (s.session.phase === 'REPORT') return t.reportSeconds;
    return 0;
  };

  function updateClock() {
    const s = S.state;
    if (!s || !el('gameView') || el('gameView').classList.contains('hidden')) {
      if (s && !el('lobbyView').classList.contains('hidden')) updateLobbyClock(s);
      return;
    }
    const ends = s.session.timing.phaseEndsAt ? Date.parse(s.session.timing.phaseEndsAt) : null;
    const remain = ends ? ends - (Date.now() + S.offset) : 0;
    const total = Math.max(1, PHASE_SECONDS(s) * 1000);
    const p = Math.max(0, Math.min(1, remain / total));
    const ring = el('ring');
    ring.style.setProperty('--p', p.toFixed(3));
    ring.classList.toggle('warn', remain > 0 && remain < 31000);
    el('clockText').textContent = remain > 0 ? fmt.mmss(remain) : (s.session.phase === 'ACTION' ? '已封盘' : '--:--');
    const sub = el('clockSub');
    if (s.session.phase === 'ACTION') sub.textContent = remain > 0 ? '行动窗口 · 到点自动结算' : '等待沙盘结算';
    else if (s.session.phase === 'PREP') sub.textContent = '准备阶段 · 规划路线与采购清单';
    else if (s.session.phase === 'BRIEF') sub.textContent = '天气播报 · 注意今日天候';
    else if (s.session.phase === 'REPORT') sub.textContent = '日报 · 看看今天发生了什么';
    else if (s.session.phase === 'SETTLING') sub.textContent = '沙盘结算中…';
    else if (s.session.phase === 'ENDED') sub.textContent = '本局结束';
  }

  function updateLobbyClock(s) {
    const openFrom = s.session.timing.openFrom;
    const cd = el('lobbyCountdown');
    if (!openFrom) {
      cd.textContent = '--:--';
      el('lobbyPhase').textContent = '等待管理员开营';
      return;
    }
    const remain = Date.parse(openFrom) - (Date.now() + S.offset);
    if (remain <= 0) {
      cd.textContent = '00:00';
      el('lobbyPhase').textContent = '即将开营…';
      return;
    }
    cd.textContent = remain > 3600000 ? fmt.hhmmss(remain) : fmt.mmss(remain);
    el('lobbyPhase').textContent = `定于 ${fmt.date(openFrom)} 开营，请提前入场`;
  }

  setInterval(() => {
    updateClock();
    if (S.state && S.state.session.phase === 'ACTION') {
      const remain = S.state.session.timing.phaseEndsAt ? Date.parse(S.state.session.timing.phaseEndsAt) - (Date.now() + S.offset) : 0;
      if (remain > 0 && remain < 31000 && !S._warned) { S._warned = true; blip('danger'); }
      if (remain > 31000) S._warned = false;
    }
  }, 1000);

  /* ---------------- 交互 ---------------- */

  document.addEventListener('click', (e) => {
    const mv = e.target.closest('[data-move]');
    if (mv && !mv.disabled) {
      const id = mv.dataset.move || null;
      S.draft.moveTo = S.draft.moveTo === id ? null : id;
      if (S.draft.moveTo) S.draft.askIntel = false;
      blip('click');
      renderGame(S.state);
      return;
    }
    const act = e.target.closest('[data-act]');
    if (act && !act.disabled) {
      const k = act.dataset.act;
      if (k === 'buy') openShop();
      if (k === 'water') { S.draft.takeWater = !S.draft.takeWater; blip('click'); renderGame(S.state); }
      if (k === 'exchange') { S.draft.exchangeWaterForFood = !S.draft.exchangeWaterForFood; renderGame(S.state); }
      if (k === 'intel') openIntel();
      return;
    }
    const gear = e.target.closest('[data-gear]');
    if (gear && !gear.disabled) {
      const k = gear.dataset.gear;
      if (k === 'tent') { S.draft.useTent = !S.draft.useTent; if (S.draft.useTent) S.draft.useCompass = false; }
      if (k === 'compass') { S.draft.useCompass = !S.draft.useCompass; if (S.draft.useCompass) S.draft.useTent = false; }
      blip('click');
      renderGame(S.state);
    }
  });

  el('btnSubmit').addEventListener('click', async () => {
    const s = S.state;
    if (!s) return;
    const draft = ensureDraft(s);
    if (draft.askIntel && !draft.intelId) { DG.toast('先选一条情报再提交', 'warn'); openIntel(); return; }
    S.submitting = true;
    renderGame(s);
    try {
      const clientActionId = (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
      await DG.api('/api/player/action', {
        method: 'POST',
        body: JSON.stringify({
          clientActionId,
          action: {
            moveTo: draft.moveTo,
            stay: !draft.moveTo,
            buy: draft.buy,
            takeWater: draft.takeWater ? true : 0,
            askIntel: draft.askIntel,
            intelId: draft.intelId,
            useTent: draft.useTent,
            useCompass: draft.useCompass,
            exchangeWaterForFood: draft.exchangeWaterForFood,
          },
        }),
      });
      blip('submit');
      DG.toast('行动已封存，等待其他队伍', 'success');
      S.submitting = false;
      await loadState(true);
    } catch (err) {
      S.submitting = false;
      DG.toast(err.message, 'warn', 6000);
      renderGame(s);
    }
  });

  el('btnRecall').addEventListener('click', async () => {
    try {
      await DG.api('/api/player/action', { method: 'DELETE' });
      DG.toast('已撤回，可以重新规划', 'success');
      S.draft = null;
      await loadState(true);
    } catch (err) {
      DG.toast(err.message, 'warn');
    }
  });

  /* ---------------- 商店 ---------------- */

  function sheet(html) {
    el('sheet').innerHTML = html;
    el('sheetWrap').classList.remove('hidden');
  }
  function closeSheet() { el('sheetWrap').classList.add('hidden'); }
  el('sheetWrap').addEventListener('click', (e) => {
    if (e.target === el('sheetWrap') || e.target.closest('[data-close]')) closeSheet();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSheet(); });

  function openShop() {
    const s = S.state;
    const t = s.team;
    const draft = ensureDraft(s);
    const isBase = t.nodeType === 'BASE';
    const items = isBase ? ['water', 'food', 'tent', 'compass'] : ['water', 'food'];
    const data = {
      water: { nm: '皮囊水', price: isBase ? s.prices.water : s.prices.waterAtVillage, wt: s.prices.weights.water, unit: '皮囊' },
      food: { nm: '食物', price: isBase ? s.prices.food : s.prices.foodAtVillage, wt: s.prices.weights.food, unit: '盘' },
      tent: { nm: '帐篷', price: s.prices.tent, wt: s.prices.weights.tent, unit: '顶', note: `可用 ${s.rules.tentUses} 次` },
      compass: { nm: '指南针', price: s.prices.compass, wt: s.prices.weights.compass, unit: '个', note: '一次性，防迷路' },
    };
    const render = () => {
      let cost = 0;
      let addWt = 0;
      items.forEach((k) => { cost += draft.buy[k] * data[k].price; addWt += draft.buy[k] * data[k].wt; });
      const leftCap = t.capacity - t.weight - addWt;
      sheet(`
        <div class="sheet-head">
          <div><div class="micro">SUPPLY</div><h3 style="margin-top:4px">${isBase ? '大本营补给' : '村庄补给'}</h3></div>
          <button class="icon-btn" data-close="1">${icon('x')}</button>
        </div>
        <div class="sheet-body">
          <div class="goods">
            ${items.map((k) => `
              <div class="good">
                <div class="top"><span class="nm">${data[k].nm}</span><span class="pr num">${fmt.money(data[k].price)}</span></div>
                <div class="wt">${data[k].wt} 磅 / ${data[k].unit}${data[k].note ? ` · ${data[k].note}` : ''}</div>
                <div class="stepper">
                  <button data-step="-1" data-k="${k}">−</button>
                  <input readonly value="${draft.buy[k]}">
                  <button data-step="1" data-k="${k}">+</button>
                </div>
              </div>`).join('')}
          </div>
          <div class="totals">
            <div class="b"><div class="k">花费</div><div class="v ${cost > t.cash ? 'blood' : ''}">${fmt.money(cost)}</div></div>
            <div class="b"><div class="k">新增载重</div><div class="v">${addWt} 磅</div></div>
            <div class="b"><div class="k">剩余载重</div><div class="v ${leftCap < 0 ? 'blood' : ''}">${leftCap} 磅</div></div>
          </div>
          <div class="dim" style="font-size:11.5px;line-height:1.8">采购在结算时生效并计入当天成本；现金 ${fmt.money(t.cash)}，载重已用 ${t.weight}/${t.capacity} 磅。</div>
        </div>
        <div class="sheet-foot">
          <button class="btn btn-ghost" data-close="1">取消</button>
          <button class="btn btn-primary" data-shop-ok="1">确认采购</button>
        </div>`);
    };
    render();

    el('sheet').onclick = (e) => {
      if (e.target.closest('[data-close]')) { closeSheet(); return; }
      const step = e.target.closest('[data-step]');
      if (step) {
        const k = step.dataset.k;
        const dir = Number(step.dataset.step);
        draft.buy[k] = Math.max(0, draft.buy[k] + dir);
        render();
        return;
      }
      if (e.target.closest('[data-shop-ok]')) {
        let cost = 0;
        let addWt = 0;
        items.forEach((k) => { cost += draft.buy[k] * data[k].price; addWt += draft.buy[k] * data[k].wt; });
        if (cost > t.cash) { DG.toast('现金不足，减少数量', 'warn'); return; }
        if (t.weight + addWt > t.capacity) { DG.toast('载重不足，少买一点', 'warn'); return; }
        closeSheet();
        renderGame(S.state);
      }
    };
  }

  /* ---------------- 情报 ---------------- */

  function openIntel() {
    const s = S.state;
    const draft = ensureDraft(s);
    const cost = s.intel.costText;
    sheet(`
      <div class="sheet-head">
        <div><div class="micro">INTELLIGENCE · 沙漠老怪</div><h3 style="margin-top:4px">代价：${esc(cost)}</h3></div>
        <button class="icon-btn" data-close="1">${icon('x')}</button>
      </div>
      <div class="sheet-body">
        <div class="muted" style="font-size:12.5px;line-height:1.8">问情报的当天不能移动。情报可能救你的命，也可能是废话——沙漠老怪从不保证。</div>
        <div style="display:grid;gap:10px">
          ${s.intel.items.map((i) => {
            const taken = i.taken && !i.mine;
            const on = draft.intelId === i.id;
            return `<button class="good" data-intel="${i.id}" ${taken ? 'disabled' : ''} style="text-align:left;cursor:${taken ? 'not-allowed' : 'pointer'};opacity:${taken ? 0.45 : 1};${on ? 'border-color:var(--sand);background:rgba(231,177,92,.1)' : ''}">
              <div class="top"><span class="nm">${esc(i.title)}</span>${i.mine ? '<span class="chip ok dot">已掌握</span>' : taken ? '<span class="chip bad dot">已被买走</span>' : ''}</div>
              <div style="font-size:12px;color:var(--muted);line-height:1.7">${esc(i.text)}</div>
            </button>`;
          }).join('')}
        </div>
      </div>
      <div class="sheet-foot">
        <button class="btn btn-ghost" data-close="1">不问</button>
        <button class="btn btn-primary" data-intel-ok="1">确认购买</button>
      </div>`);

    const handler = (e) => {
      if (e.target.closest('[data-close]')) { closeSheet(); return; }
      const it = e.target.closest('[data-intel]');
      if (it && !it.disabled) {
        draft.intelId = it.dataset.intel;
        draft.askIntel = true;
        draft.moveTo = null;
        openIntel();
        return;
      }
      if (e.target.closest('[data-intel-ok]')) {
        if (!draft.intelId) { DG.toast('先选一条情报', 'warn'); return; }
        draft.askIntel = true;
        draft.moveTo = null;
        closeSheet();
        renderGame(S.state);
      }
    };
    el('sheet').onclick = handler;
  }

  /* ---------------- 日报 ---------------- */

  function openReport(r) {
    const s = S.state;
    const cons = r.consumed || {};
    const bal = r.balance || {};
    const purch = r.purchases || {};
    const money = (o) => Object.keys(o).filter((k) => o[k].qty).map((k) => `${k === 'water' ? '水' : k === 'food' ? '食物' : k === 'tent' ? '帐篷' : '指南针'}×${o[k].qty}（¥${Math.round(o[k].cost)}）`).join('、') || '无';
    sheet(`
      <div class="sheet-head">
        <div><div class="micro">DAY ${r.day} REPORT</div><h3 style="margin-top:4px">${esc(r.returned ? '你回到了大本营' : r.died ? '队伍失联' : r.moved ? '今日行程' : '原地一天')}</h3></div>
        <button class="icon-btn" data-close="1">${icon('x')}</button>
      </div>
      <div class="sheet-body">
        <div class="summary-card">
          <div class="say">${esc(r.summary)}</div>
          <div class="adv">${esc(r.advice)}</div>
        </div>
        ${r.notes && r.notes.length ? `<div style="display:grid;gap:6px">${r.notes.map((n) => `<div class="chip warn" style="white-space:normal">${esc(n)}</div>`).join('')}</div>` : ''}
        <div class="report-grid">
          <div>
            <div class="micro" style="margin-bottom:8px">当日账目</div>
            <div class="kv">
              <div class="r"><span>位置 / 天候</span><span>${esc(r.fromLabel)} → ${esc(r.terrainLabel)} · ${esc(r.weatherLabel)}</span></div>
              <div class="r"><span>消耗（水 / 食物）</span><span class="num">-${cons.water} / -${cons.food}</span></div>
              <div class="r"><span>装备</span><span>${esc(r.countermeasure)}</span></div>
              <div class="r"><span>采购</span><span style="max-width:60%;text-align:right">${money(purch)}</span></div>
              <div class="r"><span>取水 / 挖金</span><span class="num">+${r.tookWater || 0} 水 · +${r.dug || 0} 金</span></div>
              <div class="r"><span>现金变动</span><span class="num">${r.cashDelta > 0 ? '+' : ''}${Math.round(r.cashDelta)}</span></div>
              <div class="r"><span>名次 / 金价</span><span>${r.returnRank ? `第 ${r.returnRank} 名` : '未归营'}</span></div>
            </div>
          </div>
          <div>
            <div class="micro" style="margin-bottom:8px">结余</div>
            <div class="totals" style="grid-template-columns:1fr 1fr">
              <div class="b"><div class="k">水</div><div class="v">${bal.water}</div></div>
              <div class="b"><div class="k">食物</div><div class="v">${bal.food}</div></div>
              <div class="b"><div class="k">金子</div><div class="v sand">${bal.gold}</div></div>
              <div class="b"><div class="k">现金</div><div class="v">${fmt.money(bal.cash)}</div></div>
            </div>
            <div class="hairline" style="margin:12px 0"></div>
            <div class="kv">
              <div class="r"><span>载重</span><span class="num">${bal.weight} / ${bal.capacity} 磅</span></div>
              <div class="r"><span>帐篷耐久</span><span class="num">${bal.tentLeft}</span></div>
              <div class="r"><span>指南针</span><span class="num">${bal.compass}</span></div>
            </div>
          </div>
        </div>
      </div>
      <div class="sheet-foot"><button class="btn btn-primary" data-close="1">知道了</button></div>`);

    if (r.dug) setTimeout(() => blip('gold'), 400);
  }

  /* ---------------- 终局 ---------------- */

  function openFinal() {
    const s = S.state;
    const board = s.leaderboard || [];
    const rows = board.map((b, i) => `
      <div class="rank-row ${i === 0 ? 'top' : ''}">
        <div class="rk">${String(i + 1).padStart(2, '0')}</div>
        <div><div style="font-weight:700">${esc(b.name)}</div><div class="dim" style="font-size:11px">${b.returned ? `第 ${b.returnRank || '?'} 个归营 · 第 ${b.usedDays || '?'} 天` : b.status === 'DEAD' ? `出局：${esc(b.deadReason || '断水断粮')}` : '未归营'}</div></div>
        <div class="num sand">${b.gold} 块</div>
        <div class="num">${fmt.money(b.net)}</div>
        <div class="chip ${b.exempt ? 'ok' : ''}">${b.exempt ? '免税' : `税 ${Math.round(s.economy.taxRate * 100)}%`}</div>
      </div>`).join('');

    sheet(`
      <div class="sheet-head">
        <div><div class="micro">FINAL LEDGER</div><h3 style="margin-top:4px">终局结算 · ${esc(s.session.name)}</h3></div>
        <button class="icon-btn" data-close="1">${icon('x')}</button>
      </div>
      <div class="sheet-body">
        <div class="king" style="padding:22px">
          <div class="crown">TOP OF THE DUNES</div>
          <h2 style="margin:8px 0">${esc(board[0] ? board[0].name : '无人归营')}</h2>
          <div class="muted">按净收益排名 · 金价按归营名次锁定 · ${s.economy.priceMode === 'PIECE' ? '元/块' : '元/磅'}</div>
        </div>
        <div class="rank-list">${rows}</div>
        <div class="dim" style="font-size:11.5px">净收益 = 剩余现金 + 金子计价 − ${Math.round(s.economy.taxRate * 100)}% 税（挖金最多者免税）。</div>
      </div>
      <div class="sheet-foot"><button class="btn btn-primary" data-close="1">收下战报</button></div>`);
  }

  /* ---------------- 规则 ---------------- */

  function openRules() {
    const s = S.state;
    const rows = s.consumptionTable.map((c) => `
      <tr><td>${esc(c.label)}</td><td class="num">${c.water} 水</td><td class="num">${c.food} 食</td><td class="dim" style="font-size:11px">${esc(c.note || '')}</td></tr>`).join('');
    sheet(`
      <div class="sheet-head">
        <div><div class="micro">RULESET</div><h3 style="margin-top:4px">沙盘规则</h3></div>
        <button class="icon-btn" data-close="1">${icon('x')}</button>
      </div>
      <div class="sheet-body">
        <div class="table-wrap">
          <table class="table">
            <thead><tr><th>天候 / 对策</th><th>水</th><th>食物</th><th>说明</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div class="kv">
          <div class="r"><span>移动</span><span>每天一格，只能走到相邻格</span></div>
          <div class="r"><span>死亡判定</span><span>${s.rules.dieAtZero ? '水或食物归零即出局' : '水或食物为负才出局'}</span></div>
          <div class="r"><span>挖金</span><span>${s.rules.digOnArrival ? '到达藏宝山当天可挖' : '到达当天休整，次日起每天 1 块'}（${s.economy.goldWeight} 磅/块）</span></div>
          <div class="r"><span>归营金价</span><span class="num">${s.economy.returnPrices.join(' / ')} ${s.economy.priceMode === 'PIECE' ? '元/块' : '元/磅'}</span></div>
          <div class="r"><span>税</span><span>${Math.round(s.economy.taxRate * 100)}%${s.economy.taxExemptTopDigger ? '，挖金最多者免税' : ''}</span></div>
          <div class="r"><span>村庄换粮</span><span>${s.rules.villageWaterToFood.enabled ? `${s.rules.villageWaterToFood.waterCost} 水 → ${s.rules.villageWaterToFood.foodGain} 食物` : '未开启'}</span></div>
          <div class="r"><span>撤回行动</span><span>封盘前 ${s.rules.recallBeforeSeconds} 秒内不可撤回</span></div>
        </div>
        <div>
          <div class="micro" style="margin-bottom:8px">今日各格天候</div>
          <div class="weather">${s.weatherToday.map((w) => `<div class="wcell"><div class="t">${esc(w.label)}</div><div class="ico">${icon(DG.W_ICON[w.weather])}</div><div class="w">${esc(DG.W_SHORT[w.weather] || w.weatherLabel)}</div></div>`).join('')}</div>
        </div>
      </div>
      <div class="sheet-foot"><button class="btn btn-ghost" data-close="1">关闭</button>${s.lastReport ? '<button class="btn btn-primary" data-last-report="1">上一天日报</button>' : ''}</div>`);

    el('sheet').onclick = (e) => {
      if (e.target.closest('[data-last-report]')) openReport(s.lastReport);
    };
  }

  /* ---------------- 播报 ---------------- */

  function renderTicker(list) {
    const track = el('tickerMove');
    if (!list) return;
    const items = list.length ? list : [{ text: '沙盘静默。风在动，沙在动，只有队伍不动。', level: 'info' }];
    const line = items.map((b) => `<span>${esc(b.text)}</span>`).join('<span style="color:var(--line-strong)">·</span>');
    track.innerHTML = line + line;
  }

  /* ---------------- 视图切换 ---------------- */

  el('btnRules').addEventListener('click', openRules);
  el('btnLogout').addEventListener('click', async () => { await DG.api('/api/auth/logout', { method: 'POST', body: JSON.stringify({ role: 'player' }) }); location.href = '/?role=team'; });
  el('lobbyLogout').addEventListener('click', async () => { await DG.api('/api/auth/logout', { method: 'POST', body: JSON.stringify({ role: 'player' }) }); location.href = '/?role=team'; });
  el('btnSound').addEventListener('click', () => {
    S.sound = !S.sound;
    localStorage.setItem('dg_sound', S.sound ? 'on' : 'off');
    el('btnSound').innerHTML = icon(S.sound ? 'sound' : 'mute');
    if (S.sound) blip('click');
  });
  el('btnSound').innerHTML = icon(S.sound ? 'sound' : 'mute');
  el('btnRules').innerHTML = icon('map');
  el('btnLogout').innerHTML = icon('logout');
  el('deathClose').addEventListener('click', () => { el('deathVeil').classList.add('hidden'); if (S.state) openReport(S.state.lastReport || { day: 0, summary: '你留在了沙里。', advice: '数据保留，可用于复盘。', consumed: {}, balance: {}, purchases: {} }); });

  /* ---------------- 启动 ---------------- */

  async function boot() {
    try {
      const me = await DG.api('/api/auth/me');
      const isTeam = me.team || (me.user && me.user.role === 'PLAYER');
      if (!isTeam) { location.href = '/?role=team'; return; }
      S.socket = DG.connectSocket((evt, payload) => {
        if (evt === 'connect') { loadState(true); }
        if (evt === 'disconnect') { if (S.state) renderGame(S.state); }
        if (evt === 'refresh' || evt === 'dayStart' || evt === 'phase' || evt === 'dayEnd' || evt === 'ended') {
          if (evt === 'dayStart') { sessionStorage.removeItem(`dg_report_${S.state ? S.state.session.id : ''}_${payload && payload.day}`); }
          loadState(true);
        }
      });
      await loadState();
    } catch (err) {
      DG.toast(err.message, 'warn');
    }
    setInterval(() => { if (!document.hidden) loadState(true); }, 6000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) loadState(true); });
  }

  boot();
})();
