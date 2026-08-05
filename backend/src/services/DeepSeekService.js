const axios = require('axios');
const fs = require('fs');
const path = require('path');
const db = require('../db');

class DeepSeekService {
  constructor() {
    this.apiKey = process.env.DEEPSEEK_API_KEY;
    this.baseUrl = process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com';
    this.isConfigured = !!this.apiKey;
  }

  async analyzeDrawingWithVision(imagePath, additionalContext = '') {
    if (!this.isConfigured) {
      throw new Error('DeepSeek API key not configured');
    }

    try {
      const imageData = fs.readFileSync(imagePath);
      const base64Image = imageData.toString('base64');
      const mimeType = this.getMimeType(imagePath);
      console.log('---->');
      const response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model: 'deepseek-chat',
          messages: [
            {
              role: 'system',
              content: `你是一个专业的机加工图纸分析专家。请分析提供的图纸，提取详细的机加工参数。

请以JSON格式返回以下信息：
{
  "partName": "零件名称（推测或提取）",
  "material": "推荐材料（如：45号钢、铝材、不锈钢等）",
  "dimensions": {
    "length": 长度数值,
    "width": 宽度数值,
    "height": 高度数值,
    "diameter": 直径数值（如果是圆形零件）
  },
  "quantity": 1,
  "precision": "精度要求（low/medium/high/very_high）",
  "features": [
    {
      "type": "特征类型（hole/slot/thread/surface等）",
      "description": "特征描述",
      "parameters": {
        "diameter": 直径（如有）,
        "depth": 深度（如有）,
        "count": 数量（如有）
      }
    }
  ],
  "tolerances": {
    "general": "一般公差",
    "critical": "关键公差说明"
  },
  "surfaceRequirements": "表面处理要求",
  "heatTreatment": "热处理要求",
  "complexity": "复杂程度（simple/medium/hard/complex）",
  "estimatedVolume": 估计体积（cm³）,
  "notes": "其他注意事项"
}

请确保返回纯粹的JSON，不要有其他文字说明。使用中文回答。`
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `请分析这张机加工图纸，提取详细参数。${additionalContext}`
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${mimeType};base64,${base64Image}`
                  }
                }
              ]
            }
          ],
          temperature: 0.3,
          max_tokens: 4096,
          response_format: { type: 'json_object' }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const content = response.data.choices[0].message.content;
      try {
        return JSON.parse(content);
      } catch (e) {
        return { rawText: content, error: 'JSON解析失败' };
      }

    } catch (error) {
      console.error('DeepSeek API调用失败:', error.response?.data || error.message);
      throw new Error(`图纸分析失败: ${error.message}`);
    }
  }

  async analyzeQuoteWithAI(quoteData) {
    if (!this.isConfigured) {
      return this.fallbackQuoteAnalysis(quoteData);
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model: 'deepseek-chat',
          messages: [
            {
              role: 'system',
              content: `你是一个专业的机加工报价工程师。根据提供的零件参数，给出详细的报价分析建议。

请以JSON格式返回：
{
  "materialRecommendation": "材料推荐",
  "processSuggestions": [
    {
      "process": "工序名称",
      "reason": "推荐理由",
      "estimatedTime": "预估时间（小时）"
    }
  ],
  "priceAnalysis": {
    "materialCost": "材料成本说明",
    "laborCost": "人工成本说明",
    "equipmentCost": "设备费用说明",
    "totalEstimation": "总价预估范围"
  },
  "warningPoints": ["注意事项1", "注意事项2"],
  "suggestions": ["优化建议1", "优化建议2"]
}

请以JSON格式返回，使用中文。`
            },
            {
              role: 'user',
              content: `请分析以下机加工零件并给出报价建议：

零件信息：
${JSON.stringify(quoteData, null, 2)}`
            }
          ],
          temperature: 0.7,
          max_tokens: 3000,
          response_format: { type: 'json_object' }
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const content = response.data.choices[0].message.content;
      try {
        return JSON.parse(content);
      } catch (e) {
        return { rawText: content };
      }

    } catch (error) {
      console.error('DeepSeek报价分析失败:', error);
      return this.fallbackQuoteAnalysis(quoteData);
    }
  }

  async fallbackQuoteAnalysis(quoteData) {
    // 从工序目录取前几道机加工工序作为建议（替代旧硬编码 下料/粗加工/精加工）
    let processSuggestions = [
      { process: '车床', reason: '基础机加工工序' },
      { process: 'CNC（三轴）', reason: '型面加工' },
      { process: '铣床', reason: '补充加工' }
    ];
    try {
      const rows = await db.query("SELECT name FROM processes WHERE costType = 'time' AND active = 1 ORDER BY id LIMIT 3");
      if (rows.length) processSuggestions = rows.map(p => ({ process: p.name, reason: '机加工工序' }));
    } catch (_) { /* 保持默认 */ }

    return {
      materialRecommendation: '建议使用标准材料',
      processSuggestions,
      priceAnalysis: {
        materialCost: '毛重 × 单价',
        machiningCost: 'Σ 工费率/60 × 加工时长',
        totalEstimation: '基于现有计算引擎（K/R/S/T/U/V/W）'
      },
      warningPoints: ['建议进行人工审核', '请确认材料单价为最新市场价'],
      suggestions: ['建议上传更清晰的图纸', '在工序确认面板核对加工时长']
    };
  }

  getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp',
      '.webp': 'image/webp'
    };
    return mimeTypes[ext] || 'image/png';
  }
}

module.exports = new DeepSeekService();

