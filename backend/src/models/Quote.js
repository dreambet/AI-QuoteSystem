const db = require('../db');

const jsonFields = new Set([
  'blankSpec', 'finishedSpec', 'priceSnapshot', 'processSnapshot', 'calculation',
  'aiReview', 'manualReview', 'drawingAnalysis', 'aiQuoteAnalysis'
]);

const quoteFields = new Set([
  'materialCode', 'partName', 'partDescription', 'material',
  'grossWeight', 'netWeight', 'quantity', 'drawingPath', 'blankSpec', 'finishedSpec',
  'strategyVersionId', 'priceSnapshot', 'processSnapshot', 'calculation', 'aiReview',
  'manualReview', 'drawingAnalysis', 'aiQuoteAnalysis', 'finalUnitPrice', 'status'
]);

// Browser forms submit an empty input as "". SQLite accepted that value in a
// numeric column, while MySQL in strict mode correctly rejects it. Keep all
// optional numeric values nullable before they reach the database.
const nullableNumericFields = new Set([
  'grossWeight', 'netWeight', 'strategyVersionId', 'finalUnitPrice'
]);

const normalizeOptionalNumber = value => {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  return value;
};

const normalizeQuantity = value => {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return 1;
  const numeric = Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : 1;
};

const normalizeFieldValue = (key, value) => {
  if (key === 'quantity') return normalizeQuantity(value);
  return nullableNumericFields.has(key) ? normalizeOptionalNumber(value) : value;
};

const serialize = (key, value) => jsonFields.has(key) && value !== null && value !== undefined ? JSON.stringify(value) : value;
const sqlField = key => `\`${key}\``;

class Quote {
  static async create(data) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    const stamp = new Date();
    const fields = [
      'id', 'materialCode', 'partName', 'partDescription', 'material',
      'grossWeight', 'netWeight', 'quantity', 'drawingPath', 'blankSpec', 'finishedSpec',
      'strategyVersionId', 'priceSnapshot', 'processSnapshot', 'status', 'createdAt', 'updatedAt'
    ];
    const normalized = {
      ...data,
      materialCode: data.materialCode || null,
      partName: data.partName || '未命名零件',
      material: data.material || '待确认材料',
      quantity: normalizeQuantity(data.quantity),
      status: data.status || 'draft',
      createdAt: stamp,
      updatedAt: stamp
    };
    await db.query(
      `INSERT INTO quotes (${fields.map(sqlField).join(', ')}) VALUES (${fields.map(() => '?').join(', ')})`,
      fields.map(field => field === 'id' ? id : serialize(field, normalizeFieldValue(field, normalized[field])))
    );
    return this.findById(id);
  }

  static async findAll() {
    return db.query('SELECT * FROM quotes ORDER BY createdAt DESC');
  }

  // 多字段追溯搜索：materialCode / partName / partDescription / 通用 q
  static async search(filters = {}) {
    const conditions = [];
    const params = [];
    const { materialCode, partName, partDescription, q, status } = filters;
    if (status) { conditions.push('status = ?'); params.push(status); }
    if (materialCode) { conditions.push('materialCode LIKE ?'); params.push(`%${materialCode}%`); }
    if (partName) { conditions.push('partName LIKE ?'); params.push(`%${partName}%`); }
    if (partDescription) { conditions.push('partDescription LIKE ?'); params.push(`%${partDescription}%`); }
    if (q) {
      conditions.push('(materialCode LIKE ? OR partName LIKE ? OR partDescription LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like);
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    return db.query(`SELECT * FROM quotes ${where} ORDER BY createdAt DESC`, params);
  }

  static async findById(id) {
    const rows = await db.query('SELECT * FROM quotes WHERE id = ? LIMIT 1', [id]);
    return rows[0] || null;
  }

  static async update(id, data) {
    const fields = Object.keys(data).filter(key => quoteFields.has(key) && key !== 'createdAt' && data[key] !== undefined);
    if (!fields.length) return this.findById(id);
    const assignments = [...fields.map(field => `${sqlField(field)} = ?`), 'updatedAt = ?'];
    await db.query(
      `UPDATE quotes SET ${assignments.join(', ')} WHERE id = ?`,
      [...fields.map(field => serialize(field, normalizeFieldValue(field, data[field]))), new Date(), id]
    );
    return this.findById(id);
  }
}

module.exports = Quote;
