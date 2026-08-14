
import axios from 'axios';

const API_BASE = '/api/quotes';
const CATALOG_BASE = '/api/catalog';

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
  export: (id) => axios.get(`${API_BASE}/${id}/export`, { responseType: 'blob' }),
  analyzeDrawing: (id, data) => axios.post(`${API_BASE}/${id}/analyze-drawing`, data),
  aiQuote: (id, data) => axios.post(`${API_BASE}/${id}/ai-quote`, data),
  get3DModel: (id) => axios.get(`${API_BASE}/${id}/3d-model`)
};

export const catalogApi = {
  getMaterials: () => axios.get(`${CATALOG_BASE}/materials`),
  createMaterial: (data) => axios.post(`${CATALOG_BASE}/materials`, data),
  getMaterialPrices: (id) => axios.get(`${CATALOG_BASE}/materials/${id}/prices`),
  confirmPrice: (id, data) => axios.post(`${CATALOG_BASE}/materials/${id}/prices`, data),
  getProcesses: () => axios.get(`${CATALOG_BASE}/processes`),
  updateProcess: (id, data) => axios.put(`${CATALOG_BASE}/processes/${id}`, data),
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
