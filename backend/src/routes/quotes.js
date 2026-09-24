const express = require('express');
const router = express.Router();
const multer = require('multer');
const Quote = require('../models/Quote');
const QuoteCalculator = require('../services/QuoteCalculator');
const AIReviewer = require('../services/AIReviewer');
const QuoteExcelGenerator = require('../services/QuoteExcelGenerator');
const DeepSeekService = require('../services/DeepSeekService');
const AIProcessDraftService = require('../services/AIProcessDraftService');
const cadParserPool = require('../services/cadParserPool');
const ManufacturingFeatureService = require('../services/ManufacturingFeatureService');
// 启动即预热解析 worker（加载 occt WASM），首次图纸分析无需叠加初始化耗时
cadParserPool.warmup().catch(() => {});
const db = require('../db');
const path = require('path');
const fs = require('fs');
const DrawingStorage = require('../services/DrawingStorage');

DrawingStorage.ensureDirectories();
const uploadsDir = DrawingStorage.uploadsDir;
const modelsDir = DrawingStorage.modelsDir;

// 图纸上传 multer 配置（与 upload.js 保持一致的存储规则与格式限制）
const uploadDrawing = multer({
  storage: multer.diskStorage(DrawingStorage.multerStorage()),
  fileFilter: DrawingStorage.multerFilter,
  limits: { fileSize: DrawingStorage.maxFileSize }
});

// ---------- 计算辅助 ----------
const num = (value, fallback = 0) => {
  const n = typeof value === 'string' ? parseFloat(value) : Number(value);
  return Number.isFinite(n) ? n : fallback;
};
// AI 仅需要已确认的制造规格。集中白名单避免把余料单价、空字段或任意新增表单字段传给外部模型。
const AI_BLANK_SPEC_KEYS = ['材质', '形状', '料长', '料宽', '料厚', '外径', '内径', '步距', '毛重', 'MOQ'];
const AI_FINISHED_SPEC_KEYS = ['料长', '料宽', '料厚', '外径', '内径', '步距', '净重'];
const AI_DIMENSION_KEYS = ['length', 'width', 'height', 'diameter'];
const TECHNICAL_REQUIREMENT_PATTERN = /粗糙|(?:\bra|rz)\s*\d|公差|平面度|平行度|垂直度|同轴度|圆度|跳动|螺纹|攻牙|热处理|淬火|回火|渗碳|氮化|镀|阳极|喷砂|抛光|发黑|磷化|酸洗|钝化|去毛刺|倒角|镭雕/i;
const REVIEW_FEATURE_PATTERN = /孔|槽|腔|螺纹|攻牙|倒角|圆角|薄壁|曲面|圆锥|齿|配合|台阶|精加工/i;
const REVIEW_DIMENSION_PATTERN = /孔|直径|半径|深度|螺纹|槽|外径|内径|倒角|圆角|(?:Φ|φ|⌀)/i;
const compactAiText = (value, limit = 80) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, limit);
const compactAiObject = (source, keys) => keys.reduce((out, key) => {
  const value = source && source[key];
  if (value !== undefined && value !== null && String(value).trim() !== '') out[key] = compactAiText(value, 32);
  return out;
}, {});
const summarizeFeatureTypes = features => Object.entries((features || []).reduce((out, feature) => {
  const type = compactAiText(feature?.type || '其他', 32) || '其他';
  out[type] = (out[type] || 0) + 1;
  return out;
}, {})).sort((a, b) => b[1] - a[1]).slice(0, 16).reduce((out, [type, count]) => ({ ...out, [type]: count }), {});
const representativeFeatures = features => {
  const ranked = (features || []).map(feature => {
    const type = compactAiText(feature?.type || '其他', 32);
    const description = compactAiText(feature?.description, 88);
    const key = `${type}|${description}`;
    const priority = /孔|槽|腔|螺纹|倒角|圆角|曲面|薄壁|平面/i.test(key) ? 1 : 0;
    return { type, description, key, priority };
  }).filter(item => item.type || item.description).sort((a, b) => b.priority - a.priority);
  const seen = new Set();
  return ranked.filter(item => !seen.has(item.key) && seen.add(item.key)).slice(0, 8).map(({ type, description }) => ({ type, description }));
};
const toleranceMagnitude = value => {
  const match = compactAiText(value, 40).match(/(?:±|\+\/-|\+|-)\s*(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
};
const keyDimensionsForAi = annotations => (annotations || []).filter(item => item?.value != null).map(item => {
  const type = compactAiText(item.type || '尺寸', 24);
  const tolerance = compactAiText(item.tolerance, 32);
  const magnitude = toleranceMagnitude(tolerance);
  const featurePriority = /孔|直径|半径|深度|螺纹|槽/i.test(type) ? 20 : 0;
  const tolerancePriority = magnitude == null ? 0 : magnitude <= 0.02 ? 100 : magnitude <= 0.05 ? 70 : 35;
  return { type, value: compactAiText(item.value, 24), ...(tolerance ? { tolerance } : {}), score: tolerancePriority + featurePriority };
}).sort((a, b) => b.score - a.score).slice(0, 8).map(({ score, ...item }) => item);
const technicalRequirementsForAi = values => {
  const candidates = (values || []).flatMap(value => String(value || '').split(/[\r\n；;。]/)).map(item => compactAiText(item, 100)).filter(item => item && TECHNICAL_REQUIREMENT_PATTERN.test(item));
  return [...new Set(candidates)].slice(0, 6);
};
const classifyTechnicalRequirement = value => {
  if (/热处理|淬火|回火|渗碳|氮化/i.test(value)) return '热处理';
  if (/镀|阳极|喷砂|抛光|发黑|磷化|酸洗|钝化/i.test(value)) return '表面处理';
  if (/粗糙|(?:\bra|rz)\s*\d/i.test(value)) return '粗糙度';
  if (/螺纹|攻牙/i.test(value)) return '螺纹';
  if (/去毛刺|倒角/i.test(value)) return '去毛刺/倒角';
  return '尺寸与公差';
};
// 审核只关注会导致工序遗漏或质量风险的要求，避免整段图纸文字重复进入模型。
const technicalRequirementsForReview = values => technicalRequirementsForAi(values)
  .map(value => ({ category: classifyTechnicalRequirement(value), value }))
  .slice(0, 5);
const reviewFeatureSummary = features => Object.entries((features || []).reduce((out, feature) => {
  const type = compactAiText(feature?.type || '', 32);
  if (!type || !REVIEW_FEATURE_PATTERN.test(`${type} ${feature?.description || ''}`)) return out;
  out[type] = (out[type] || 0) + 1;
  return out;
}, {})).sort((a, b) => b[1] - a[1]).slice(0, 10).reduce((out, [type, count]) => ({ ...out, [type]: count }), {});
const representativeReviewFeatures = features => (features || []).map(feature => ({
  type: compactAiText(feature?.type || '', 32),
  description: compactAiText(feature?.description || '', 88)
})).filter(item => item.type && REVIEW_FEATURE_PATTERN.test(`${item.type} ${item.description}`))
  .filter((item, index, list) => list.findIndex(other => other.type === item.type && other.description === item.description) === index)
  .slice(0, 5);
const reviewDimensionsForAi = annotations => keyDimensionsForAi(annotations).filter(item => {
  const magnitude = toleranceMagnitude(item.tolerance);
  return REVIEW_DIMENSION_PATTERN.test(item.type) || (magnitude != null && magnitude <= 0.05);
}).slice(0, 6);
const reviewGlobalToleranceForAi = value => {
  const tolerance = compactAiText(value, 32);
  const magnitude = toleranceMagnitude(tolerance);
  return magnitude != null && magnitude <= 0.05 ? tolerance : null;
};
const reviewProcessesForAi = selection => {
  const grouped = new Map();
  for (const item of (selection || []).filter(item => item?.name)) {
    const name = compactAiText(item.name, 48);
    const costType = compactAiText(item.costType, 20);
    const key = `${name}|${costType}`;
    const current = grouped.get(key) || { name, costType, enabled: true, count: 0, minutes: 0, hasMinutes: false };
    current.count += 1;
    if (item.costType === 'time' && item.minutes != null) {
      current.minutes += num(item.minutes, 0);
      current.hasMinutes = true;
    }
    grouped.set(key, current);
  }
  return [...grouped.values()].slice(0, 10).map(item => ({
    name: item.name,
    costType: item.costType,
    enabled: item.enabled,
    ...(item.count > 1 ? { count: item.count } : {}),
    ...(item.hasMinutes ? { minutes: Math.round(item.minutes * 10) / 10 } : {})
  }));
};
// 价格和正常历史均不需要模型解读；仅把需要复核的历史异常摘要交给 AI。
const abnormalHistoryForAi = baseline => {
  if (!baseline) return null;
  const result = {};
  if (baseline.deviation && baseline.deviation !== '正常') result.unitPriceDeviation = baseline.deviation;
  if (baseline.processDiff) result.processDiff = compactAiText(baseline.processDiff, 120);
  if (baseline.durationFlags?.length) result.durationAnomalies = baseline.durationFlags.slice(0, 5).map(item => ({ process: compactAiText(item.process, 48), multiple: item.multiple }));
  return Object.keys(result).length ? result : null;
};
const STALE_DAYS = 30;
const isStale = confirmedAt => !confirmedAt || (Date.now() - new Date(confirmedAt).getTime()) > STALE_DAYS * 86400000;

// 按材料编码/名称查当前 active 单价
async function lookupMaterialPrice(material) {
  if (!material) return null;
  const rows = await db.query(
    `SELECT mp.unitPrice, mp.confirmedAt, mp.effectiveAt, m.id AS materialId, m.code
     FROM materials m LEFT JOIN material_prices mp ON mp.materialId = m.id AND mp.status = 'active'
     WHERE m.code = ? OR m.name = ? LIMIT 1`,
    [material, material]
  );
  return rows[0] || null;
}

// 把第 3 步确认的材料单价回写到共享目录 material_prices：
// 同一材质旧的 active 转 historical，新价插入为新 active（带 confirmedAt=now，视为市场确认）。
// 价格与当前 active 一致时跳过，避免重复写历史。材质不存在于 materials 时跳过（防御）。
async function upsertMaterialPrice(materialCode, unitPrice, operator = 'manual-quote') {
  if (!materialCode || unitPrice == null || Number.isNaN(Number(unitPrice))) return null;
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    const [mats] = await conn.query('SELECT id FROM materials WHERE code = ? LIMIT 1', [materialCode]);
    if (!mats.length) { await conn.rollback(); return null; }
    const materialId = mats[0].id;
    const [active] = await conn.query(
      "SELECT id, unitPrice FROM material_prices WHERE materialId = ? AND status = 'active' LIMIT 1",
      [materialId]
    );
    if (active.length && Number(active[0].unitPrice) === Number(unitPrice)) {
      await conn.commit();
      return { materialId, changed: false };
    }
    if (active.length) {
      await conn.query("UPDATE material_prices SET status = 'historical' WHERE id = ?", [active[0].id]);
    }
    const now = new Date();
    await conn.query(
      `INSERT INTO material_prices
        (materialId, unitPrice, effectiveAt, confirmedAt, source, status, operatorName, changeReason, createdAt)
       VALUES (?, ?, ?, ?, 'manual', 'active', ?, ?, ?)`,
      [materialId, Number(unitPrice), now, now, operator, '报价流程确认单价', now]
    );
    await conn.commit();
    return { materialId, changed: true };
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

// 解析报价策略：优先 strategyVersionId，其次取一条 published，再合并用户覆盖
async function resolveStrategy(strategyVersionId, overrides = {}) {
  let row;
  if (overrides.strategyId) {
    const rows = await db.query('SELECT * FROM pricing_strategies WHERE id = ? LIMIT 1', [overrides.strategyId]);
    row = rows[0];
  } else if (strategyVersionId) {
    const rows = await db.query('SELECT * FROM pricing_strategies WHERE id = ? LIMIT 1', [strategyVersionId]);
    row = rows[0];
  }
  if (!row) {
    const rows = await db.query('SELECT * FROM pricing_strategies ORDER BY id LIMIT 1');
    row = rows[0];
  }
  if (!row) {
    row = { overheadRate: 0.1, profitRate: 0.3, taxRate: 0.13, sampleMultiplier: 1, materialLossRate: 0.05, toolLossRate: 0.08, setupFeeDefault: 0 };
  }
  return {
    id: row.id,
    overheadRate: overrides.overheadRate != null ? num(overrides.overheadRate) : num(row.overheadRate),
    profitRate: overrides.profitRate != null ? num(overrides.profitRate) : num(row.profitRate),
    taxRate: overrides.taxRate != null ? num(overrides.taxRate) : (row.taxRate == null ? 0.13 : num(row.taxRate)),
    sampleMultiplier: overrides.sampleMultiplier != null ? num(overrides.sampleMultiplier) : (row.sampleMultiplier == null ? 1 : num(row.sampleMultiplier)),
    materialLossRate: overrides.materialLossRate != null ? num(overrides.materialLossRate) : num(row.materialLossRate),
    toolLossRate: overrides.toolLossRate != null ? num(overrides.toolLossRate) : num(row.toolLossRate),
    setupFeeDefault: num(row.setupFeeDefault, 0)
  };
}

// 用 processes 表补全 selection 的 name/costType/默认费率
async function enrichSelection(selection) {
  const procs = await db.query('SELECT code, name, costType, hourlyRate, unitRate, fixedAmount FROM processes WHERE active = 1');
  const map = new Map(procs.map(p => [p.code, p]));
  return (selection || []).map(sel => {
    const meta = map.get(sel.processCode) || {};
    return {
      processCode: sel.processCode,
      name: sel.name || meta.name,
      costType: sel.costType || meta.costType,
      hourlyRate: sel.hourlyRate != null ? num(sel.hourlyRate) : num(meta.hourlyRate),
      minutes: num(sel.minutes),
      unitRate: sel.unitRate != null ? num(sel.unitRate) : num(meta.unitRate),
      rate: sel.rate != null ? num(sel.rate) : null,
      amount: sel.amount != null ? num(sel.amount) : num(meta.fixedAmount),
      // 工序快照保留图纸建议的来源与依据；计算器只消费费率/时长字段。
      source: sel.source || '人工确认',
      basis: sel.basis || null,
      featureIds: Array.isArray(sel.featureIds) ? sel.featureIds : [],
      confidence: sel.confidence != null ? num(sel.confidence) : null,
      // 采纳 AI 工艺初稿时，保留当时的工艺类型、依据与置信度；仅用于核价单追溯，不参与公式计算。
      processSuggestionSnapshot: sel.processSuggestionSnapshot && typeof sel.processSuggestionSnapshot === 'object' ? {
        id: compactAiText(sel.processSuggestionSnapshot.id, 60) || null,
        source: compactAiText(sel.processSuggestionSnapshot.source || sel.source, 60) || null,
        processType: compactAiText(sel.processSuggestionSnapshot.processType, 40) || null,
        basis: compactAiText(sel.processSuggestionSnapshot.basis || sel.basis, 240) || null,
        featureIds: Array.isArray(sel.processSuggestionSnapshot.featureIds) ? sel.processSuggestionSnapshot.featureIds.map(item => compactAiText(item, 80)).filter(Boolean).slice(0, 12) : [],
        confidence: sel.processSuggestionSnapshot.confidence != null ? num(sel.processSuggestionSnapshot.confidence) : null
      } : null
    };
  });
}

// 工序确认目录快照：核价单需要同时展示本次采用与未采用的工站，
// 因此在计算时保存当时可选的全局工站，避免日后目录变更影响历史报价单。
async function getProcessCatalogSnapshot() {
  const processes = await db.query('SELECT code, name, costType, hourlyRate, unitRate, fixedAmount FROM processes WHERE active = 1 ORDER BY id');
  return processes.map(item => ({
    processCode: item.code,
    name: item.name,
    costType: item.costType,
    hourlyRate: item.hourlyRate != null ? num(item.hourlyRate) : null,
    unitRate: item.unitRate != null ? num(item.unitRate) : null,
    amount: item.fixedAmount != null ? num(item.fixedAmount) : null
  }));
}

router.post('/', async (req, res) => {
  try {
    const quote = await Quote.create(req.body);
    res.status(201).json(quote);
  } catch (error) {
    console.error('创建报价失败:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/', async (req, res) => {
  try {
    res.json(await Quote.findPage(req.query || {}));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const quote = await Quote.findById(req.params.id);
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }
    res.json(quote);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    // 状态只能由计算、AI 审核和人工审核等专用动作推进，避免浏览器直接伪造“已完成”。
    const { status: _status, ...editableFields } = req.body || {};
    if (_status !== undefined) return res.status(400).json({ error: '报价状态由系统流程自动维护，不能直接修改。' });
    const quote = await Quote.update(req.params.id, editableFields);
    res.json(quote);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/calculate', async (req, res) => {
  try {
    const quote = await Quote.findById(req.params.id);
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    const { processSelection = [], unitPrice, strategyOverrides = {}, setupFee, strategyId, priceMode, yieldRate } = req.body || {};

    // 规格：优先专用列，回退 blankSpec/finishedSpec JSON
    const blankSpec = quote.blankSpec || {};
    const finishedSpec = quote.finishedSpec || {};
    const grossWeight = num(quote.grossWeight ?? blankSpec.grossWeight ?? blankSpec['毛重']);
    const netWeight = num(quote.netWeight ?? finishedSpec.netWeight ?? finishedSpec['净重']);

    // 单价：请求体(用户第3步确认)优先 -> 材料当前 active 价格
    let price;
    let priceSource;
    let priceConfirmedAt = null;
    if (unitPrice != null && unitPrice !== '') {
      price = num(unitPrice);
      priceSource = 'manual';
      priceConfirmedAt = new Date();
    } else {
      const mat = await lookupMaterialPrice(quote.material);
      if (mat && mat.unitPrice != null) {
        price = num(mat.unitPrice);
        priceSource = 'catalog';
        priceConfirmedAt = mat.confirmedAt;
      } else {
        price = 0;
        priceSource = 'missing';
      }
    }

    const strategy = await resolveStrategy(quote.strategyVersionId, { ...strategyOverrides, strategyId: strategyOverrides.strategyId || strategyId });
    const selection = await enrichSelection(processSelection);
    const processCatalogSnapshot = await getProcessCatalogSnapshot();
    const fee = setupFee != null ? num(setupFee) : num(strategy.setupFeeDefault, 0);

    // 计价方式由形状驱动（直接价不适用于方块/球体，仅用于新增的自定义形状）：
    // 请求体优先 -> 形状（方块/球体=weight 元/kg | 自定义形状=fixed 直接价）-> weight
    let mode = priceMode === 'fixed' || priceMode === 'weight' ? priceMode : null;
    if (!mode) {
      const shape = quote.blankSpec && quote.blankSpec['形状'];
      mode = shape === '方块' || shape === '球体' || !shape ? 'weight' : 'fixed';
    }
    const resolvedMode = mode === 'fixed' ? 'fixed' : 'weight';
    const yieldPercent = num(yieldRate);

    // 面向界面的字段级校验：让报价员知道缺哪项、去哪里修，而不是只收到 500。
    const issues = [];
    if (!quote.material || quote.material === '待确认材料') {
      issues.push({ field: '材质', message: '尚未确认材质', fix: '在“材料规格（毛坯）”中选择或新增材质。' });
    }
    if (!(price > 0)) {
      issues.push({ field: resolvedMode === 'weight' ? '材料单价' : '材料价格', message: '材料价格必须大于 0', fix: '在“单价确认”中填写最新材料价格，或在材料目录维护有效价格。' });
    }
    if (resolvedMode === 'weight' && !(grossWeight > 0)) {
      issues.push({ field: '毛重', message: '按重量计价时毛重必须大于 0', fix: '填写毛坯规格和密度以自动计算毛重，或直接在“毛重(kg)”中输入确认值。' });
    }
    if (selection.some(item => item.costType === 'weight') && !(netWeight > 0)) {
      issues.push({ field: '净重', message: '已选重量型工序，但净重未填写', fix: '在“产品规格（成品）”中填写净重，或取消该重量型工序。' });
    }
    selection.filter(item => item.costType === 'time').forEach(item => {
      if (!(num(item.minutes) > 0)) issues.push({ field: item.name || item.processCode, message: '加工分钟数必须大于 0', fix: '打开“工序确认”并填写确认后的加工分钟数。' });
      if (!(num(item.hourlyRate) > 0)) issues.push({ field: item.name || item.processCode, message: '工费率必须大于 0', fix: '打开“工序确认”并填写工费率（元/小时），或移除该工序。' });
    });
    if (issues.length) return res.status(422).json({ error: '报价参数待确认', issues });

    // 用户第3步手填单价 -> 回写共享目录 material_prices（旧 active 转 historical，新价升为 active）。
    // 失败不阻断计算，仅告警。
    if (priceSource === 'manual') {
      try { await upsertMaterialPrice(quote.material, price, req.user?.username || '管理员'); }
      catch (err) { console.warn('回写 material_prices 失败:', err.message); }
    }

    const calculation = QuoteCalculator.calculate(
      { grossWeight, netWeight, quantity: quote.quantity },
      { processSelection: selection, strategy, unitPrice: price, setupFee: fee, priceMode: resolvedMode, yieldRate: yieldPercent > 0 ? yieldPercent : null }
    );

    const priceSnapshot = {
      unitPrice: price,
      material: quote.material,
      confirmedAt: priceConfirmedAt,
      source: priceSource,
      priceMode: resolvedMode,
      yieldRate: yieldPercent > 0 ? yieldPercent : null,
      stale: priceSource === 'catalog' ? isStale(priceConfirmedAt) : false
    };
    const processSnapshot = {
      processSelection: selection,
      processCatalogSnapshot,
      strategy: { id: strategy.id, overheadRate: strategy.overheadRate, profitRate: strategy.profitRate, taxRate: strategy.taxRate, sampleMultiplier: strategy.sampleMultiplier, materialLossRate: strategy.materialLossRate, toolLossRate: strategy.toolLossRate, setupFee: fee },
      computed: { processes: calculation.processes, additions: calculation.additions }
    };

    // 重算后旧审核结果语义失效：参数已变更，标记 stale 供前端提示重新审核
    const updateData = {
      calculation,
      priceSnapshot,
      processSnapshot,
      strategyVersionId: strategy.id || null,
      grossWeight,
      netWeight,
      finalUnitPrice: calculation.unitPrice,
      status: 'calculated'
    };
    if (quote.aiReview) updateData.aiReview = { ...quote.aiReview, stale: true };
    if (quote.manualReview) updateData.manualReview = { ...quote.manualReview, stale: true };
    const updatedQuote = await Quote.update(req.params.id, updateData);

    res.json(updatedQuote);
  } catch (error) {
    console.error('计算报价失败:', error);
    res.status(500).json({ error: error.message });
  }
});

// 双层审核：规则层（零成本硬门槛）+ 本地基线层（同 materialCode 历史比对，涉价计算全本地）
// + LLM 语义层（解读四类人为疏漏，白名单输入零价格）。LLM 失败静默降级为仅规则层。
router.post('/:id/ai-review', async (req, res) => {
  try {
    const quote = await Quote.findById(req.params.id);
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    // 第1层：规则引擎（硬门槛）
    const ruleResult = AIReviewer.review(quote);

    // 第2层：本地基线 + LLM 语义审核（仅在已有计算结果时执行）
    let baseline = null;
    let semantic = null;
    if (quote.calculation) {
      try {
        if (quote.materialCode) {
          const history = await db.query(
            'SELECT id, materialCode, calculation, processSnapshot, updatedAt FROM quotes WHERE materialCode = ? AND id != ? ORDER BY updatedAt DESC LIMIT 5',
            [quote.materialCode, quote.id]
          );
          baseline = AIReviewer.computeHistoryBaseline(quote, history);
        }
        const semanticPayload = buildSemanticReviewPayload(quote, baseline);
        semantic = await DeepSeekService.semanticReview(semanticPayload);
      } catch (layerError) {
        console.error('语义审核层异常(降级为仅规则层):', layerError.message);
      }
    }

    const aiReview = {
      ...ruleResult,
      baseline,
      semantic,
      reviewedAt: new Date().toISOString()
    };
    const updatedQuote = await Quote.update(req.params.id, {
      aiReview,
      status: 'ai_reviewed'
    });

    res.json(updatedQuote);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// 流式双层审核：规则层+基线本地秒出（rules 事件先行推送前端展示），
// 语义层 LLM 逐字流式（delta，reasoning/content 双通道），结束后合并落库并回传权威结果（done）。
// 客户端断开即中止上游生成，不浪费 token；LLM 失败静默降级为仅规则层仍走 done。
router.post('/:id/ai-review/stream', async (req, res) => {
  const sse = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders && res.flushHeaders();

  let quote;
  try {
    quote = await Quote.findById(req.params.id);
    if (!quote) {
      sse('error', { message: 'Quote not found' });
      return res.end();
    }
    sse('meta', { quoteId: quote.id });
  } catch (error) {
    sse('error', { message: error.message });
    return res.end();
  }

  // 客户端断开 -> 中止上游 LLM 生成
  const abort = new AbortController();
  let clientClosed = false;
  req.on('close', () => {
    clientClosed = true;
    abort.abort();
  });

  try {
    // 第1层：规则引擎（硬门槛，零成本）
    const ruleResult = AIReviewer.review(quote);

    // 第2层：本地基线（同 materialCode 历史比对，涉价计算全本地）
    let baseline = null;
    if (quote.calculation && quote.materialCode) {
      try {
        const history = await db.query(
          'SELECT id, materialCode, calculation, processSnapshot, updatedAt FROM quotes WHERE materialCode = ? AND id != ? ORDER BY updatedAt DESC LIMIT 5',
          [quote.materialCode, quote.id]
        );
        baseline = AIReviewer.computeHistoryBaseline(quote, history);
      } catch (layerError) {
        console.error('基线层异常(跳过):', layerError.message);
      }
    }
    if (clientClosed) return;
    sse('rules', { rules: ruleResult, baseline });

    // 第3层：LLM 语义审核（流式；失败返回 null 静默降级为仅规则层）
    let semantic = null;
    if (quote.calculation) {
      try {
        const semanticPayload = buildSemanticReviewPayload(quote, baseline);
        semantic = await DeepSeekService.semanticReviewStream(semanticPayload, {
          signal: abort.signal,
          onDelta: (t, kind) => { if (!clientClosed) sse('delta', { t, kind }); }
        });
      } catch (layerError) {
        if (clientClosed || layerError.code === 'ERR_CANCELED') return;
        console.error('语义审核层异常(降级为仅规则层):', layerError.message);
      }
    }
    if (clientClosed) return;

    const aiReview = {
      ...ruleResult,
      baseline,
      semantic,
      reviewedAt: new Date().toISOString()
    };
    const updatedQuote = await Quote.update(req.params.id, { aiReview, status: 'ai_reviewed' });
    // 响应瘦身：drawingAnalysis 可能数百 KB，前端已有，剔除
    const { drawingAnalysis: _skip, ...slimQuote } = updatedQuote || {};
    sse('done', { aiReview, quote: slimQuote });
  } catch (error) {
    if (clientClosed) return;
    console.error('AI流式审核失败:', error.message);
    sse('error', { message: error.message || 'AI流式审核失败' });
  }
  res.end();
});

router.post('/:id/manual-review', async (req, res) => {
  try {
    const { status, comments } = req.body;
    const quote = await Quote.findById(req.params.id);
    if (!quote) return res.status(404).json({ error: '报价任务不存在。' });
    const manualReview = {
      status,
      comments,
      reviewedAt: new Date().toISOString()
    };
    const finalized = status === 'approved';
    const archivedAt = finalized ? new Date() : null;

    const updatedQuote = await Quote.update(req.params.id, {
      manualReview,
      status: finalized ? 'finalized' : 'manually_reviewed',
      ...(finalized ? { drawingPath: null, drawingArchivedAt: archivedAt } : {})
    });

    if (finalized) {
      const cleanup = await DrawingStorage.clearCompletedQuoteDrawing(quote);
      console.info('已完成报价图纸已清理', { quoteId: quote.id, ...cleanup });
    }

    res.json(updatedQuote);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/export', async (req, res) => {
  let outputPath = null;
  try {
    const quote = await Quote.findById(req.params.id);
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }
    // 服务端硬校验：与前端按钮门槛一致，未通过人工审核或未计算的报价不允许导出
    if (quote.manualReview?.status !== 'approved') {
      return res.status(403).json({ error: '报价单需人工审核通过后才能导出' });
    }
    if (!quote.calculation) {
      return res.status(409).json({ error: '该报价尚未完成计算，无法导出' });
    }

    // 旧报价尚无工序目录快照时，以当前有效目录补齐“未采用工序”；新报价优先使用计算时快照。
    const exportQuote = quote.processSnapshot?.processCatalogSnapshot?.length
      ? quote
      : { ...quote, exportProcessCatalog: await getProcessCatalogSnapshot() };
    outputPath = path.join(uploadsDir, `quote-${quote.id}.xlsx`);
    await QuoteExcelGenerator.generate(exportQuote, outputPath);

    // 文件名过滤 Windows 非法字符与控制符，避免 Content-Disposition 异常
    const safeName = String(quote.partName || quote.id).replace(/[\\/:*?"<>|\r\n]+/g, '_').trim() || quote.id;
    res.download(outputPath, `核价单-${safeName}.xlsx`, () => {
      // 下载结束（成功或失败）即清理临时文件，避免 uploads 目录堆积
      fs.unlink(outputPath, () => {});
      outputPath = null;
    });
  } catch (error) {
    if (outputPath) fs.unlink(outputPath, () => {});
    res.status(500).json({ error: error.message });
  }
});

// POST /api/quotes/:id/analyze-drawing
// 支持三种方式提供图纸：
//   1. 直接上传文件（multipart，字段名 drawing）
//   2. 请求体 JSON 中传 drawingPath（已有文件名）
//   3. 自动使用 quote 上已存储的 drawingPath
router.post('/:id/analyze-drawing', uploadDrawing.single('drawing'), async (req, res) => {
  try {
    const quote = await Quote.findById(req.params.id);
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    // 确定图纸路径：上传文件 > 请求体 drawingPath > quote 上已存的 drawingPath
    let drawingPath;
    if (req.file) {
      try {
        await DrawingStorage.validateFileSignature(req.file.path, req.file.filename);
      } catch (error) {
        await DrawingStorage.removeFileIfExists(req.file.path);
        return res.status(400).json({ error: error.message });
      }
      drawingPath = req.file.filename;
      // 同时更新 quote 上的 drawingPath
      await Quote.update(req.params.id, { drawingPath, drawingName: String(req.file.originalname || '').slice(0, 255) });
    } else if (req.body.drawingPath) {
      drawingPath = req.body.drawingPath;
    } else if (quote.drawingPath) {
      drawingPath = quote.drawingPath;
    }

    if (!drawingPath) {
      return res.status(400).json({
        error: '需要提供图纸',
        hint: '请上传图纸文件，或在请求体中提供 drawingPath，或先为报价单关联图纸'
      });
    }

    // 路径穿越防御：drawingPath 可能来自客户端，必须落在 uploadsDir 内
    let fullPath;
    try { fullPath = DrawingStorage.resolveDrawing(drawingPath); } catch (error) { return res.status(400).json({ error: error.message }); }
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({
        error: '图纸文件不存在或已按保留策略清理。'
      });
    }

    const ext = path.extname(fullPath).toLowerCase();
    const cadExtensions = ['.dxf', '.dwg', '.step', '.stp'];

    let analysisResult;

    if (cadExtensions.includes(ext)) {
      // --- CAD 文件解析（worker 线程执行 + 同文件缓存，不阻塞事件循环） ---
      try {
        const { result: parseResult, cached: parseCached } = ext === '.dxf'
          ? await cadParserPool.parseDXF(fullPath)
          : ext === '.dwg'
            ? await cadParserPool.parseDWG(fullPath)
            : await cadParserPool.parseSTEP(fullPath);

        if (!parseResult.success) {
          throw new Error(parseResult.error || 'CAD文件解析失败');
        }

        // 仅用本地几何数据生成制造特征和候选工序；不调用模型、不直接写入报价金额。
        // 非 STEP/STP 返回空结果，二维格式仍沿用现有轮廓/标注解析与人工确认。
        const manufacturing = ManufacturingFeatureService.analyze(parseResult);

        const dimensions = {
          length: num((quote.blankSpec || {})['料长']) || 100,
          width: num((quote.blankSpec || {})['料宽']) || 50,
          height: num((quote.blankSpec || {})['料厚']) || 20,
          diameter: num((quote.blankSpec || {})['外径']) || 0
        };

        if (parseResult.bounds) {
          dimensions.length = parseResult.bounds.width || dimensions.length;
          dimensions.width = parseResult.bounds.height || dimensions.width;
          if (parseResult.format === 'STEP' && parseResult.bounds.depth) {
            dimensions.height = parseResult.bounds.depth;
          }
        }

        // 尺寸标注优先：用 DIMENSION 实体的实测值覆盖 bounds 估算值，更贴近图纸标注
        const dimAnn = parseResult.dimensionAnnotations || [];
        if (dimAnn.length) {
          const dia = dimAnn.find(d => d.type === '直径' && d.value != null);
          const rad = dimAnn.find(d => d.type === '半径' && d.value != null);
          if (dia) dimensions.diameter = dia.value;
          else if (rad) dimensions.diameter = rad.value * 2;
          const linears = dimAnn
            .filter(d => (d.type === '线性' || d.type === '对齐') && d.value != null)
            .map(d => d.value)
            .sort((a, b) => b - a);
          if (linears.length) dimensions.length = linears[0];
          if (linears.length > 1) dimensions.width = linears[1];
        }

        let modelInfo = parseResult.modelInfo || { type: 'none', available: false };
        const modelCachePath = path.join(modelsDir, `${quote.id}.json`);
        if (parseResult.model?.meshes?.length) {
          // 命中解析缓存且模型缓存文件仍在时跳过重写（内容相同，避免每次分析都写数 MB 文件）
          if (!parseCached || !fs.existsSync(modelCachePath)) {
            await fs.promises.writeFile(modelCachePath, JSON.stringify(parseResult.model));
          }
          modelInfo = { ...modelInfo, cached: true, endpoint: `/api/quotes/${quote.id}/3d-model` };
        } else if (fs.existsSync(modelCachePath)) {
          await fs.promises.unlink(modelCachePath).catch(() => {});
        }
        // features/dimensionAnnotations 已是顶层字段，cadInfo 里不再重复携带（此前双份存储使 drawingAnalysis 体积翻倍）
        const { model, features: _f, dimensionAnnotations: _d, ...cadInfo } = parseResult;

        analysisResult = {
          partName: quote.partName || '未命名零件',
          material: quote.material || '钢材',
          dimensions,
          quantity: quote.quantity || 1,
          features: parseResult.features || [],
          manufacturingFeatures: manufacturing.features,
          processSuggestions: manufacturing.processSuggestions,
          unresolvedItems: manufacturing.unresolved,
          dimensionAnnotations: dimAnn,
          globalTolerance: parseResult.globalTolerance || null,
          notes: parseResult.message || 'CAD文件已解析，请手动确认参数',
          modelInfo,
          cadInfo: { ...cadInfo, modelInfo }
        };
      } catch (parseError) {
        console.error('CAD解析失败:', parseError.message || parseError);
        analysisResult = {
          partName: quote.partName || '未命名零件',
          material: quote.material || '钢材',
          dimensions: {
            length: quote.length || 100,
            width: quote.width || 50,
            height: quote.height || 20,
            diameter: quote.diameter || 0
          },
          quantity: quote.quantity || 1,
          features: [],
          notes: `CAD解析失败: ${parseError.message || '未知错误'}，请手动确认参数`
        };
      }
    } else {
      analysisResult = {
        partName: quote.partName || '未命名零件',
        material: quote.material || '钢材',
        dimensions: {
          length: quote.length || 100,
          width: quote.width || 50,
          height: quote.height || 20
        },
        quantity: quote.quantity || 1,
        features: [],
        notes: `不支持的文件格式: ${ext}，请上传 DWG/DXF/STEP/STP 格式图纸`
      };
    }

    // 将分析结果写回 quote
    const updateData = { drawingAnalysis: analysisResult };
    if (analysisResult.partName) updateData.partName = analysisResult.partName;
    if (analysisResult.material) updateData.material = analysisResult.material;
    if (analysisResult.quantity) updateData.quantity = analysisResult.quantity;

    const updatedQuote = await Quote.update(req.params.id, updateData);

    // 响应瘦身：drawingAnalysis 已单独作为 analysis 返回，quote 里不再重复携带数百 KB
    const { drawingAnalysis: _skipAnalysis, ...slimQuote } = updatedQuote || {};
    res.json({
      success: true,
      analysis: analysisResult,
      quote: slimQuote
    });

  } catch (error) {
    console.error('图纸分析失败:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      message: '图纸分析失败'
    });
  }
});

// 本地 CAD 解析已经落库后，流式生成 AI 工艺初稿。AI 失败始终回退本地规则，不阻断人工确认/报价。
router.post('/:id/ai-process-draft/stream', async (req, res) => {
  // 每条事件主动 flush，避免开发代理/部分浏览器等到缓冲区积累后才显示，导致“实时”内容空白。
  const sse = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    if (typeof res.flush === 'function') res.flush();
  };
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders && res.flushHeaders();
  sse('meta', { stage: 'connecting', message: '正在建立 AI 工艺分析连接…' });
  let quote;
  try {
    quote = await Quote.findById(req.params.id);
    if (!quote) { sse('error', { message: '报价任务不存在' }); return res.end(); }
    if (!quote.drawingAnalysis) { sse('error', { message: '请先完成本地 CAD 解析' }); return res.end(); }
  } catch (error) { sse('error', { message: error.message }); return res.end(); }

  const abort = new AbortController();
  let clientClosed = false;
  // 监听响应关闭，而不是 req.close：POST 请求体读取完不代表 SSE 客户端已离开。
  res.on('close', () => { if (!res.writableEnded) { clientClosed = true; abort.abort(); } });
  req.on('aborted', () => { clientClosed = true; abort.abort(); });
  let receivedDelta = false;
  const heartbeat = setInterval(() => { if (!clientClosed && !res.writableEnded) sse('meta', { stage: 'ai', message: receivedDelta ? 'AI 正在继续生成工艺初稿' : 'AI 请求已发送，正在等待模型返回第一段内容' }); }, 3000);
  const firstTokenTimer = setTimeout(() => { if (!receivedDelta && !clientClosed) abort.abort('AI 首段输出超时'); }, AIProcessDraftService.firstTokenTimeout);
  const fallback = async reason => {
    const analysis = { ...quote.drawingAnalysis, aiProcessDraft: { status: 'fallback', generatedAt: new Date().toISOString(), reason: safeSseReason(reason), validation: 'AI 不可用，使用本地规则初稿' } };
    const updated = await Quote.update(quote.id, { drawingAnalysis: analysis });
    const { drawingAnalysis: _skip, ...slimQuote } = updated || {};
    sse('done', { analysis, quote: slimQuote, fallback: true });
  };
  try {
    const workstations = await db.query('SELECT code, name, costType FROM processes WHERE active = 1 ORDER BY id');
    const payload = AIProcessDraftService.buildPayload(quote.drawingAnalysis, workstations);
    sse('meta', { stage: 'ai', message: AIProcessDraftService.isConfigured ? '本地解析完成，已构建脱敏参数并发送给 AI' : 'AI 未配置，正在准备本地规则初稿', inputSummary: AIProcessDraftService.summary(payload) });
    if (!AIProcessDraftService.isConfigured) { await fallback('AI 工艺初稿未配置'); return res.end(); }
    console.info('AI 工艺初稿任务开始', { quoteId: quote.id, summary: AIProcessDraftService.summary(payload) });
    const raw = await AIProcessDraftService.generateStream(payload, { signal: abort.signal, onDelta: (t, kind) => { receivedDelta = true; if (!clientClosed) sse('delta', { t, kind }); } });
    if (clientClosed) return;
    const draft = AIProcessDraftService.validate(raw, payload);
    const analysis = {
      ...quote.drawingAnalysis,
      localRuleDraft: { manufacturingFeatures: quote.drawingAnalysis.manufacturingFeatures || [], processSuggestions: quote.drawingAnalysis.processSuggestions || [], unresolvedItems: quote.drawingAnalysis.unresolvedItems || [] },
      manufacturingFeatures: draft.featureCandidates,
      processSuggestions: draft.processSuggestions,
      unresolvedItems: draft.reviewItems,
      aiProcessDraft: { status: 'ai', generatedAt: new Date().toISOString(), model: AIProcessDraftService.model, inputSummary: AIProcessDraftService.summary(payload), validation: '已通过特征引用、工站与分钟数范围校验', requirementCandidates: draft.requirementCandidates }
    };
    const updated = await Quote.update(quote.id, { drawingAnalysis: analysis });
    const { drawingAnalysis: _skip, ...slimQuote } = updated || {};
    sse('done', { analysis, quote: slimQuote, fallback: false });
  } catch (error) {
    if (!clientClosed) {
      console.warn('AI 工艺初稿失败，回退本地规则', { quoteId: quote.id, message: error.message });
      try { await fallback(error.message); } catch (fallbackError) { sse('error', { message: fallbackError.message }); }
    }
  } finally { clearInterval(heartbeat); clearTimeout(firstTokenTimer); }
  res.end();
});

function safeSseReason(value) {
  return String(value || 'AI 服务不可用').replace(/[\r\n]+/g, ' ').slice(0, 160);
}

// ---------- AI 报价建议共享逻辑 ----------
// 报价建议输入白名单：以人工确认规格、已选工序和关键制造事实为主。
// 原始 CAD、文件名、客户信息、材料单价、报价金额、余料单价、全量特征及解析备注均不进入模型。
function buildAiQuotePayload(quote) {
  const da = quote.drawingAnalysis || {};
  const features = Array.isArray(da.features) ? da.features : [];
  return {
    inputVersion: 'quote-advice-v2',
    material: compactAiText(quote.material || da.material, 48) || null,
    quantity: Math.max(1, num(quote.quantity, 1)),
    weightsKg: { gross: num(quote.grossWeight, 0) || null, net: num(quote.netWeight, 0) || null },
    confirmedSpecs: {
      blank: compactAiObject(quote.blankSpec, AI_BLANK_SPEC_KEYS),
      finished: compactAiObject(quote.finishedSpec, AI_FINISHED_SPEC_KEYS)
    },
    envelopeMm: compactAiObject(da.dimensions, AI_DIMENSION_KEYS),
    globalTolerance: reviewGlobalToleranceForAi(da.globalTolerance),
    keyDimensions: keyDimensionsForAi(da.dimensionAnnotations),
    featureSummary: summarizeFeatureTypes(features),
    representativeFeatures: representativeFeatures(features),
    technicalRequirements: technicalRequirementsForAi([quote.partDescription, da.notes]),
    confirmedProcesses: ((quote.processSnapshot && quote.processSnapshot.processSelection) || []).filter(item => item?.name).slice(0, 12).map(item => ({ name: compactAiText(item.name, 48), costType: item.costType, ...(item.costType === 'time' && item.minutes != null ? { minutes: num(item.minutes, 0) } : {}) }))
  };
}

// 语义审核输入白名单（零价格）：只带与人工确认疏漏相关的规格、工序、关键公差、特征和本地基线结论。
function buildSemanticReviewPayload(quote, baseline) {
  const da = quote.drawingAnalysis || {};
  const features = Array.isArray(da.features) ? da.features : [];
  return {
    inputVersion: 'semantic-review-v2',
    material: compactAiText(quote.material, 48) || null,
    confirmedSpecs: {
      blank: compactAiObject(quote.blankSpec, AI_BLANK_SPEC_KEYS),
      finished: compactAiObject(quote.finishedSpec, AI_FINISHED_SPEC_KEYS)
    },
    globalTolerance: compactAiText(da.globalTolerance, 32) || null,
    keyDimensions: reviewDimensionsForAi(da.dimensionAnnotations),
    technicalRequirements: technicalRequirementsForReview([quote.partDescription, da.notes]),
    featureSummary: reviewFeatureSummary(features),
    representativeFeatures: representativeReviewFeatures(features),
    processes: reviewProcessesForAi((quote.processSnapshot && quote.processSnapshot.processSelection) || []),
    quantity: Math.max(1, num(quote.quantity, 1)),
    setupFeeApplied: Number(quote.calculation && quote.calculation.setupFee) > 0,
    history: abnormalHistoryForAi(baseline)
  };
}

// 落库 AI 分析结果（复用第3步已算的 calculation，缺失则从 processSnapshot 重算）
async function persistAiQuote(quote, aiAnalysis) {
  let calculation = quote.calculation;
  if (!calculation && quote.processSnapshot) {
    const ps = quote.processSnapshot;
    calculation = QuoteCalculator.calculate(
      { grossWeight: quote.grossWeight, netWeight: quote.netWeight, quantity: quote.quantity },
      { processSelection: ps.processSelection, strategy: ps.strategy, unitPrice: quote.priceSnapshot && quote.priceSnapshot.unitPrice, setupFee: ps.strategy && ps.strategy.setupFee }
    );
  }
  const updateData = { aiQuoteAnalysis: aiAnalysis, status: 'ai_quoted' };
  if (calculation) updateData.calculation = calculation;
  const updatedQuote = await Quote.update(quote.id, updateData);
  return { calculation, updatedQuote };
}

router.post('/:id/ai-quote', async (req, res) => {
  try {
    const quote = await Quote.findById(req.params.id);
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    const quoteData = buildAiQuotePayload(quote);
    let aiAnalysis;

    try {
      aiAnalysis = await DeepSeekService.analyzeQuoteWithAI(quoteData);
    } catch (aiError) {
      console.error('AI报价分析失败，使用备用:', aiError.message);
      aiAnalysis = {
        materialRecommendation: quote.material || '待确认材料',
        processSuggestions: (quote.processSnapshot && Array.isArray(quote.processSnapshot.processSelection)
          ? quote.processSnapshot.processSelection
              .filter(s => s.costType === 'time' && s.minutes > 0)
              .slice(0, 3)
              .map(s => ({ name: s.name, reason: '已选机加工工序' }))
          : []),
        priceAnalysis: { totalEstimation: '基于系统计算引擎（K/R/S/T/U/V/W）' },
        warningPoints: ['AI 暂不可用，建议人工审核', '请确认材料单价为最新市场价'],
        suggestions: ['使用系统内置计算引擎', '在工序确认面板核对加工时长']
      };
    }

    const { calculation, updatedQuote } = await persistAiQuote(quote, aiAnalysis);

    res.json({
      success: true,
      aiAnalysis: aiAnalysis,
      calculation: calculation,
      quote: updatedQuote
    });

  } catch (error) {
    console.error('AI报价失败:', error);
    res.status(500).json({
      error: error.message,
      message: 'AI报价失败'
    });
  }
});

// 流式 AI 报价建议：SSE 转发增量文本（delta），流结束后解析落库并回传权威状态（done）。
// 客户端断开即中止上游生成，不浪费 token；失败时前端降级走非流式 /ai-quote。
router.post('/:id/ai-quote/stream', async (req, res) => {
  const sse = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders && res.flushHeaders();

  let quote;
  try {
    quote = await Quote.findById(req.params.id);
    if (!quote) {
      sse('error', { message: 'Quote not found' });
      return res.end();
    }
    sse('meta', { quoteId: quote.id });
  } catch (error) {
    sse('error', { message: error.message });
    return res.end();
  }

  // 客户端断开 -> 中止上游 LLM 生成
  const abort = new AbortController();
  let clientClosed = false;
  req.on('close', () => {
    clientClosed = true;
    abort.abort();
  });

  try {
    const quoteData = buildAiQuotePayload(quote);
    const aiAnalysis = await DeepSeekService.analyzeQuoteWithAIStream(quoteData, {
      signal: abort.signal,
      onDelta: (t, kind) => { if (!clientClosed) sse('delta', { t, kind }); }
    });
    if (clientClosed) return;

    const { calculation, updatedQuote } = await persistAiQuote(quote, aiAnalysis);
    // 响应瘦身：updatedQuote 里的 drawingAnalysis 可能数百 KB，流式场景前端已有，剔除
    const { drawingAnalysis: _skip, ...slimQuote } = updatedQuote || {};
    sse('done', { aiAnalysis, calculation, quote: slimQuote });
  } catch (error) {
    if (clientClosed) return;
    console.error('AI流式报价失败:', error.message);
    sse('error', { message: error.message || 'AI流式报价失败' });
  }
  res.end();
});

router.get('/:id/3d-model', async (req, res) => {
  try {
    const quote = await Quote.findById(req.params.id);
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    const modelPath = path.join(modelsDir, `${quote.id}.json`);
    if (!fs.existsSync(modelPath)) {
      return res.status(404).json({
        success: false,
        error: '该报价没有可用的原始三维模型；二维图纸请使用推断模型，或重新上传 STEP/STP 文件。'
      });
    }

    res.json({
      success: true,
      modelType: 'mesh',
      source: 'step',
      model: JSON.parse(await fs.promises.readFile(modelPath, 'utf8'))
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
