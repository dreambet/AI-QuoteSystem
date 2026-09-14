
import axios from 'axios';

const API_BASE = '/api/quotes';
const CATALOG_BASE = '/api/catalog';

// SSE 流式 POST 通用处理：事件以空行分隔，事件体可能跨 chunk，按 \n\n 缓冲切分后分发到 handlers。
// 事件：meta / rules / delta(t, kind) / done / error
const ssePost = async (url, body, handlers = {}, signal) => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
    signal
  });
  if (!res.ok || !res.body) throw new Error('流式接口不可用 (' + res.status + ')');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let sep;
    while ((sep = buf.indexOf('\n\n')) >= 0) {
      const raw = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      let eventName = '';
      const dataLines = [];
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) eventName = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (!dataLines.length) continue;
      let data;
      try { data = JSON.parse(dataLines.join('\n')); } catch (_) { continue; }
      if (eventName === 'delta') handlers.onDelta && handlers.onDelta(data.t, data.kind);
      else if (eventName === 'meta') handlers.onMeta && handlers.onMeta(data);
      else if (eventName === 'rules') handlers.onRules && handlers.onRules(data);
      else if (eventName === 'done') handlers.onDone && handlers.onDone(data);
      else if (eventName === 'error') handlers.onError && handlers.onError(data);
    }
  }
};

export const quoteApi = {
  create: (data) => axios.post(API_BASE, data),
  // 支持追溯过滤：{ materialCode, partName, partDescription, q, status }
  getAll: (params) => axios.get(API_BASE, { params: params || {} }),
  getById: (id) => axios.get(`${API_BASE}/${id}`),
  update: (id, data) => axios.put(`${API_BASE}/${id}`, data),
  // 按新计算引擎：{ processSelection, unitPrice, strategyOverrides, strategyId, setupFee }
  calculate: (id, data) => axios.post(`${API_BASE}/${id}/calculate`, data || {}),
  aiReview: (id) => axios.post(`${API_BASE}/${id}/ai-review`),
  manualReview: (id, data) => axios.post(`${API_BASE}/${id}/manual-review`, data),
  exportExcel: (id) => axios.get(`${API_BASE}/${id}/export`, { responseType: 'blob' }),
  analyzeDrawing: (id, data) => axios.post(`${API_BASE}/${id}/analyze-drawing`, data),
  aiQuote: (id, data) => axios.post(`${API_BASE}/${id}/ai-quote`, data),
  // 流式 AI 报价建议：SSE 增量转发。handlers: { onMeta, onDelta(t), onDone(data), onError(err) }
  // signal: AbortController.signal，取消即中止上游生成
  aiQuoteStream: (id, handlers = {}, signal) => ssePost(
    API_BASE + '/' + id + '/ai-quote/stream',
    { useAnalysisData: true },
    handlers,
    signal
  ),
  // 流式 AI 审核：规则层+基线秒出（onRules），语义层逐字流式（onDelta），结束回传权威结果（onDone）
  aiReviewStream: (id, handlers = {}, signal) => ssePost(
    API_BASE + '/' + id + '/ai-review/stream',
    {},
    handlers,
    signal
  ),
  get3DModel: (id) => axios.get(`${API_BASE}/${id}/3d-model`)
};

export const catalogApi = {
  getMaterials: () => axios.get(`${CATALOG_BASE}/materials`),
  createMaterial: (data) => axios.post(`${CATALOG_BASE}/materials`, data),
  updateMaterial: (id, data) => axios.put(`${CATALOG_BASE}/materials/${id}`, data),
  getMaterialPrices: (id) => axios.get(`${CATALOG_BASE}/materials/${id}/prices`),
  confirmPrice: (id, data) => axios.post(`${CATALOG_BASE}/materials/${id}/prices`, data),
  getProcesses: () => axios.get(`${CATALOG_BASE}/processes`),
  createProcess: (data) => axios.post(`${CATALOG_BASE}/processes`, data),
  updateProcess: (id, data) => axios.put(`${CATALOG_BASE}/processes/${id}`, data),
  deleteProcess: (id) => axios.delete(`${CATALOG_BASE}/processes/${id}`),
  getShapes: () => axios.get(`${CATALOG_BASE}/shapes`),
  createShape: (data) => axios.post(`${CATALOG_BASE}/shapes`, data),
  deleteShape: (id) => axios.delete(`${CATALOG_BASE}/shapes/${id}`),
  getStrategies: () => axios.get(`${CATALOG_BASE}/strategies`),
  createStrategy: (data) => axios.post(`${CATALOG_BASE}/strategies`, data),
  updateStrategy: (id, data) => axios.put(`${CATALOG_BASE}/strategies/${id}`, data),
  deleteStrategy: (id) => axios.delete(`${CATALOG_BASE}/strategies/${id}`)
};

export const uploadApi = {
  uploadDrawing: (file) => {
    const formData = new FormData();
    formData.append('drawing', file);
    return axios.post('/api/upload/drawing', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
  }
};
