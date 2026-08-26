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
- materialSpec（材料规格/毛坯）与 productSpec（产品规格/成品）中的料长、料宽、料厚、步距、外径、毛重、净重等是**人工确认后的准确值**，优先于图纸解析的 dimensions 估算值，请以它们为准。
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

  // 语义审核共享的消息构造（非流式/流式同一份 prompt，保证行为一致）
  _semanticMessages(payload) {
    return [
      {
        role: 'system',
        content: `你是机加工报价单的交付前质检员。报价由确定性公式计算（不会错），你检查的是人工确认环节的疏漏。只报告有具体依据的问题，不做泛化建议。

检测维度（按优先级）：
1. 工序完整性：partDescription/partName 中的表面处理关键词（酸洗钝化/阳极/镀镍/镭雕/热处理等）在 processes 中是否遗漏；材料牌号常见配套工艺（如 S31603 需酸洗钝化）是否缺失。
2. 特征-工序匹配：featureSummary 中的孔/槽特征数量与已选加工工序是否匹配（如大量孔位却无任何孔加工工序）。
3. 加工时长合理性：processes 的 minutes 与规格（料长/外径/毛重）和特征复杂度是否相称（如料长12mm车床90分钟）。
4. 规格自洽：毛重<净重、毛重/净重>3、方料与圆料规格同填冲突、MOQ=1却收调机费等矛盾。
5. 公差-工序匹配：globalTolerance 或 keyDimensions 中的紧公差（≤±0.02）是否有磨床等精加工工序支撑。
6. 历史漂移解读：history 字段是本地计算的基线结论（首次报价/工序差异/时长倍数异常/单件价偏离等级），据此提示用户核实是否改错参数。history 中不含价格数字。

输出要求：
- 只输出确实存在的问题，宁缺毋滥；没有问题返回空 findings 并在 summary 说明"未发现明显疏漏"。
- 每条 finding 的 location 必须是以下之一："工序确认"、"材料规格"、"产品规格"、"基本信息"。
- message 一句话（≤50字），evidence 引用具体输入字段值作为依据。
- 最多输出8条，按 severity（high/medium/low）降序。

以JSON格式返回：
{
  "findings": [
    { "severity": "high", "dimension": "工序完整性", "location": "工序确认", "message": "……", "evidence": "……" }
  ],
  "summary": "一句话总体结论"
}`
      },
      {
        role: 'user',
        content: JSON.stringify(payload, null, 2)
      }
    ];
  }

  // 解析语义审核输出。截断（finish_reason=length / 流中断）导致 JSON 不闭合时，
  // 尝试从残缺文本中抢救已完整闭合的 finding 对象，避免整次 LLM 调用白费
  _parseSemanticContent(content, finishReason) {
    const text = String(content || '');
    try {
      const parsed = this.parseJsonContent(text);
      return Array.isArray(parsed.findings) ? parsed : { findings: [], summary: parsed.summary || '' };
    } catch (e) {
      const findings = this._salvageSemanticFindings(text);
      console.error(
        `语义审核返回JSON解析失败: ${e.message}（finish_reason=${finishReason || 'unknown'}, 正文长度=${text.length}, 抢救出${findings.length}条完整发现）`,
        text ? `尾部片段: ...${text.slice(-160)}` : '正文为空'
      );
      if (findings.length) return { findings, summary: '模型输出被截断，以上为已完整生成的发现' };
      return null;
    }
  }

  // 从截断的语义审核输出中提取已闭合的 finding（扁平结构，花括号不嵌套）
  _salvageSemanticFindings(text) {
    const out = [];
    const start = text.indexOf('"findings"');
    if (start < 0) return out;
    const arrStart = text.indexOf('[', start);
    if (arrStart < 0) return out;
    const re = /\{[^{}]*\}/g;
    let match;
    while ((match = re.exec(text.slice(arrStart + 1)))) {
      try {
        const finding = JSON.parse(match[0]);
        if (finding && (finding.message || finding.dimension)) out.push(finding);
      } catch (_) { /* 不完整对象忽略 */ }
    }
    return out;
  }

  // 语义审核：交付前的自动质检，专抓第3步人工确认环节的疏漏。
  // 输入为白名单构造（零价格），本地基线层结果以枚举/倍数注入。
  // 返回 { findings: [{severity, dimension, location, message, evidence}], summary }；失败返回 null（降级为仅规则层）。
  async semanticReview(payload) {
    if (!this.isConfigured) return null;

    try {
      const response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        { model: this.model, messages: this._semanticMessages(payload), temperature: 0.2, max_tokens: 4000 },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
      const choice = response.data.choices[0];
      return this._parseSemanticContent(choice.message.content, choice.finish_reason);
    } catch (error) {
      console.error('DeepSeek语义审核失败:', error.message);
      return null;
    }
  }

  // 流式版语义审核：onDelta(text, kind) 逐段回调（reasoning/content），signal 取消时中止上游。
  // 返回值与非流式一致；失败返回 null（降级为仅规则层），客户端取消向上抛由路由结束响应。
  async semanticReviewStream(payload, { onDelta, signal } = {}) {
    if (!this.isConfigured) return null;

    let response;
    try {
      response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        { model: this.model, messages: this._semanticMessages(payload), temperature: 0.2, max_tokens: 4000, stream: true },
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
      console.error('DeepSeek语义审核流式请求建立失败:', error.message);
      return null;
    }

    let result;
    try {
      result = await this._consumeStream(response, onDelta);
    } catch (error) {
      if (error.code === 'ERR_CANCELED') throw error;
      console.error('DeepSeek语义审核流式失败:', error.message);
      return null;
    }
    return this._parseSemanticContent(result.content, result.finishReason);
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
    let result;
    try {
      result = await this._consumeStream(response, onDelta);
    } catch (error) {
      if (error.code === 'ERR_CANCELED') throw error;
      throw error; // 流中途异常向上抛，由路由发 error 事件并降级
    }

    try {
      return this.parseJsonContent(result.content);
    } catch (e) {
      console.error('AI返回JSON解析失败(流式):', e.message);
      return { rawText: full };
    }
  }

  // 消费 chat/completions SSE 流：逐行解析 delta，reasoning_content/content 双通道回调，
  // 仅正文累积进返回值（思考过程不参与 JSON 解析）。流中途异常向上抛。
  async _consumeStream(response, onDelta) {
    let full = '';
    let buf = '';
    let finishReason = null;
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
        const choice = json.choices && json.choices[0];
        const delta = (choice && choice.delta) || {};
        if (choice && choice.finish_reason) finishReason = choice.finish_reason;
        if (delta.reasoning_content) {
          if (onDelta) onDelta(delta.reasoning_content, 'reasoning');
        }
        if (delta.content) {
          full += delta.content;
          if (onDelta) onDelta(delta.content, 'content');
        }
      }
    }
    return { content: full, finishReason };
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

