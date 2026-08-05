/**
 * 目录数据种子化与修复脚本（幂等）。
 * 用法：npm run seed
 *
 * 数据主要由前序会话已种子化（materials/processes/pricing_strategies/part_masters）。
 * 本脚本仅做三件未完成的修复，并保证可重复执行：
 *   1. 产品5 策略 sampleMultiplier 2 -> 1（计算公式总结.md：产品5 W=(T+U)×1.13，无×2）
 *   2. 阳极工序 unitRate 补 15（Q_阳极 = 15 × 净重）
 *   3. S31603 / S30408 占位 material_prices（待市场确认，触发第3步提醒）
 */
const db = require('./db');

const OPERATOR = '系统种子';
const NOW = new Date();

async function fixStrategySampleMultiplier(connection) {
  const [rows] = await connection.query(
    "SELECT id, sampleMultiplier FROM pricing_strategies WHERE code = 'INVIC-35763000088'"
  );
  if (!rows.length) return '产品5策略缺失，跳过';
  if (String(rows[0].sampleMultiplier) === '1') return '产品5样品倍率已为1';
  await connection.query(
    "UPDATE pricing_strategies SET sampleMultiplier = 1, updatedAt = ? WHERE code = 'INVIC-35763000088'",
    [NOW]
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
        (materialId, unitPrice, currency, taxIncluded, effectiveAt, confirmedAt, source, status, operatorName, changeReason, createdAt)
       VALUES (?, 0, 'CNY', 0, ?, NULL, 'seed-placeholder', 'active', ?, '占位价格，待市场确认后更新', ?)`,
      [grade.id, NOW, OPERATOR, NOW]
    );
    results.push(`${grade.code}: 插入占位价格(待确认)`);
  }
  return results.join('；');
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
