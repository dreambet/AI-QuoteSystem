
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const quotesRouter = require('./routes/quotes');
const uploadRouter = require('./routes/upload');
const assistantRouter = require('./routes/assistant');
const catalogRouter = require('./routes/catalog');

const app = express();

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.get('/health', async (req, res) => {
  // MySQL 探测：库不可用时 health 仍返回 200（便于探活），但 db 状态明确标出
  let db = 'ok';
  try {
    await require('./db').query('SELECT 1');
  } catch (err) {
    db = 'unreachable: ' + err.message;
  }
  res.json({
    status: 'ok',
    db,
    deepseekConfigured: !!process.env.DEEPSEEK_API_KEY
  });
});

app.use('/api/quotes', quotesRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/assistant', assistantRouter);
app.use('/api/catalog', catalogRouter);

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
  console.error('服务器错误:', err);
  // 如果是 JSON 解析错误，返回 400
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: '无效的 JSON 请求体' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: '请求体过大' });
  }
  res.status(err.status || 500).json({
    error: err.message || '服务器内部错误'
  });
});

module.exports = app;
