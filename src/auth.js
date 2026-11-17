'use strict';

const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { db, nowIso } = require('./db');

const COOKIE = 'dg_token';

function loadSecret() {
  if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
  const dir = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, '.jwt-secret');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const secret = require('crypto').randomBytes(48).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}
const SECRET = loadSecret();

function sign(user) {
  return jwt.sign({ uid: user.id, role: user.role, teamId: user.team_id || null, username: user.username }, SECRET, {
    expiresIn: '7d',
  });
}

function verifyToken(token) {
  try {
    return jwt.verify(token, SECRET);
  } catch (err) {
    return null;
  }
}

function parseCookies(header = '') {
  return header.split(';').reduce((acc, part) => {
    const idx = part.indexOf('=');
    if (idx > 0) acc[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
    return acc;
  }, {});
}

function setCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 3600}${process.env.HTTPS === 'true' ? '; Secure' : ''}`
  );
}

function clearCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function attachUser(req, _res, next) {
  req.user = null;
  const token = parseCookies(req.headers.cookie || '')[COOKIE];
  if (token) {
    try {
      const payload = jwt.verify(token, SECRET);
      const user = db.prepare('SELECT * FROM users WHERE id=? AND active=1').get(payload.uid);
      if (user) req.user = user;
    } catch (err) {
      /* 过期或伪造 token：按未登录处理 */
    }
  }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  if (req.user.role !== 'ADMIN') return res.status(403).json({ error: '需要管理员权限' });
  next();
}

function requirePlayer(req, res, next) {
  if (!req.user) return res.status(401).json({ error: '请先登录' });
  if (req.user.role !== 'PLAYER' || !req.user.team_id) return res.status(403).json({ error: '需要队伍账号' });
  next();
}

function validatePassword(pwd) {
  if (typeof pwd !== 'string' || pwd.length < 10) return '密码至少 10 位';
  if (!/[a-z]/.test(pwd) || !/[A-Z]/.test(pwd) || !/\d/.test(pwd)) return '密码需包含大小写字母与数字';
  return null;
}

function login({ username, password, mode }) {
  const user = db.prepare('SELECT * FROM users WHERE username=?').get(String(username || '').trim());
  if (!user || !user.active) return { ok: false, status: 401, error: '账号或密码错误' };
  if (mode === 'admin' && user.role !== 'ADMIN') return { ok: false, status: 401, error: '该账号不是管理员' };
  if (mode === 'player' && user.role !== 'PLAYER') return { ok: false, status: 401, error: '请使用管理员入口登录' };
  if (user.lock_until && Date.parse(user.lock_until) > Date.now()) {
    const sec = Math.ceil((Date.parse(user.lock_until) - Date.now()) / 1000);
    return { ok: false, status: 423, error: `登录失败次数过多，请 ${sec} 秒后再试` };
  }
  if (!bcrypt.compareSync(String(password || ''), user.password_hash)) {
    const fails = (user.fails || 0) + 1;
    const lock = fails >= 5 ? new Date(Date.now() + 5 * 60000).toISOString() : null;
    db.prepare('UPDATE users SET fails=?, lock_until=? WHERE id=?').run(fails, lock, user.id);
    return { ok: false, status: 401, error: lock ? '连续 5 次失败，账号锁定 5 分钟' : `账号或密码错误（剩余 ${5 - fails} 次）` };
  }
  db.prepare('UPDATE users SET fails=0, lock_until=NULL WHERE id=?').run(user.id);
  return { ok: true, user, token: sign(user) };
}

module.exports = {
  COOKIE, sign, verifyToken, parseCookies, setCookie, clearCookie, attachUser,
  requireAuth, requireAdmin, requirePlayer, validatePassword, login,
};
