const db = require('./db');

(async () => {
  try {
    await db.ensureSchema();
    console.log('MySQL quote database schema is ready.');
  } catch (error) {
    console.error('Database initialization failed:', error.message);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
})();
