const express = require('express');
const router = express.Router();
const multer = require('multer');
const Quote = require('../models/Quote');
const QuoteCalculator = require('../services/QuoteCalculator');
const AIReviewer = require('../services/AIReviewer');
const QuoteGenerator = require('../services/QuoteGenerator');
const DeepSeekService = require('../services/DeepSeekService');
const CADParserService = require('../services/CADParserService');
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

// 图纸上传 multer 配置（与 upload.js 保持一致的存储规则）
const drawingStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const uploadDrawing = multer({ storage: drawingStorage });

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
    const quotes = await Quote.findAll();
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

    const calculation = QuoteCalculator.calculate(quote);
    const updatedQuote = await Quote.update(req.params.id, {
      calculation,
      status: 'calculated'
    });

    res.json(updatedQuote);
  } catch (error) {
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

    const context = req.body.context || '';

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
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.bmp', '.webp'];
    const cadExtensions = ['.dxf', '.dwg', '.step', '.stp'];

    let analysisResult;

    if (cadExtensions.includes(ext)) {
      // --- CAD 文件解析 ---
      try {
        const parseResult = ext === '.dxf'
          ? await CADParserService.parseDXF(fullPath)
          : ext === '.dwg'
            ? await CADParserService.parseDWG(fullPath)
            : await CADParserService.parseSTEP(fullPath);

        if (!parseResult.success) {
          throw new Error(parseResult.error || 'CAD文件解析失败');
        }

        const dimensions = {
          length: quote.length || 100,
          width: quote.width || 50,
          height: quote.height || 20,
          diameter: quote.diameter || 0
        };

        if (parseResult.bounds) {
          dimensions.length = parseResult.bounds.width || dimensions.length;
          dimensions.width = parseResult.bounds.height || dimensions.width;
          if (parseResult.format === 'STEP' && parseResult.bounds.depth) {
            dimensions.height = parseResult.bounds.depth;
          }
        }

        let modelInfo = parseResult.modelInfo || { type: 'none', available: false };
        const modelCachePath = path.join(modelsDir, `${quote.id}.json`);
        if (parseResult.model?.meshes?.length) {
          fs.writeFileSync(modelCachePath, JSON.stringify(parseResult.model));
          modelInfo = { ...modelInfo, cached: true, endpoint: `/api/quotes/${quote.id}/3d-model` };
        } else if (fs.existsSync(modelCachePath)) {
          fs.unlinkSync(modelCachePath);
        }
        const { model, ...cadInfo } = parseResult;

        analysisResult = {
          partName: quote.partName || '未命名零件',
          material: quote.material || '钢材',
          dimensions,
          quantity: quote.quantity || 1,
          precision: quote.precision || '中等',
          features: parseResult.features || [],
          complexity: '中等',
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
          precision: quote.precision || '中等',
          features: [],
          complexity: '中等',
          notes: `CAD解析失败: ${parseError.message || '未知错误'}，请手动确认参数`
        };
      }
    } else if (imageExtensions.includes(ext)) {
      // --- 图片文件 AI 视觉分析 ---
      try {
        analysisResult = await DeepSeekService.analyzeDrawingWithVision(fullPath, context);
      } catch (aiError) {
        console.error('AI分析失败，使用备用分析:', aiError.message);
        analysisResult = {
          partName: quote.partName || '未命名零件',
          material: quote.material || '钢材',
          dimensions: {
            length: quote.length || 100,
            width: quote.width || 50,
            height: quote.height || 20
          },
          quantity: quote.quantity || 1,
          precision: quote.precision || '中等',
          features: [],
          complexity: '中等',
          notes: 'AI分析暂时不可用，请手动确认参数'
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
        precision: quote.precision || '中等',
        features: [],
        complexity: '中等',
        notes: `不支持的文件格式: ${ext}，请上传 DWG/DXF/STEP 或图片格式`
      };
    }

    // 将分析结果写回 quote
    const updateData = { drawingAnalysis: analysisResult };
    if (analysisResult.partName) updateData.partName = analysisResult.partName;
    if (analysisResult.material) updateData.material = analysisResult.material;
    if (analysisResult.dimensions) {
      updateData.length = analysisResult.dimensions.length;
      updateData.width = analysisResult.dimensions.width;
      updateData.height = analysisResult.dimensions.height;
      updateData.diameter = analysisResult.dimensions.diameter;
    }
    if (analysisResult.quantity) updateData.quantity = analysisResult.quantity;
    if (analysisResult.precision) updateData.precision = analysisResult.precision;

    const updatedQuote = await Quote.update(req.params.id, updateData);

    res.json({
      success: true,
      analysis: analysisResult,
      quote: updatedQuote
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

router.post('/:id/ai-quote', async (req, res) => {
  try {
    const quote = await Quote.findById(req.params.id);
    if (!quote) {
      return res.status(404).json({ error: 'Quote not found' });
    }

    const quoteData = quote.drawingAnalysis || quote;
    let aiAnalysis;

    try {
      aiAnalysis = await DeepSeekService.analyzeQuoteWithAI(quoteData);
    } catch (aiError) {
      console.error('AI报价分析失败，使用备用:', aiError.message);
      aiAnalysis = {
        materialRecommendation: quote.material || '钢材',
        processSuggestions: [
          { name: '下料', reason: '准备毛坯' },
          { name: '粗加工', reason: '去除余量' },
          { name: '精加工', reason: '保证精度' }
        ],
        priceAnalysis: { totalEstimation: '基于系统计算引擎' },
        warningPoints: ['建议人工审核确认'],
        suggestions: ['使用系统内置计算引擎']
      };
    }

    const calculation = QuoteCalculator.calculate(quote);
    const updatedQuote = await Quote.update(req.params.id, {
      calculation,
      aiQuoteAnalysis: aiAnalysis,
      status: 'ai_quoted'
    });

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
      model: JSON.parse(fs.readFileSync(modelPath, 'utf8'))
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
