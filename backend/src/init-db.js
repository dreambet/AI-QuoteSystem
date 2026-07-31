const db = require('./db');
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const createTables = () => {
  db.serialize(() => {
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
    const migrateColumns = [
      { name: 'drawingAnalysis', type: 'TEXT' },
      { name: 'aiQuoteAnalysis', type: 'TEXT' },
      { name: 'aiReview', type: 'TEXT' },
      { name: 'manualReview', type: 'TEXT' },
      { name: 'calculation', type: 'TEXT' },
    ];

    db.all("PRAGMA table_info(quotes)", [], (err, columns) => {
      if (err) {
        console.error('读取表结构失败:', err.message);
        return;
      }

      const existingColumns = columns.map(c => c.name);

      migrateColumns.forEach(col => {
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

    console.log('数据库初始化完成');
  });
};

createTables();
