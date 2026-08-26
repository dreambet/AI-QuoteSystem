// CRA 开发代理默认开启 gzip 压缩（webpack-dev-server compress=true），
// 压缩中间件会把后端的 SSE 流整体缓冲到响应结束才发出，
// 导致 AI 报价建议/审核在开发环境看不到逐字流式效果（全程"已思考 0 字"后一次性出结果）。
// 对流式接口去掉 Accept-Encoding 请求头，让代理以 chunked 直传。
// 生产环境同理：反向代理需关闭该路径的缓冲（nginx: proxy_buffering off）。
module.exports = function (app) {
  app.use('/api/quotes', (req, res, next) => {
    if (req.path.endsWith('/ai-quote/stream') || req.path.endsWith('/ai-review/stream')) {
      delete req.headers['accept-encoding'];
    }
    next();
  });
};
