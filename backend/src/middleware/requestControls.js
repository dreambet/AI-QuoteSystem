const crypto = require('crypto');
const db = require('../db');

const requestId = (req, res, next) => {
  req.requestId = crypto.randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
};

const createRateLimiter = ({ windowMs, max, message }) => {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const key = `${req.ip || req.socket.remoteAddress || 'unknown'}:${req.baseUrl || ''}`;
    const entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      return res.status(429).json({ error: message || '请求过于频繁，请稍后重试。', code: 'RATE_LIMITED' });
    }
    next();
  };
};

const auditMutation = (req, res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  const startedAt = Date.now();
  res.on('finish', () => {
    if (!req.user || res.statusCode >= 500) return;
    const action = `${req.method} ${(req.baseUrl || '')}${req.route?.path || req.path}`.slice(0, 255);
    db.query(
      `INSERT INTO audit_logs (actorUserId, actorUsername, action, requestId, ipAddress, statusCode, durationMs, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, req.user.username, action, req.requestId, String(req.ip || '').slice(0, 64), res.statusCode, Date.now() - startedAt, new Date()]
    ).catch(error => console.error('写入审计日志失败:', error.message));
  });
  next();
};

module.exports = { requestId, createRateLimiter, auditMutation };
