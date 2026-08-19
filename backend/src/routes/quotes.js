const express = require('express');
const router = express.Router();
const multer = require('multer');
const Quote = require('../models/Quote');
const QuoteCalculator = require('../services/QuoteCalculator');
const AIReviewer = require('../services/AIReviewer');
const QuoteGenerator = require('../services/QuoteGenerator');
const DeepSeekService = require('../services/DeepSeekService');
const cadParserPool = require('../services/cadParserPool');
// 启动即预热解析 worker（加载 occt WASM），首次图纸分析无需叠加初始化耗时
cadParserPool.warmup().catch(() => {});
const db = require('../db');
const path = require('path');
const fs = require('fs');

const uploadsDir = path.join(__dirname, '../uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}
const modelsDir = path.join(uploadsDir, 'models');
if (!fs.existsSync(modelsDir)) {
  fs.mkdirSync(modelsDir, { recursive: true });
}

// 图纸上传 multer 配置（与 upload.js 保持一致的存储规则与格式限制）
const DRAWING_EXTENSIONS = ['.dwg', '.dxf', '.step', '.stp'];
const drawingFileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (!DRAWING_EXTENSIONS.includes(ext)) {
    return cb(new Error('不支持的图纸格式，仅支持 DWG/DXF/STEP/STP'));
  }
  cb(null, true);
};
const drawingStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const uploadDrawing = multer({ storage: drawingStorage, fileFilter: drawingFileFilter });

// ---------- 计算辅助 ----------
const num = (value, fallback = 0) => {
  const n = typeof value === 'string' ? parseFloat(value) : Number(value);
  return Number.isFinite(n) ? n : fallback;
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
      amount: sel.amount != null ? num(sel.amount) : num(meta.fixedAmount)
    };
  });
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
    const { materialCode, partName, partDescription, q, status } = req.query;
    const hasFilter = materialCode || partName || partDescription || q || status;
    const quotes = hasFilter
      ? await Quote.search({ materialCode, partName, partDescription, q, status })
      : await Quote.findAll();
    res.json(quotes);
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
    const quote = await Quote.update(req.params.id, req.body);
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

    const { processSelection = [], unitPrice, strategyOverrides = {}, setupFee, strategyId } = req.body || {};

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
    const fee = setupFee != null ? num(setupFee) : num(strategy.setupFeeDefault, 0);

    // 用户第3步手填单价 -> 回写共享目录 material_prices（旧 active 转 historical，新价升为 active）。
    // 失败不阻断计算，仅告警。
    if (priceSource === 'manual') {
      try { await upsertMaterialPrice(quote.material, price); }
      catch (err) { console.warn('回写 material_prices 失败:', err.message); }
    }

    const calculation = QuoteCalculator.calculate(
      { grossWeight, netWeight, quantity: quote.quantity },
      { processSelection: selection, strategy, unitPrice: price, setupFee: fee }
    );

    const priceSnapshot = {
      unitPrice: price,
      material: quote.material,
      confirmedAt: priceConfirmedAt,
      source: priceSource,
      stale: priceSource === 'catalog' ? isStale(priceConfirmedAt) : false
    };
    const processSnapshot = {
      processSelection: selection,
      strategy: { id: strategy.id, overheadRate: strategy.overheadRate, profitRate: strategy.profitRate, taxRate: strategy.taxRate, sampleMultiplier: strategy.sampleMultiplier, materialLossRate: strategy.materialLossRate, toolLossRate: strategy.toolLossRate, setupFee: fee },
      computed: { processes: calculation.processes, additions: calculation.additions }
    };

    const updatedQuote = await Quote.update(req.params.id, {
      calculation,
      priceSnapshot,
      processSnapshot,
      strategyVersionId: strategy.id || null,
      grossWeight,
      netWeight,
      finalUnitPrice: calculation.unitPrice,
      status: 'calculated'
    });

    res.json(updatedQuote);
  } catch (error) {
    console.error('计算报价失败:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/ai-review', async (req, res) => {
  try {
    const quote = await Quote.findById(req.params.id);
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    const aiReview = AIReviewer.review(quote);
    const updatedQuote = await Quote.update(req.params.id, {
      aiReview,
      status: 'ai_reviewed'
    });

    res.json(updatedQuote);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/manual-review', async (req, res) => {
  try {
    const { status, comments } = req.body;
    const manualReview = {
      status,
      comments,
      reviewedAt: new Date().toISOString()
    };

    const updatedQuote = await Quote.update(req.params.id, {
      manualReview,
      status: status === 'approved' ? 'finalized' : 'manually_reviewed'
    });

    res.json(updatedQuote);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id/export', async (req, res) => {
  try {
    const quote = await Quote.findById(req.params.id);
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    const outputPath = path.join(uploadsDir, `quote-${quote.id}.pdf`);
    await QuoteGenerator.generatePDF(quote, outputPath);

    res.download(outputPath, `报价单-${quote.partName}.pdf`);
  } catch (error) {
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
      drawingPath = req.file.filename;
      // 同时更新 quote 上的 drawingPath
      await Quote.update(req.params.id, { drawingPath });
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

    const fullPath = path.join(uploadsDir, drawingPath);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({
        error: '图纸文件不存在',
        drawingPath,
        fullPath
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

// ---------- AI 报价建议共享逻辑 ----------
// AI 输入 = 图纸解析摘要 + 人工确认的材料/产品规格（料长/料宽/料厚/步距/内外径/毛重/净重等）。
// 单价快照 priceSnapshot 不发送，材料单价不可上传给 AI。
// 特征全量列表（可达80+条/16KB+）压缩为分类计数+有限明细，输入 token 是 LLM 响应时长的主要成分。
function buildAiQuotePayload(quote) {
  const da = quote.drawingAnalysis || {};
  const features = Array.isArray(da.features) ? da.features : [];
  const featureSummary = {};
  features.forEach(f => { const key = f.type || '其他'; featureSummary[key] = (featureSummary[key] || 0) + 1; });
  return {
    partName: da.partName || quote.partName,
    material: da.material || quote.material,
    dimensions: da.dimensions,
    quantity: quote.quantity,
    materialCode: quote.materialCode,
    grossWeight: quote.grossWeight,
    netWeight: quote.netWeight,
    materialSpec: quote.blankSpec || {},
    productSpec: quote.finishedSpec || {},
    globalTolerance: da.globalTolerance || null,
    featureSummary,
    featureDetails: features.slice(0, 15).map(f => [f.type, f.description].filter(Boolean).join(' ')),
    notes: da.notes
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
