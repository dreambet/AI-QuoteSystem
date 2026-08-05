const app = require('./app');
const db = require('./db');

const PORT = process.env.PORT || 3001;
let server;

async function start() {
  await db.ensureSchema();
  server = app.listen(PORT, () => console.log(`Server running on port ${PORT} with MySQL quote database`));
}

start().catch(error => {
  console.error('Server startup failed:', error.message);
  process.exit(1);
});

async function shutdown(signal) {
  console.log(`Received ${signal}, shutting down...`);
  if (server) await new Promise(resolve => server.close(resolve));
  await db.close();
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
