const db = require('../db');
const AuthService = require('../services/AuthService');

const authenticate = async (req, res, next) => {
  const header = String(req.get('authorization') || '');
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const payload = AuthService.verifyToken(token);
  if (!payload) return res.status(401).json({ error: '登录已失效，请重新登录。', code: 'AUTH_REQUIRED' });
  try {
    const rows = await db.query('SELECT id, username, role, active, tokenVersion, lastLoginAt FROM users WHERE id = ? LIMIT 1', [payload.sub]);
    const user = rows[0];
    if (!user || !user.active || Number(user.tokenVersion || 0) !== Number(payload.tokenVersion || 0)) {
      return res.status(401).json({ error: '登录已失效，请重新登录。', code: 'AUTH_EXPIRED' });
    }
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: '请先登录。', code: 'AUTH_REQUIRED' });
  if (!roles.includes(req.user.role)) return res.status(403).json({ error: '当前账户没有此操作权限。', code: 'FORBIDDEN' });
  next();
};

module.exports = { authenticate, requireRole };
