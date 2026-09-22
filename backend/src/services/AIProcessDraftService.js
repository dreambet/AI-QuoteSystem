const axios = require('axios');

const safeText = (value, max = 240) => String(value == null ? '' : value).replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
const safeNumber = (value, fallback = null) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const clamp = (value, min, max, fallback) => Math.min(max, Math.max(min, safeNumber(value, fallback)));

// 只接受本地 CAD 服务生成的结构化事实；此服务从不读取 CAD 原文件、文件名、客户资料或报价价格。
class AIProcessDraftService {
  constructor() {
    this.apiKey = process.env.DEEPSEEK_API_KEY;
    this.baseUrl = process.env.DEEPSEEK_API_BASE || 'https://api.deepseek.com';
    this.model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
    this.enabled = process.env.AI_PROCESS_DRAFT_ENABLED !== 'false';
    this.timeout = Math.max(10000, Number(process.env.AI_PROCESS_DRAFT_TIMEOUT_MS) || 60000);
    this.firstTokenTimeout = Math.max(8000, Number(process.env.AI_PROCESS_DRAFT_FIRST_TOKEN_TIMEOUT_MS) || 25000);
    // deepseek-v4-flash 在兼容网关中需要显式请求，才会稳定返回推理增量。
    this.thinkingEnabled = process.env.AI_PROCESS_DRAFT_THINKING_ENABLED !== 'false';
    this.maxTokens = Math.max(800, Number(process.env.AI_PROCESS_DRAFT_MAX_TOKENS) || 1800);
  }

  get isConfigured() { return this.enabled && !!this.apiKey; }

  buildPayload(analysis, workstations) {
    const semantics = analysis.cadInfo?.stepSemantics || {};
    const rawCounts = (Array.isArray(analysis.features) ? analysis.features : []).reduce((out, item) => {
      const type = safeText(item.type || '其他实体', 40);
      out[type] = (out[type] || 0) + 1;
      return out;
    }, {});
    const radiusFacts = (items, prefix, type) => (Array.isArray(items) ? items : []).slice(0, 16).map((item, index) => ({ id: `${prefix}-${index + 1}`, type, radiusMm: safeNumber(item.radius), count: safeNumber(item.count, 0) }));
    // 直接来自 CAD 解析的曲面、半径组、实体统计；不包含 manufacturingFeatures 本地规则候选。
    const geometryFacts = [
      { id: 'surface-plane', type: '平面', count: safeNumber(semantics.planes, 0) },
      { id: 'surface-cylinder', type: '圆柱面', count: safeNumber(semantics.cylindricalSurfaces ?? semantics.cylinders, 0) },
      { id: 'surface-cone', type: '圆锥面', count: safeNumber(semantics.conicalSurfaces ?? semantics.cones, 0) },
      { id: 'surface-spline', type: '样条曲面', count: safeNumber(semantics.splineSurfaces ?? semantics.splines, 0) },
      { id: 'edge-circular', type: '圆边', count: safeNumber(semantics.circularEdges, 0) },
      ...radiusFacts(semantics.cylindricalRadii, 'cylinder-radius', '圆柱半径组'),
      ...radiusFacts(semantics.conicalRadii, 'cone-radius', '圆锥半径组'),
      ...radiusFacts(semantics.circularRadii, 'circle-radius', '圆边半径组'),
      ...Object.entries(rawCounts).slice(0, 16).map(([type, count], index) => ({ id: `entity-${index + 1}`, type, count }))
    ].filter(item => item.count > 0);
    return {
      drawing: {
        format: safeText(analysis.cadInfo?.format || 'CAD', 20),
        dimensionsMm: analysis.dimensions || {},
        dimensions: (analysis.dimensionAnnotations || []).slice(0, 24).map(item => ({ type: safeText(item.type, 24), value: safeNumber(item.value), tolerance: safeText(item.tolerance, 40) })),
        tolerance: safeText(analysis.globalTolerance, 60),
        surfaceSummary: { advancedFaces: safeNumber(semantics.advancedFaces, 0), planes: safeNumber(semantics.planes, 0), cylinders: safeNumber(semantics.cylindricalSurfaces ?? semantics.cylinders, 0), cones: safeNumber(semantics.conicalSurfaces ?? semantics.cones, 0), splines: safeNumber(semantics.splineSurfaces ?? semantics.splines, 0) }
      },
      geometryFacts,
      workstationCatalog: workstations.map(item => ({ code: safeText(item.code, 60), name: safeText(item.name, 80), costType: safeText(item.costType, 20) }))
    };
  }

  summary(payload) {
    return { format: payload.drawing.format, geometryFactCount: payload.geometryFacts.length, dimensionCount: payload.drawing.dimensions.length, workstationCount: payload.workstationCatalog.length };
  }

  messages(payload) {
    return [{
      role: 'system',
      content: `你是机加工工艺工程师。直接根据 geometryFacts、尺寸标注和曲面统计生成待人工确认的工艺初稿，不要把本地规则候选作为依据。不得编造图纸事实；不得输出材料价格、工费率、报价金额。只可使用 workstationCatalog 已有工站 code，否则 processCode 为空并标记 requiresConfiguration。sourceFactIds 和 featureIds 只能引用 geometryFacts 的 id。建议分钟数范围 1-480。推理要简洁，最终只输出 JSON：{"featureCandidates":[{"type":"孔/槽/型腔/平面/倒角等","description":"说明","sourceFactIds":["事实id"],"confidence":0.8}],"processSuggestions":[{"name":"工序","processCode":"已有工站code或空","processType":"cncMilling/drilling/turning/chamferReview/contourReview/surfaceReview/deburrReview","sequence":1,"minutes":10,"confidence":0.8,"basis":"依据","featureIds":["事实id"],"requiresConfiguration":false}],"requirementCandidates":[{"category":"材料/粗糙度/热处理/表面处理","value":"候选","confidence":0.5,"basis":"依据"}],"reviewItems":["待人工核对事项"]}`
    }, { role: 'user', content: JSON.stringify(payload) }];
  }

  parseJson(content) {
    const source = String(content || '').trim();
    const fenced = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const value = fenced ? fenced[1].trim() : source.slice(Math.max(0, source.indexOf('{')), source.lastIndexOf('}') + 1);
    return JSON.parse(value);
  }

  async generateStream(payload, { onDelta, signal } = {}) {
    const requestBody = {
      model: this.model, messages: this.messages(payload), temperature: 0.1, max_tokens: this.maxTokens, stream: true
    };
    if (this.thinkingEnabled) requestBody.thinking = { type: 'enabled' };
    const response = await axios.post(`${this.baseUrl}/chat/completions`, requestBody, { headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' }, responseType: 'stream', signal, timeout: this.timeout });
    let text = '';
    let buffer = '';
    const consume = line => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) return;
      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') return;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta || {};
        // 不同 OpenAI 兼容网关的字段命名并不完全一致，统一转发为 reasoning。
        const reasoning = delta.reasoning_content || delta.reasoning || delta.thinking;
        if (typeof reasoning === 'string' && reasoning) onDelta?.(reasoning, 'reasoning');
        if (delta.content) { text += delta.content; onDelta?.(delta.content, 'content'); }
      } catch (_) { /* 忽略非 JSON 的 SSE 心跳 */ }
    };
    for await (const chunk of response.data) {
      buffer += chunk.toString();
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, index)); buffer = buffer.slice(index + 1); }
    }
    if (buffer.trim()) consume(buffer);
    return this.parseJson(text);
  }

  validate(draft, payload) {
    const featureIds = new Set(payload.geometryFacts.map(item => item.id));
    const stations = new Map(payload.workstationCatalog.map(item => [item.code, item]));
    const knownIds = value => (Array.isArray(value) ? value : []).map(item => safeText(item, 80)).filter(id => featureIds.has(id)).slice(0, 12);
    const featureCandidates = (draft?.featureCandidates || []).slice(0, 30).map((item, index) => ({
      id: `AI-F-${index + 1}`, type: safeText(item.type || '待确认制造特征', 60), description: safeText(item.description, 200), confidence: clamp(item.confidence, 0, 1, 0.5), sourceFactIds: knownIds(item.sourceFactIds), source: 'ai'
    })).filter(item => item.description || item.sourceFactIds.length);
    const processSuggestions = (draft?.processSuggestions || []).slice(0, 16).map((item, index) => {
      const station = stations.get(safeText(item.processCode, 60));
      const minutes = clamp(item.minutes, 1, 480, null);
      if (!minutes) return null;
      return { id: `AI-P-${index + 1}`, name: safeText(station?.name || item.name || '待配置工序', 80), processCode: station?.code || '', processType: safeText(item.processType || 'contourReview', 40), sequence: Math.round(clamp(item.sequence, 1, 99, index + 1)), minutes, confidence: clamp(item.confidence, 0, 1, 0.5), basis: safeText(item.basis || 'AI 基于本地解析特征给出的待确认建议', 240), featureIds: knownIds(item.featureIds), requiresConfiguration: !station || item.requiresConfiguration === true, calculationInputs: { source: 'AI 脱敏图纸参数' }, source: 'ai' };
    }).filter(Boolean).sort((a, b) => a.sequence - b.sequence);
    const categories = new Set(['材料', '粗糙度', '热处理', '表面处理']);
    const requirementCandidates = (draft?.requirementCandidates || []).slice(0, 10).map(item => ({ category: safeText(item.category, 30), value: safeText(item.value, 120), confidence: clamp(item.confidence, 0, 1, 0.5), basis: safeText(item.basis, 160), requiresConfirmation: true })).filter(item => categories.has(item.category) && item.value);
    const reviewItems = (draft?.reviewItems || []).map(item => safeText(item, 200)).filter(Boolean).slice(0, 12);
    if (!featureCandidates.length && !processSuggestions.length && !reviewItems.length) throw new Error('AI 输出没有可采纳的有效字段');
    return { featureCandidates, processSuggestions, requirementCandidates, reviewItems };
  }
}

module.exports = new AIProcessDraftService();
