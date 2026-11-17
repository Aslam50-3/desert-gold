'use strict';
/**
 * Cloudflare 入口：API / WebSocket 交给同一个 Durable Object（单场沙盘），
 * 其余路径走静态资源；/play /admin /screen 这类无扩展名路径映射到对应 HTML。
 */
import { GameRoom } from './game.js';

export { GameRoom };

// 页面与脚本一律走协商缓存：浏览器每次都会向边缘校验 ETag，避免旧版 JS 把新标签页带偏。
async function serveAsset(request, env, target) {
  const res = await env.ASSETS.fetch(new Request(target, { headers: request.headers }));
  const type = res.headers.get('content-type') || '';
  if (/text\/html|javascript|text\/css/.test(type)) {
    const headers = new Headers(res.headers);
    headers.set('cache-control', 'no-cache, must-revalidate');
    return new Response(res.body, { status: res.status, headers });
  }
  return res;
}

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
      return serveAsset(request, env, new URL(PAGES[path], url));
    }

    return serveAsset(request, env, url);
  },
};
