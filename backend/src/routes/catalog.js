/**
 * 目录管理 API：材料(含价格)、工序、报价策略、零件主档。
 * 挂载于 /api/catalog。供前端在第3步选择材料/确认单价、工序确认面板读取工序与费率、
 * 内联维护工费率（需求5）使用。无独立维护页面，均由现有页面内联调用。
 */
const express = require('express');
const db = require('../db');

const router = express.Router();
const DEFAULT_OPERATOR = 'system';
const STALE_DAYS = 30;

const operator = req => (req.body && req.body.operatorName) || (req.query && req.query.operatorName) || DEFAULT_OPERATOR;

// ---------- 材料（含当前 active 价格） ----------
router.get('/materials', async (req, res) => {
  try {
    const rows = await db.query(`
      SELECT m.id, m.code, m.name, m.specification, m.density, m.priceUnit, m.active,
             mp.unitPrice, mp.effectiveAt AS priceEffectiveAt, mp.confirmedAt AS priceConfirmedAt,
             mp.source AS priceSource, mp.changeReason AS priceChangeReason
      FROM materials m
      LEFT JOIN material_prices mp ON mp.materialId = m.id AND mp.status = 'active'
      WHERE m.active = 1
      ORDER BY m.id
    `);
    const list = rows.map(r => {
      const confirmed = r.priceConfirmedAt ? new Date(r.priceConfirmedAt) : null;
      const stale = !confirmed || (Date.now() - confirmed.getTime()) > STALE_DAYS * 86400000;
      return { ...r, priceStale: !!stale };
    });
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 材料 -> 历史价格
router.get('/materials/:id/prices', async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT id, unitPrice, currency, effectiveAt, confirmedAt, source, status, operatorName, changeReason, createdAt
       FROM material_prices WHERE materialId = ? ORDER BY effectiveAt DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 确认/更新材料单价（写新 active 价格，旧 active 转 historical）
router.post('/materials/:id/prices', async (req, res) => {
  const { unitPrice, changeReason, confirmed = true } = req.body || {};
  if (unitPrice == null || Number.isNaN(Number(unitPrice))) {
    return res.status(400).json({ error: 'unitPrice 必填' });
  }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      "UPDATE material_prices SET status = 'historical' WHERE materialId = ? AND status = 'active'",
      [req.params.id]
    );
    const now = new Date();
    await conn.query(
      `INSERT INTO material_prices
        (materialId, unitPrice, currency, taxIncluded, effectiveAt, confirmedAt, source, status, operatorName, changeReason, createdAt)
       VALUES (?, ?, 'CNY', 0, ?, ?, 'manual', 'active', ?, ?, ?)`,
      [req.params.id, Number(unitPrice), now, confirmed ? now : null, operator(req), changeReason || '手动确认单价', now]
    );
    await conn.commit();
    res.json({ success: true });
  } catch (error) {
    await conn.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    conn.release();
  }
});

// ---------- 工序 ----------
router.get('/processes', async (req, res) => {
  try {
    const rows = await db.query(
      'SELECT id, code, name, costType, hourlyRate, unitRate, fixedAmount, unit, active FROM processes WHERE active = 1 ORDER BY id'
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 维护工序成本（工费率/损耗率/固定金额）—— 需求5
router.put('/processes/:id', async (req, res) => {
  const { hourlyRate, unitRate, fixedAmount, changeReason } = req.body || {};
  const fields = [];
  const params = [];
  if (hourlyRate != null) { fields.push('hourlyRate = ?'); params.push(Number(hourlyRate)); }
  if (unitRate != null) { fields.push('unitRate = ?'); params.push(Number(unitRate)); }
  if (fixedAmount != null) { fields.push('fixedAmount = ?'); params.push(Number(fixedAmount)); }
  if (!fields.length) return res.status(400).json({ error: '未提供可更新字段' });
  fields.push('operatorName = ?'); params.push(operator(req));
  fields.push('changeReason = ?'); params.push(changeReason || '工艺成本维护');
  fields.push('updatedAt = ?'); params.push(new Date());
  params.push(req.params.id);
  try {
    await db.query(`UPDATE processes SET ${fields.join(', ')} WHERE id = ?`, params);
    const rows = await db.query('SELECT id, code, name, costType, hourlyRate, unitRate, fixedAmount, unit, active FROM processes WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------- 报价策略 ----------
router.get('/strategies', async (req, res) => {
  try {
    const rows = await db.query(`
      SELECT id, code, name, version, status, materialLossRate, toolLossRate, overheadRate, profitRate,
             taxRate, sampleMultiplier, setupFeeDefault, setupFeeMin, setupFeeMax, priceStaleDays
      FROM pricing_strategies ORDER BY id
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/strategies/:id', async (req, res) => {
  const allowed = ['materialLossRate','toolLossRate','overheadRate','profitRate','taxRate','sampleMultiplier','setupFeeDefault','setupFeeMin','setupFeeMax','priceStaleDays'];
  const fields = [];
  const params = [];
  for (const k of allowed) {
    if (req.body[k] != null) { fields.push(`\`${k}\` = ?`); params.push(Number(req.body[k])); }
  }
  if (!fields.length) return res.status(400).json({ error: '未提供可更新字段' });
  fields.push('updatedAt = ?'); params.push(new Date());
  params.push(req.params.id);
  try {
    await db.query(`UPDATE pricing_strategies SET ${fields.join(', ')} WHERE id = ?`, params);
    const rows = await db.query('SELECT * FROM pricing_strategies WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ---------- 零件主档（按物料编码取规格+工序路线+默认策略，供前端参考） ----------
router.get('/part-masters', async (req, res) => {
  try {
    const rows = await db.query(`
      SELECT pm.id, pm.materialCode, pm.partName, pm.partDescription, pm.materialId, m.code AS materialCode2,
             pm.blankSpec, pm.finishedSpec, pm.grossWeight, pm.netWeight, pm.moq,
             pm.defaultStrategyCode, pm.processRoute, pm.status
      FROM part_masters pm LEFT JOIN materials m ON m.id = pm.materialId
      ORDER BY pm.id
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/part-masters/:materialCode', async (req, res) => {
  try {
    const rows = await db.query(
      'SELECT * FROM part_masters WHERE materialCode = ? LIMIT 1',
      [req.params.materialCode]
    );
    if (!rows.length) return res.status(404).json({ error: '未找到该物料编码的零件主档' });
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
