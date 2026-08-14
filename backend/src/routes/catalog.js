/**
 * 目录管理 API：材料(含价格)、工序、报价策略。
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
      SELECT m.id, m.code, m.name, m.active,
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

// 新增材质（用户在下拉里没有时手输并保存，供下次复用）。可选带单价。
router.post('/materials', async (req, res) => {
  const { code, name, unitPrice, changeReason } = req.body || {};
  if (!code || !String(code).trim()) return res.status(400).json({ error: '材质编码(code)必填' });
  const trimCode = String(code).trim();
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [exist] = await conn.query('SELECT id FROM materials WHERE code = ?', [trimCode]);
    if (exist.length) { await conn.rollback(); return res.status(409).json({ error: '该材质编码已存在' }); }
    const now = new Date();
    const [result] = await conn.query(
      'INSERT INTO materials (code, name, active, createdBy, createdAt, updatedAt) VALUES (?, ?, 1, ?, ?, ?)',
      [trimCode, (name || trimCode), operator(req), now, now]
    );
    const materialId = result.insertId;
    if (unitPrice != null && unitPrice !== '') {
      await conn.query(
        `INSERT INTO material_prices (materialId, unitPrice, effectiveAt, confirmedAt, source, status, operatorName, changeReason, createdAt)
         VALUES (?, ?, ?, ?, 'manual', 'active', ?, ?, ?)`,
        [materialId, Number(unitPrice), now, now, operator(req), changeReason || '新增材质', now]
      );
    }
    await conn.commit();
    res.status(201).json({ id: materialId, code: trimCode, name: name || trimCode });
  } catch (error) {
    await conn.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    conn.release();
  }
});

// 材料 -> 历史价格
router.get('/materials/:id/prices', async (req, res) => {
  try {
    const rows = await db.query(
      `SELECT id, unitPrice, effectiveAt, confirmedAt, source, status, operatorName, changeReason, createdAt
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
        (materialId, unitPrice, effectiveAt, confirmedAt, source, status, operatorName, changeReason, createdAt)
       VALUES (?, ?, ?, ?, 'manual', 'active', ?, ?, ?)`,
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
      'SELECT id, code, name, costType, hourlyRate, unitRate, fixedAmount, active FROM processes WHERE active = 1 ORDER BY id'
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
      SELECT id, name, materialLossRate, toolLossRate, overheadRate, profitRate,
             taxRate, sampleMultiplier, setupFeeDefault
      FROM pricing_strategies ORDER BY id
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 新增成本策略（name 唯一，替代原 code）
router.post('/strategies', async (req, res) => {
  const { name, materialLossRate, toolLossRate, overheadRate, profitRate, taxRate, sampleMultiplier, setupFeeDefault, changeReason } = req.body || {};
  if (!name || !String(name).trim()) return res.status(400).json({ error: '策略名称(name)必填' });
  const trimName = String(name).trim();
  const numOr = (v, d) => (v != null && v !== '' && !Number.isNaN(Number(v))) ? Number(v) : d;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [exist] = await conn.query('SELECT id FROM pricing_strategies WHERE name = ?', [trimName]);
    if (exist.length) { await conn.rollback(); return res.status(409).json({ error: '该策略名称已存在' }); }
    const now = new Date();
    const [result] = await conn.query(
      `INSERT INTO pricing_strategies
        (name, materialLossRate, toolLossRate, overheadRate, profitRate, taxRate, sampleMultiplier, setupFeeDefault, createdBy, changeReason, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        trimName,
        numOr(materialLossRate, 0), numOr(toolLossRate, 0), numOr(overheadRate, 0), numOr(profitRate, 0),
        numOr(taxRate, 0.13), numOr(sampleMultiplier, 2), numOr(setupFeeDefault, 300),
        operator(req), changeReason || '新建成本策略', now, now
      ]
    );
    await conn.commit();
    res.status(201).json({ id: result.insertId, name: trimName });
  } catch (error) {
    await conn.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    conn.release();
  }
});

// 编辑策略（name 可改但唯一；+ 7率 + changeReason 审计）
router.put('/strategies/:id', async (req, res) => {
  const numericRates = ['materialLossRate','toolLossRate','overheadRate','profitRate','taxRate','sampleMultiplier','setupFeeDefault'];
  const fields = [];
  const params = [];
  const trimName = req.body.name != null ? String(req.body.name).trim() : '';
  if (trimName) { fields.push('name = ?'); params.push(trimName); }
  for (const k of numericRates) {
    if (req.body[k] != null && req.body[k] !== '') { fields.push(`\`${k}\` = ?`); params.push(Number(req.body[k])); }
  }
  if (!fields.length) return res.status(400).json({ error: '未提供可更新字段' });
  try {
    // name 唯一预校验（排除自身），避免触发 DB 的 Duplicate entry
    if (trimName) {
      const dup = await db.query('SELECT id FROM pricing_strategies WHERE name = ? AND id <> ?', [trimName, req.params.id]);
      if (dup.length) return res.status(409).json({ error: '该策略名称已存在' });
    }
    fields.push('changeReason = ?'); params.push(req.body.changeReason || '策略维护');
    fields.push('updatedAt = ?'); params.push(new Date());
    params.push(req.params.id);
    await db.query(`UPDATE pricing_strategies SET ${fields.join(', ')} WHERE id = ?`, params);
    const rows = await db.query('SELECT * FROM pricing_strategies WHERE id = ?', [req.params.id]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 删除策略（直接删；已有报价由 processSnapshot 存的率值快照保护，不受影响）
router.delete('/strategies/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM pricing_strategies WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
