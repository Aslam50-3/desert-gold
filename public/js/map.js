/* Canvas 2D 沙盘渲染层：沙丘 / 节点 / 队伍棋子 / 沙尘 / 金粒 */
(function () {
  const C = {
    sand: '#e7b15c',
    amber: '#f4a259',
    teal: '#3fe0c8',
    blood: '#ff5252',
    bone: '#f2e9db',
    dim: '#6f6455',
    line: 'rgba(231,177,92,0.22)',
    desert: '#8a7657',
    tomb: '#9a93a8',
  };

  const TYPE_COLOR = {
    BASE: C.sand,
    DESERT: C.desert,
    VILLAGE: C.amber,
    OASIS: C.teal,
    TOMB: C.tomb,
    MOUNTAIN: '#ffd27a',
  };

  function hash(n) {
    let x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  class DesertMap {
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.opts = opts;
      this.nodes = [];
      this.edges = [];
      this.teams = [];
      this.selfId = null;
      this.currentId = null;
      this.hover = null;
      this.anims = new Map();
      this.particles = [];
      this.storm = 0;
      this.stormTarget = 0;
      this.heat = 0;
      this.heatTarget = 0;
      this.shake = 0;
      this.zoom = 1;
      this.zoomTarget = 1;
      this.t0 = performance.now();
      this.palette = TYPE_COLOR;
      this._bind();
      this._resize();
      this._loop = this._loop.bind(this);
      requestAnimationFrame(this._loop);
      if (window.ResizeObserver) new ResizeObserver(() => this._resize()).observe(canvas.parentElement || canvas);
      window.addEventListener('resize', () => this._resize());
    }

    _bind() {
      this.canvas.addEventListener('mousemove', (e) => {
        const p = this._pos(e);
        this.hover = this._hit(p.x, p.y);
        this.canvas.style.cursor = this.hover && this.isNeighbor(this.hover) ? 'pointer' : 'default';
      });
      this.canvas.addEventListener('mouseleave', () => { this.hover = null; });
      this.canvas.addEventListener('click', (e) => {
        const p = this._pos(e);
        const n = this._hit(p.x, p.y);
        if (n && this.opts.onNodeClick) this.opts.onNodeClick(n.id);
      });
    }

    _pos(e) {
      const r = this.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    _resize() {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      this.w = Math.max(320, rect.width);
      this.h = Math.max(240, rect.height);
      this.canvas.width = Math.round(this.w * dpr);
      this.canvas.height = Math.round(this.h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this._computeProjection();
      this._buildBackdrop();
    }

    _computeProjection() {
      if (!this.nodes.length) return;
      const pad = 0.55;
      const minX = Math.min(...this.nodes.map((n) => n.x)) - pad;
      const maxX = Math.max(...this.nodes.map((n) => n.x)) + pad;
      const minY = Math.min(...this.nodes.map((n) => n.y)) - pad;
      const maxY = Math.max(...this.nodes.map((n) => n.y)) + pad;
      const bw = maxX - minX;
      const bh = maxY - minY;
      this.minX = minX; this.minY = minY; this.bw = bw; this.bh = bh;
      const s = Math.min(this.w / bw, this.h / bh);
      this.scale = s;
      this.ox = (this.w - bw * s) / 2;
      this.oy = (this.h - bh * s) / 2;
    }

    project(n) {
      return {
        x: this.ox + (n.x - this.minX) * this.scale,
        y: this.oy + (n.y - this.minY) * this.scale,
      };
    }

    setData({ nodes, edges, teams, selfId, currentId }) {
      const first = !this.nodes.length;
      this.nodes = nodes || [];
      this.edges = edges || [];
      this.teams = teams || [];
      this.selfId = selfId || this.selfId;
      this.currentId = currentId || null;
      if (first) { this._computeProjection(); this._buildBackdrop(); }
    }

    isNeighbor(id) {
      const self = this.teams.find((t) => t.id === this.selfId);
      if (!self) return false;
      return this.adj && this.adj.get(self.nodeId) && this.adj.get(self.nodeId).has(id);
    }

    nodeById(id) {
      return this.nodes.find((n) => n.id === id);
    }

    _hit(x, y) {
      let best = null;
      let bestD = 30;
      for (const n of this.nodes) {
        const p = this.project(n);
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bestD) { bestD = d; best = n; }
      }
      return best;
    }

    _buildAdj() {
      const adj = new Map();
      for (const n of this.nodes) adj.set(n.id, new Set());
      for (const e of this.edges) {
        if (!adj.has(e.fromId) || !adj.has(e.toId)) continue;
        adj.get(e.fromId).add(e.toId);
        adj.get(e.toId).add(e.fromId);
      }
      this.adj = adj;
    }

    _buildBackdrop() {
      this._buildAdj();
      const off = document.createElement('canvas');
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      off.width = this.w * dpr;
      off.height = this.h * dpr;
      const g = off.getContext('2d');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);

      // 底色
      const bg = g.createRadialGradient(this.w * 0.5, this.h * 0.42, 40, this.w * 0.5, this.h * 0.5, Math.max(this.w, this.h) * 0.85);
      bg.addColorStop(0, '#171208');
      bg.addColorStop(0.45, '#0d0b08');
      bg.addColorStop(1, '#050403');
      g.fillStyle = bg;
      g.fillRect(0, 0, this.w, this.h);

      // 沙丘等高线：用有多层贝塞尔的地形线，弱对比，只做质感
      for (let layer = 0; layer < 7; layer += 1) {
        const yBase = this.h * (0.16 + layer * 0.12);
        g.beginPath();
        g.moveTo(-20, yBase + hash(layer) * 30);
        for (let i = 0; i <= 8; i += 1) {
          const x = (this.w / 8) * i;
          const y = yBase + Math.sin(i * 1.3 + layer) * 14 + hash(layer * 9 + i) * 22;
          g.lineTo(x, y);
        }
        g.strokeStyle = `rgba(231,177,92,${0.028 + layer * 0.004})`;
        g.lineWidth = 1;
        g.stroke();
      }

      // 沙金光晕
      const glow = g.createRadialGradient(this.w * 0.55, this.h * 0.38, 10, this.w * 0.55, this.h * 0.38, this.w * 0.55);
      glow.addColorStop(0, 'rgba(231,177,92,0.13)');
      glow.addColorStop(0.5, 'rgba(231,177,92,0.04)');
      glow.addColorStop(1, 'rgba(231,177,92,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, this.w, this.h);

      // 暗角
      const vg = g.createRadialGradient(this.w * 0.5, this.h * 0.5, Math.min(this.w, this.h) * 0.35, this.w * 0.5, this.h * 0.5, Math.max(this.w, this.h) * 0.78);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.72)');
      g.fillStyle = vg;
      g.fillRect(0, 0, this.w, this.h);
      this.backdrop = off;
    }

    /* ---------------- 交互效果 ---------------- */

    playMove(teamId, fromId, toId) {
      const from = this.nodeById(fromId);
      const to = this.nodeById(toId);
      if (!from || !to) return;
      this.anims.set(teamId, { from, to, start: performance.now(), dur: 780 });
      this.zoomTarget = 1.025;
      const p0 = this.project(from);
      this._dust(p0.x, p0.y, 16);
      setTimeout(() => {
        const p1 = this.project(to);
        this._dust(p1.x, p1.y, 22);
        this.zoomTarget = 1;
      }, 760);
    }

    burstGold(nodeId) {
      const n = this.nodeById(nodeId);
      if (!n) return;
      const p = this.project(n);
      for (let i = 0; i < 26; i += 1) {
        const a = Math.random() * Math.PI * 2;
        const v = 40 + Math.random() * 120;
        this.particles.push({
          x: p.x, y: p.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40,
          life: 1, size: 1.5 + Math.random() * 2.4, color: i % 3 ? '#e7b15c' : '#ffe6ad', gold: true,
        });
      }
    }

    setStorm(on) { this.stormTarget = on ? 1 : 0; if (on) this.shake = 1; }
    setHeat(on) { this.heatTarget = on ? 1 : 0; }

    _dust(x, y, n) {
      for (let i = 0; i < n; i += 1) {
        const a = Math.random() * Math.PI * 2;
        const v = 8 + Math.random() * 34;
        this.particles.push({
          x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.6 - 6,
          life: 1, size: 1 + Math.random() * 2, color: 'rgba(214,178,120,0.7)',
        });
      }
    }

    /* ---------------- 绘制 ---------------- */

    _loop(now) {
      const ctx = this.ctx;
      const dt = Math.min(0.05, (now - this.t0) / 1000 || 0.016);
      this.t0 = now;
      const t = now / 1000;

      this.storm += (this.stormTarget - this.storm) * Math.min(1, dt * 4);
      this.heat += (this.heatTarget - this.heat) * Math.min(1, dt * 4);
      this.zoom += (this.zoomTarget - this.zoom) * Math.min(1, dt * 4);
      if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 1.4);

      const sx = (Math.random() - 0.5) * 9 * this.shake;
      const sy = (Math.random() - 0.5) * 7 * this.shake;

      ctx.clearRect(0, 0, this.w, this.h);
      ctx.save();
      ctx.translate(this.w / 2 + sx, this.h / 2 + sy);
      ctx.scale(this.zoom, this.zoom);
      ctx.translate(-this.w / 2, -this.h / 2);

      if (this.backdrop) ctx.drawImage(this.backdrop, 0, 0, this.w, this.h);

      this._drawEdges(t);
      this._drawNodes(t);
      this._drawTeams(t, now);
      this._drawParticles(dt);

      ctx.restore();

      if (this.heat > 0.01) this._drawHeat();
      if (this.storm > 0.01) this._drawStorm(dt, t);

      requestAnimationFrame(this._loop);
    }

    _drawEdges(t) {
      const ctx = this.ctx;
      const self = this.teams.find((x) => x.id === this.selfId);
      ctx.lineCap = 'round';
      for (const e of this.edges) {
        const a = this.nodeById(e.fromId);
        const b = this.nodeById(e.toId);
        if (!a || !b) continue;
        const pa = this.project(a);
        const pb = this.project(b);
        const near = self && (self.nodeId === e.fromId || self.nodeId === e.toId);
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.setLineDash([6, 10]);
        ctx.lineDashOffset = -((t * 22) % 16);
        ctx.strokeStyle = near ? 'rgba(231,177,92,0.42)' : 'rgba(231,177,92,0.13)';
        ctx.lineWidth = near ? 1.6 : 1;
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    _drawNodes(t) {
      const ctx = this.ctx;
      const self = this.teams.find((x) => x.id === this.selfId);
      for (const n of this.nodes) {
        const p = this.project(n);
        const color = this.palette[n.type] || C.desert;
        const isSelfHere = self && self.nodeId === n.id;
        const isNeighbor = self && this.adj && this.adj.get(self.nodeId) && this.adj.get(self.nodeId).has(n.id);
        const isHover = this.hover && this.hover.id === n.id;
        const r = n.type === 'BASE' || n.type === 'MOUNTAIN' ? 19 : 15;

        // 光晕
        const pulse = 0.5 + 0.5 * Math.sin(t * 1.6 + n.x + n.y);
        const halo = ctx.createRadialGradient(p.x, p.y, r * 0.4, p.x, p.y, r * 2.6);
        halo.addColorStop(0, this._alpha(color, 0.22 + 0.12 * pulse));
        halo.addColorStop(1, this._alpha(color, 0));
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r * 2.6, 0, Math.PI * 2);
        ctx.fill();

        // 可走节点：旋转虚线环
        if (isNeighbor) {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(t * 0.6);
          ctx.beginPath();
          ctx.setLineDash([4, 6]);
          ctx.arc(0, 0, r + 8, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(231,177,92,0.55)';
          ctx.lineWidth = 1.2;
          ctx.stroke();
          ctx.restore();
          ctx.setLineDash([]);
        }

        // 本体
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = isHover ? '#221a10' : '#100d09';
        ctx.fill();
        ctx.strokeStyle = isSelfHere ? C.bone : this._alpha(color, isNeighbor ? 0.95 : 0.6);
        ctx.lineWidth = isSelfHere ? 2 : 1.2;
        ctx.stroke();

        // 类型图形
        ctx.strokeStyle = this._alpha(color, 0.9);
        ctx.fillStyle = this._alpha(color, 0.16);
        ctx.lineWidth = 1.3;
        this._glyph(ctx, n.type, p.x, p.y, r * 0.52);

        // 名称
        ctx.font = '600 9.5px ui-monospace, Menlo, Consolas, monospace';
        ctx.fillStyle = n.type === 'BASE' || n.type === 'MOUNTAIN' ? 'rgba(242,233,219,0.92)' : 'rgba(226,214,193,0.55)';
        ctx.textAlign = 'center';
        const label = n.name;
        ctx.fillText(label, p.x, p.y + r + 13);
      }
    }

    _drawTeams(t, now) {
      const ctx = this.ctx;
      const byNode = new Map();
      for (const team of this.teams) {
        if (!team.nodeId) continue;
        if (!byNode.has(team.nodeId)) byNode.set(team.nodeId, []);
        byNode.get(team.nodeId).push(team);
      }
      for (const [nodeId, list] of byNode.entries()) {
        const node = this.nodeById(nodeId);
        if (!node) continue;
        const base = this.project(node);
        list.forEach((team, i) => {
          const anim = this.anims.get(team.id);
          let x = base.x;
          let y = base.y;
          if (anim) {
            const k = Math.min(1, (now - anim.start) / anim.dur);
            const ease = 1 - Math.pow(1 - k, 3);
            const a = this.project(anim.from);
            const b = this.project(anim.to);
            const cx = (a.x + b.x) / 2;
            const cy = (a.y + b.y) / 2 - Math.min(70, Math.hypot(b.x - a.x, b.y - a.y) * 0.32);
            x = (1 - ease) * (1 - ease) * a.x + 2 * (1 - ease) * ease * cx + ease * ease * b.x;
            y = (1 - ease) * (1 - ease) * a.y + 2 * (1 - ease) * ease * cy + ease * ease * b.y;
            if (k >= 1) this.anims.delete(team.id);
          }
          const n = list.length;
          let offX = 0;
          let offY = -27;
          if (n > 4) {
            // 多人同格：围成一圈，而不是叠成一排
            const ang = -Math.PI / 2 + (i * Math.PI * 2) / n;
            const rad = 22 + n * 2.4;
            offX = Math.cos(ang) * rad;
            offY = Math.sin(ang) * rad * 0.7 - 6;
          } else if (n > 1) {
            const stack = i - (n - 1) / 2;
            offX = stack * 21;
            offY = -24 - Math.abs(stack) * 2;
          }
          const isSelf = team.id === this.selfId;
          const px = x + offX;
          const py = y + offY;

          // 引线
          ctx.beginPath();
          ctx.moveTo(base.x, base.y - 4);
          ctx.lineTo(px, py + 8);
          ctx.strokeStyle = this._alpha(team.color, 0.35);
          ctx.lineWidth = 1;
          ctx.stroke();

          const size = isSelf ? 8.5 : 7;
          if (isSelf) {
            const g = ctx.createRadialGradient(px, py, 2, px, py, 22);
            g.addColorStop(0, this._alpha(team.color, 0.4));
            g.addColorStop(1, this._alpha(team.color, 0));
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.arc(px, py, 22, 0, Math.PI * 2);
            ctx.fill();
          }
          ctx.save();
          ctx.translate(px, py);
          ctx.rotate(Math.PI / 4);
          ctx.fillStyle = team.color;
          ctx.globalAlpha = team.status === 'DEAD' ? 0.35 : 1;
          ctx.fillRect(-size / 2, -size / 2, size, size);
          ctx.restore();
          ctx.globalAlpha = 1;

          if (n <= 4 || isSelf) {
            ctx.font = '700 9px ui-monospace, Menlo, Consolas, monospace';
            ctx.fillStyle = this._alpha(team.color, 0.95);
            ctx.textAlign = 'center';
            ctx.fillText(team.name.slice(0, 6), px, py - 12);
          }
        });
      }
    }

    _drawParticles(dt) {
      const ctx = this.ctx;
      for (let i = this.particles.length - 1; i >= 0; i -= 1) {
        const p = this.particles[i];
        p.life -= dt * (p.gold ? 0.9 : 1.3);
        if (p.life <= 0) { this.particles.splice(i, 1); continue; }
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += (p.gold ? 90 : 26) * dt;
        p.vx *= 0.97;
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    _drawStorm(dt, t) {
      const ctx = this.ctx;
      const a = this.storm;
      if (!this._stormParts) {
        this._stormParts = Array.from({ length: 160 }, () => ({
          x: Math.random() * this.w,
          y: Math.random() * this.h,
          v: 220 + Math.random() * 420,
          l: 8 + Math.random() * 34,
          s: Math.random() * 1.4 + 0.4,
        }));
      }
      ctx.save();
      ctx.globalAlpha = 0.16 * a;
      ctx.fillStyle = '#c4853a';
      ctx.fillRect(0, 0, this.w, this.h);
      ctx.globalAlpha = 0.5 * a;
      ctx.strokeStyle = 'rgba(255,226,178,0.55)';
      ctx.lineWidth = 1;
      for (const p of this._stormParts) {
        p.x += p.v * dt;
        p.y += p.v * 0.22 * dt;
        if (p.x > this.w + 40) { p.x = -40; p.y = Math.random() * this.h; }
        if (p.y > this.h + 20) p.y = -10;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x - p.l, p.y - p.l * 0.18);
        ctx.stroke();
      }
      ctx.restore();
    }

    _drawHeat() {
      const ctx = this.ctx;
      const a = 0.34 * this.heat;
      const g = ctx.createRadialGradient(this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.45, this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.8);
      g.addColorStop(0, 'rgba(255,120,60,0)');
      g.addColorStop(1, `rgba(255,96,40,${a})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, this.w, this.h);
    }

    _glyph(ctx, type, x, y, r) {
      ctx.save();
      ctx.translate(x, y);
      const s = r;
      if (type === 'BASE') {
        ctx.beginPath();
        ctx.moveTo(-s, s * 0.7);
        ctx.lineTo(0, -s * 0.75);
        ctx.lineTo(s, s * 0.7);
        ctx.closePath();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.75);
        ctx.lineTo(0, s * 0.1);
        ctx.stroke();
      } else if (type === 'MOUNTAIN') {
        ctx.beginPath();
        ctx.moveTo(-s, s * 0.65);
        ctx.lineTo(-s * 0.2, -s * 0.8);
        ctx.lineTo(s * 0.15, s * 0.1);
        ctx.lineTo(s * 0.5, -s * 0.35);
        ctx.lineTo(s, s * 0.65);
        ctx.closePath();
        ctx.stroke();
        ctx.fill();
      } else if (type === 'VILLAGE') {
        ctx.beginPath();
        ctx.moveTo(-s * 0.9, s * 0.6);
        ctx.lineTo(-s * 0.9, -s * 0.1);
        ctx.lineTo(-s * 0.25, -s * 0.55);
        ctx.lineTo(s * 0.4, -s * 0.1);
        ctx.lineTo(s * 0.4, s * 0.6);
        ctx.closePath();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(s * 0.4, s * 0.6);
        ctx.lineTo(s * 0.4, s * 0.05);
        ctx.lineTo(s, s * 0.05);
        ctx.stroke();
      } else if (type === 'OASIS') {
        ctx.beginPath();
        ctx.moveTo(0, s * 0.8);
        ctx.lineTo(0, -s * 0.7);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, s * 0.1);
        ctx.quadraticCurveTo(-s, -s * 0.1, -s * 0.9, -s * 0.8);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, s * 0.2);
        ctx.quadraticCurveTo(s, s, s * 0.9, -s * 0.7);
        ctx.stroke();
      } else if (type === 'TOMB') {
        ctx.beginPath();
        ctx.moveTo(-s * 0.7, s * 0.8);
        ctx.lineTo(-s * 0.7, -s * 0.1);
        ctx.arc(0, -s * 0.1, s * 0.7, Math.PI, 0);
        ctx.lineTo(s * 0.7, s * 0.8);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.2);
        ctx.lineTo(0, s * 0.35);
        ctx.stroke();
      } else {
        // DESERT
        ctx.beginPath();
        ctx.moveTo(-s, s * 0.45);
        ctx.quadraticCurveTo(-s * 0.2, -s * 0.5, s * 0.9, s * 0.2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(-s * 0.8, s * 0.8);
        ctx.quadraticCurveTo(0, s * 0.1, s, s * 0.55);
        ctx.stroke();
      }
      ctx.restore();
    }

    _alpha(hex, a) {
      if (hex.startsWith('rgba')) return hex;
      const h = hex.replace('#', '');
      const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
      return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
    }
  }

  window.DesertMap = DesertMap;
})();
