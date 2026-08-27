require('dotenv').config();
const mysql = require('mysql2/promise');

const databaseConfig = {
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'quote',
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
  queueLimit: 0,
  charset: 'utf8mb4'
};

const pool = mysql.createPool(databaseConfig);

const jsonColumns = [
  'calculation', 'aiReview', 'manualReview', 'drawingAnalysis', 'aiQuoteAnalysis',
  'blankSpec', 'finishedSpec', 'priceSnapshot', 'processSnapshot'
];

function parseRow(row) {
  if (!row) return row;
  const parsed = { ...row };
  jsonColumns.forEach(column => {
    if (typeof parsed[column] === 'string') {
      try { parsed[column] = JSON.parse(parsed[column]); } catch (_) { /* Keep legacy plain text. */ }
    }
  });
  return parsed;
}

async function query(sql, params = []) {
  // MySQL 5.7.18 on this host crashes in server-side prepared statements when
  // long JSON/BLOB values are inserted. mysql2's query() still escapes values
  // safely, while avoiding that server bug.
  const [rows] = await pool.query(sql, params);
  return Array.isArray(rows) ? rows.map(parseRow) : rows;
}

async function getConnection() {
  return pool.getConnection();
}

async function withTransaction(callback) {
  const connection = await getConnection();
  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function execute(connection, sql, params = []) {
  const [result] = await connection.query(sql, params);
  return result;
}

async function ensureColumn(connection, table, column, definition) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (!rows.length) await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
}

async function ensureSchema() {
  const connection = await getConnection();
  try {
    await connection.query('SET NAMES utf8mb4');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS quotes (
        id VARCHAR(64) PRIMARY KEY,
        materialCode VARCHAR(128) NULL,
        partName VARCHAR(255) NOT NULL,
        partDescription TEXT NULL,
        material VARCHAR(128) NOT NULL,
        grossWeight DECIMAL(16,6) NULL,
        netWeight DECIMAL(16,6) NULL,
        quantity INT NOT NULL,
        drawingPath TEXT NULL,
        blankSpec LONGTEXT NULL,
        finishedSpec LONGTEXT NULL,
        strategyVersionId BIGINT NULL,
        priceSnapshot LONGTEXT NULL,
        processSnapshot LONGTEXT NULL,
        calculation LONGTEXT NULL,
        aiReview LONGTEXT NULL,
        manualReview LONGTEXT NULL,
        drawingAnalysis LONGTEXT NULL,
        aiQuoteAnalysis LONGTEXT NULL,
        finalUnitPrice DECIMAL(16,4) NULL,
        status VARCHAR(64) NOT NULL DEFAULT 'draft',
        createdAt DATETIME NOT NULL,
        updatedAt DATETIME NOT NULL,
        INDEX idx_quotes_material_code (materialCode),
        INDEX idx_quotes_created_at (createdAt)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const quoteColumns = {
      materialCode: 'VARCHAR(128) NULL', partDescription: 'TEXT NULL',
      grossWeight: 'DECIMAL(16,6) NULL', netWeight: 'DECIMAL(16,6) NULL',
      blankSpec: 'LONGTEXT NULL', finishedSpec: 'LONGTEXT NULL', strategyVersionId: 'BIGINT NULL',
      priceSnapshot: 'LONGTEXT NULL', processSnapshot: 'LONGTEXT NULL', finalUnitPrice: 'DECIMAL(16,4) NULL'
    };
    for (const [column, definition] of Object.entries(quoteColumns)) {
      await ensureColumn(connection, 'quotes', column, definition);
    }

    await connection.query(`
      CREATE TABLE IF NOT EXISTS materials (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(128) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        priceMode VARCHAR(16) NOT NULL DEFAULT 'weight',
        density DECIMAL(10,4) NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        createdBy VARCHAR(128) NULL,
        createdAt DATETIME NOT NULL,
        updatedAt DATETIME NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // 计价方式：weight=元/kg（K=毛重×单价）| fixed=直接价格（K=单价本身）。存量材质默认 weight。
    await ensureColumn(connection, 'materials', 'priceMode', "VARCHAR(16) NOT NULL DEFAULT 'weight'");
    // 密度（g/cm³）：按材质维护，第3步用于按尺寸自动算毛重/净重（方块=长×宽×厚×密度，球体=球体积×密度）
    await ensureColumn(connection, 'materials', 'density', 'DECIMAL(10,4) NULL');
    await connection.query(`
      CREATE TABLE IF NOT EXISTS material_prices (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        materialId BIGINT NOT NULL,
        unitPrice DECIMAL(16,4) NOT NULL,
        effectiveAt DATETIME NOT NULL,
        confirmedAt DATETIME NULL,
        source VARCHAR(255) NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'active',
        operatorName VARCHAR(128) NOT NULL,
        changeReason VARCHAR(500) NOT NULL,
        createdAt DATETIME NOT NULL,
        INDEX idx_prices_material_active (materialId, status, effectiveAt),
        CONSTRAINT fk_prices_material FOREIGN KEY (materialId) REFERENCES materials(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS processes (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(128) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        costType VARCHAR(32) NOT NULL DEFAULT 'time',
        hourlyRate DECIMAL(16,4) NULL,
        unitRate DECIMAL(16,4) NULL,
        fixedAmount DECIMAL(16,4) NULL,
        active TINYINT(1) NOT NULL DEFAULT 1,
        operatorName VARCHAR(128) NULL,
        changeReason VARCHAR(500) NULL,
        createdAt DATETIME NOT NULL,
        updatedAt DATETIME NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS pricing_strategies (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        materialLossRate DECIMAL(10,6) NOT NULL DEFAULT 0,
        toolLossRate DECIMAL(10,6) NOT NULL DEFAULT 0,
        overheadRate DECIMAL(10,6) NOT NULL DEFAULT 0,
        profitRate DECIMAL(10,6) NOT NULL DEFAULT 0,
        taxRate DECIMAL(10,6) NOT NULL DEFAULT 0.13,
        sampleMultiplier DECIMAL(10,6) NOT NULL DEFAULT 2,
        setupFeeDefault DECIMAL(16,4) NOT NULL DEFAULT 300,
        createdBy VARCHAR(128) NOT NULL,
        changeReason VARCHAR(500) NOT NULL,
        createdAt DATETIME NOT NULL,
        updatedAt DATETIME NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // 形状目录（全局共享）：预置方块/球体带自动算重公式；用户新增形状供第3步选择（无公式，毛/净重手填）
    await connection.query(`
      CREATE TABLE IF NOT EXISTS shapes (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(64) NOT NULL UNIQUE,
        createdAt DATETIME NOT NULL,
        updatedAt DATETIME NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await connection.query('INSERT IGNORE INTO shapes (name, createdAt, updatedAt) VALUES (?, NOW(), NOW()), (?, NOW(), NOW())', ['方块', '球体']);
  } finally {
    connection.release();
  }
}

async function close() {
  await pool.end();
}

module.exports = { pool, query, execute, getConnection, withTransaction, ensureSchema, close, parseRow };
