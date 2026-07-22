
import axios from 'axios';

const API_BASE = '/api/quotes';

export const quoteApi = {
  create: (data) => axios.post(API_BASE, data),
  getAll: () => axios.get(API_BASE),
  getById: (id) => axios.get(`${API_BASE}/${id}`),
  update: (id, data) => axios.put(`${API_BASE}/${id}`, data)
};

