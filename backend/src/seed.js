/**
 * 目录数据种子化与修复脚本（幂等）。
 * 用法：npm run seed
 *
 * 数据主要由前序会话已种子化（materials/processes/pricing_strategies）。
 * 本脚本仅做以下修复，并保证可重复执行：
 *   1. 产品5 策略 sampleMultiplier 2 -> 1（计算公式总结.md：产品5 W=(T+U)×1.13，无×2）
 *   2. 阳极工序 unitRate 补 15（Q_阳极 = 15 × 净重）
 *   3. S31603 / S30408 占位 material_prices（待市场确认，触发第3步提醒）
 *   5. 常用牌号密度预置（g/cm³，仅补空值；密度已恢复为 materials.density 列，用于按尺寸算毛/净重）
 */
const db = require('./db');

const OPERATOR = '系统种子';
const NOW = new Date();

async function fixStrategySampleMultiplier(connection) {
  // 产品5 = 预置第5条策略（原 code INVIC-35763000088）；code 列已删，按 id 顺序取第5条
  const [rows] = await connection.query(
    'SELECT id, sampleMultiplier FROM pricing_strategies ORDER BY id LIMIT 1 OFFSET 4'
  );
  if (!rows.length) return '策略不足5条，跳过产品5倍率修复';
  if (Number(rows[0].sampleMultiplier) === 1) return '产品5样品倍率已为1';
  await connection.query(
    'UPDATE pricing_strategies SET sampleMultiplier = 1, updatedAt = ? WHERE id = ?',
    [NOW, rows[0].id]
  );
  return `产品5样品倍率 ${rows[0].sampleMultiplier} -> 1`;
}

async function fixAnodizingUnitRate(connection) {
  const [rows] = await connection.query(
    "SELECT id, unitRate FROM processes WHERE code = 'anodizing'"
  );
  if (!rows.length) return '阳极工序缺失，跳过';
  if (Number(rows[0].unitRate) === 15) return '阳极unitRate已为15';
  await connection.query(
    "UPDATE processes SET unitRate = 15, updatedAt = ? WHERE code = 'anodizing'",
    [NOW]
  );
  return `阳极unitRate ${rows[0].unitRate ?? 'null'} -> 15`;
}

async function ensureGradeMaterialPrices(connection) {
  // S31603 / S30408 占位价格：未确认、待用户在第3步确认
  const [grades] = await connection.query(
    "SELECT id, code FROM materials WHERE code IN ('S31603','S30408')"
  );
  const results = [];
  for (const grade of grades) {
    const [existing] = await connection.query(
      'SELECT id FROM material_prices WHERE materialId = ? AND status = ?',
      [grade.id, 'active']
    );
    if (existing.length) {
      results.push(`${grade.code}: 已有active价格，跳过`);
      continue;
    }
    await connection.query(
      `INSERT INTO material_prices
        (materialId, unitPrice, effectiveAt, confirmedAt, source, status, operatorName, changeReason, createdAt)
       VALUES (?, 0, ?, NULL, 'seed-placeholder', 'active', ?, '占位价格，待市场确认后更新', ?)`,
      [grade.id, NOW, OPERATOR, NOW]
    );
    results.push(`${grade.code}: 插入占位价格(待确认)`);
  }
  return results.join('；');
}

// 报价策略改名：英维克xxxx成本策略 -> 成本策略A/B/C/...（按 id 顺序），与前端下拉显示一致
async function renameStrategies(connection) {
  const [rows] = await connection.query('SELECT id, name FROM pricing_strategies ORDER BY id');
  if (!rows.length) return '无策略';
  let renamed = 0;
  for (let i = 0; i < rows.length; i++) {
    const letter = String.fromCharCode(65 + i);
    const target = `成本策略${letter}`;
    if (rows[i].name === target) continue;
    await connection.query('UPDATE pricing_strategies SET name = ?, updatedAt = ? WHERE id = ?', [target, NOW, rows[i].id]);
    renamed += 1;
  }
  return `重命名 ${renamed} 条策略为 成本策略A..${String.fromCharCode(65 + rows.length - 1)}（共${rows.length}条）`;
}

// 密度预置（g/cm³）：仅补 NULL/0 的材质，已维护的值不覆盖（密度用于第3步按尺寸自动算毛/净重）
async function presetDensities(connection) {
  const presets = {
    S31603: 7.98,       // 316L
    S30408: 7.93,       // 304
    S31609: 7.98,       // 316H
    'S31609 不锈钢': 7.98
  };
  const results = [];
  for (const [code, density] of Object.entries(presets)) {
    const [rows] = await connection.query(
      'SELECT id FROM materials WHERE code = ? AND (density IS NULL OR density = 0)',
      [code]
    );
    if (!rows.length) { results.push(`${code}: 已有密度或材质不存在，跳过`); continue; }
    await connection.query('UPDATE materials SET density = ?, updatedAt = ? WHERE id = ?', [density, NOW, rows[0].id]);
    results.push(`${code}: 密度 ${density}`);
  }
  return results.join('；');
}

// ---------- 无用字段清理迁移（幂等，先 A 类后 B 类） ----------
async function tableExists(connection, table) {
  const [rows] = await connection.query(
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  );
  return rows.length > 0;
}
async function indexExists(connection, table, index) {
  const [rows] = await connection.query(
    `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [table, index]
  );
  return rows.length > 0;
}
async function dropColumn(connection, table, column) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [table, column]
  );
  if (!rows.length) return false;
  await connection.query(`ALTER TABLE \`${table}\` DROP COLUMN \`${column}\``);
  return true;
}

// A 类（完全无用）：quotes.customer/usageContext/quoteType/finalConfirmedBy/finalConfirmedAt；
//   materials.specification/priceUnit；material_prices.currency/taxIncluded；processes.unit；
//   pricing_strategies.config/publishedAt/publishedBy/version；整表 part_masters/quote_events。
// B 类（仅展示/冗余）：quotes.partNumber/length/width/height/diameter/moq/deliveryDate/precision；
//   pricing_strategies.status/setupFeeMin/setupFeeMax/priceStaleDays。partDescription 保留。
async function dropUselessColumns(connection) {
  const results = [];
  // ---- A 类 ----
  for (const col of ['customer', 'usageContext', 'quoteType', 'finalConfirmedBy', 'finalConfirmedAt']) {
    if (await dropColumn(connection, 'quotes', col)) results.push(`[A] quotes.${col} 已删除`);
  }
  for (const col of ['specification', 'priceUnit']) {
    if (await dropColumn(connection, 'materials', col)) results.push(`[A] materials.${col} 已删除`);
  }
  for (const col of ['currency', 'taxIncluded']) {
    if (await dropColumn(connection, 'material_prices', col)) results.push(`[A] material_prices.${col} 已删除`);
  }
  if (await dropColumn(connection, 'processes', 'unit')) results.push('[A] processes.unit 已删除');
  // pricing_strategies：删 version/config 等列；删 code 列（改用 name 唯一）；补建 name 唯一键
  if (await indexExists(connection, 'pricing_strategies', 'uq_strategy_version')) {
    await connection.query('ALTER TABLE pricing_strategies DROP INDEX uq_strategy_version');
    results.push('[A] pricing_strategies 唯一键 uq_strategy_version 已删除');
  }
  if (await indexExists(connection, 'pricing_strategies', 'idx_strategy_active')) {
    await connection.query('ALTER TABLE pricing_strategies DROP INDEX idx_strategy_active');
    results.push('[A] pricing_strategies 索引 idx_strategy_active 已删除');
  }
  for (const col of ['version', 'config', 'publishedAt', 'publishedBy']) {
    if (await dropColumn(connection, 'pricing_strategies', col)) results.push(`[A] pricing_strategies.${col} 已删除`);
  }
  // 删 code：先删唯一键 uq_strategy_code，再删列
  if (await indexExists(connection, 'pricing_strategies', 'uq_strategy_code')) {
    await connection.query('ALTER TABLE pricing_strategies DROP INDEX uq_strategy_code');
    results.push('[A] pricing_strategies 唯一键 uq_strategy_code 已删除');
  }
  if (await dropColumn(connection, 'pricing_strategies', 'code')) results.push('[A] pricing_strategies.code 已删除');
  // 补建 name 唯一键（name 无重名时）
  if (!(await indexExists(connection, 'pricing_strategies', 'uq_strategy_name'))) {
    const [dupName] = await connection.query('SELECT name FROM pricing_strategies GROUP BY name HAVING COUNT(*) > 1');
    if (!dupName.length) {
      await connection.query('ALTER TABLE pricing_strategies ADD UNIQUE KEY uq_strategy_name (name)');
      results.push('[A] pricing_strategies 补建 name 唯一键');
    } else {
      results.push('[A] pricing_strategies name 存在重名，未建唯一键');
    }
  }
  // ---- B 类 ----
  for (const col of ['partNumber', 'length', 'width', 'height', 'diameter', 'moq', 'deliveryDate', 'precision']) {
    if (await dropColumn(connection, 'quotes', col)) results.push(`[B] quotes.${col} 已删除`);
  }
  for (const col of ['status', 'setupFeeMin', 'setupFeeMax', 'priceStaleDays']) {
    if (await dropColumn(connection, 'pricing_strategies', col)) results.push(`[B] pricing_strategies.${col} 已删除`);
  }
  // ---- 整表删除 ----
  if (await tableExists(connection, 'part_masters')) {
    await connection.query('DROP TABLE part_masters');
    results.push('[A] part_masters 表已删除');
  }
  if (await tableExists(connection, 'quote_events')) {
    await connection.query('DROP TABLE quote_events');
    results.push('[A] quote_events 表已删除');
  }
  return results.length ? results.join('；') : '无需变更';
}

async function main() {
  await db.ensureSchema();
  const connection = await db.getConnection();
  try {
    await connection.query('SET NAMES utf8mb4');
    console.log('== 种子数据修复 ==');
    console.log('1)', await fixStrategySampleMultiplier(connection));
    console.log('2)', await fixAnodizingUnitRate(connection));
    console.log('3)', await ensureGradeMaterialPrices(connection));
    console.log('4)', await renameStrategies(connection));
    console.log('5)', await presetDensities(connection));
    console.log('6)', await dropUselessColumns(connection));
    console.log('== 完成 ==');
  } finally {
    connection.release();
    await db.close();
  }
}

main().catch(error => {
  console.error('种子化失败:', error.message);
  process.exitCode = 1;
});
