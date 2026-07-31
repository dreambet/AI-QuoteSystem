const fs = require('fs');
const path = require('path');
const db = require('./db');

const dataDir = path.join(__dirname, '../data');
const dbPath = path.join(dataDir, 'quotes.db');

console.log('开始重建数据库...');

// 删除旧数据库
if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
  console.log('旧数据库已删除');
}

// 确保目录存在
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// 创建新表
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
  `, (err) => {
    if (err) {
      console.error('创建表失败:', err);
    } else {
      console.log('✓ 数据库表创建成功!');
    }

    console.log('重建完成!');
    db.close();
  });
});
