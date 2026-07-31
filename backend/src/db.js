const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'quotes.db');

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database');
    // 自动创建表并迁移缺失的列
    ensureSchema();
  }
});

function ensureSchema() {
  db.serialize(() => {
    // 创建表（如果不存在）
    db.run(`
      CREATE TABLE IF NOT EXISTS quotes (
        id TEXT PRIMARY KEY,
        partName TEXT NOT NULL,
        partNumber TEXT,
        material TEXT NOT NULL,
        length REAL,
        width REAL,
        height REAL,
        diameter REAL,
        quantity INTEGER NOT NULL,
        deliveryDate TEXT,
        precision TEXT,
        drawingPath TEXT,
        calculation TEXT,
        aiReview TEXT,
        manualReview TEXT,
        drawingAnalysis TEXT,
        aiQuoteAnalysis TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `);

    // 自动迁移：为旧数据库添加缺失的列
    db.all("PRAGMA table_info(quotes)", [], (err, columns) => {
      if (err) {
        console.error('读取表结构失败:', err.message);
        return;
      }

      const expectedColumns = [
        { name: 'drawingAnalysis', type: 'TEXT' },
        { name: 'aiQuoteAnalysis', type: 'TEXT' },
        { name: 'aiReview', type: 'TEXT' },
        { name: 'manualReview', type: 'TEXT' },
        { name: 'calculation', type: 'TEXT' },
      ];

      const existingColumns = columns.map(c => c.name);

      expectedColumns.forEach(col => {
        if (!existingColumns.includes(col.name)) {
          db.run(`ALTER TABLE quotes ADD COLUMN ${col.name} ${col.type}`, (err) => {
            if (err) {
              console.error(`添加列 ${col.name} 失败:`, err.message);
            } else {
              console.log(`✓ 已添加缺失列: ${col.name}`);
            }
          });
        }
      });
    });
  });
}

module.exports = db;
