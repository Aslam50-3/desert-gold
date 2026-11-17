/* 通用前端工具：请求、格式化、图标、吐司、socket */
(function () {
  const ICONS = {
    water: '<path d="M12 3.5c3.4 4 5 6.4 5 8.9A5 5 0 0 1 7 12.4c0-2.5 1.6-4.9 5-8.9Z"/><path d="M9.6 13.4c0 1.4 1 2.5 2.4 2.6"/>',
    food: '<path d="M4 11h16a8 8 0 0 1-16 0Z"/><path d="M7 7.5c0-1.4 1.2-2.2 1.2-3.5M12 7.5c0-1.6 1.2-2.4 1.2-4M17 7.5c0-1.2 1-1.9 1-3"/>',
    gold: '<path d="M12 3.2 15.4 8l-3.4 4.3L8.6 8Z"/><path d="M7.4 13.4 11 17l-3.6 3.6L3.8 17Z"/><path d="M16.6 13.4 20.2 17l-3.6 3.6L13 17Z"/>',
    tent: '<path d="M12 4 3.5 19h17Z"/><path d="M12 4v15"/><path d="M8.6 19l3.4-6 3.4 6"/>',
    compass: '<circle cx="12" cy="12" r="8.5"/><path d="M15.5 8.5 10 10l-2 5.5L13.5 14Z"/>',
    cash: '<rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.6"/><path d="M6.5 12h.01M17.5 12h.01"/>',
    weight: '<path d="M5 8h14l2 12H3Z"/><path d="M9 8a3 3 0 1 1 6 0"/>',
    base: '<path d="M3.5 20h17"/><path d="M6 20V10l6-5 6 5v10"/><path d="M10 20v-6h4v6"/>',
    desert: '<path d="M2 18c3-6 6-9 9-9s6 3 9 9"/><path d="M2 18h20"/><path d="M15 9.5c1.4-1.6 3-2.2 4.5-2"/>',
    village: '<path d="M3 20V12l4-3v11"/><path d="M9 20V9l4-3 4 3v11"/><path d="M17 20v-6l4-2v8"/><path d="M2 20h20"/>',
    oasis: '<path d="M12 20V10"/><path d="M12 12c-3-1-4.6-3.4-4.4-6 3 .4 4.4 2.6 4.4 6Z"/><path d="M12 13c3.2-.8 5-3 4.8-6-3 .2-4.8 2.6-4.8 6Z"/>',
    tomb: '<path d="M6 20V11a6 6 0 0 1 12 0v9"/><path d="M4 20h16"/><path d="M12 8v4M10.4 10h3.2"/>',
    mountain: '<path d="M2 18.5 9 6l4 7 2-3 5 8.5Z"/><path d="M2 18.5h20"/><path d="M9 6l2 3.4"/>',
    storm: '<path d="M4 8h9a3 3 0 1 0-3-3"/><path d="M3 12h14a3 3 0 1 1-3 3"/><path d="M5 16h7"/>',
    heat: '<circle cx="12" cy="12" r="4.2"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.5 1.5M16.9 16.9l1.5 1.5M18.4 5.6l-1.5 1.5M7.1 16.9l-1.5 1.5"/>',
    sunny: '<circle cx="12" cy="12" r="4"/><path d="M12 3.5v1.8M12 18.7v1.8M3.5 12h1.8M18.7 12h1.8M6 6l1.3 1.3M16.7 16.7l1.3 1.3M18 6l-1.3 1.3M7.3 16.7L6 18"/>',
    skull: '<path d="M12 3.5c4.4 0 7.2 2.8 7.2 6.6 0 2.3-1.1 3.7-2.6 4.7v2.7H7.4v-2.7c-1.5-1-2.6-2.4-2.6-4.7C4.8 6.3 7.6 3.5 12 3.5Z"/><circle cx="9.6" cy="10.6" r="1.2"/><circle cx="14.4" cy="10.6" r="1.2"/><path d="M10.6 14h2.8"/>',
    crown: '<path d="M4 8l3.5 3L12 5l4.5 6L20 8l-1.5 9h-13Z"/><path d="M5.5 20h13"/>',
    pick: '<path d="M4 20l8-8"/><path d="M9 15c-1.6-3.4.2-7.4 3.6-9"/><path d="M13.4 4.6c2.6 1 3.6 3.4 3 6.4"/><path d="M6.2 17.8l-2.4-2.4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    mute: '<path d="M4 9.5h3l4-3.5v12L7 14.5H4Z"/><path d="M15.5 9.5 20 14M20 9.5 15.5 14"/>',
    sound: '<path d="M4 9.5h3l4-3.5v12L7 14.5H4Z"/><path d="M14 8.5c1.6 1.8 1.6 5.2 0 7M16.6 6c2.8 3.2 2.8 8.8 0 12"/>',
    logout: '<path d="M14 4h5v16h-5"/><path d="M3 12h11"/><path d="M11 8.5 14.5 12 11 15.5"/>',
    user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.8 20c.6-3.8 3.4-6 7.2-6s6.6 2.2 7.2 6"/>',
    play: '<path d="M8 5.5 19 12 8 18.5Z"/>',
    pause: '<path d="M9 6v12M15 6v12"/>',
    bolt: '<path d="M13 3 6 13h4l-1 8 7-10h-4l1-8Z"/>',
    arrow: '<path d="M5 12h13"/><path d="M13 7.5 17.5 12 13 16.5"/>',
    check: '<path d="M4.5 12.5 9.5 17.5 19.5 6.5"/>',
    x: '<path d="M6 6 18 18M18 6 6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>',
    gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 3.5v2M12 18.5v2M3.5 12h2M18.5 12h2M6 6l1.4 1.4M16.6 16.6l1.4 1.4M18 6l-1.4 1.4M7.4 16.6 6 18"/>',
    map: '<path d="M3 6.5 9 4l6 2.5 6-2.5v13l-6 2.5-6-2.5-6 2.5Z"/><path d="M9 4v13M15 6.5v13"/>',
  };

  function icon(name, cls) {
    const p = ICONS[name] || ICONS.bolt;
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"${cls ? ` class="${cls}"` : ''}>${p}</svg>`;
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options,
    });
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch (err) { data = { error: text }; }
    if (!res.ok) {
      const err = new Error((data && data.error) || `请求失败 (${res.status})`);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  const fmt = {
    int: (n) => (Number.isFinite(Number(n)) ? Number(n).toLocaleString('zh-CN') : '—'),
    money: (n) => `¥${Math.round(Number(n) || 0).toLocaleString('zh-CN')}`,
    pct: (n) => `${Math.round((Number(n) || 0) * 100)}%`,
    mmss: (ms) => {
      const total = Math.max(0, Math.ceil(ms / 1000));
      const m = Math.floor(total / 60);
      const s = total % 60;
      return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    },
    hhmmss: (ms) => {
      const total = Math.max(0, Math.ceil(ms / 1000));
      const h = Math.floor(total / 3600);
      const m = Math.floor((total % 3600) / 60);
      const s = total % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    },
    date: (iso) => {
      if (!iso) return '—';
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return '—';
      return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    },
  };

  const PHASE = {
    IDLE: '待开营',
    PREP: '准备阶段',
    BRIEF: '天气播报',
    ACTION: '行动窗口',
    SETTLING: '沙盘结算中',
    REPORT: '日报时间',
    ENDED: '本局结束',
  };

  const TYPE_LABEL = { BASE: '大本营', DESERT: '沙漠', VILLAGE: '村庄', OASIS: '绿洲', TOMB: '古墓', MOUNTAIN: '藏宝山' };
  const TYPE_ICON = { BASE: 'base', DESERT: 'desert', VILLAGE: 'village', OASIS: 'oasis', TOMB: 'tomb', MOUNTAIN: 'mountain' };
  const W_ICON = { SUNNY: 'sunny', HEAT: 'heat', STORM: 'storm', STORM_HEAT: 'storm' };
  const W_SHORT = { SUNNY: '晴', HEAT: '高温', STORM: '沙尘', STORM_HEAT: '沙暴+高温' };

  function toast(text, level = 'info', ms = 4200) {
    let box = document.querySelector('.toasts');
    if (!box) {
      box = document.createElement('div');
      box.className = 'toasts';
      document.body.appendChild(box);
    }
    const el = document.createElement('div');
    el.className = `toast ${level}`;
    el.textContent = text;
    box.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity .3s, transform .3s';
      el.style.opacity = '0';
      el.style.transform = 'translateY(-6px)';
      setTimeout(() => el.remove(), 320);
    }, ms);
  }

  function connectSocket(on) {
    if (typeof io === 'function') {
      const socket = io({ withCredentials: true });
      socket.on('connect', () => on && on('connect', socket));
      socket.on('disconnect', () => on && on('disconnect'));
      socket.on('game:toast', (p) => toast(p.text, p.level || 'info'));
      socket.on('game:refresh', () => on && on('refresh'));
      socket.on('game:dayStart', (p) => on && on('dayStart', p));
      socket.on('game:phase', (p) => on && on('phase', p));
      socket.on('game:dayEnd', (p) => on && on('dayEnd', p));
      socket.on('team:report', (p) => on && on('report', p));
      socket.on('game:ended', (p) => on && on('ended', p));
      return socket;
    }
    // Cloudflare 版：没有 Socket.IO，用 DO 原生 WebSocket，事件名保持一致
    const handlers = {};
    const api = {
      connected: false,
      on(event, fn) {
        (handlers[event] = handlers[event] || []).push(fn);
        return api;
      },
      close() {
        stopped = true;
        try { if (ws) ws.close(); } catch (e) { /* noop */ }
      },
    };
    let ws = null;
    let stopped = false;
    let retry = null;
    const emit = (event, payload) => (handlers[event] || []).forEach((fn) => fn(payload));
    api.on('game:toast', (p) => toast(p.text, p.level || 'info'));
    api.on('game:refresh', () => on && on('refresh'));
    api.on('game:dayStart', (p) => on && on('dayStart', p));
    api.on('game:phase', (p) => on && on('phase', p));
    api.on('game:dayEnd', (p) => on && on('dayEnd', p));
    api.on('team:report', (p) => on && on('report', p));
    api.on('game:ended', (p) => on && on('ended', p));

    const open = () => {
      if (stopped) return;
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      ws = new WebSocket(`${proto}//${location.host}/ws`);
      ws.onopen = () => {
        api.connected = true;
        emit('connect');
        on && on('connect', api);
      };
      ws.onclose = () => {
        api.connected = false;
        on && on('disconnect');
        if (!stopped) retry = setTimeout(open, 3000);
      };
      ws.onerror = () => { /* 断线由 onclose 统一重连 */ };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg && msg.event) emit(msg.event, msg.payload || {});
        } catch (e) { /* 忽略非 JSON 帧 */ }
      };
    };
    open();
    return api;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  window.DG = { api, fmt, icon, toast, connectSocket, PHASE, TYPE_LABEL, TYPE_ICON, W_ICON, W_SHORT, escapeHtml };
})();
