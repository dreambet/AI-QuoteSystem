const axios = require('axios');
const db = require('../db');

class DeepSeekService {
  constructor() {
    this.apiKey = process.env.DEEPSEEK_API_KEY;
    this.baseUrl = process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com';
    this.model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
    this.isConfigured = !!this.apiKey;
  }

  // 报价建议共享的消息构造（非流式/流式同一份 prompt，保证行为一致）
  _quoteMessages(quoteData) {
    return [
      {
        role: 'system',
        content: `你是一个专业的机加工报价工程师。根据提供的零件参数，给出详细的报价分析建议。

输入数据说明：
- materialSpec（材料规格/毛坯）与 productSpec（产品规格/成品）中的料长、料宽、料厚、步距、外径、内径、毛重、净重等是**人工确认后的准确值**，优先于图纸解析的 dimensions 估算值，请以它们为准。
- grossWeight/netWeight 为确认后的毛重(kg)/净重(kg)；featureSummary 为图纸特征分类计数，featureDetails 为代表性特征明细。
- 输入中不包含材料单价信息，请勿猜测或要求具体单价，报价判断基于几何、工序与重量。

输出精简要求（用户在界面等待，务必控制篇幅）：
- processSuggestions 最多5条，每条 reason 不超过40字
- warningPoints、suggestions 各最多4条，每条一句话
- priceAnalysis 各字段一句话

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
    ];
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
          messages: this._quoteMessages(quoteData),
          temperature: 0.7,
          max_tokens: 2500,
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

  // 流式版：onDelta(text) 逐段回调增量文本；signal 用于客户端取消时中止上游生成。
  // 返回值与非流式一致（解析后的结构体或 rawText 兜底）。
  async analyzeQuoteWithAIStream(quoteData, { onDelta, signal } = {}) {
    if (!this.isConfigured) {
      return this.fallbackQuoteAnalysis(quoteData);
    }

    let response;
    try {
      response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model: this.model,
          messages: this._quoteMessages(quoteData),
          temperature: 0.7,
          max_tokens: 2500,
          stream: true
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          responseType: 'stream',
          signal
        }
      );
    } catch (error) {
      if (error.code === 'ERR_CANCELED') throw error; // 客户端取消：向上抛，不落库
      console.error('DeepSeek流式请求建立失败:', error.message);
      return this.fallbackQuoteAnalysis(quoteData);
    }

    // SSE 行可能跨 chunk 断裂，按行缓冲解析
    let full = '';
    let buf = '';
    try {
      for await (const chunk of response.data) {
        buf += chunk.toString();
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          let json;
          try { json = JSON.parse(payload); } catch (_) { continue; }
          const delta = (json.choices && json.choices[0] && json.choices[0].delta) || {};
          // 推理模型先流式输出思考过程（reasoning_content）再输出正文（content），
          // 两者都回调（kind: 'reasoning' | 'content'），正文才累积参与最终解析
          if (delta.reasoning_content) {
            if (onDelta) onDelta(delta.reasoning_content, 'reasoning');
          }
          if (delta.content) {
            full += delta.content;
            if (onDelta) onDelta(delta.content, 'content');
          }
        }
      }
    } catch (error) {
      if (error.code === 'ERR_CANCELED') throw error;
      throw error; // 流中途异常向上抛，由路由发 error 事件并降级
    }

    try {
      return this.parseJsonContent(full);
    } catch (e) {
      console.error('AI返回JSON解析失败(流式):', e.message);
      return { rawText: full };
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

