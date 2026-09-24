const express = require('express');
const db = require('../db');
const AuthService = require('../services/AuthService');
const { authenticate } = require('../middleware/auth');
const { createRateLimiter } = require('../middleware/requestControls');

const router = express.Router();
const loginLimiter = createRateLimiter({ windowMs: 15 * 60 * 1000, max: 5, message: '登录尝试过多，请 15 分钟后重试。' });

router.post('/login', loginLimiter, async (req, res, next) => {
  const username = AuthService.normalizeUsername(req.body?.username);
  const password = String(req.body?.password || '');
  if (!username || !password) return res.status(400).json({ error: '请输入有效的账号和密码。' });
  try {
    const rows = await db.query('SELECT id, username, passwordHash, role, active, tokenVersion, lastLoginAt FROM users WHERE username = ? LIMIT 1', [username]);
    const user = rows[0];
    if (!user || !user.active || !(await AuthService.verifyPassword(password, user.passwordHash))) {
      return res.status(401).json({ error: '账号或密码错误。', code: 'INVALID_CREDENTIALS' });
    }
    const now = new Date();
    await db.query('UPDATE users SET lastLoginAt = ?, updatedAt = ? WHERE id = ?', [now, now, user.id]);
    user.lastLoginAt = now;
    const token = AuthService.signToken(user);
    res.json({ token, user: AuthService.publicUser(user), expiresIn: Number(process.env.AUTH_TOKEN_TTL_SECONDS) || 8 * 60 * 60 });
  } catch (error) { next(error); }
});

router.get('/me', authenticate, (req, res) => res.json({ user: AuthService.publicUser(req.user) }));

router.post('/logout', authenticate, async (req, res, next) => {
  try {
    await db.query('UPDATE users SET tokenVersion = tokenVersion + 1, updatedAt = ? WHERE id = ?', [new Date(), req.user.id]);
    res.json({ success: true });
  } catch (error) { next(error); }
});

router.put('/password', authenticate, async (req, res, next) => {
  const currentPassword = String(req.body?.currentPassword || '');
  const newPassword = String(req.body?.newPassword || '');
  const failure = AuthService.validatePassword(newPassword);
  if (failure) return res.status(400).json({ error: failure });
  try {
    const rows = await db.query('SELECT passwordHash FROM users WHERE id = ? LIMIT 1', [req.user.id]);
    if (!rows[0] || !(await AuthService.verifyPassword(currentPassword, rows[0].passwordHash))) {
      return res.status(400).json({ error: '当前密码不正确。' });
    }
    const passwordHash = await AuthService.hashPassword(newPassword);
    await db.query('UPDATE users SET passwordHash = ?, tokenVersion = tokenVersion + 1, updatedAt = ? WHERE id = ?', [passwordHash, new Date(), req.user.id]);
    res.json({ success: true, message: '密码已更新，请重新登录。' });
  } catch (error) { next(error); }
});

module.exports = router;
