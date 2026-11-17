'use strict';

const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const { db, DB_FILE } = require('./src/db');
const auth = require('./src/auth');
const service = require('./src/service');
const { seed } = require('./src/seed');
const app = express();
app.disable('x-powered-by');

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: false }, serveClient: true });

/* 统一广播出口：service 层只负责“发什么”，socket 层负责“发给谁” */
service.setEmitter((event, payload, room) => {
  if (room) io.to(room).emit(event, payload);
  else io.emit(event, payload);
});

io.on('connection', (socket) => {
  const token = auth.parseCookies(socket.request.headers.cookie || '')[auth.COOKIE];
  const payload = token ? auth.verifyToken(token) : null;
  const user = payload && payload.uid ? { uid: payload.uid, teamId: payload.teamId, role: payload.role } : null;
  const session = service.currentSession();
  if (session) socket.join(`session:${session.id}`);

  socket.on('room:join', (payload = {}) => {
    const { sessionId, teamId } = payload;
    if (sessionId) socket.join(`session:${sessionId}`);
    if (teamId && user && user.teamId === teamId) {
      socket.join(`team:${teamId}`);
      service.markOnline(teamId, socket.id, true);
    }
  });

  socket.on('disconnect', () => {
    if (user && user.teamId) service.markOnline(user.teamId, socket.id, false);
  });
});

app.use('/api', require('./src/routes'));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'], maxAge: '1h' }));

app.get('/healthz', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// SPA 风格路由：/play /admin /screen 落到对应 html
const pages = {
  '/login': 'index.html',
  '/play': 'play.html',
  '/play/board': 'play.html',
  '/play/lobby': 'play.html',
  '/admin': 'admin.html',
  '/screen': 'screen.html',
};
for (const [route, file] of Object.entries(pages)) {
  app.get(route, (req, res) => res.sendFile(path.join(__dirname, 'public', file)));
}

app.use((err, req, res, next) => {
  console.error('[error]', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: '服务器内部错误' });
});

seed();

const PORT = Number(process.env.PORT || 3000);

// 每秒推进阶段；时间戳都在数据库里，重启后能接着走
setInterval(() => {
  try {
    service.tick();
  } catch (err) {
    console.error('[ticker]', err);
  }
}, 1000);

server.listen(PORT, () => {
  console.log(`沙漠掘金 · 沙盘已启动  http://localhost:${PORT}`);
  console.log(`数据库：${DB_FILE}`);
});

process.on('SIGTERM', () => {
  io.close();
  server.close(() => {
    db.close();
    process.exit(0);
  });
});
