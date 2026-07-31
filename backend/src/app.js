
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const quotesRouter = require('./routes/quotes');
const uploadRouter = require('./routes/upload');
const assistantRouter = require('./routes/assistant');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    deepseekConfigured: !!process.env.DEEPSEEK_API_KEY
  });
});

app.use('/api/quotes', quotesRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/assistant', assistantRouter);

// Express 全局错误处理中间件 — 兜底捕获路由中未处理的异常
app.use((err, req, res, next) => {
  console.error('服务器错误:', err);
  // 如果是 JSON 解析错误，返回 400
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: '无效的 JSON 请求体' });
  }
  res.status(err.status || 500).json({
    error: err.message || '服务器内部错误'
  });
});

module.exports = app;
