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

  // 列表页只需少量展示字段；quotes 表含多个数百 KB 的 LONGTEXT JSON 列（drawingAnalysis 等），
  // SELECT * 会让列表接口随任务数线性膨胀（57 行实测 7MB+）。这里只取必要列，
  // calculation.total / blankSpec.MOQ / priceSnapshot.unitPrice 用 JSON_EXTRACT 抽取。
  static get LIST_SELECT() {
    // NULLIF 防 JSON 列存空串时 JSON_EXTRACT 报错
    return 'SELECT `id`, `materialCode`, `partName`, `partDescription`, `material`, `quantity`, `status`, `createdAt`, `updatedAt`, '
      + "JSON_UNQUOTE(JSON_EXTRACT(NULLIF(`calculation`, ''), '$.total')) AS `calcTotal`, "
      + "JSON_UNQUOTE(JSON_EXTRACT(NULLIF(`blankSpec`, ''), '$.MOQ')) AS `moq`, "
      + "JSON_UNQUOTE(JSON_EXTRACT(NULLIF(`priceSnapshot`, ''), '$.unitPrice')) AS `priceUnit` ";
  }

  static _projectListRow(row) {
    const calcTotal = row.calcTotal !== null && row.calcTotal !== undefined && row.calcTotal !== '' ? Number(row.calcTotal) : null;
    const moq = row.moq !== null && row.moq !== undefined && row.moq !== '' ? Number(row.moq) : null;
    const priceUnit = row.priceUnit !== null && row.priceUnit !== undefined && row.priceUnit !== '' ? Number(row.priceUnit) : null;
    return {
      id: row.id,
      materialCode: row.materialCode,
      partName: row.partName,
      partDescription: row.partDescription,
      material: row.material,
      quantity: row.quantity,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      // 保持前端既有取值结构不变：quote.calculation.total / quote.blankSpec.MOQ / quote.priceSnapshot.unitPrice
      calculation: calcTotal != null && Number.isFinite(calcTotal) ? { total: calcTotal } : null,
      blankSpec: moq != null && Number.isFinite(moq) ? { MOQ: moq } : {},
      priceSnapshot: priceUnit != null && Number.isFinite(priceUnit) ? { unitPrice: priceUnit } : null
    };
  }

  static async findAll() {
    const rows = await db.query(`${this.LIST_SELECT} FROM quotes ORDER BY createdAt DESC`);
    return rows.map(row => this._projectListRow(row));
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
    const rows = await db.query(`${this.LIST_SELECT} FROM quotes ${where} ORDER BY createdAt DESC`, params);
    return rows.map(row => this._projectListRow(row));
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
