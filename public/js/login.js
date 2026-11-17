/* 登录页：夜色沙丘插画 + 表单逻辑 */
(function () {
  const canvas = document.getElementById('loginCanvas');
  const ctx = canvas.getContext('2d');
  const loginEl = document.getElementById('login');
  const form = document.getElementById('loginForm');
  const errEl = document.getElementById('loginErr');
  const btn = document.getElementById('loginBtn');
  const roleParam = new URLSearchParams(location.search).get('role');
  let mode = roleParam === 'admin' ? 'admin' : 'player';
  let W = 0;
  let H = 0;
  const parts = [];
  const t0 = performance.now();

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    W = rect.width; H = rect.height;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!parts.length) {
      for (let i = 0; i < 110; i += 1) {
        parts.push({ x: Math.random() * W, y: Math.random() * H, v: 6 + Math.random() * 24, s: Math.random() * 1.6 + 0.3, r: Math.random() * 6 });
      }
    }
  }

  const stars = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random() * 0.55, r: Math.random() * 1.1 + 0.2, a: Math.random() * 0.5 + 0.15 }));

  function dune(y, amp, phase, color, rim) {
    ctx.beginPath();
    ctx.moveTo(-10, y);
    for (let x = 0; x <= W + 40; x += 26) {
      const yy = y + Math.sin(x * 0.007 + phase) * amp + Math.sin(x * 0.019 + phase * 2) * amp * 0.42;
      ctx.lineTo(x, yy);
    }
    // 沙脊受光：一条极细的金线，比整块渐变更像真沙丘
    ctx.strokeStyle = rim;
    ctx.lineWidth = 1.1;
    ctx.stroke();
    ctx.lineTo(W + 40, H + 10);
    ctx.lineTo(-10, H + 10);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function frame(now) {
    const t = (now - t0) / 1000;
    ctx.clearRect(0, 0, W, H);

    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#050403');
    sky.addColorStop(0.32, '#0d0a06');
    sky.addColorStop(0.55, '#2b1c0c');
    sky.addColorStop(0.66, '#5a3a15');
    sky.addColorStop(0.74, '#241708');
    sky.addColorStop(1, '#070504');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // 星
    for (const s of stars) {
      const tw = 0.5 + 0.5 * Math.sin(t * 0.8 + s.x * 30);
      ctx.globalAlpha = s.a * (0.4 + 0.6 * tw);
      ctx.fillStyle = '#f6e7cb';
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * H, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // 地平线金光
    const hz = ctx.createRadialGradient(W * 0.62, H * 0.66, 0, W * 0.62, H * 0.66, W * 0.62);
    hz.addColorStop(0, 'rgba(255,196,110,0.55)');
    hz.addColorStop(0.22, 'rgba(231,177,92,0.28)');
    hz.addColorStop(0.5, 'rgba(196,140,66,0.10)');
    hz.addColorStop(1, 'rgba(231,177,92,0)');
    ctx.fillStyle = hz;
    ctx.fillRect(0, 0, W, H);

    // 沙丘三层
    dune(H * 0.70, 18, t * 0.02, '#1b1409', 'rgba(231,177,92,0.10)');
    dune(H * 0.80, 26, 1.6 + t * 0.03, '#100c07', 'rgba(231,177,92,0.18)');
    dune(H * 0.91, 18, 3.2 + t * 0.04, '#080605', 'rgba(231,177,92,0.24)');

    // 山脊上的孤影（带长影，像被夕阳压扁的人）
    const gx = W * 0.68;
    const gy = H * 0.80 + Math.sin(gx * 0.007 + 1.6) * 26 + Math.sin(gx * 0.019 + 3.2) * 10.9;
    ctx.strokeStyle = 'rgba(231,177,92,0.22)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(gx + 4, gy + 2);
    ctx.lineTo(gx + 68, gy + 22);
    ctx.stroke();
    ctx.fillStyle = '#040303';
    ctx.beginPath();
    ctx.arc(gx, gy - 30, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(gx - 3.5, gy - 25, 7, 26);
    ctx.beginPath();
    ctx.moveTo(gx + 2, gy - 20);
    ctx.lineTo(gx + 21, gy - 5);
    ctx.lineTo(gx + 18, gy);
    ctx.lineTo(gx + 1, gy - 14);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(gx - 2, gy - 20);
    ctx.lineTo(gx - 16, gy - 8);
    ctx.lineTo(gx - 14, gy - 5);
    ctx.lineTo(gx - 1, gy - 15);
    ctx.fill();

    // 风沙
    for (const p of parts) {
      p.x += p.v;
      p.y -= p.v * 0.12;
      if (p.x > W + 10) { p.x = -10; p.y = Math.random() * H; }
      ctx.globalAlpha = 0.10 + Math.random() * 0.12;
      ctx.strokeStyle = '#e7c79a';
      ctx.lineWidth = p.s;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - p.r * 5, p.y + p.r);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);

  function setMode(next) {
    mode = next;
    loginEl.dataset.mode = mode;
    document.querySelectorAll('.login-tabs button').forEach((x) => x.classList.toggle('on', x.dataset.tab === mode));
    document.getElementById('username').placeholder = mode === 'admin' ? '管理员账号' : '队名账号，如 team01';
    errEl.textContent = '';
  }

  document.querySelectorAll('.login-tabs button').forEach((b) => {
    b.addEventListener('click', () => setMode(b.dataset.tab));
  });
  setMode(mode);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.textContent = '';
    btn.disabled = true;
    btn.textContent = '正在进入…';
    try {
      const res = await DG.api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({
          username: document.getElementById('username').value.trim(),
          password: document.getElementById('password').value,
          mode,
        }),
      });
      if (res.role === 'ADMIN') {
        location.href = '/admin';
      } else {
        location.href = '/play';
      }
    } catch (err) {
      errEl.textContent = err.message;
      btn.disabled = false;
      btn.textContent = '进入沙漠';
      document.getElementById('password').select();
    }
  });

  DG.api('/api/auth/me').then((r) => {
    const q = new URLSearchParams(location.search).get('role');
    const isAdmin = r.admin || (r.user && r.user.role === 'ADMIN');
    const isTeam = r.team || (r.user && r.user.role === 'PLAYER');
    if (q === 'admin') { if (isAdmin) location.href = '/admin'; return; }
    if (q === 'team') { if (isTeam) location.href = '/play'; return; }
    // 经理与队伍各用一枚 Cookie：只有一个身份时直接进对应界面，两个都在时留在选择页。
    if (isAdmin && !isTeam) location.href = '/admin';
    else if (isTeam && !isAdmin) location.href = '/play';
  }).catch(() => {});
})();
