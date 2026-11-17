/* 大屏：全员地图 / 金价榜 / 天候 / 播报 */
(function () {
  const S = { state: null, map: null, offset: 0, lastDay: 0 };
  const el = (id) => document.getElementById(id);
  const esc = DG.escapeHtml;
  const fmt = DG.fmt;

  const TYPE_COLOR = { BASE: '#e7b15c', DESERT: '#8a7657', VILLAGE: '#f4a259', OASIS: '#3fe0c8', TOMB: '#9a93a8', MOUNTAIN: '#ffd27a' };

  function phaseLabel(p) {
    return { IDLE: 'WAITING', PREP: 'PREPARE', BRIEF: 'WEATHER BRIEF', ACTION: 'ACTION WINDOW', SETTLING: 'SETTLING', REPORT: 'REPORT', ENDED: 'THE END' }[p] || p;
  }

  async function load() {
    try {
      const st = await DG.api('/api/screen/state');
      const prev = S.state;
      S.state = st;
      S.offset = Date.parse(st.serverNow) - Date.now();
      render(st, prev);
    } catch (err) {
      el('scPhase').textContent = 'NO SIGNAL';
    }
  }

  function render(st, prev) {
    el('scTitle').textContent = st.session.name || '沙漠掘金';
    el('scDay').textContent = st.session.currentDay;
    el('scTotal').textContent = st.session.totalDays;
    el('scPhase').textContent = phaseLabel(st.session.phase);

    // 地图
    if (!S.map) S.map = new DesertMap(el('screenCanvas'), {});
    const teams = st.teams.filter((t) => t.nodeId).map((t) => ({
      id: t.id, name: t.name, color: t.color, nodeId: t.nodeId, status: t.status,
    }));
    if (prev) {
      for (const t of teams) {
        const old = prev.teams.find((x) => x.id === t.id);
        if (old && old.nodeId && old.nodeId !== t.nodeId) S.map.playMove(t.id, old.nodeId, t.nodeId);
        if (old && t.gold > (old.gold || 0)) S.map.burstGold(t.nodeId);
      }
    }
    S.map.setData({ nodes: st.map.nodes, edges: st.map.edges, teams, selfId: null });

    const w = st.weatherToday || [];
    const storm = w.find((x) => x.terrain === 'DESERT');
    S.map.setStorm(Boolean(storm && (storm.weather === 'STORM' || storm.weather === 'STORM_HEAT')));
    S.map.setHeat(Boolean(w.find((x) => x.weather === 'HEAT' || x.weather === 'STORM_HEAT' && x.terrain === 'DESERT')));

    // 金价榜
    const board = (st.leaderboard || []).filter((b) => b.returned).sort((a, b) => (a.returnRank || 99) - (b.returnRank || 99));
    el('scReturned').textContent = `${board.length} 支`;
    el('scTop').innerHTML = board.slice(0, 5).map((b) => `
      <div class="r">
        <span class="rk">${String(b.returnRank || 0).padStart(2, '0')}</span>
        <span style="display:flex;align-items:center;gap:8px;min-width:0"><i style="width:8px;height:8px;border-radius:2px;transform:rotate(45deg);background:${esc(b.color)}"></i><span class="nm" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(b.name)}</span></span>
        <span class="num sand">${b.gold} 块 · ${fmt.money(b.net)}</span>
      </div>`).join('') || '<div class="dim" style="font-size:12px">还没有队伍归营。沙漠在等第一个回来的人。</div>';

    el('scWeather').innerHTML = w.map((x) => `
      <div class="w"><div class="t">${esc(x.label)}</div><div class="v" style="color:${x.weather === 'SUNNY' ? '#cbb894' : x.weather === 'HEAT' ? '#f4a259' : '#ff7070'}">${esc(x.weatherLabel)}</div></div>`).join('');

    const alive = st.teams.filter((t) => t.status !== 'DEAD').length;
    el('scAlive').textContent = `${alive} 支`;
    el('scTeams').innerHTML = st.teams.map((t) => `
      <div class="trow ${t.status === 'DEAD' ? 'dead' : ''}">
        <i style="width:8px;height:8px;border-radius:2px;transform:rotate(45deg);background:${esc(t.color)}"></i>
        <span class="nm">${esc(t.name)}</span>
        <span class="st">${t.status === 'DEAD' ? 'OUT' : t.status === 'RETURNED' ? `#${t.returnRank} 归营` : t.status === 'LOST' ? '迷路' : `${t.nodeId || '—'} · ${t.water}水 ${t.food}食`}</span>
      </div>`).join('');

    const items = st.broadcasts || [];
    const line = items.length ? items.map((b) => `<span>${esc(b.text)}</span>`).join('<span style="color:var(--line-strong)">·</span>') : '<span>沙盘正在进行。风把脚印一点点抹平。</span>';
    el('scTicker').innerHTML = line + line;

    updateClock();
    if (st.session.currentDay !== S.lastDay) { S.lastDay = st.session.currentDay; }
  }

  function updateClock() {
    const st = S.state;
    if (!st || !st.session.phaseEndsAt) { el('scClock').textContent = '--:--'; return; }
    const remain = Date.parse(st.session.phaseEndsAt) - (Date.now() + S.offset);
    el('scClock').textContent = remain > 0 ? fmt.mmss(remain) : '00:00';
    el('scClock').style.color = remain > 0 && remain < 31000 ? 'var(--blood)' : 'var(--sand)';
  }

  setInterval(updateClock, 1000);

  async function boot() {
    await load();
    DG.connectSocket((evt) => {
      if (['refresh', 'dayStart', 'phase', 'dayEnd', 'ended', 'report'].includes(evt)) load();
      if (evt === 'connect') load();
    });
    setInterval(() => { if (!document.hidden) load(); }, 4000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });
  }

  boot();
})();
