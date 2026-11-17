'use strict';
/**
 * Cloudflare 入口：API / WebSocket 交给同一个 Durable Object（单场沙盘），
 * 其余路径走静态资源；/play /admin /screen 这类无扩展名路径映射到对应 HTML。
 */
import { GameRoom } from './game.js';

export { GameRoom };

const PAGES = {
  '/': '/index.html',
  '/login': '/index.html',
  '/play': '/play.html',
  '/play/board': '/play.html',
  '/play/lobby': '/play.html',
  '/admin': '/admin.html',
  '/screen': '/screen.html',
  '/screen/board': '/screen.html',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/healthz') {
      return Response.json({ ok: true, time: new Date().toISOString(), runtime: 'cloudflare-workers' });
    }

    if (path === '/ws' || path.startsWith('/api/')) {
      const stub = env.GAME.get(env.GAME.idFromName('main'));
      return stub.fetch(request);
    }

    if (path === '/socket.io/socket.io.js') {
      // 页面统一引用了 Socket.IO 客户端；Cloudflare 版用 DO 原生 WebSocket，
      // 这里回一个空模块，避免 404 噪声，api.js 会自动走原生回落。
      return new Response('/* desert-gold: socket.io is not used on Cloudflare Workers */', {
        headers: { 'content-type': 'application/javascript; charset=utf-8', 'cache-control': 'public, max-age=3600' },
      });
    }

    if (PAGES[path]) {
      return env.ASSETS.fetch(new Request(new URL(PAGES[path], url), { headers: request.headers }));
    }

    return env.ASSETS.fetch(request);
  },
};
