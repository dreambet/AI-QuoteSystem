
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const quotesRouter = require('./routes/quotes');
const uploadRouter = require('./routes/upload');
const assistantRouter = require('./routes/assistant');
const catalogRouter = require('./routes/catalog');
const authRouter = require('./routes/auth');
const { authenticate, requireRole } = require('./middleware/auth');
const { requestId, createRateLimiter, auditMutation } = require('./middleware/requestControls');

const app = express();

app.set('trust proxy', 1);
app.use(requestId);
// 允许任意前端来源访问 API；真正的访问控制由后续登录鉴权与角色权限承担。
app.use(cors({
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use('/api', createRateLimiter({ windowMs: 60 * 1000, max: Number(process.env.API_RATE_LIMIT_PER_MINUTE) || 240 }));

// liveness 只表示 Node 进程可响应，不披露数据库、密钥等内部信息。
app.get('/health', (req, res) => res.json({ status: 'ok' }));
// readiness 供部署平台探测；数据库不可用即返回非 2xx。
app.get('/ready', async (req, res) => {
  try {
    await require('./db').query('SELECT 1');
    res.json({ status: 'ready' });
  } catch (_) {
    res.status(503).json({ status: 'not_ready' });
  }
});

app.use('/api/auth', authRouter);
app.use('/api', authenticate, auditMutation);
app.use('/api/quotes', quotesRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/assistant', assistantRouter);
app.use('/api/catalog', requireRole('admin'), catalogRouter);

// 生产托管前端构建产物：API 之外的所有 GET 落到 SPA 入口，解决 /quotes/:id 等直达/刷新 404。
// 本地开发仍用 CRA dev server（3000 + proxy），build 目录不存在时静默跳过。
const frontendBuildDir = path.join(__dirname, '../../frontend/build');
if (fs.existsSync(path.join(frontendBuildDir, 'index.html'))) {
  app.use(express.static(frontendBuildDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/health') return next();
    res.sendFile(path.join(frontendBuildDir, 'index.html'));
  });
}

// Express 全局错误处理中间件 — 兜底捕获路由中未处理的异常
app.use((err, req, res, next) => {
  console.error('服务器错误:', { requestId: req.requestId, message: err.message, stack: err.stack });
  // 如果是 JSON 解析错误，返回 400
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: '无效的 JSON 请求体' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: '请求体过大' });
  }
  const status = err.status || 500;
  res.status(status).json({
    error: status >= 500 && process.env.NODE_ENV === 'production' ? '服务器暂时无法处理请求，请稍后重试。' : (err.message || '服务器内部错误'),
    requestId: req.requestId
  });
});

module.exports = app;
