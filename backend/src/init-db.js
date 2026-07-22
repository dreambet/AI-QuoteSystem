
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
        status TEXT NOT NULL DEFAULT 'draft',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `);
    console.log('Database tables created');
  });
};

createTables();

