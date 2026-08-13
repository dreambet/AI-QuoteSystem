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
  'blankSpec', 'finishedSpec', 'priceSnapshot', 'processSnapshot', 'payload', 'processRoute', 'config'
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
        customer VARCHAR(255) NULL,
        materialCode VARCHAR(128) NULL,
        partName VARCHAR(255) NOT NULL,
        partNumber VARCHAR(255) NULL,
        partDescription TEXT NULL,
        usageContext VARCHAR(255) NULL,
        material VARCHAR(128) NOT NULL,
        length DECIMAL(16,4) NULL,
        width DECIMAL(16,4) NULL,
        height DECIMAL(16,4) NULL,
        diameter DECIMAL(16,4) NULL,
        grossWeight DECIMAL(16,6) NULL,
        netWeight DECIMAL(16,6) NULL,
        moq INT NULL,
        quoteType VARCHAR(32) NOT NULL DEFAULT 'production',
        quantity INT NOT NULL,
        deliveryDate VARCHAR(64) NULL,
        \`precision\` VARCHAR(64) NULL,
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
        finalConfirmedBy VARCHAR(128) NULL,
        finalConfirmedAt DATETIME NULL,
        status VARCHAR(64) NOT NULL DEFAULT 'draft',
        createdAt DATETIME NOT NULL,
        updatedAt DATETIME NOT NULL,
        INDEX idx_quotes_material_code (materialCode),
        INDEX idx_quotes_created_at (createdAt)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const quoteColumns = {
      customer: 'VARCHAR(255) NULL', materialCode: 'VARCHAR(128) NULL', partDescription: 'TEXT NULL',
      usageContext: 'VARCHAR(255) NULL', grossWeight: 'DECIMAL(16,6) NULL', netWeight: 'DECIMAL(16,6) NULL',
      moq: 'INT NULL', quoteType: "VARCHAR(32) NOT NULL DEFAULT 'production'", blankSpec: 'LONGTEXT NULL',
      finishedSpec: 'LONGTEXT NULL', strategyVersionId: 'BIGINT NULL', priceSnapshot: 'LONGTEXT NULL',
      processSnapshot: 'LONGTEXT NULL', finalUnitPrice: 'DECIMAL(16,4) NULL',
      finalConfirmedBy: 'VARCHAR(128) NULL', finalConfirmedAt: 'DATETIME NULL'
    };
    for (const [column, definition] of Object.entries(quoteColumns)) {
      await ensureColumn(connection, 'quotes', column, definition);
    }

    await connection.query(`
      CREATE TABLE IF NOT EXISTS materials (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        code VARCHAR(128) NOT NULL UNIQUE,
        name VARCHAR(255) NOT NULL,
        specification VARCHAR(255) NULL,
        priceUnit VARCHAR(32) NOT NULL DEFAULT 'kg',
        active TINYINT(1) NOT NULL DEFAULT 1,
        createdBy VARCHAR(128) NULL,
        createdAt DATETIME NOT NULL,
        updatedAt DATETIME NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS material_prices (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        materialId BIGINT NOT NULL,
        unitPrice DECIMAL(16,4) NOT NULL,
        currency VARCHAR(16) NOT NULL DEFAULT 'CNY',
        taxIncluded TINYINT(1) NOT NULL DEFAULT 0,
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
        unit VARCHAR(32) NULL,
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
        code VARCHAR(128) NOT NULL,
        name VARCHAR(255) NOT NULL,
        version INT NOT NULL DEFAULT 1,
        status VARCHAR(32) NOT NULL DEFAULT 'draft',
        materialLossRate DECIMAL(10,6) NOT NULL DEFAULT 0,
        toolLossRate DECIMAL(10,6) NOT NULL DEFAULT 0,
        overheadRate DECIMAL(10,6) NOT NULL DEFAULT 0,
        profitRate DECIMAL(10,6) NOT NULL DEFAULT 0,
        taxRate DECIMAL(10,6) NOT NULL DEFAULT 0.13,
        sampleMultiplier DECIMAL(10,6) NOT NULL DEFAULT 2,
        setupFeeDefault DECIMAL(16,4) NOT NULL DEFAULT 300,
        setupFeeMin DECIMAL(16,4) NOT NULL DEFAULT 300,
        setupFeeMax DECIMAL(16,4) NOT NULL DEFAULT 600,
        priceStaleDays INT NOT NULL DEFAULT 30,
        config LONGTEXT NULL,
        publishedAt DATETIME NULL,
        publishedBy VARCHAR(128) NULL,
        createdBy VARCHAR(128) NOT NULL,
        changeReason VARCHAR(500) NOT NULL,
        createdAt DATETIME NOT NULL,
        updatedAt DATETIME NOT NULL,
        UNIQUE KEY uq_strategy_version (code, version),
        INDEX idx_strategy_active (status, code)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS part_masters (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        materialCode VARCHAR(128) NOT NULL UNIQUE,
        customer VARCHAR(255) NULL,
        partName VARCHAR(255) NOT NULL,
        partDescription TEXT NULL,
        materialId BIGINT NULL,
        blankSpec LONGTEXT NULL,
        finishedSpec LONGTEXT NULL,
        grossWeight DECIMAL(16,6) NULL,
        netWeight DECIMAL(16,6) NULL,
        moq INT NULL,
        defaultStrategyCode VARCHAR(128) NULL,
        processRoute LONGTEXT NULL,
        sourceReference VARCHAR(255) NULL,
        status VARCHAR(32) NOT NULL DEFAULT 'draft',
        operatorName VARCHAR(128) NOT NULL,
        changeReason VARCHAR(500) NOT NULL,
        createdAt DATETIME NOT NULL,
        updatedAt DATETIME NOT NULL,
        INDEX idx_part_master_material (materialId),
        CONSTRAINT fk_part_material FOREIGN KEY (materialId) REFERENCES materials(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await connection.query(`
      CREATE TABLE IF NOT EXISTS quote_events (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        quoteId VARCHAR(64) NOT NULL,
        eventType VARCHAR(64) NOT NULL,
        operatorName VARCHAR(128) NULL,
        reason VARCHAR(500) NULL,
        payload LONGTEXT NULL,
        createdAt DATETIME NOT NULL,
        INDEX idx_quote_events_quote (quoteId, createdAt)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  } finally {
    connection.release();
  }
}

async function close() {
  await pool.end();
}

module.exports = { pool, query, execute, getConnection, withTransaction, ensureSchema, close, parseRow };
