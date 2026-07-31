const app = require('./app');

const PORT = process.env.PORT || 3001;

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// 捕获未处理的 Promise rejection
process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的 Promise Rejection:', reason);
  // 不立即退出，给 nodemon 记录日志的机会，然后退出让其重启
  server.close(() => {
    process.exit(1);
  });
});

// 捕获未处理的异常
process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
  server.close(() => {
    process.exit(1);
  });
});

// 优雅退出
process.on('SIGTERM', () => {
  console.log('收到 SIGTERM 信号，正在关闭服务器...');
  server.close(() => {
    console.log('服务器已关闭');
    process.exit(0);
  });
});
