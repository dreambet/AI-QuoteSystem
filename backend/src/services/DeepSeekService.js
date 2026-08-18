const axios = require('axios');
const db = require('../db');

class DeepSeekService {
  constructor() {
    this.apiKey = process.env.DEEPSEEK_API_KEY;
    this.baseUrl = process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com';
    this.model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
    this.isConfigured = !!this.apiKey;
  }

  async analyzeQuoteWithAI(quoteData) {
    if (!this.isConfigured) {
      return this.fallbackQuoteAnalysis(quoteData);
    }

    try {
      const response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model: this.model,
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
          max_tokens: 4096,
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
        return this.parseJsonContent(content);
      } catch (e) {
        console.error('AI返回JSON解析失败:', e.message);
        return { rawText: content };
      }

    } catch (error) {
      console.error('DeepSeek报价分析失败:', error);
      return this.fallbackQuoteAnalysis(quoteData);
    }
  }

  // DeepSeek 概率性用 ```json ... ``` 围栏包裹 JSON（大 payload 时更常见），先剥围栏再解析
  parseJsonContent(content) {
    let text = String(content || '').trim();
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (fenced) {
      text = fenced[1].trim();
    } else {
      // 无围栏但前后混有说明文字时，截取首尾大括号之间的部分
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start >= 0 && end > start) {
        text = text.slice(start, end + 1);
      }
    }
    return JSON.parse(text);
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
}

module.exports = new DeepSeekService();

